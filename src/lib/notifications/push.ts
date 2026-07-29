import webpush from "web-push";

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID keys are not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env"
    );
  }
  // P-256 базовый формат: public 65 байт → 87 base64url-символов; private 32 байта → 43 символа.
  if (publicKey.length !== 87 || !publicKey.startsWith("B")) {
    throw new Error(
      `VAPID public key invalid format (expected 87-char base64url starting with "B", got length=${publicKey.length})`
    );
  }
  if (privateKey.length !== 43) {
    throw new Error(
      `VAPID private key invalid format (expected 43-char base64url, got length=${privateKey.length})`
    );
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error(`VAPID subject must start with mailto: or https://, got "${subject}"`);
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Непрочитанные уведомления получателя — бейдж на иконке приложения (setAppBadge). */
  unread?: number;
};

/**
 * Отправка в один endpoint. "dead" — подписка протухла (404/410): вызывающий
 * обязан удалить её из своей таблицы, иначе очередь копит мёртвые адреса.
 */
export async function sendWebPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<"sent" | "dead" | "failed"> {
  configure();
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    );
    return "sent";
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    // 404 Not Found / 410 Gone → subscription is dead.
    if (statusCode === 404 || statusCode === 410) return "dead";
    console.error(`[push] send failed for ${sub.endpoint.slice(0, 60)}:`, err);
    return "failed";
  }
}
