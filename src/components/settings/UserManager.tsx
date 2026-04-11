"use client";

import { useEffect, useState } from "react";
import { useBrainStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Loader2, ShieldCheck, Users } from "lucide-react";
import type { UserRole } from "@/types";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  manager: "Менеджер (просмотр)",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-violet-100 text-violet-700",
  manager: "bg-sky-100 text-sky-700",
};

export function UserManager() {
  const users = useBrainStore((s) => s.users);
  const fetchUsers = useBrainStore((s) => s.fetchUsers);
  const createUser = useBrainStore((s) => s.createUser);
  const deleteUser = useBrainStore((s) => s.deleteUser);

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("manager");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createUser(newEmail.trim().toLowerCase(), newRole, newName.trim() || undefined);
      setNewEmail("");
      setNewName("");
      setNewRole("manager");
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при добавлении");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(email: string) {
    setDeletingEmail(email);
    try {
      await deleteUser(email);
    } finally {
      setDeletingEmail(null);
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-1.5">
            <Users className="size-4 text-violet-600" />
          </div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            Пользователи
          </h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setShowAdd((v) => !v); setError(null); }}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Добавить
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4"
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Имя (необязательно)</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Имя пользователя"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Роль</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="manager">Менеджер (просмотр)</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Добавить
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { setShowAdd(false); setError(null); }}
              >
                Отмена
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* User list */}
      {users.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
          <ShieldCheck className="mx-auto mb-2 size-7 text-slate-300" />
          <p className="text-sm text-slate-500">Пользователей пока нет</p>
          <p className="mt-0.5 text-xs text-slate-400">Добавьте пользователей для доступа к приложению</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.email}
              className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate text-sm font-medium text-slate-800">
                    {u.name || u.email}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      ROLE_COLORS[u.role]
                    )}
                  >
                    {ROLE_LABELS[u.role]}
                  </span>
                </div>
                {u.name && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">{u.email}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(u.email)}
                disabled={deletingEmail === u.email}
                className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                title="Удалить пользователя"
              >
                {deletingEmail === u.email ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
