"use client";

// Подписка на push-уведомления. Без неё фоновая рассылка v2 не имеет адресатов.

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushState,
  type PushState,
} from "@/lib/notifications/client";

// Подписка авторизуется по core-identity: приглашённый участник должен уметь
// включить уведомления, не будучи заведённым где-то ещё.
const V2_PUSH = { subscribeUrl: "/api/v2/push/subscribe" };

function describe(state: PushState): string {
  if (!state.supported) return "Браузер не поддерживает уведомления";
  if (state.permission === "denied") return "Уведомления заблокированы в настройках браузера";
  return state.subscribed ? "Уведомления включены на этом устройстве" : "Уведомления выключены";
}

export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getPushState());
    } catch {
      setState({ supported: false, reason: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle() {
    if (!state?.supported) return;
    setBusy(true);
    setError(null);
    try {
      if (state.subscribed) await disablePushNotifications(V2_PUSH);
      else await enablePushNotifications(V2_PUSH);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить подписку");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const canToggle = state.supported && state.permission !== "denied";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="flex-1 text-sm text-muted-foreground">{describe(state)}</p>
      {canToggle && (
        <Button variant="outline" size="sm" onClick={() => void toggle()} disabled={busy}>
          {state.supported && state.subscribed ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {state.supported && state.subscribed ? "Отключить" : "Включить"}
        </Button>
      )}
      {error && <span className="w-full text-sm text-destructive">{error}</span>}
    </div>
  );
}
