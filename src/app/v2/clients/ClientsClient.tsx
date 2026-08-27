"use client";

// CRM: список клиентов слева, карточка справа. Раздел недоступен гостям
// (сервер вернёт 403; в навигации пункт скрыт).

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/core/client";
import type { DealRow } from "@/lib/core/crm";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { useLoad } from "@/lib/core/use-load";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { CrmTabs } from "../crm/CrmTabs";

interface Client {
  id: string;
  name: string;
  /**
   * Колл-центровые поля и статус клиента из первой версии CRM больше не
   * показываются: процесс продажи живёт на сделке. Колонки в БД пока целы —
   * снос отдельной миграцией, когда выкат уляжется.
   */
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
}

export function ClientsClient({ initial }: { initial: ClientsInitial }) {
  const { orgId } = useV2Store();
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("client");
  const [clients, setClients] = useState<Client[]>(initial.clients);
  const [selected, setSelected] = useState<ClientFull | null>(null);
  /** Сделки открытого клиента — история покупок аккаунта. */
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [newName, setNewName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Держим id открытой карточки в ref: ответы медленных запросов не должны
  // перерисовывать панель, если пользователь уже переключился на другого клиента.
  const openId = useRef<string | null>(null);

  const listPath = orgId ? `/orgs/${orgId}/clients` : null;

  // Список посчитан на сервере — в кэш вместо запроса после гидрации.
  useEffect(() => {
    if (!listPath) return;
    seed(listPath, initial.clients);
  }, [listPath, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!listPath) return;
      try {
        setClients(await cachedGet<Client[]>(listPath, opts));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить клиентов");
      }
    },
    [listPath],
  );

  const reload = useCallback(async () => {
    if (orgId) invalidate(`/orgs/${orgId}/client`);
    await load({ force: true });
  }, [orgId, load]);

  useLoad(load);

  const open = useCallback(
    async (clientId: string) => {
      if (!orgId) return;
      openId.current = clientId;
      try {
        const [full, clientDeals] = await Promise.all([
          api.get<ClientFull>(`/orgs/${orgId}/clients/${clientId}`),
          api.get<DealRow[]>(`/orgs/${orgId}/crm/deals?client_id=${clientId}`),
        ]);
        if (openId.current !== clientId) return;
        setSelected(full);
        setDeals(clientDeals);
        setError(null);
      } catch (e) {
        if (openId.current !== clientId) return;
        setError(e instanceof Error ? e.message : "Не удалось открыть карточку");
      }
    },
    [orgId],
  );

  // Переход из поиска: /v2/clients?client=<id>
  const openDeepLink = useCallback(() => {
    if (deepLinkId) return open(deepLinkId);
  }, [deepLinkId, open]);
  useLoad(openDeepLink);

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
    <div className="flex h-full flex-col">
      <CrmTabs active="clients" />
      <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">Все клиенты</span>
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
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => void open(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60",
                selected?.id === c.id && "bg-muted",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{c.name || "Без названия"}</span>
              {c.monthly_revenue != null && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.round(c.monthly_revenue).toLocaleString("ru-RU")} ₽
                </span>
              )}
            </button>
          ))}
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

            </div>

            {/* Клиент — аккаунт с историей сделок: этапы продажи живут на них,
                а не на самом клиенте. */}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Сделки
              </h2>
              <div className="flex flex-col gap-1.5">
                {deals.map((d) => (
                  <Link
                    key={d.id}
                    href="/v2/crm"
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate">{d.title || "Без названия"}</span>
                    {d.amount != null && (
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {Math.round(d.amount).toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                  </Link>
                ))}
                {deals.length === 0 && (
                  <p className="text-sm text-muted-foreground">Сделок пока нет</p>
                )}
              </div>
            </section>

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
    </div>
  );
}
