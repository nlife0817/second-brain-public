"use client"

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

// Меню по правой кнопке.
//
// Части — те же, что у выпадающего меню: Base UI отдаёт под обоими корнями один
// и тот же `Menu`, отличается только то, чем меню открывают. Поэтому здесь
// заводится ровно корень и область-триггер, а содержимое переиспользуется —
// иначе в приложении завелись бы два меню с разъезжающимся оформлением.

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

export {
  ContextMenu,
  ContextMenuTrigger,
  DropdownMenuContent as ContextMenuContent,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
  DropdownMenuSub as ContextMenuSub,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
}
