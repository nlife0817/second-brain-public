"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBrainStore, useSelectedClient } from "@/lib/store";
import {
  ClientFull,
  ClientStatus,
  ContactFieldType,
  CONTACT_FIELD_CONFIG,
  CLIENT_PARAMS_CONFIG,
  ClientParams,
} from "@/types";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { RelationsList } from "@/components/relations/RelationsList";
import { CommentsList } from "@/components/comments/CommentsList";

import {
  Trash2,
  Plus,
  X,
  Building2,
  Users,
  StickyNote,
  Link2,
  Mail,
  Phone,
  Send,
  Save,
  Pencil,
  ChevronDown,
  Banknote,
  UserCheck,
  PhoneCall,
  Database as DatabaseIcon,
  BarChart3,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Local-state types (mirrors UpdateClientPayload shape)              */
/* ------------------------------------------------------------------ */

interface LocalCompany {
  id?: string;
  name: string;
}

interface LocalContactField {
  id?: string;
  type: ContactFieldType;
  value: string;
}

interface LocalContact {
  id?: string;
  name: string;
  fields: LocalContactField[];
}

interface LocalNote {
  id?: string;
  text: string;
}

interface LocalLink {
  id?: string;
  url: string;
  title: string;
}

interface LocalClientState {
  name: string;
  status_id: string | null;
  budget: string;
  operators_per_shift: string;
  operators_total: string;
  calls_per_month: string;
  crm_system: string;
  companies: LocalCompany[];
  contacts: LocalContact[];
  notes: LocalNote[];
  links: LocalLink[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function deepCloneClient(client: ClientFull): LocalClientState {
  return {
    name: client.name,
    status_id: client.status_id,
    budget: client.budget ?? "",
    operators_per_shift: client.operators_per_shift ?? "",
    operators_total: client.operators_total ?? "",
    calls_per_month: client.calls_per_month ?? "",
    crm_system: client.crm_system ?? "",
    companies: client.companies.map((c) => ({ id: c.id, name: c.name })),
    contacts: client.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      fields: c.fields.map((f) => ({
        id: f.id,
        type: f.type,
        value: f.value,
      })),
    })),
    notes: client.notes.map((n) => ({ id: n.id, text: n.text })),
    links: client.links.map((l) => ({
      id: l.id,
      url: l.url,
      title: l.title,
    })),
  };
}

const FIELD_TYPE_ICONS: Record<ContactFieldType, typeof Mail> = {
  email: Mail,
  phone: Phone,
  telegram: Send,
  note: StickyNote,
};

const CONTACT_FIELD_TYPES: ContactFieldType[] = [
  "email",
  "phone",
  "telegram",
  "note",
];

/* ------------------------------------------------------------------ */
/*  Section header                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon: Icon,
  label,
  count,
  onAdd,
}: {
  icon: typeof Building2;
  label: string;
  count: number;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-slate-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {count > 0 && (
          <span className="text-[10px] tabular-nums text-slate-400">
            ({count})
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onAdd}
        className="text-slate-400 hover:text-slate-700"
        title={`Добавить`}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete confirmation                                                */
/* ------------------------------------------------------------------ */

