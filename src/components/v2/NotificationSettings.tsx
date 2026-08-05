"use client";

// Блоки раздела уведомлений. Общие для десктопной страницы
// /v2/settings/notifications и мобильных настроек: правило «что присылать»
// одно на человека, и расходиться между оболочками ему нельзя.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Laptop, Send, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/core/client";
import {
  DEFAULT_PREF,
  NOTIFICATION_KINDS,
  type NotificationPref,
  type NotificationPrefs,
} from "@/lib/core/notification-kinds";
import { isValidHhMm, type DeliverySettings } from "@/lib/core/delivery";
import { plural } from "@/lib/core/plural";
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
        text: `Отправлено на ${plural(res.sent, "устройство", "устройства", "устройств")}`,
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

// ---- Телеграм ------------------------------------------------------------------------------

interface TelegramLinkView {
  chat_id: string;
  username: string | null;
  first_name: string | null;
  created_at: string;
}

interface TelegramStatus {
  /** Настроен ли бот на сервере: без токена подключать нечего. */
  configured: boolean;
  link: TelegramLinkView | null;
}

/**
 * Подключение телеграма. Привязку подтверждает сам бот — приложение об этом
 * узнаёт только следующим запросом, поэтому после перехода по ссылке экран
 * опрашивает статус: иначе человек возвращается из телеграма на страницу,
 * которая по-прежнему предлагает подключиться.
 */
const LINK_POLL_MS = 3000;
const LINK_POLL_LIMIT = 40; // ≈2 минуты — дольше ждать возвращения нет смысла

export function TelegramConnect() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  /** Запасной путь, когда всплывающее окно заблокировано браузером. */
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<TelegramStatus>("/telegram/link");
    setStatus(res);
    return res;
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Не удалось загрузить статус");
      setStatus({ configured: false, link: null });
    });
  }, [load]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setWaiting(false);
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  async function connect() {
    setBusy(true);
    setError(null);
    setNote(null);
    setManualUrl(null);
    try {
      const res = await api.post<{ url: string }>("/telegram/link");
      // Всплывающее окно, открытое после ответа сервера, а не прямо в
      // обработчике клика, часть браузеров блокирует — отсюда запасная ссылка
      // рядом с кнопкой, а не только надежда на window.open.
      const opened = window.open(res.url, "_blank", "noopener,noreferrer");
      if (!opened) setManualUrl(res.url);
      setWaiting(true);
      let ticks = 0;
      stopPolling();
      pollRef.current = setInterval(() => {
        ticks++;
        void load()
          .then((next) => {
            if (next.link) stopPolling();
            else if (ticks >= LINK_POLL_LIMIT) stopPolling();
          })
          .catch(() => stopPolling());
      }, LINK_POLL_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить ссылку");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    setNote(null);
    setManualUrl(null);
    stopPolling();
    try {
      await api.del("/telegram/link");
      setStatus({ configured: true, link: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отключить");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.post("/telegram/test");
      setNote("Отправлено — проверьте чат с ботом");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить");
      // Заблокированный бот сервер уже отвязал — перечитываем статус, иначе
      // экран продолжает показывать подключение как рабочее.
      void load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  if (!status.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Бот не настроен на сервере: в окружении нет TELEGRAM_BOT_TOKEN.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {manualUrl && (
        <p className="text-sm text-muted-foreground">
          Браузер заблокировал открытие телеграма —{" "}
          <a
            href={manualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            откройте ссылку вручную
          </a>
          .
        </p>
      )}

      {status.link ? (
        <>
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <Check className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {status.link.username
                  ? `@${status.link.username}`
                  : status.link.first_name || "Чат подключён"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                подключён{" "}
                {new Date(status.link.created_at).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
              <Send className="size-4" />
              Проверить
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
              <Trash2 className="size-4" />
              Отключить
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void connect()}>
            <Send className="size-4" />
            Подключить Telegram
          </Button>
          {waiting && (
            <span className="text-sm text-muted-foreground">
              Ждём подтверждения в боте — нажмите «Запустить» в открывшемся чате
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Режим тишины, сводка и напоминания ---------------------------------------------------

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

/**
 * Поле времени с черновиком.
 *
 * Наивный `onChange → сохранить` шлёт запрос на каждое нажатие, а пока часы
 * набраны, а минуты нет, поле отдаёт пустую строку — сервер честно отвечает
 * «время в формате ЧЧ:ММ», и человек видит ошибку посреди набора. Поэтому
 * набор живёт в черновике, а сохраняется завершённое значение.
 */
function TimeField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  // Значение пришло с сервера (или откатилось после ошибки) — показываем его.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(next: string) {
    if (!isValidHhMm(next) || next === value) return;
    onCommit(next);
  }

  return (
    <input
      type="time"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => {
        // Незавершённый набор не сохраняем и возвращаем прежнее значение.
        if (!isValidHhMm(draft)) setDraft(value);
      }}
      className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
    />
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
          <TimeField
            value={settings.quiet_start}
            onCommit={(value) => void save({ quiet_start: value })}
          />
          <span className="text-sm text-muted-foreground">—</span>
          <TimeField
            value={settings.quiet_end}
            onCommit={(value) => void save({ quiet_end: value })}
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
        telegram: next.telegram,
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
      {/* Шапка колонок — только на широком экране. На телефоне три колонки не
          оставляют месту под название события ничего, поэтому там подписи
          переезжают к самим переключателям, а строка переносится. */}
      <div className="hidden items-center gap-4 border-b border-border pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:flex">
        <span className="flex-1">Событие</span>
        <span className="w-24 text-center">В приложении</span>
        <span className="w-16 text-center">Push</span>
        <span className="w-20 text-center">Telegram</span>
      </div>
      {NOTIFICATION_KINDS.map(({ kind, label, hint }) => {
        const pref = prefs[kind] ?? DEFAULT_PREF;
        const busy = savingKind === kind;
        return (
          <div
            key={kind}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-2.5 last:border-b-0"
          >
            {/* На узком экране название занимает всю строку и уводит
                переключатели на следующую — отсюда `shrink-0`: без него
                flex-элемент со `width: 100%` просто ужимается и встаёт с ними
                в одну строку. На широком возвращаемся к колонке: именно
                `flex-1` (базис 0), а не `basis-auto`, — иначе колонка растёт по
                длине пояснения и переключатели разъезжаются с шапкой. */}
            <div className="w-full min-w-0 shrink-0 sm:w-auto sm:flex-1">
              <p className="text-sm">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <ChannelToggle
              label="В приложении"
              className="sm:w-24"
              checked={pref.inbox}
              disabled={busy}
              onChange={(checked) => void save(kind, { ...pref, inbox: checked })}
            />
            {/* Доставки без записи в инбоксе не существует: рассылка собирается
                из core.notifications, а её при выключенном инбоксе нет. */}
            <ChannelToggle
              label="Push"
              className="sm:w-16"
              checked={pref.inbox && pref.push}
              disabled={busy || !pref.inbox}
              onChange={(checked) => void save(kind, { ...pref, push: checked })}
            />
            <ChannelToggle
              label="Telegram"
              className="sm:w-20"
              checked={pref.inbox && pref.telegram}
              disabled={busy || !pref.inbox}
              onChange={(checked) => void save(kind, { ...pref, telegram: checked })}
            />
          </div>
        );
      })}
    </div>
  );
}

function ChannelToggle({
  label,
  className,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  className?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center justify-center gap-1.5", className)}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span className="text-xs text-muted-foreground sm:hidden">{label}</span>
    </label>
  );
}
