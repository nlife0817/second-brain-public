"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";

/** Мини-редактор описания (Tiptap StarterKit). Отдаёт HTML через onBlur. */
export function RichText({
  value,
  onSave,
  placeholder = "Добавьте описание…",
  editable = true,
}: {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: value || "",
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring",
      },
    },
    onBlur: ({ editor: e }) => {
      const html = e.isEmpty ? "" : e.getHTML();
      if (html !== value) onSave(html);
    },
  });

  // Синхронизация при смене задачи (компонент переиспользуется по key).
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== (value || "")) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}