function DeleteConfirmation({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500">Удалить клиента?</span>
      <button
        onClick={onConfirm}
        className="inline-flex items-center justify-center h-6 px-2 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-medium"
      >
        Да
      </button>
      <button
        onClick={onCancel}
        className="inline-flex items-center justify-center h-6 px-2 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors text-xs font-medium"
      >
        Нет
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact field type selector (inline dropdown)                      */
/* ------------------------------------------------------------------ */

function FieldTypeSelect({
  value,
  onChange,
}: {
  value: ContactFieldType;
  onChange: (type: ContactFieldType) => void;
}) {
  return (
    <Select value={value} onValueChange={(val) => { if (val) onChange(val); }}>
      <SelectTrigger
        size="sm"
        className="h-6 w-[110px] border-slate-200 bg-slate-50 text-[11px] shrink-0"
      >
        <SelectValue>
          <span className="flex items-center gap-1">
            {(() => {
              const Icon = FIELD_TYPE_ICONS[value];
              return <Icon className="size-3 text-slate-400" />;
            })()}
            <span>{CONTACT_FIELD_CONFIG[value].label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="border-slate-200 bg-white min-w-[140px]">
        {CONTACT_FIELD_TYPES.map((type) => {
          const config = CONTACT_FIELD_CONFIG[type];
          const Icon = FIELD_TYPE_ICONS[type];
          return (
            <SelectItem key={type} value={type}>
              <span className="flex items-center gap-1.5">
                <Icon className="size-3 text-slate-400" />
                {config.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge (for select options)                                  */
/* ------------------------------------------------------------------ */

function StatusBadgeOption({ status }: { status: ClientStatus }) {
  return (
    <Badge
      variant="secondary"
      className="text-[10px] font-medium rounded-md"
      style={{
        backgroundColor: `${status.color}18`,
        color: status.color,
        borderColor: `${status.color}30`,
      }}
    >
      {status.name}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Client detail content (shared by modal & panel)                    */
/* ------------------------------------------------------------------ */

function ClientDetailContent() {
  const isOpen = useBrainStore((s) => s.isClientDetailOpen);
  const closeModal = useBrainStore((s) => s.closeClientDetail);
  const updateClient = useBrainStore((s) => s.updateClient);
  const deleteClient = useBrainStore((s) => s.deleteClient);
  const clientStatuses = useBrainStore((s) => s.clientStatuses);
  const client = useSelectedClient();

  const [local, setLocal] = useState<LocalClientState | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset local state when client data changes (modal opens with new client)
  useEffect(() => {
    if (client && isOpen) {
      setLocal(deepCloneClient(client));
      setEditingName(false);
      setConfirmingDelete(false);
    }
  }, [client?.id, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus name input when editing
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  /* ---------- Save handler ---------- */

  const handleSave = useCallback(async () => {
    if (!client || !local) return;
    setSaving(true);
    try {
      await updateClient(client.id, {
        name: local.name,
        status_id: local.status_id,
        budget: local.budget,
        operators_per_shift: local.operators_per_shift,
        operators_total: local.operators_total,
        calls_per_month: local.calls_per_month,
        crm_system: local.crm_system,
        companies: local.companies,
        contacts: local.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          fields: c.fields,
        })),
        notes: local.notes,
        links: local.links,
      });
    } finally {
      setSaving(false);
    }
  }, [client, local, updateClient]);

  /* ---------- Delete handler ---------- */

  const handleDelete = useCallback(async () => {
    if (!client) return;
    await deleteClient(client.id);
    closeModal();
  }, [client, deleteClient, closeModal]);

  /* ---------- Local state updaters ---------- */

  const updateLocal = useCallback(
    (patch: Partial<LocalClientState>) => {
      setLocal((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    []
  );

  /* -- Companies -- */
  const addCompany = useCallback(() => {
    setLocal((prev) => {
      if (!prev) return prev;
      return { ...prev, companies: [...prev.companies, { name: "" }] };
    });
  }, []);

  const updateCompany = useCallback((index: number, name: string) => {
    setLocal((prev) => {
      if (!prev) return prev;
      const companies = [...prev.companies];
      companies[index] = { ...companies[index], name };
      return { ...prev, companies };
    });
  }, []);

  const removeCompany = useCallback((index: number) => {
    setLocal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        companies: prev.companies.filter((_, i) => i !== index),
      };
    });
  }, []);

  /* -- Contacts -- */
  const addContact = useCallback(() => {
    setLocal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contacts: [...prev.contacts, { name: "", fields: [] }],
      };
    });
  }, []);

  const updateContactName = useCallback(
    (index: number, name: string) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const contacts = [...prev.contacts];
        contacts[index] = { ...contacts[index], name };
        return { ...prev, contacts };
      });
    },
    []
  );

  const removeContact = useCallback((index: number) => {
    setLocal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contacts: prev.contacts.filter((_, i) => i !== index),
      };
    });
  }, []);

  const addContactField = useCallback(
    (contactIndex: number, type: ContactFieldType = "email") => {
      setLocal((prev) => {
        if (!prev) return prev;
        const contacts = [...prev.contacts];
        contacts[contactIndex] = {
          ...contacts[contactIndex],
          fields: [...contacts[contactIndex].fields, { type, value: "" }],
        };
        return { ...prev, contacts };
      });
    },
    []
  );

  const updateContactField = useCallback(
    (
      contactIndex: number,
      fieldIndex: number,
      patch: Partial<LocalContactField>
    ) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const contacts = [...prev.contacts];
        const fields = [...contacts[contactIndex].fields];
        fields[fieldIndex] = { ...fields[fieldIndex], ...patch };
        contacts[contactIndex] = { ...contacts[contactIndex], fields };
        return { ...prev, contacts };
      });
    },
    []
  );

  const removeContactField = useCallback(
    (contactIndex: number, fieldIndex: number) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const contacts = [...prev.contacts];
        contacts[contactIndex] = {
          ...contacts[contactIndex],
          fields: contacts[contactIndex].fields.filter(
            (_, i) => i !== fieldIndex
          ),
        };
        return { ...prev, contacts };
      });
    },
    []
  );

  /* -- Notes -- */
  const addNote = useCallback(() => {
    setLocal((prev) => {
      if (!prev) return prev;
      return { ...prev, notes: [...prev.notes, { text: "" }] };
    });
  }, []);

  const updateNote = useCallback((index: number, text: string) => {
    setLocal((prev) => {
      if (!prev) return prev;
      const notes = [...prev.notes];
      notes[index] = { ...notes[index], text };
      return { ...prev, notes };
    });
  }, []);

  const removeNote = useCallback((index: number) => {
    setLocal((prev) => {
      if (!prev) return prev;
      return { ...prev, notes: prev.notes.filter((_, i) => i !== index) };
    });
  }, []);

  /* -- Links -- */
  const addLink = useCallback(() => {
    setLocal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        links: [...prev.links, { url: "", title: "" }],
      };
    });
  }, []);

  const updateLink = useCallback(
    (index: number, patch: Partial<LocalLink>) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const links = [...prev.links];
        links[index] = { ...links[index], ...patch };
        return { ...prev, links };
      });
    },
    []
  );

  const removeLink = useCallback((index: number) => {
    setLocal((prev) => {
      if (!prev) return prev;
      return { ...prev, links: prev.links.filter((_, i) => i !== index) };
    });
  }, []);

  /* ---------- Render guard ---------- */

  if (!client || !local) return null;

  const currentStatus = clientStatuses.find(
    (s) => s.id === local.status_id
  ) ?? null;

  /* ------------------------------------------------------------------ */
  /*  Content JSX (shared between modal and panel)                       */
  /* ------------------------------------------------------------------ */

  const content = (
    <div className="p-5 sm:p-6 space-y-0">
      {/* ====== HEADER ====== */}
      <div className="flex items-start gap-3 pb-4">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={local.name}
              onChange={(e) => updateLocal({ name: e.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingName(false);
                if (e.key === "Escape") setEditingName(false);
              }}
              className="text-lg font-semibold text-slate-900 h-9 border-slate-200"
              placeholder="Имя клиента"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="group/name flex items-center gap-1.5 text-left w-full"
              title="Нажмите для редактирования"
            >
              <h2 className="text-lg font-semibold text-slate-900 truncate">
                {local.name || "Без имени"}
              </h2>
              <Pencil className="size-3.5 text-slate-300 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
            </button>
          )}
        </div>

        <Select
          value={local.status_id ?? "__none__"}
          onValueChange={(val) =>
            updateLocal({ status_id: val === "__none__" ? null : val })
          }
        >
          <SelectTrigger size="sm" className="h-7 w-auto border-slate-200 bg-white shrink-0">
            <SelectValue>
              {currentStatus ? (
                <StatusBadgeOption status={currentStatus} />
              ) : (
                <span className="text-xs text-slate-400">Статус</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-slate-200 bg-white min-w-[160px]">
            <SelectItem value="__none__">
              <span className="text-xs text-slate-400">Без статуса</span>
            </SelectItem>
            {clientStatuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                <StatusBadgeOption status={status} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {confirmingDelete ? (
          <DeleteConfirmation
            onConfirm={handleDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmingDelete(true)}
            className="text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0"
            title="Удалить клиента"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <Separator className="bg-slate-100" />

      {/* ====== PARAMS ====== */}
      <div className="pt-2">
        <div className="flex items-center gap-2 py-2">
          <BarChart3 className="size-4 text-slate-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Параметры
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2">
          {CLIENT_PARAMS_CONFIG.map(({ key, label, placeholder }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-500">{label}</label>
              <Input
                value={local[key]}
                onChange={(e) => updateLocal({ [key]: e.target.value })}
                placeholder={placeholder}
                className="h-7 text-sm border-slate-200"
              />
            </div>
          ))}
        </div>
      </div>
      <Separator className="bg-slate-100" />

      {/* ====== COMPANIES ====== */}
      <div className="pt-2">
        <SectionHeader icon={Building2} label="Компании" count={local.companies.length} onAdd={addCompany} />
        {local.companies.length > 0 && (
          <div className="space-y-1.5 pb-2">
            {local.companies.map((company, i) => (
              <div key={company.id ?? `new-${i}`} className="flex items-center gap-2">
                <Input value={company.name} onChange={(e) => updateCompany(i, e.target.value)} placeholder="Название компании" className="h-7 text-sm flex-1 border-slate-200" />
                <button onClick={() => removeCompany(i)} className="inline-flex items-center justify-center size-6 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator className="bg-slate-100" />

      {/* ====== CONTACTS ====== */}
      <div className="pt-2">
        <SectionHeader icon={Users} label="Контакты" count={local.contacts.length} onAdd={addContact} />
        {local.contacts.length > 0 && (
          <div className="space-y-3 pb-2">
            {local.contacts.map((contact, ci) => (
              <div key={contact.id ?? `new-contact-${ci}`} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={contact.name} onChange={(e) => updateContactName(ci, e.target.value)} placeholder="Имя контакта" className="h-7 text-sm font-medium flex-1 border-slate-200 bg-white" />
                  <button onClick={() => removeContact(ci)} className="inline-flex items-center justify-center size-6 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"><X className="size-3.5" /></button>
                </div>
                {contact.fields.length > 0 && (
                  <div className="space-y-1.5 pl-1">
                    {contact.fields.map((field, fi) => (
                      <div key={field.id ?? `new-field-${ci}-${fi}`} className="flex items-center gap-1.5">
                        <FieldTypeSelect value={field.type} onChange={(type) => updateContactField(ci, fi, { type })} />
                        <Input value={field.value} onChange={(e) => updateContactField(ci, fi, { value: e.target.value })} placeholder={CONTACT_FIELD_CONFIG[field.type].placeholder} className="h-6 text-xs flex-1 border-slate-200 bg-white" />
                        <button onClick={() => removeContactField(ci, fi)} className="inline-flex items-center justify-center size-5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"><X className="size-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => addContactField(ci)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors pl-1 pt-0.5">
                  <Plus className="size-3" /><span>Добавить поле</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator className="bg-slate-100" />

      {/* ====== NOTES ====== */}
      <div className="pt-2">
        <SectionHeader icon={StickyNote} label="Заметки" count={local.notes.length} onAdd={addNote} />
        {local.notes.length > 0 && (
          <div className="space-y-2 pb-2">
            {local.notes.map((note, i) => (
              <div key={note.id ?? `new-note-${i}`} className="flex gap-2">
                <Textarea value={note.text} onChange={(e) => updateNote(i, e.target.value)} placeholder="Текст заметки..." className="flex-1 text-sm min-h-[56px] border-slate-200 resize-none" />
                <button onClick={() => removeNote(i)} className="inline-flex items-center justify-center size-6 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0 mt-1"><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator className="bg-slate-100" />

      {/* ====== LINKS ====== */}
      <div className="pt-2">
        <SectionHeader icon={Link2} label="Ссылки" count={local.links.length} onAdd={addLink} />
        {local.links.length > 0 && (
          <div className="space-y-1.5 pb-2">
            {local.links.map((link, i) => (
              <div key={link.id ?? `new-link-${i}`} className="flex items-center gap-2">
                <Input value={link.title} onChange={(e) => updateLink(i, { title: e.target.value })} placeholder="Название" className="h-7 text-sm w-[35%] border-slate-200" />
                <Input value={link.url} onChange={(e) => updateLink(i, { url: e.target.value })} placeholder="https://..." className="h-7 text-sm flex-1 border-slate-200" />
                <button onClick={() => removeLink(i)} className="inline-flex items-center justify-center size-6 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== RELATIONS ====== */}
      {client && (
        <>
          <Separator className="bg-slate-100" />
          <div className="pt-2">
            <RelationsList entityType="client" entityId={client.id} />
          </div>
        </>
      )}

      {/* ====== COMMENTS ====== */}
      {client && (
        <>
          <Separator className="bg-slate-100" />
          <div className="pt-2">
            <CommentsList entityType="client" entityId={client.id} />
          </div>
        </>
      )}

      {/* ====== FOOTER ====== */}
      <div className="pt-4 flex justify-end">
        <Button variant="default" size="sm" onClick={handleSave} disabled={saving || !local.name.trim()} className="gap-1.5">
          <Save className="size-3.5" />
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </div>
  );

  return content;
}

/* ================================================================== */
/*  ClientDetailModal — Dialog wrapper                                 */
/* ================================================================== */

export function ClientDetailModal() {
  const isOpen = useBrainStore((s) => s.isClientDetailOpen);
  const closeDetail = useBrainStore((s) => s.closeClientDetail);
  const detailMode = useBrainStore((s) => s.detailMode);
  const client = useSelectedClient();

  if (detailMode !== "modal") return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeDetail(); }}>
      <DialogContent
        className="max-w-[calc(100%-1rem)] sm:max-w-2xl w-full max-h-[90vh] p-0 bg-white overflow-hidden"
        showCloseButton
      >
        <DialogTitle className="sr-only">{client?.name ?? "Клиент"}</DialogTitle>
        <DialogDescription className="sr-only">Детали клиента</DialogDescription>
        <ScrollArea className="max-h-[90vh]">
          <ClientDetailContent />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/*  ClientDetailPanel — inline side panel wrapper                      */
/* ================================================================== */

const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 420;

function getPanelMaxWidth() {
  if (typeof window === "undefined") return 700;
  return Math.floor(window.innerWidth * 0.5);
}

export function ClientDetailPanel() {
  const isOpen = useBrainStore((s) => s.isClientDetailOpen);
  const closeDetail = useBrainStore((s) => s.closeClientDetail);
  const detailMode = useBrainStore((s) => s.detailMode);
  const client = useSelectedClient();

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const max = getPanelMaxWidth();
      setPanelWidth((prev) => Math.min(prev, Math.max(PANEL_MIN_WIDTH, max)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? PANEL_DEFAULT_WIDTH;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const maxW = getPanelMaxWidth();
      const delta = startX - ev.clientX;
      const newWidth = Math.min(maxW, Math.max(PANEL_MIN_WIDTH, startWidth + delta));
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

  if (detailMode !== "panel") return null;
  if (!isOpen || !client) return null;

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
      {/* Drag handle */}
      <div
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover:bg-violet-400/30 active:bg-violet-400/50 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />
      {/* Close */}
      <div className="flex items-center justify-end p-2 shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={closeDetail}>
          <X className="size-4" />
        </Button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <ClientDetailContent />
      </div>
    </div>
  );
}
