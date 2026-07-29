"use client";

// Выбор активной организации. Раньше жил в шапке сайдбара — название
// организации было кнопкой с выпадающим меню. Теперь шапка это просто
// заголовок, а переключатель переехал в «Настройки».

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";

export function OrgSwitcher() {
  const router = useRouter();
  const storeApi = useV2StoreApi();
  const { orgs, orgId, orgName } = useV2Store();

  async function switchTo(nextId: string) {
    if (nextId === orgId) return;
    await storeApi.getState().switchOrg(nextId);
    // Данные страницы считает сервер по cookie — без обновления серверного
    // рендера экран остался бы на задачах прежней организации.
    router.refresh();
  }

  if (orgs.length <= 1) {
    return <p className="text-sm">{orgName}</p>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 hover:bg-muted/60">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              {orgName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm">{orgName}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent className="w-64">
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => void switchTo(o.id)}>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.id === orgId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
