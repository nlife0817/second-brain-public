"use client";

import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { useBrainStore, useSelectedItem, useCategoryConfig } from "@/lib/store";
import {
  ItemWithSubtasks,
  ItemStatus,
  ItemPriority,
  ItemCategory,
  ItemType,
  DevelopmentParticipantInput,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  TYPE_CONFIG,
} from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { uploadAttachment } from "@/lib/storage";
import {
  KaitenDevelopmentStageSelect,
  KaitenParticipantsSelect,
  useKaitenCatalog,
} from "@/components/kaiten/KaitenValueControls";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { SubtaskList } from "./SubtaskList";
import { RelationsList } from "@/components/relations/RelationsList";
import { CommentsList } from "@/components/comments/CommentsList";
import { TimerSection } from "@/components/timing/TimerSection";

import {
  CalendarIcon,
  Trash2,
  AlertTriangle,
  Clock,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  List,
  ListOrdered,
  Paperclip,
  Pencil,
  X,
} from "lucide-react";
import { TagSelector } from "./TagSelector";

/* ------------------------------------------------------------------ */
/*  RichEditor                                                         */
/* ------------------------------------------------------------------ */

const RichEditor = memo(function RichEditor({
  content,
  onSave,
}: {
  content: string;
  onSave: (html: string) => void;
}) {
  // Refs let us call the latest onSave without re-creating the editor and
  // remember the last HTML we already sent up so we can ignore re-entrant
  // store echoes when our own optimistic update lands back as a `content` prop.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  const flushNow = useCallback((html: string) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (lastEmittedRef.current === html) return;
    lastEmittedRef.current = html;
    onSaveRef.current(html);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      Image,
      Placeholder.configure({ placeholder: "Добавьте описание..." }),
    ],
    content: content || "",
    editorProps: {
      attributes: {
        class:
          "min-h-[120px] border border-slate-200 rounded-lg p-3 prose prose-sm max-w-none focus:outline-none focus:border-slate-300",
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) return false;
            uploadAttachment(file)
              .then((res) => editor?.chain().focus().setImage({ src: res.url, alt: res.name }).run())
              .catch((err) => console.error("Image upload failed", err));
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            uploadAttachment(file)
              .then((res) => editor?.chain().focus().setImage({ src: res.url, alt: res.name }).run())
              .catch((err) => console.error("Image upload failed", err));
            return true;
          }
          // Non-image files → inline download link
          event.preventDefault();
          uploadAttachment(file)
            .then((res) => {
              const safeName = res.name.replace(/[<>&"']/g, "");
              editor?.chain().focus().insertContent(
                `<p><a href="${res.url}" target="_blank" rel="noopener">📎 ${safeName}</a></p>`
              ).run();
            })
            .catch((err) => console.error("File upload failed", err));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Debounced fire so each keystroke doesn't fire a PUT.
      // Selects/dates/status flush instantly via their own handlers — only
      // long-form text needs this throttle.
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const html = ed.getHTML();
        if (lastEmittedRef.current === html) return;
        lastEmittedRef.current = html;
        onSaveRef.current(html);
      }, 400);
    },
    onBlur: ({ editor: ed }) => {
      // Force-flush any pending debounced edit so we never lose input on
      // tab-switch, sheet-close, etc.
      flushNow(ed.getHTML());
    },
  });

  // Force-flush on unmount (sheet close, route change).
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
        if (editor) {
          const html = editor.getHTML();
          if (lastEmittedRef.current !== html) {
            lastEmittedRef.current = html;
            onSaveRef.current(html);
          }
        }
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (content === editor.getHTML()) return;
    // Echo of our own optimistic save coming back through the store —
    // don't reset content (would clobber the cursor and any newer typing).
    if (lastEmittedRef.current === content) return;
    editor.commands.setContent(content || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (!editor) return null;

  const btnCls = (active: boolean) =>
    cn(
      "rounded p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors",
      active && "text-slate-900 bg-slate-100"
    );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnCls(editor.isActive("bold"))}
          title="Жирный"
        >
          <BoldIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnCls(editor.isActive("italic"))}
          title="Курсив"
        >
          <ItalicIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={btnCls(editor.isActive("underline"))}
          title="Подчёркнутый"
        >
          <UnderlineIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={btnCls(editor.isActive("strike"))}
          title="Зачёркнутый"
        >
          <StrikethroughIcon className="size-4" />
        </button>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnCls(editor.isActive("bulletList"))}
          title="Маркированный список"
        >
          <List className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btnCls(editor.isActive("orderedList"))}
          title="Нумерованный список"
        >
          <ListOrdered className="size-4" />
        </button>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <button
          type="button"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.onchange = async () => {
              const files = Array.from(input.files ?? []);
              for (const file of files) {
                try {
                  const res = await uploadAttachment(file);
                  if (file.type.startsWith("image/")) {
                    editor.chain().focus().setImage({ src: res.url, alt: res.name }).run();
                  } else {
                    const safeName = res.name.replace(/[<>&"']/g, "");
                    editor.chain().focus().insertContent(
                      `<p><a href="${res.url}" target="_blank" rel="noopener">📎 ${safeName}</a></p>`
                    ).run();
                  }
                } catch (err) {
                  console.error("Upload failed", err);
                }
              }
            };
            input.click();
          }}
          className={btnCls(false)}
          title="Прикрепить файл"
        >
          <Paperclip className="size-4" />
        </button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Field selectors (shared)                                           */
