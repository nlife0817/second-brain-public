import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cfEmail = req.headers.get("cf-access-authenticated-user-email");
  const devEmail = process.env.DEV_AUTH_EMAIL;
  const nodeEnv = process.env.NODE_ENV;

  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (key.startsWith("cf-") || key.startsWith("x-")) {
      allHeaders[key] = value;
    }
  });

  return NextResponse.json({
    cfEmail,
    devEmail: devEmail ?? null,
    nodeEnv,
    cfAndXHeaders: allHeaders,
  });
}
