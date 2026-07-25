import { createSupabaseBrowserClient } from "./supabase/client";

export type UploadResult = {
  path: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
};

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export async function uploadAttachment(file: File): Promise<UploadResult> {
  const supabase = createSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  const owner = user?.id ?? "anon";
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${owner}/${ts}-${rand}-${safeFileName(file.name || "file")}`;

  const { error } = await supabase.storage.from("attachments").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;

  // Signed URL valid for 1 year (bucket is private).
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed?.signedUrl) throw signErr ?? new Error("No signed URL");

  return {
    path,
    url: signed.signedUrl,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}

export async function uploadDataUrl(dataUrl: string, suggestedName = "image.png"): Promise<UploadResult> {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) throw new Error("Not a data URL");
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = !!match[2];
  const payload = match[3];
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  const ext = mimeType.split("/")[1]?.split("+")[0] ?? "bin";
  const name = suggestedName.includes(".") ? suggestedName : `${suggestedName}.${ext}`;
  const file = new File([bytes], name, { type: mimeType });
  return await uploadAttachment(file);
}
