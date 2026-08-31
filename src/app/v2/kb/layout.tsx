// Серверная оболочка раздела: дерево считается здесь и уезжает в первый HTML.
// Layout, а не страница, — чтобы переход между документами не перемонтировал
// колонку и не терял раскрытые ветки.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listKbTrash, listKbTree } from "@/lib/core/kb";
import { canOrg } from "@/lib/core/policy";
import { KbShell } from "./KbShell";

export default async function KbLayout({ children }: { children: React.ReactNode }) {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  const [tree, trash] = await Promise.all([listKbTree(auth), listKbTrash(auth)]);

  return (
    <KbShell
      initialTree={tree}
      trashCount={trash.length}
      canCreateCommon={canOrg(auth, "kb.create.common")}
      // Порядок разделов — это порядок проектов организации, общий с панелью,
      // поэтому и право на него то же самое.
      canOrderProjects={canOrg(auth, "projects.order")}
    >
      {children}
    </KbShell>
  );
}
