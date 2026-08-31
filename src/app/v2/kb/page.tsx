import { BookOpen } from "lucide-react";

/**
 * Раздел открыт, документ не выбран. Отдельного «обзора» здесь нет намеренно:
 * список последних дублировал бы дерево, которое и так стоит слева.
 */
export default function KbIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <BookOpen className="size-10 text-muted-foreground/60" />
      <p className="text-sm font-medium">Выберите документ слева</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Документы проекта видит вся его команда. Документ без проекта живёт в разделе «Общие»:
        доступ к нему настраивается поимённо.
      </p>
    </div>
  );
}
