"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBrainStore, useSelectedItem } from "@/lib/store";
import {
  ItemStatus,
  ItemPriority,
  ItemCategory,
  ItemType,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  CATEGORY_CONFIG,
  TYPE_CONFIG,
} from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SubtaskList } from "./SubtaskList";

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
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  RichEditor – inline tiptap component                              */
/* ------------------------------------------------------------------ */

function RichEditor({
  content,
  onSave,
}: {
  content: string;
  onSave: (html: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
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
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              editor?.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
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
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              editor?.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
    onBlur: ({ editor: ed }) => {
      onSave(ed.getHTML());
    },
  });

  // Sync content when the item changes externally
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
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
      {/* Toolbar */}
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
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TaskDetailSheet                                                    */
/* ------------------------------------------------------------------ */

export function TaskDetailSheet() {
  const { isDetailOpen, closeDetail, updateItem, deleteItem } = useBrainStore();
  const item = useSelectedItem();

  const [title, setTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Sync local state with selected item
  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setShowDeleteConfirm(false);
    }
  }, [item]);

  // Focus title input when editing starts
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

  const handleDateChange = useCallback(
    (date: Date | undefined) => {
      if (item) {
        updateItem(item.id, {
          due_date: date ? date.toISOString() : null,
        });
        setDatePickerOpen(false);
      }
    },
    [item, updateItem]
  );

  const handleClearDate = useCallback(() => {
    if (item) {
      updateItem(item.id, { due_date: null });
      setDatePickerOpen(false);
    }
  }, [item, updateItem]);

  const handleDelete = useCallback(async () => {
    if (item) {
      await deleteItem(item.id);
      closeDetail();
    }
  }, [item, deleteItem, closeDetail]);

  if (!item) return null;

  const dueDate = item.due_date ? new Date(item.due_date) : undefined;
  const isOverdue =
    dueDate && dueDate < new Date() && item.status !== "done";

  return (
    <Sheet
      open={isDetailOpen}
      onOpenChange={(open) => {
        if (!open) closeDetail();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-[700px] flex-col border-l border-slate-200 bg-white p-0 sm:max-w-2xl"
        showCloseButton
      >
        <div className="flex-1 overflow-y-auto max-h-[calc(100vh-80px)]">
          <div className="flex flex-col gap-6 p-6 pb-8">
            {/* Header: Title + Type badge */}
            <SheetHeader className="gap-3 p-0">
              <div className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">
                  {TYPE_CONFIG[item.type].label}
                </Badge>
              </div>

              <SheetTitle className="sr-only">{item.title}</SheetTitle>

              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTitleSave();
                    if (e.key === "Escape") {
                      setTitle(item.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="w-full bg-transparent text-lg font-semibold leading-snug text-slate-900 outline-none"
                />
              ) : (
                <h2
                  onClick={() => setIsEditingTitle(true)}
                  className="cursor-text text-lg font-semibold leading-snug text-slate-900 transition-colors hover:text-slate-700"
                >
                  {item.title}
                </h2>
              )}
            </SheetHeader>

            {/* Properties grid */}
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
              {/* Status */}
              <span className="text-sm text-slate-500">Статус</span>
              <Select
                value={item.status}
                onValueChange={handleStatusChange}
              >
                <SelectTrigger className="h-8 w-full border-slate-200 bg-white">
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
              <span className="text-sm text-slate-500">Приоритет</span>
              <Select
                value={item.priority}
                onValueChange={handlePriorityChange}
              >
                <SelectTrigger className="h-8 w-full border-slate-200 bg-white">
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
              <span className="text-sm text-slate-500">Категория</span>
              <Select
                value={item.category}
                onValueChange={handleCategoryChange}
              >
                <SelectTrigger className="h-8 w-full border-slate-200 bg-white">
                  <SelectValue>
                    {CATEGORY_CONFIG[item.category].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="border-slate-200 bg-white">
                  {(
                    Object.entries(CATEGORY_CONFIG) as [
                      ItemCategory,
                      (typeof CATEGORY_CONFIG)[ItemCategory],
                    ][]
                  ).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Type */}
              <span className="text-sm text-slate-500">Тип</span>
              <Select value={item.type} onValueChange={handleTypeChange}>
                <SelectTrigger className="h-8 w-full border-slate-200 bg-white">
                  <SelectValue>
                    {TYPE_CONFIG[item.type].label}
                  </SelectValue>
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

              {/* Due date */}
              <span className="text-sm text-slate-500">Срок</span>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger
                  render={
                    <button
                      className={cn(
                        "inline-flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 transition-colors hover:bg-slate-50",
                        !dueDate && "text-slate-500",
                        isOverdue && "border-red-300 text-red-600"
                      )}
                      type="button"
                    />
                  }
                >
                  <CalendarIcon className="size-3.5 shrink-0" />
                  {dueDate ? (
                    <span className="flex items-center gap-1.5">
                      {format(dueDate, "d MMM yyyy", { locale: ru })}
                      {isOverdue && (
                        <AlertTriangle className="size-3 text-red-500" />
                      )}
                    </span>
                  ) : (
                    <span>Без срока</span>
                  )}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto border-slate-200 bg-white p-0">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={handleDateChange}
                    locale={ru}
                  />
                  {dueDate && (
                    <div className="border-t border-slate-200 px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-slate-500 hover:text-slate-900"
                        onClick={handleClearDate}
                      >
                        Убрать срок
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <Separator className="bg-slate-200" />

            {/* Description – Rich text editor */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-500">
                Описание
              </span>
              <RichEditor
                content={item.description || ""}
                onSave={handleDescriptionSave}
              />
            </div>

            <Separator className="bg-slate-200" />

            {/* Subtasks */}
            <SubtaskList parentId={item.id} subtasks={item.subtasks || []} />

            <Separator className="bg-slate-200" />

            {/* Timestamps */}
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

            <Separator className="bg-slate-200" />

            {/* Delete */}
            <div>
              {showDeleteConfirm ? (
                <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-600">
                    Вы уверены? Это действие нельзя отменить.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDelete}
                    >
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
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
