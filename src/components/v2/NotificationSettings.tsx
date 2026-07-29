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
import { cachedGet, invalidate } from "@/lib/core/query";
import { browserTimezone } from "@/lib/core/timezone";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

/** Один ответ на два блока настроек — путь общий и для кэша, и для сброса. */
const SETTINGS_PATH = "/notifications/settings";

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

// ---- Режим тишины, сводка и напоминания ---------------------------------------------------

interface DeliverySettings {
  timezone: string;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  digest_hour: number;
  reminders_enabled: boolean;
}

interface SettingsResponse {
  settings: DeliverySettings;
  muted_projects: string[];
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function DeliveryPreferences() {
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Через кэш: на десктопной странице этот же ответ читает и список проектов —
  // без него экран дважды спрашивал бы одно и то же.
  useEffect(() => {
    void cachedGet<SettingsResponse>(SETTINGS_PATH)
      .then((res) => setSettings(res.settings))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Не удалось загрузить"));
  }, []);

  async function save(patch: Partial<DeliverySettings>) {
    const prev = settings;
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setError(null);
    try {
      const res = await api.patch<{ settings: DeliverySettings }>(SETTINGS_PATH, patch);
      setSettings(res.settings);
      invalidate(SETTINGS_PATH);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      if (prev) setSettings(prev);
    }
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">{error ?? "Загрузка…"}</p>;
  }

  const deviceTz = browserTimezone();

  return (
    <div className="flex flex-col">
      {error && <p className="pb-2 text-sm text-destructive">{error}</p>}

      <Row
        label="Напоминать о сроках"
        hint="За полчаса до времени задачи, при просрочке и утренней сводкой"
      >
        <Checkbox
          checked={settings.reminders_enabled}
          onCheckedChange={(checked) => void save({ reminders_enabled: checked === true })}
        />
      </Row>

      <Row label="Утренняя сводка" hint="Час по вашему местному времени">
        <select
          value={settings.digest_hour}
          disabled={!settings.reminders_enabled}
          onChange={(e) => void save({ digest_hour: Number(e.target.value) })}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </Row>

      <Row
        label="Не беспокоить"
        hint="В это время push не приходит: уведомления копятся и приходят одним сообщением после окончания"
      >
        <Checkbox
          checked={settings.quiet_enabled}
          onCheckedChange={(checked) => void save({ quiet_enabled: checked === true })}
        />
      </Row>

      {settings.quiet_enabled && (
        <Row label="Тихие часы" hint="Можно задать через полночь — например, с 22:00 до 08:00">
          <input
            type="time"
            value={settings.quiet_start}
            onChange={(e) => void save({ quiet_start: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">—</span>
          <input
            type="time"
            value={settings.quiet_end}
            onChange={(e) => void save({ quiet_end: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
        </Row>
      )}

      <Row label="Часовой пояс" hint="Определяется устройством — задавать вручную не нужно">
        <span className="text-sm text-muted-foreground">
          {settings.timezone}
          {deviceTz && deviceTz !== settings.timezone && " → " + deviceTz}
        </span>
      </Row>
    </div>
  );
}

// ---- Отключение по проектам ----------------------------------------------------------------

export function ProjectMutes() {
  const projects = useV2Store((s) => s.projects);
  const [muted, setMuted] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void cachedGet<SettingsResponse>(SETTINGS_PATH)
      .then((res) => setMuted(new Set(res.muted_projects)))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Не удалось загрузить");
        setMuted(new Set());
      });
  }, []);

  async function toggle(projectId: string, mute: boolean) {
    setMuted((prev) => {
      const next = new Set(prev ?? []);
      if (mute) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
    try {
      const res = await api.put<{ muted_projects: string[] }>(SETTINGS_PATH, {
        project_id: projectId,
        muted: mute,
      });
      setMuted(new Set(res.muted_projects));
      invalidate(SETTINGS_PATH);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  if (!muted) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">Доступных проектов пока нет.</p>;
  }

  return (
    <div className="flex flex-col">
      {error && <p className="pb-2 text-sm text-destructive">{error}</p>}
      {projects.map((project) => (
        <Row key={project.id} label={project.name}>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            не беспокоить
            <Checkbox
              checked={muted.has(project.id)}
              onCheckedChange={(checked) => void toggle(project.id, checked === true)}
            />
          </label>
        </Row>
      ))}
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
