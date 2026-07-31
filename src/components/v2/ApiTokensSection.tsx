"use client";

// Токены доступа для внешних агентов (MCP) в настройках организации.
//
// Значение токена приходит один раз — в ответе на выпуск. Показать его повторно
// невозможно: в базе лежит только хеш. Отсюда устройство раздела — выпущенный
// токен остаётся на экране до перезагрузки, вместе с готовой строкой
// подключения, а в списке от него виден лишь префикс.

import { useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/core/client";
import type { ApiToken, ApiTokenScope } from "@/lib/core/types";

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  read: "Только чтение",
  full: "Чтение и изменение",
};

const SCOPE_HINTS: Record<ApiTokenScope, string> = {
  read: "Агент видит задачи и вложения, но ничего не меняет",
  full: "Агент работает вашими правами: правит задачи, комментирует, настраивает проекты",
};

function formatDate(value: string | null): string {
  if (!value) return "не использовался";
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function ApiTokensSection({
  orgId,
  initialTokens,
  currentUserId,
  onError,
}: {
  orgId: string | null;
  initialTokens: ApiToken[];
  currentUserId: string | null;
  onError: (message: string | null) => void;
}) {
  const [tokens, setTokens] = useState<ApiToken[]>(initialTokens);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiTokenScope>("full");
  const [issued, setIssued] = useState<{ value: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    if (orgId) setTokens(await api.get<ApiToken[]>(`/orgs/${orgId}/api-tokens`));
  }

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      onError(null);
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const command = issued
    ? `claude mcp add --transport http second-brain ${
        typeof window === "undefined" ? "" : window.location.origin
      }/api/mcp --header "Authorization: Bearer ${issued.value}"`
    : "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Токен даёт внешнему агенту (Claude через MCP) те же права, что есть у вас. Всё, что он сделает,
        попадёт в историю задач с пометкой «через Claude».
      </p>

      {tokens.length > 0 && (
        <div className="flex flex-col gap-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <code className="text-xs text-muted-foreground">{t.prefix}…</code>
              <span className="text-xs text-muted-foreground">{SCOPE_LABELS[t.scope]}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {formatDate(t.last_used_at)}
              </span>
              {t.user_id !== currentUserId && (
                <span className="text-xs text-muted-foreground">чужой</span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                title="Отозвать"
                onClick={() => void run(async () => void (await api.del(`/orgs/${orgId}/api-tokens/${t.id}`)))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {issued && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Токен «{issued.name}» показывается один раз — сохраните его сейчас.
          </p>
          <code className="text-xs break-all">{issued.value}</code>
          <p className="text-xs text-muted-foreground">Команда для Claude Code:</p>
          <code className="text-xs break-all">{command}</code>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => {
              void navigator.clipboard.writeText(command);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Скопировано" : "Скопировать команду"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название: например, «Claude на ноутбуке»"
          className="h-8 min-w-52 flex-1"
        />
        <Select value={scope} onValueChange={(v) => setScope(v as ApiTokenScope)}>
          <SelectTrigger size="sm" className="w-52">
            <SelectValue>{SCOPE_LABELS[scope]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCOPE_LABELS) as ApiTokenScope[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SCOPE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!name.trim()}
          onClick={() =>
            void run(async () => {
              const res = await api.post<{ token: ApiToken; value: string }>(`/orgs/${orgId}/api-tokens`, {
                name: name.trim(),
                scope,
              });
              setIssued({ value: res.value, name: res.token.name });
              setCopied(false);
              setName("");
            })
          }
        >
          Выпустить
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{SCOPE_HINTS[scope]}</p>
    </div>
  );
}
