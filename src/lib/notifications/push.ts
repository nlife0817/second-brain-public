import webpush from "web-push";
import { prepare } from "../sql";

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

export type PushAction = {
  action: string;       // identifier matched by service worker on click
  title: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  itemId?: string;
  requireInteraction?: boolean;
  actions?: PushAction[];
};

type SubscriptionRow = {
  id: string;
  user_email: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToEmail(
  email: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  configure();
  const subs = await prepare<SubscriptionRow>(
    "SELECT id, user_email, endpoint, p256dh, auth FROM push_subscriptions WHERE user_email = ?"
  ).all(email);

  let sent = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      // 404 Not Found / 410 Gone → subscription is dead, drop it.
      if (statusCode === 404 || statusCode === 410) {
        await prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        removed++;
      } else {
        console.error(`[push] send failed for ${sub.endpoint.slice(0, 60)}:`, err);
      }
    }
  }
  return { sent, removed };
}

export async function sendPushToAllSubscribers(
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  configure();
  const subs = await prepare<SubscriptionRow>(
    "SELECT id, user_email, endpoint, p256dh, auth FROM push_subscriptions"
  ).all();

  let sent = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        removed++;
      } else {
        console.error(`[push] send failed for ${sub.endpoint.slice(0, 60)}:`, err);
      }
    }
  }
  return { sent, removed };
}