/* ------------------------------------------------------------------ */

function FieldSelectors({
  item,
  layout,
  onStatusChange,
  onPriorityChange,
  onCategoryChange,
  onTypeChange,
  onDueChange,
}: {
  item: ItemWithSubtasks;
  layout: "modal" | "panel";
  onStatusChange: (v: ItemStatus | null) => void;
  onPriorityChange: (v: ItemPriority | null) => void;
  onCategoryChange: (v: ItemCategory | null) => void;
  onTypeChange: (v: ItemType | null) => void;
  onDueChange: (next: { date: string | null; time: string | null }) => void;
}) {
  const categoryConfig = useCategoryConfig();
  const categories = useBrainStore((s) => s.categories);

  const isPanel = layout === "panel";
  const labelCls = isPanel ? "text-xs text-slate-500" : "text-sm text-slate-500";
  const triggerH = isPanel ? "h-7" : "h-8";

  /* ===== PANEL layout: grouped 2-column with labels on top ===== */
  if (isPanel) {
    return (
      <div className="flex flex-col gap-2">
        {/* Row 1: Status + Priority */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Статус</span>
            <Select value={item.status} onValueChange={onStatusChange}>
              <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white text-xs")}>
                <SelectValue>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
                      STATUS_CONFIG[item.status].color
                    )}
                  >
                    {STATUS_CONFIG[item.status].label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {(
                  Object.entries(STATUS_CONFIG) as [
                    ItemStatus,
                    (typeof STATUS_CONFIG)[ItemStatus],
                  ][]
                ).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <span
                      className={cn(
                        "inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium",
                        config.color
                      )}
                    >
                      {config.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Приоритет</span>
            <Select value={item.priority} onValueChange={onPriorityChange}>
              <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white text-xs")}>
                <SelectValue>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "inline-block size-2 rounded-full",
                        item.priority === "urgent" && "bg-red-500",
                        item.priority === "high" && "bg-orange-500",
                        item.priority === "medium" && "bg-yellow-500",
                        item.priority === "low" && "bg-blue-500",
                        item.priority === "none" && "bg-gray-400"
                      )}
                    />
                    {PRIORITY_CONFIG[item.priority].label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {(
                  Object.entries(PRIORITY_CONFIG) as [
                    ItemPriority,
                    (typeof PRIORITY_CONFIG)[ItemPriority],
                  ][]
                ).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-block size-2 rounded-full",
                          key === "urgent" && "bg-red-500",
                          key === "high" && "bg-orange-500",
                          key === "medium" && "bg-yellow-500",
                          key === "low" && "bg-blue-500",
                          key === "none" && "bg-gray-400"
                        )}
                      />
                      {config.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: Category + Type */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Категория</span>
            <Select value={item.category} onValueChange={onCategoryChange}>
              <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white text-xs")}>
                <SelectValue>{categoryConfig[item.category]?.label ?? item.category}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Тип</span>
            <Select value={item.type} onValueChange={onTypeChange}>
              <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white text-xs")}>
                <SelectValue>{TYPE_CONFIG[item.type].label}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {(
                  Object.entries(TYPE_CONFIG) as [
                    ItemType,
                    (typeof TYPE_CONFIG)[ItemType],
                  ][]
                ).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 3: Due date + time (full width) */}
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Срок</span>
          <DateTimePicker
            size="sm"
            placeholder="Без срока"
            className="w-full"
            value={{ date: item.due_date ?? null, time: item.due_time ?? null }}
            onChange={onDueChange}
          />
        </div>
      </div>
    );
  }

  /* ===== MODAL layout: label-left, value-right grid ===== */
  return (
    <div className="grid items-center gap-x-4 gap-y-2.5 grid-cols-[auto_1fr]">
      {/* Status */}
      <span className={labelCls}>Статус</span>
      <Select value={item.status} onValueChange={onStatusChange}>
        <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white")}>
          <SelectValue>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
                STATUS_CONFIG[item.status].color
              )}
            >
              {STATUS_CONFIG[item.status].label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white">
          {(
            Object.entries(STATUS_CONFIG) as [
              ItemStatus,
              (typeof STATUS_CONFIG)[ItemStatus],
            ][]
          ).map(([key, config]) => (
            <SelectItem key={key} value={key}>
              <span
                className={cn(
                  "inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium",
                  config.color
                )}
              >
                {config.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Priority */}
      <span className={labelCls}>Приоритет</span>
      <Select value={item.priority} onValueChange={onPriorityChange}>
        <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white")}>
          <SelectValue>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block size-2 rounded-full",
                  item.priority === "urgent" && "bg-red-500",
                  item.priority === "high" && "bg-orange-500",
                  item.priority === "medium" && "bg-yellow-500",
                  item.priority === "low" && "bg-blue-500",
                  item.priority === "none" && "bg-gray-400"
                )}
              />
              {PRIORITY_CONFIG[item.priority].label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white">
          {(
            Object.entries(PRIORITY_CONFIG) as [
              ItemPriority,
              (typeof PRIORITY_CONFIG)[ItemPriority],
            ][]
          ).map(([key, config]) => (
            <SelectItem key={key} value={key}>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block size-2 rounded-full",
                    key === "urgent" && "bg-red-500",
                    key === "high" && "bg-orange-500",
                    key === "medium" && "bg-yellow-500",
                    key === "low" && "bg-blue-500",
                    key === "none" && "bg-gray-400"
                  )}
                />
                {config.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category */}
      <span className={labelCls}>Категория</span>
      <Select value={item.category} onValueChange={onCategoryChange}>
        <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white")}>
          <SelectValue>{categoryConfig[item.category]?.label ?? item.category}</SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white">
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Type */}
      <span className={labelCls}>Тип</span>
      <Select value={item.type} onValueChange={onTypeChange}>
        <SelectTrigger className={cn(triggerH, "w-full border-slate-200 bg-white")}>
          <SelectValue>{TYPE_CONFIG[item.type].label}</SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-200 bg-white">
          {(
            Object.entries(TYPE_CONFIG) as [
              ItemType,
              (typeof TYPE_CONFIG)[ItemType],
            ][]
          ).map(([key, config]) => (
            <SelectItem key={key} value={key}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Due date + time */}
      <span className={labelCls}>Срок</span>
      <DateTimePicker
        size="md"
        placeholder="Без срока"
        className="w-full"
        value={{ date: item.due_date ?? null, time: item.due_time ?? null }}
        onChange={onDueChange}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Timestamps                                                         */
/* ------------------------------------------------------------------ */

function Timestamps({ item }: { item: ItemWithSubtasks }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="size-3" />
        <span>
          Создано:{" "}
          {format(new Date(item.created_at), "d MMM yyyy, HH:mm", {
            locale: ru,
          })}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="size-3" />
        <span>
          Обновлено:{" "}
          {format(new Date(item.updated_at), "d MMM yyyy, HH:mm", {
            locale: ru,
          })}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete section                                                     */
/* ------------------------------------------------------------------ */

function DeleteSection({
  showDeleteConfirm,
  setShowDeleteConfirm,
  onDelete,
}: {
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (v: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div>
      {showDeleteConfirm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">
            Вы уверены? Это действие нельзя отменить.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              Удалить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-red-600"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="size-3.5" />
          Удалить задачу
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  useTaskDetailLogic — shared hook for both modes                    */
/* ------------------------------------------------------------------ */

function useTaskDetailLogic(item: ItemWithSubtasks | null) {
  const updateItem = useBrainStore((s) => s.updateItem);
  const deleteItem = useBrainStore((s) => s.deleteItem);
  const closeDetail = useBrainStore((s) => s.closeDetail);

  const [title, setTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(item.title);
      setShowDeleteConfirm(false);
    }
  }, [item]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSave = useCallback(() => {
    setIsEditingTitle(false);
    const trimmed = title.trim();
    if (item && trimmed && trimmed !== item.title) {
      updateItem(item.id, { title: trimmed });
    } else if (item) {
      setTitle(item.title);
    }
  }, [item, title, updateItem]);

  const handleDescriptionSave = useCallback(
    (html: string) => {
      if (item && html !== (item.description || "")) {
        updateItem(item.id, { description: html });
      }
    },
    [item, updateItem]
  );

  const handleStatusChange = useCallback(
    (value: ItemStatus | null) => {
      if (item && value) updateItem(item.id, { status: value });
    },
    [item, updateItem]
  );

  const handlePriorityChange = useCallback(
    (value: ItemPriority | null) => {
      if (item && value) updateItem(item.id, { priority: value });
    },
    [item, updateItem]
  );

  const handleCategoryChange = useCallback(
    (value: ItemCategory | null) => {
      if (item && value) updateItem(item.id, { category: value });
    },
    [item, updateItem]
  );

  const handleTypeChange = useCallback(
    (value: ItemType | null) => {
      if (item && value) updateItem(item.id, { type: value });
    },
    [item, updateItem]
  );

  const handleDevelopmentStageChange = useCallback(
    (value: string | null) => {
      if (item) updateItem(item.id, { development_stage: value });
    },
    [item, updateItem]
  );

  const handleParticipantsChange = useCallback(
    (participants: DevelopmentParticipantInput[]) => {
      if (!item) return;
      updateItem(item.id, {
        participants: participants.map((participant) => ({
          provider: participant.provider ?? null,
          remote_id: participant.remote_id ?? null,
          name: participant.name,
        })),
      });
    },
    [item, updateItem]
  );

  const handleDueChange = useCallback(
    ({ date, time }: { date: string | null; time: string | null }) => {
      if (!item) return;
      updateItem(item.id, { due_date: date, due_time: time });
    },
    [item, updateItem]
  );

  const handleDelete = useCallback(async () => {
    if (item) {
      await deleteItem(item.id);
      closeDetail();
    }
  }, [item, deleteItem, closeDetail]);

  return {
    title,
    setTitle,
    isEditingTitle,
    setIsEditingTitle,
    showDeleteConfirm,
    setShowDeleteConfirm,
    titleInputRef,
    handleTitleSave,
    handleDescriptionSave,
    handleStatusChange,
    handlePriorityChange,
    handleCategoryChange,
    handleTypeChange,
    handleDevelopmentStageChange,
    handleParticipantsChange,
    handleDueChange,
    handleDelete,
  };
}

/* ------------------------------------------------------------------ */
/*  TaskDetailContent — shared inner content                           */
/* ------------------------------------------------------------------ */

function TaskDetailContent({
  item,
  layout,
}: {
  item: ItemWithSubtasks;
  layout: "modal" | "panel";
}) {
  const { catalog, loading: kaitenCatalogLoading } = useKaitenCatalog();
  const {
    title,
    setTitle,
    isEditingTitle,
    setIsEditingTitle,
    showDeleteConfirm,
    setShowDeleteConfirm,
    titleInputRef,
    handleTitleSave,
    handleDescriptionSave,
    handleStatusChange,
    handlePriorityChange,
    handleCategoryChange,
    handleTypeChange,
    handleDevelopmentStageChange,
    handleParticipantsChange,
    handleDueChange,
    handleDelete,
  } = useTaskDetailLogic(item);

  /* ---- Parent link (for subtasks) ---- */
  const isSubtask = !!item.parent_id;
  const parentItem = useBrainStore((s) =>
    isSubtask ? s.items.find((i) => i.id === item.parent_id) ?? null : null
  );
  const openDetail = useBrainStore((s) => s.openDetail);
  const updateItem = useBrainStore((s) => s.updateItem);

  /* ---- Title block ----
     Goal: make it obvious the title is editable. Display mode shows a
     subtle hover state with a pencil affordance; edit mode has a clear
     bordered input with a focus ring and a hint about Enter/Esc keys.
     Both modes share the same vertical footprint to avoid layout shift. */
  const titleSizeCls = layout === "panel" ? "text-base" : "text-lg";
  const titleBlock = (
    <div className="space-y-2">
      {parentItem && (
        <button
          onClick={() => openDetail(parentItem.id)}
          className="text-[11px] text-blue-500 hover:text-blue-700 hover:underline transition-colors flex items-center gap-1"
        >
          <span className="text-slate-400">↑</span>
          {parentItem.title}
        </button>
      )}
      {isEditingTitle ? (
        <div className="space-y-1">
          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleTitleSave();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTitle(item.title);
                setIsEditingTitle(false);
              }
            }}
            className={cn(
              "w-full rounded-md border border-blue-400 bg-white px-2.5 py-1.5 font-semibold leading-snug text-slate-900 shadow-sm ring-2 ring-blue-100 outline-none transition-colors",
              titleSizeCls
            )}
            placeholder="Название задачи"
          />
          <div className="flex items-center gap-3 px-1 text-[10px] text-slate-400">
            <span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[9px] text-slate-600">Enter</kbd>
              {" "}— сохранить
            </span>
            <span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[9px] text-slate-600">Esc</kbd>
              {" "}— отменить
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditingTitle(true)}
          title="Редактировать заголовок"
          className={cn(
            "group flex w-full items-start gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left font-semibold leading-snug text-slate-900 transition-colors hover:border-slate-200 hover:bg-slate-50",
            titleSizeCls
          )}
        >
          <span className="min-w-0 flex-1 break-words">{item.title}</span>
          <Pencil className="mt-0.5 size-3.5 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );

  /* ---- Field selectors block ---- */
  const fieldsBlock = (
    <FieldSelectors
      item={item}
      layout={layout}
      onStatusChange={handleStatusChange}
      onPriorityChange={handlePriorityChange}
      onCategoryChange={handleCategoryChange}
      onTypeChange={handleTypeChange}
      onDueChange={handleDueChange}
    />
  );

  /* ---- Tags block ---- */
  const handleTagsChange = useCallback(
    (tagIds: string[]) => updateItem(item.id, { tags: tagIds }),
    [item.id, updateItem]
  );
  const tagsBlock = (
    <TagSelector
      selectedTags={item.tags ?? []}
      onTagsChange={handleTagsChange}
    />
  );

  const developmentFieldsBlock = item.category === "development" ? (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="space-y-1">
        <span
          className={cn(
            "font-medium text-slate-500",
            layout === "panel" ? "text-xs" : "text-sm"
          )}
        >
          Разработка
        </span>
        <p className="text-xs text-slate-500">
          Значения этапа и участников будут использованы при синхронизации с
          Kaiten.
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-600">
          Этап разработки
        </span>
        <KaitenDevelopmentStageSelect
          value={item.development_stage}
          options={catalog.development_stages}
          onChange={handleDevelopmentStageChange}
          className="bg-white"
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-600">Участники</span>
        <KaitenParticipantsSelect
          value={item.participants ?? []}
          options={catalog.participants}
          onChange={handleParticipantsChange}
          buttonClassName="bg-white"
        />
      </div>

      {kaitenCatalogLoading && (
        <div className="text-xs text-slate-500">
          Загружается каталог Kaiten для этапов и участников.
        </div>
      )}
    </div>
  ) : null;

  /* ---- Description block ---- */
  const descriptionBlock = (
    <div className="space-y-2">
      <span className={cn("font-medium text-slate-500", layout === "panel" ? "text-xs" : "text-sm")}>Описание</span>
      <RichEditor
        content={item.description || ""}
        onSave={handleDescriptionSave}
      />
    </div>
  );

  /* ---- Subtasks block (hidden for subtasks themselves) ---- */
  const subtasksBlock = isSubtask ? null : (
    <SubtaskList parentId={item.id} subtasks={item.subtasks || []} />
  );

  /* ---- Timer / time-tracking block ---- */
  const timerBlock = (item.type === "task" || item.type === "meeting" || item.type === "plan")
    ? <TimerSection item={item} layout={layout} />
    : null;

  /* ---- Relations block ---- */
  const relationsBlock = (
    <RelationsList entityType="item" entityId={item.id} />
  );

  /* ---- Comments block ---- */
  const commentsBlock = (
    <CommentsList entityType="item" entityId={item.id} />
  );

  /* ---- Timestamps block ---- */
  const timestampsBlock = <Timestamps item={item} />;

  /* ---- Delete block ---- */
  const deleteBlock = (
    <DeleteSection
      showDeleteConfirm={showDeleteConfirm}
      setShowDeleteConfirm={setShowDeleteConfirm}
      onDelete={handleDelete}
    />
  );

  /* ===== MODAL: responsive two-column layout ===== */
  if (layout === "modal") {
    return (
      <div className="flex flex-col md:flex-row gap-6">
        {/* LEFT column — main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          {titleBlock}
          <Separator className="bg-slate-200" />
          {descriptionBlock}
          {subtasksBlock && <Separator className="bg-slate-200" />}
          {subtasksBlock}
          <Separator className="bg-slate-200" />
          {relationsBlock}
          <Separator className="bg-slate-200" />
          {commentsBlock}
        </div>

        {/* RIGHT column — fields sidebar, stacks below on small screens */}
        <div className="w-full md:w-[260px] lg:w-[280px] shrink-0 flex flex-col gap-4">
          {fieldsBlock}
          {developmentFieldsBlock}
          {tagsBlock}
          {timerBlock && <Separator className="bg-slate-200" />}
          {timerBlock}
          <Separator className="bg-slate-200" />
          {timestampsBlock}
          <Separator className="bg-slate-200" />
          {deleteBlock}
        </div>
      </div>
    );
  }

  /* ===== PANEL: single-column layout ===== */
  return (
    <div className="flex flex-col gap-3">
      {titleBlock}
      <Separator className="bg-slate-200" />
      {fieldsBlock}
      {developmentFieldsBlock}
      {tagsBlock}
      {timerBlock && <Separator className="bg-slate-200" />}
      {timerBlock}
      {descriptionBlock}
      {subtasksBlock && <Separator className="bg-slate-200" />}
      {subtasksBlock}
      <Separator className="bg-slate-200" />
      {relationsBlock}
      <Separator className="bg-slate-200" />
      {commentsBlock}
      <Separator className="bg-slate-200" />
      <div className="flex items-center justify-between">
        {timestampsBlock}
        {deleteBlock}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TaskDetailSheet — modal mode (Dialog)                              */
/* ------------------------------------------------------------------ */

export { TaskDetailModal as TaskDetailSheet };

export function TaskDetailModal({ forceModal }: { forceModal?: boolean } = {}) {
  const isDetailOpen = useBrainStore((s) => s.isDetailOpen);
  const closeDetail = useBrainStore((s) => s.closeDetail);
  const detailMode = useBrainStore((s) => s.detailMode);
  const item = useSelectedItem();

  // Only render in modal mode (unless forced, e.g. opened from clients section)
  if (!forceModal && detailMode !== "modal") return null;
  if (!item) return null;

  return (
    <Dialog
      open={isDetailOpen}
      onOpenChange={(open) => {
        if (!open) closeDetail();
      }}
    >
      <DialogContent
        className={cn(
          "max-w-[calc(100%-1rem)] sm:max-w-[92vw] md:max-w-[90vw] lg:max-w-5xl xl:max-w-7xl w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 lg:p-8 bg-white",
          forceModal && "z-[60]"
        )}
        showCloseButton
      >
        <DialogTitle className="sr-only">{item.title}</DialogTitle>
        <TaskDetailContent item={item} layout="modal" />
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  TaskDetailPanel — panel mode (inline right side)                   */
/*  Responsive: mobile (<md) = full-width overlay drawer               */
/*              md-lg = inline panel, percentage-clamped                */
/*              lg+   = inline panel with drag resize                  */
/* ------------------------------------------------------------------ */

const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 400;

/** Max width = 50% of viewport so the panel never exceeds half the screen */
function getPanelMaxWidth() {
  if (typeof window === "undefined") return 700;
  return Math.floor(window.innerWidth * 0.5);
}

/** Check if viewport is below the md breakpoint (768px) */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export function TaskDetailPanel() {
  const isDetailOpen = useBrainStore((s) => s.isDetailOpen);
  const closeDetail = useBrainStore((s) => s.closeDetail);
  const detailMode = useBrainStore((s) => s.detailMode);
  const item = useSelectedItem();
  const isMobile = useIsMobile();

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Keep panelWidth within bounds when the viewport resizes */
  useEffect(() => {
    const onResize = () => {
      const max = getPanelMaxWidth();
      setPanelWidth((prev) => Math.min(prev, Math.max(PANEL_MIN_WIDTH, max)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Resize via dragging left edge (only for md+ screens)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;

    const startX = e.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? PANEL_DEFAULT_WIDTH;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const maxW = getPanelMaxWidth();
      // Dragging left means increasing width (panel is on the right)
      const delta = startX - ev.clientX;
      const newWidth = Math.min(
        maxW,
        Math.max(PANEL_MIN_WIDTH, startWidth + delta)
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Slide-in animation on mount only.
  // The component is conditionally rendered in page.tsx, so it mounts
  // when the panel opens and unmounts when it closes. Switching between
  // items keeps it mounted — no re-trigger, no flicker.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (detailMode !== "panel") return null;
  if (!isDetailOpen || !item) return null;

  /* ---------- Mobile: full-width overlay drawer ---------- */
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity duration-200",
            mounted ? "opacity-100" : "opacity-0"
          )}
          onClick={closeDetail}
        />
        {/* Drawer panel */}
        <div
          ref={panelRef}
          className={cn(
            "relative ml-auto flex flex-col bg-white h-full w-[calc(100vw-40px)] max-w-[500px] shadow-xl",
            "transition-transform duration-200 ease-out",
            mounted ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* Close button */}
          <div className="flex items-center justify-end p-2 shrink-0">
            <Button variant="ghost" size="icon-sm" onClick={closeDetail}>
              <X className="size-4" />
            </Button>
          </div>
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <TaskDetailContent item={item} layout="panel" />
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Desktop (md+): inline side panel ---------- */
  return (
    <div
      ref={panelRef}
      className={cn(
        "relative shrink-0 flex flex-col border-l border-slate-200 bg-white h-full",
        "transition-[transform,opacity] duration-200 ease-out",
        mounted ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      )}
      style={{ width: panelWidth }}
    >
      {/* Resize handle — wider hit area, visible on hover */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize group z-10 flex items-center justify-center"
      >
        <div className="w-[3px] h-full rounded-full transition-colors group-hover:bg-slate-300 group-active:bg-slate-400" />
      </div>

      {/* Close button */}
      <div className="flex items-center justify-end p-2 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={closeDetail}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Scrollable content — responsive padding based on panel width */}
      <div
        className={cn(
          "flex-1 overflow-y-auto pb-6",
          panelWidth < 380 ? "px-3" : panelWidth >= 550 ? "px-6" : "px-4"
        )}
      >
        <TaskDetailContent item={item} layout="panel" />
      </div>
    </div>
  );
}
