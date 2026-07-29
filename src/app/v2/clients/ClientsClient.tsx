"use client";

// CRM: список клиентов слева, карточка справа. Раздел недоступен гостям
// (сервер вернёт 403; в навигации пункт скрыт).

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

interface ClientStatus {
  id: string;
  name: string;
  color: string;
}
interface CrmSystem {
  id: string;
  name: string;
}
interface Client {
  id: string;
  name: string;
  status_id: string | null;
  budget: string;
  operators_per_shift: string;
  operators_total: string;
  calls_per_month: string;
  monthly_revenue: number | null;
}
interface ClientFull extends Client {
  companies: { id: string; name: string }[];
  contacts: { id: string; name: string; fields: { id: string; type: string; value: string }[] }[];
  notes: { id: string; text: string; created_at: string; author_name: string | null }[];
  links: { id: string; url: string; title: string }[];
  crm_system_ids: string[];
}

export interface ClientsInitial {
  clients: Client[];
  meta: { statuses: ClientStatus[]; crm_systems: CrmSystem[] };
}

export function ClientsClient({ initial }: { initial: ClientsInitial }) {
  const { orgId } = useV2Store();
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("client");
  const [clients, setClients] = useState<Client[]>(initial.clients);
  const [statuses, setStatuses] = useState<ClientStatus[]>(initial.meta.statuses);
  const [crmSystems, setCrmSystems] = useState<CrmSystem[]>(initial.meta.crm_systems);
  const [selected, setSelected] = useState<ClientFull | null>(null);
  const [newName, setNewName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Держим id открытой карточки в ref: ответы медленных запросов не должны
  // перерисовывать панель, если пользователь уже переключился на другого клиента.
  const openId = useRef<string | null>(null);

  const listPath = orgId ? `/orgs/${orgId}/clients` : null;
  const metaPath = orgId ? `/orgs/${orgId}/client-meta` : null;

  // Списки посчитаны на сервере — в кэш вместо пары запросов после гидрации.
  useEffect(() => {
    if (!listPath || !metaPath) return;
    seed(listPath, initial.clients);
    seed(metaPath, initial.meta);
  }, [listPath, metaPath, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!listPath || !metaPath) return;
      try {
        const [list, meta] = await Promise.all([
          cachedGet<Client[]>(listPath, opts),
          cachedGet<{ statuses: ClientStatus[]; crm_systems: CrmSystem[] }>(metaPath, opts),
        ]);
        setClients(list);
        setStatuses(meta.statuses);
        setCrmSystems(meta.crm_systems);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить клиентов");
      }
    },
    [listPath, metaPath],
  );

  const reload = useCallback(async () => {
    if (orgId) invalidate(`/orgs/${orgId}/client`);
    await load({ force: true });
  }, [orgId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    async (clientId: string) => {
      if (!orgId) return;
      openId.current = clientId;
      try {
        const full = await api.get<ClientFull>(`/orgs/${orgId}/clients/${clientId}`);
        if (openId.current !== clientId) return;
        setSelected(full);
        setError(null);
      } catch (e) {
        if (openId.current !== clientId) return;
        setError(e instanceof Error ? e.message : "Не удалось открыть карточку");
      }
    },
    [orgId],
  );

  // Переход из поиска: /v2/clients?client=<id>
  useEffect(() => {
    if (deepLinkId) void open(deepLinkId);
  }, [deepLinkId, open]);

  async function call(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await reload();
      // Перечитываем именно ту карточку, что открыта сейчас (fn мог её закрыть).
      if (openId.current) await open(openId.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function patchSelected(body: Record<string, unknown>) {
    if (!orgId || !selected) return;
    const id = selected.id;
    // Оптимистично, иначе быстрый второй клик посчитается от старого состояния.
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...(body as Partial<ClientFull>) } : prev));
    await call(() => api.patch(`/orgs/${orgId}/clients/${id}`, body));
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Клиенты</h1>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">{clients.length}</span>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                void call(async () => {
                  await api.post(`/orgs/${orgId}/clients`, { name: newName.trim() });
                  setNewName("");
                });
              }
            }}
            placeholder="Новый клиент"
            className="h-8"
          />
          <Button
            size="icon-sm"
            variant="outline"
            disabled={!newName.trim()}
            onClick={() =>
              void call(async () => {
                await api.post(`/orgs/${orgId}/clients`, { name: newName.trim() });
                setNewName("");
              })
            }
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {clients.map((c) => {
            const status = statuses.find((s) => s.id === c.status_id);
            return (
              <button
                key={c.id}
                onClick={() => void open(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60",
                  selected?.id === c.id && "bg-muted",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: status?.color ?? "#d1d5db" }}
                />
                <span className="min-w-0 flex-1 truncate">{c.name || "Без названия"}</span>
                {c.monthly_revenue != null && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {Math.round(c.monthly_revenue).toLocaleString("ru-RU")} ₽
                  </span>
                )}
              </button>
            );
          })}
          {clients.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Пока нет клиентов</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {error && (
          <p className="m-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Выберите клиента
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex items-center gap-3">
              <Input
                key={`name-${selected.id}`}
                defaultValue={selected.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== selected.name) void patchSelected({ name: v });
                }}
                className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (window.confirm(`Удалить клиента «${selected.name}»?`)) {
                    void call(async () => {
                      await api.del(`/orgs/${orgId}/clients/${selected.id}`);
                      openId.current = null;
                      setSelected(null);
                    });
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            <div className="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
              <span className="text-muted-foreground">Статус</span>
              <Select
                value={selected.status_id ?? ""}
                onValueChange={(v) => void patchSelected({ status_id: v || null })}
              >
                <SelectTrigger size="sm" className="w-fit min-w-40">
                  <SelectValue placeholder="Без статуса">
                    {statuses.find((s) => s.id === selected.status_id)?.name ?? "Без статуса"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Без статуса</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-muted-foreground">Выручка в месяц</span>
              <Input
                key={`rev-${selected.id}`}
                type="number"
                defaultValue={selected.monthly_revenue ?? ""}
                onBlur={(e) => {
                  const next = e.target.value === "" ? null : Number(e.target.value);
                  if (next !== selected.monthly_revenue) void patchSelected({ monthly_revenue: next });
                }}
                className="h-8 w-40"
              />

              {(
                [
                  ["budget", "Бюджет"],
                  ["operators_per_shift", "Операторов в смену"],
                  ["operators_total", "Операторов в штате"],
                  ["calls_per_month", "Обращений в месяц"],
                ] as const
              ).map(([key, label]) => (
                <FieldRow
                  key={key}
                  label={label}
                  value={selected[key]}
                  clientId={selected.id}
                  onSave={(v) => void patchSelected({ [key]: v })}
                />
              ))}

              <span className="text-muted-foreground">CRM-системы</span>
              <div className="flex flex-wrap gap-1.5">
                {crmSystems.map((s) => {
                  const active = selected.crm_system_ids.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() =>
                        void patchSelected({
                          crm_system_ids: active
                            ? selected.crm_system_ids.filter((x) => x !== s.id)
                            : [...selected.crm_system_ids, s.id],
                        })
                      }
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        active ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground",
                      )}
                    >
                      {s.name}
                    </button>
                  );
                })}
                {crmSystems.length === 0 && (
                  <span className="text-xs text-muted-foreground">Справочник пуст</span>
                )}
              </div>
            </div>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Контакты
              </h2>
              <div className="flex flex-col gap-1.5">
                {selected.contacts.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <p className="font-medium">{c.name}</p>
                    {c.fields.map((f) => (
                      <p key={f.id} className="text-xs text-muted-foreground">
                        {f.type}: {f.value}
                      </p>
                    ))}
                  </div>
                ))}
                {selected.contacts.length === 0 && (
                  <p className="text-sm text-muted-foreground">Контактов нет</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Заметки
              </h2>
              <div className="flex flex-col gap-2">
                {selected.notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {n.author_name || "—"} ·{" "}
                      {new Date(n.created_at).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Добавить заметку…"
                    className="min-h-16 text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={!noteText.trim()}
                    onClick={() =>
                      void call(async () => {
                        await api.post(`/orgs/${orgId}/clients/${selected.id}/notes`, { text: noteText.trim() });
                        setNoteText("");
                      })
                    }
                  >
                    Добавить
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  clientId,
  onSave,
}: {
  label: string;
  value: string;
  clientId: string;
  onSave: (value: string) => void;
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <Input
        key={`${clientId}-${label}`}
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value !== value) onSave(e.target.value);
        }}
        className="h-8 w-56"
      />
    </>
  );
}
