"use client";

// Блоки раздела уведомлений. Общие для десктопной страницы
// /v2/settings/notifications и мобильных настроек: правило «что присылать»
// одно на человека, и расходиться между оболочками ему нельзя.

import { useCallback, useEffect, useState } from "react";
import { Laptop, Send, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/core/client";
import {
  NOTIFICATION_KINDS,
  type NotificationPref,
  type NotificationPrefs,
} from "@/lib/core/notification-kinds";
import { cn } from "@/lib/utils";

// ---- Проверочная отправка ----------------------------------------------------------------

export function PushTestButton({ className }: { className?: string }) {
  const [state, setState] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setState(null);
    try {
      const res = await api.post<{ sent: number }>("/push/test");
      setState({
        ok: true,
        text: res.sent === 1 ? "Отправлено на 1 устройство" : `Отправлено на ${res.sent} устройства`,
      });
    } catch (e) {
      setState({ ok: false, text: e instanceof Error ? e.message : "Не удалось отправить" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button variant="outline" size="sm" onClick={() => void send()} disabled={busy}>
        <Send className="size-4" />
        {busy ? "Отправляем…" : "Проверить"}
      </Button>
      {state && (
        <span className={cn("text-sm", state.ok ? "text-muted-foreground" : "text-destructive")}>
          {state.text}
        </span>
      )}
    </div>
  );
}

// ---- Устройства --------------------------------------------------------------------------

interface PushDeviceView {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

/** Человеческое имя устройства: браузер + платформа из user-agent. */
function describeDevice(ua: string | null): string {
  if (!ua) return "Неизвестное устройство";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /YaBrowser/.test(ua) ? "Яндекс.Браузер"
    : /Firefox/.test(ua) ? "Firefox"
    : /Chrome/.test(ua) ? "Chrome"
    : /Safari/.test(ua) ? "Safari"
    : "Браузер";
  const platform =
    /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return platform ? `${browser} · ${platform}` : browser;
}

function isMobileAgent(ua: string | null): boolean {
  return !!ua && /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

export function PushDevices() {
  const [devices, setDevices] = useState<PushDeviceView[] | null>(null);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ devices: PushDeviceView[] }>("/push/subscribe");
      setDevices(res.devices);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить устройства");
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Своё устройство помечается на клиенте: сервер не знает, из какого браузера
  // пришёл запрос — endpoint известен только самому браузеру.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setCurrentEndpoint(sub?.endpoint ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.del(`/push/subscribe?id=${encodeURIComponent(id)}`);
      setDevices((prev) => (prev ?? []).filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отключить устройство");
    } finally {
      setBusyId(null);
    }
  }

  if (devices === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {devices.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Ни одно устройство не подписано — push приходить не будет.
        </p>
      )}
      {devices.map((device) => {
        const current = !!currentEndpoint && device.endpoint === currentEndpoint;
        const Icon = isMobileAgent(device.user_agent) ? Smartphone : Laptop;
        return (
          <div key={device.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {describeDevice(device.user_agent)}
                {current && <span className="ml-1.5 text-xs text-muted-foreground">· это устройство</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                подписано {new Date(device.created_at).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Отключить это устройство"
              disabled={busyId === device.id}
              onClick={() => void remove(device.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// ---- Типы событий ------------------------------------------------------------------------

export function NotificationKinds() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ prefs: NotificationPrefs }>("/notifications/prefs")
      .then((res) => setPrefs(res.prefs))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Не удалось загрузить настройки");
        setPrefs({});
      });
  }, []);

  async function save(kind: string, next: NotificationPref) {
    // Оптимистично: переключатель обязан отвечать сразу, а не через круг до
    // сервера. Ошибка вернёт прежнее значение.
    const prev = prefs?.[kind];
    setPrefs((p) => ({ ...(p ?? {}), [kind]: next }));
    setSavingKind(kind);
    setError(null);
    try {
      const res = await api.put<{ prefs: NotificationPrefs }>("/notifications/prefs", {
        kind,
        inbox: next.inbox,
        push: next.push,
      });
      setPrefs(res.prefs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      if (prev) setPrefs((p) => ({ ...(p ?? {}), [kind]: prev }));
    } finally {
      setSavingKind(null);
    }
  }

  if (prefs === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  return (
    <div className="flex flex-col">
      {error && <p className="pb-2 text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-4 border-b border-border pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Событие</span>
        <span className="w-24 text-center">В приложении</span>
        <span className="w-16 text-center">Push</span>
      </div>
      {NOTIFICATION_KINDS.map(({ kind, label, hint }) => {
        const pref = prefs[kind] ?? { inbox: true, push: true };
        const busy = savingKind === kind;
        return (
          <div key={kind} className="flex items-center gap-4 border-b border-border py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <div className="flex w-24 justify-center">
              <Checkbox
                checked={pref.inbox}
                disabled={busy}
                onCheckedChange={(checked) => void save(kind, { inbox: checked === true, push: pref.push })}
              />
            </div>
            <div className="flex w-16 justify-center">
              {/* Push без записи в инбоксе не существует: рассылка собирается
                  из core.notifications, а её при выключенном инбоксе нет. */}
              <Checkbox
                checked={pref.inbox && pref.push}
                disabled={busy || !pref.inbox}
                onCheckedChange={(checked) => void save(kind, { inbox: pref.inbox, push: checked === true })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
