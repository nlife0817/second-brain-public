"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushState,
  sendTestPush,
  type PushState,
} from "@/lib/notifications/client";

export function NotificationsSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onEnable() {
    setBusy(true);
    setMessage(null);
    try {
      await enablePushNotifications();
      setMessage({ kind: "ok", text: "Уведомления включены" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function onDisable() {
    setBusy(true);
    setMessage(null);
    try {
      await disablePushNotifications();
      setMessage({ kind: "ok", text: "Уведомления выключены" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function onTest() {
    setBusy(true);
    setMessage(null);
    try {
      await sendTestPush();
      setMessage({ kind: "ok", text: "Тестовый пуш отправлен — проверь уведомления" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="size-4 text-slate-500" />
        <h3 className="font-semibold">Push-уведомления</h3>
      </div>

      {!state && (
        <p className="text-sm text-slate-500">Проверяю…</p>
      )}

      {state && !state.supported && (
        <p className="text-sm text-slate-500">
          Не поддерживается в этом браузере ({state.reason}). Open PWA on mobile home screen.
        </p>
      )}

      {state?.supported && (
        <>
          <div className="text-sm text-slate-600 space-y-1">
            <div>
              Разрешение:{" "}
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-xs">
                {state.permission}
              </code>
            </div>
            <div>
              Подписка:{" "}
              <span className={state.subscribed ? "text-emerald-600" : "text-slate-400"}>
                {state.subscribed ? "активна" : "неактивна"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!state.subscribed ? (
              <Button onClick={onEnable} disabled={busy} size="sm">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
                <span className="ml-2">Включить уведомления</span>
              </Button>
            ) : (
              <>
                <Button onClick={onTest} disabled={busy} size="sm" variant="outline">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  <span className="ml-2">Отправить тест</span>
                </Button>
                <Button onClick={onDisable} disabled={busy} size="sm" variant="ghost">
                  <BellOff className="size-4" />
                  <span className="ml-2">Выключить</span>
                </Button>
              </>
            )}
          </div>

          <ul className="text-xs text-slate-500 space-y-1 pt-1">
            <li>• За 1 час до дедлайна (если у задачи указано время).</li>
            <li>• В 09:00 НСК в день дедлайна (для задач без времени).</li>
            <li>• В 21:00 НСК — сводка на завтра + просрочки.</li>
          </ul>
        </>
      )}

      {message && (
        <p
          className={
            message.kind === "ok"
              ? "text-sm text-emerald-600"
              : "text-sm text-red-600"
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
