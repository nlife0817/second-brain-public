"use client";

// Страница папки: список содержимого и то же, что у документа, — крошки,
// заголовок, доступ и корзина.
//
// Своей страницы у папки могло бы и не быть (клик просто раскрывал бы ветку),
// но тогда переименование и удаление жили бы в меню строки дерева, а «что
// внутри» приходилось бы читать по отступам. Список отвечает на это прямо и
// заодно показывает, кто и когда правил.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Folder, FolderOpen, MoreHorizontal, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/v2/bits";
import { ProjectIcon } from "@/components/v2/project-icons";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbNodeKind } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { KbAccessDialog } from "../KbAccessDialog";
import { KbCrumbs } from "./KbCrumbs";

function when(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function KbFolderClient({ initial }: { initial: KbDocumentDetail }) {
  const router = useRouter();
  const orgId = useV2Store((s) => s.orgId);
  const projects = useV2Store((s) => s.projects);

  const [folder, setFolder] = useState(initial);
  // Папка приезжает с сервера при каждом переходе и router.refresh(); сравнение
  // по ссылке в рендере, а не эффектом.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setFolder(initial);
  }

  const [title, setTitle] = useState(initial.title);
  const [titleSeed, setTitleSeed] = useState(initial.title);
  if (titleSeed !== initial.title) {
    setTitleSeed(initial.title);
    setTitle(initial.title);
  }

  const [accessOpen, setAccessOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = folder.my_role === "editor" || folder.my_role === "admin";
  const canManage = folder.my_role === "admin";
  const inherited = folder.root_id !== folder.id;

  const commitTitle = useCallback(async () => {
    const next = title.trim();
    if (!orgId || next === folder.title) return;
    try {
      const updated = await api.patch<KbDocumentDetail>(`/orgs/${orgId}/kb/${folder.id}`, {
        title: next,
      });
      setFolder(updated);
      // Дерево слева держит layout — без обновления оно осталось бы со старым
      // названием до следующей полной загрузки.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переименовать папку");
    }
  }, [orgId, folder.id, folder.title, title, router]);

  const create = useCallback(
    async (kind: KbNodeKind) => {
      if (!orgId) return;
      try {
        const created = await api.post<KbDocumentDetail>(`/orgs/${orgId}/kb`, {
          title: "Без названия",
          kind,
          parent_id: folder.id,
        });
        router.push(`/v2/kb/${created.id}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось создать");
      }
    },
    [orgId, folder.id, router],
  );

  const remove = useCallback(async () => {
    if (!orgId) return;
    try {
      await api.del(`/orgs/${orgId}/kb/${folder.id}`);
      router.push("/v2/kb");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить папку");
    }
  }, [orgId, folder.id, router]);

  const linkedProjects = projects.filter((p) => folder.project_ids.includes(p.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <KbCrumbs path={folder.path} />
        {canManage && !inherited && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAccessOpen(true)}>
            <Users className="size-4" />
            Доступ
          </Button>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Ещё">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
                <Trash2 className="size-4" />
                В корзину
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {error && (
        <p className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <div className="flex items-center gap-3">
            <FolderOpen className="size-7 shrink-0 text-primary/70" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void commitTitle()}
              disabled={!canEdit}
              placeholder="Без названия"
              aria-label="Название папки"
              className="min-w-0 flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:cursor-default"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border pb-3 text-xs text-muted-foreground">
            <span>обновлена {when(folder.updated_at)}</span>
            <span className="flex-1" />
            {linkedProjects.map((p) => (
              <Link
                key={p.id}
                href={`/v2/projects/${p.id}`}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 hover:text-foreground"
              >
                <ProjectIcon name={p.icon} color={p.color} className="size-3" />
                {p.name}
              </Link>
            ))}
            {!inherited && folder.project_ids.length === 0 && (
              <span className="rounded-md border border-border px-2 py-0.5">Общая папка</span>
            )}
          </div>

          <div className="mt-5 flex items-center gap-2">
            <h2 className="flex-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Содержимое {folder.children.length > 0 && `(${folder.children.length})`}
            </h2>
            {canEdit && (
              <>
                <Button size="sm" variant="secondary" onClick={() => void create("document")}>
                  <FileText className="size-3.5" />
                  Документ
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void create("folder")}>
                  <Folder className="size-3.5" />
                  Папка
                </Button>
              </>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1">
            {folder.children.map((child) => (
              <Link
                key={child.id}
                href={`/v2/kb/${child.id}`}
                className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm hover:border-foreground/20"
              >
                {child.kind === "folder" ? (
                  <Folder className="size-4 shrink-0 text-primary/70" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    child.kind === "folder" && "font-medium",
                  )}
                >
                  {child.title || "Без названия"}
                </span>
                {child.updated_by && <Avatar user={child.updated_by} size="xs" />}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {when(child.updated_at)}
                </span>
              </Link>
            ))}
            {folder.children.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Папка пуста{canEdit && " — заведите документ или вложенную папку"}
              </p>
            )}
          </div>
        </div>
      </div>

      <KbAccessDialog
        open={accessOpen}
        onOpenChange={setAccessOpen}
        document={folder}
        onChanged={(next) => {
          setFolder(next);
          router.refresh();
        }}
      />
    </div>
  );
}
