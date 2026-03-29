"use client";

import { useState, useEffect, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import type { EntityType, Comment } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

import {
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
} from "lucide-react";

interface CommentsListProps {
  entityType: EntityType;
  entityId: string;
}

function MiniToolbar({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  if (!editor) return null;
  return (
    <div className="flex items-center gap-0.5 border-b border-slate-100 px-2 py-1">
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600", editor.isActive("bold") && "bg-slate-100 text-slate-700")}
      >
        <BoldIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600", editor.isActive("italic") && "bg-slate-100 text-slate-700")}
      >
        <ItalicIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
        className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600", editor.isActive("underline") && "bg-slate-100 text-slate-700")}
      >
        <UnderlineIcon className="size-3.5" />
      </button>
      <div className="mx-1 h-4 w-px bg-slate-200" />
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
        className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600", editor.isActive("bulletList") && "bg-slate-100 text-slate-700")}
      >
        <List className="size-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
        className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600", editor.isActive("orderedList") && "bg-slate-100 text-slate-700")}
      >
        <ListOrdered className="size-3.5" />
      </button>
    </div>
  );
}

function CommentEditor({ initialContent, onSave, onCancel, placeholder }: {
  initialContent?: string;
  onSave: (html: string) => void;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: placeholder ?? "Написать комментарий..." }),
    ],
    content: initialContent || "",
    editorProps: {
      attributes: {
        class: "min-h-[60px] max-h-[200px] overflow-auto px-3 py-2 prose prose-sm max-w-none focus:outline-none text-sm",
      },
    },
  });

  const handleSave = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    if (!html || html === "<p></p>") return;
    onSave(html);
    editor.commands.clearContent();
  }, [editor, onSave]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <MiniToolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-1.5 border-t border-slate-100 px-2 py-1.5">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-6 px-2 text-xs">
            <X className="size-3 mr-1" /> Отмена
          </Button>
        )}
        <Button size="sm" onClick={handleSave} className="h-6 px-2.5 text-xs">
          <Check className="size-3 mr-1" /> Сохранить
        </Button>
      </div>
    </div>
  );
}

export function CommentsList({ entityType, entityId }: CommentsListProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchComments = useBrainStore((s) => s.fetchComments);
  const createComment = useBrainStore((s) => s.createComment);
  const updateComment = useBrainStore((s) => s.updateComment);
  const deleteComment = useBrainStore((s) => s.deleteComment);

  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchComments(entityType, entityId);
    setComments(data);
    setLoading(false);
  }, [fetchComments, entityType, entityId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleCreate = useCallback(async (text: string) => {
    await createComment(entityType, entityId, text);
    setShowEditor(false);
    await loadComments();
  }, [createComment, entityType, entityId, loadComments]);

  const handleUpdate = useCallback(async (commentId: string, text: string) => {
    await updateComment(commentId, text);
    setEditingId(null);
    await loadComments();
  }, [updateComment, loadComments]);

  const handleDelete = useCallback(async (commentId: string) => {
    await deleteComment(commentId);
    await loadComments();
  }, [deleteComment, loadComments]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <MessageSquare className="size-4 text-slate-400" />
          Комментарии
          {comments.length > 0 && (
            <span className="text-xs text-slate-400">({comments.length})</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => setShowEditor(!showEditor)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {showEditor && (
        <CommentEditor
          onSave={handleCreate}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {loading && comments.length === 0 && (
        <div className="text-xs text-slate-400">Загрузка...</div>
      )}

      {comments.length > 0 && (
        <div className="space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="group rounded-lg border border-slate-100 bg-white">
              {editingId === comment.id ? (
                <CommentEditor
                  initialContent={comment.text}
                  onSave={(text) => handleUpdate(comment.id, text)}
                  onCancel={() => setEditingId(null)}
                  placeholder="Редактировать..."
                />
              ) : (
                <>
                  <div
                    className="prose prose-sm max-w-none px-3 py-2 text-sm text-slate-700"
                    dangerouslySetInnerHTML={{ __html: comment.text }}
                  />
                  <div className="flex items-center justify-between border-t border-slate-50 px-3 py-1">
                    <span className="text-[10px] text-slate-300">
                      {format(new Date(comment.created_at), "d MMM yyyy, HH:mm", { locale: ru })}
                      {comment.updated_at !== comment.created_at && " (ред.)"}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingId(comment.id)}
                        className="rounded p-0.5 text-slate-300 hover:text-slate-500"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="rounded p-0.5 text-slate-300 hover:text-red-400"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
