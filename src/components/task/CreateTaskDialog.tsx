"use client";

import { useState, useCallback, useEffect } from "react";
import { useBrainStore, useCategoryConfig } from "@/lib/store";
import {
  DevelopmentParticipantInput,
  ItemStatus,
  ItemPriority,
  ItemType,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  TYPE_CONFIG,
} from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

import { CalendarIcon, Plus } from "lucide-react";
import {
  KaitenDevelopmentStageSelect,
  KaitenParticipantsSelect,
  useKaitenCatalog,
} from "@/components/kaiten/KaitenValueControls";

export function CreateTaskDialog() {
  const isCreateOpen = useBrainStore((s) => s.isCreateOpen);
  const closeCreate = useBrainStore((s) => s.closeCreate);
  const createDefaults = useBrainStore((s) => s.createDefaults);
  const createItem = useBrainStore((s) => s.createItem);
  const { catalog, loading: kaitenCatalogLoading } = useKaitenCatalog();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ItemType>("task");
  const [status, setStatus] = useState<ItemStatus>("inbox");
  const [priority, setPriority] = useState<ItemPriority>("none");
  const [category, setCategory] = useState<string>("other");
  const [developmentStage, setDevelopmentStage] = useState<string | null>(null);
  const [participants, setParticipants] = useState<DevelopmentParticipantInput[]>(
    []
  );
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const categoryConfig = useCategoryConfig();
  const storeCategories = useBrainStore((s) => s.categories);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens with defaults
  useEffect(() => {
    if (isCreateOpen) {
      setTitle("");
      setDescription("");
      setType((createDefaults.type as ItemType) || "task");
      setStatus((createDefaults.status as ItemStatus) || "inbox");
      setPriority((createDefaults.priority as ItemPriority) || "none");
      setCategory(createDefaults.category || "other");
      setDevelopmentStage(createDefaults.development_stage ?? null);
      setParticipants(
        Array.isArray(createDefaults.participants)
          ? createDefaults.participants
          : []
      );
      setDueDate(
        createDefaults.due_date ? new Date(createDefaults.due_date) : undefined
      );
    }
  }, [isCreateOpen, createDefaults]);

  const handleSubmit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createItem({
        title: trimmedTitle,
        description: description.trim() || undefined,
        type,
        status,
        priority,
        category,
        development_stage:
          category === "development" ? developmentStage ?? null : null,
        due_date: dueDate ? dueDate.toISOString() : null,
        participants: category === "development" ? participants : [],
      });
      closeCreate();
    } finally {
      setIsSubmitting(false);
    }
  }, [
    title,
    description,
    type,
    status,
    priority,
    category,
    developmentStage,
    dueDate,
    isSubmitting,
    participants,
    createItem,
    closeCreate,
  ]);

  const handleDateSelect = useCallback((date: Date | undefined) => {
    setDueDate(date);
    setDatePickerOpen(false);
  }, []);

  const handleClearDate = useCallback(() => {
    setDueDate(undefined);
    setDatePickerOpen(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const statusEntries = Object.entries(STATUS_CONFIG).filter(
    ([key]) => key !== "archived"
  ) as [ItemStatus, (typeof STATUS_CONFIG)[ItemStatus]][];

  return (
    <Dialog
      open={isCreateOpen}
      onOpenChange={(open) => {
        if (!open) closeCreate();
      }}
    >
      <DialogContent
        className="border-slate-200 bg-white sm:max-w-lg"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="text-slate-900">Создать задачу</DialogTitle>
          <DialogDescription className="sr-only">
            Заполните поля для создания новой задачи
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Title */}
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название задачи..."
            className="border-slate-200 bg-white text-base font-medium text-slate-900 placeholder:text-slate-400"
          />

          {/* Selectors row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Type */}
            <Select value={type} onValueChange={(v) => v && setType(v)}>
              <SelectTrigger size="sm" className="w-auto border-slate-200 bg-white">
                <SelectValue>
                  {TYPE_CONFIG[type].label}
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

            {/* Category */}
            <Select
              value={category}
              onValueChange={(v) => v && setCategory(v)}
            >
              <SelectTrigger size="sm" className="w-auto border-slate-200 bg-white">
                <SelectValue>
                  {categoryConfig[category]?.label ?? category}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {storeCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority */}
            <Select
              value={priority}
              onValueChange={(v) => v && setPriority(v)}
            >
              <SelectTrigger size="sm" className="w-auto border-slate-200 bg-white">
                <SelectValue>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-block size-2 rounded-full",
                        priority === "urgent" && "bg-red-500",
                        priority === "high" && "bg-orange-500",
                        priority === "medium" && "bg-yellow-500",
                        priority === "low" && "bg-blue-500",
                        priority === "none" && "bg-gray-400"
                      )}
                    />
                    {PRIORITY_CONFIG[priority].label}
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

            {/* Status */}
            <Select
              value={status}
              onValueChange={(v) => v && setStatus(v)}
            >
              <SelectTrigger size="sm" className="w-auto border-slate-200 bg-white">
                <SelectValue>
                  <span
                    className={cn(
                      "inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium",
                      STATUS_CONFIG[status].color
                    )}
                  >
                    {STATUS_CONFIG[status].label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {statusEntries.map(([key, config]) => (
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

          {category === "development" && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-600">
                    Этап разработки
                  </div>
                  <KaitenDevelopmentStageSelect
                    value={developmentStage}
                    options={catalog.development_stages}
                    onChange={setDevelopmentStage}
                    className="bg-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-600">
                    Участники
                  </div>
                  <KaitenParticipantsSelect
                    value={participants}
                    options={catalog.participants}
                    onChange={setParticipants}
                    buttonClassName="bg-white"
                  />
                </div>
              </div>

              {kaitenCatalogLoading && (
                <div className="text-xs text-slate-500">
                  Каталог Kaiten загружается. Если список пока пустой, он появится
                  автоматически после загрузки профиля синхронизации.
                </div>
              )}
            </div>
          )}

          {/* Due date */}
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger
              render={
                <button
                  className={cn(
                    "inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 transition-colors hover:bg-slate-50",
                    !dueDate && "text-slate-500"
                  )}
                  type="button"
                />
              }
            >
              <CalendarIcon className="size-3.5" />
              {dueDate
                ? format(dueDate, "d MMM yyyy", { locale: ru })
                : "Добавить срок"}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto border-slate-200 bg-white p-0">
              <Calendar
                mode="single"
                selected={dueDate}
                onSelect={handleDateSelect}
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

          {/* Description */}
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Добавьте описание..."
            className="min-h-[80px] resize-none border-slate-200 bg-slate-50 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:bg-white"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={closeCreate}
            className="border-slate-200"
          >
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || isSubmitting}
          >
            <Plus className="size-4" />
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
