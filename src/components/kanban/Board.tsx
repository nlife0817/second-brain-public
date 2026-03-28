"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useBrainStore, useFilteredItems } from "@/lib/store";
import {
  KANBAN_COLUMNS,
  STATUS_CONFIG,
  ItemStatus,
  ItemWithSubtasks,
} from "@/types";
import { KanbanColumn } from "./Column";
import { KanbanCard } from "./Card";

const measuringConfig = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

export function KanbanBoard() {
  const filteredItems = useFilteredItems();
  const reorderItems = useBrainStore((s) => s.reorderItems);
  const updateItem = useBrainStore((s) => s.updateItem);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<ItemWithSubtasks[] | null>(null);

  // Track the latest filteredItems so we can clear localItems when store updates
  const prevFilteredRef = useRef(filteredItems);
  useEffect(() => {
    // When the store items update (e.g. after fetchItems completes), clear optimistic state
    if (prevFilteredRef.current !== filteredItems && localItems !== null && activeId === null) {
      setLocalItems(null);
    }
    prevFilteredRef.current = filteredItems;
  }, [filteredItems, localItems, activeId]);

  // Use localItems during drag for optimistic updates, otherwise filtered
  const items = localItems ?? filteredItems;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const itemsByStatus = useMemo(() => {
    const map: Record<ItemStatus, ItemWithSubtasks[]> = {
      inbox: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      archived: [],
    };
    for (const item of items) {
      if (map[item.status]) {
        map[item.status].push(item);
      }
    }
    // Sort each column by position
    for (const key of Object.keys(map) as ItemStatus[]) {
      map[key].sort((a, b) => a.position - b.position);
    }
    return map;
  }, [items]);

  const activeItem = useMemo(
    () => (activeId ? items.find((i) => i.id === activeId) ?? null : null),
    [activeId, items]
  );

  const findColumnForItem = useCallback(
    (itemId: string): ItemStatus | null => {
      for (const col of KANBAN_COLUMNS) {
        if (itemId === `column-${col}`) return col;
      }
      const item = items.find((i) => i.id === itemId);
      return item ? item.status : null;
    },
    [items]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      // Clear any inline editing when drag starts
      setEditingItem(null);
      setActiveId(event.active.id as string);
      setLocalItems([...filteredItems]);
    },
    [filteredItems, setEditingItem]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const activeColumn = findColumnForItem(activeId);
      const overColumn = findColumnForItem(overId);

      if (!activeColumn || !overColumn || activeColumn === overColumn) return;

      setLocalItems((prev) => {
        if (!prev) return prev;
        return prev.map((item) =>
          item.id === activeId ? { ...item, status: overColumn } : item
        );
      });
    },
    [findColumnForItem]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveId(null);

      if (!over) {
        setLocalItems(null);
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;

      let targetStatus: ItemStatus | null = null;

      for (const col of KANBAN_COLUMNS) {
        if (overId === `column-${col}`) {
          targetStatus = col;
          break;
        }
      }

      if (!targetStatus) {
        const overItem = (localItems ?? filteredItems).find(
          (i) => i.id === overId
        );
        if (overItem) {
          targetStatus = overItem.status;
        }
      }

      if (!targetStatus) {
        setLocalItems(null);
        return;
      }

      const currentItems = localItems ?? filteredItems;
      const columnItems = currentItems
        .filter((i) => i.status === targetStatus || i.id === activeId)
        .filter((i) => i.status === targetStatus)
        .sort((a, b) => a.position - b.position);

      const activeItem = currentItems.find((i) => i.id === activeId);
      if (!activeItem) {
        setLocalItems(null);
        return;
      }

      const overIndex = columnItems.findIndex((i) => i.id === overId);
      const activeIndex = columnItems.findIndex((i) => i.id === activeId);

      let reorderedColumn: ItemWithSubtasks[];

      if (activeIndex !== -1 && overIndex !== -1) {
        reorderedColumn = arrayMove(columnItems, activeIndex, overIndex);
      } else if (activeIndex === -1) {
        const insertIndex = overIndex !== -1 ? overIndex : columnItems.length;
        reorderedColumn = [...columnItems];
        reorderedColumn.splice(insertIndex, 0, {
          ...activeItem,
          status: targetStatus,
        });
      } else {
        reorderedColumn = columnItems;
      }

      const updates = reorderedColumn.map((item, index) => ({
        id: item.id,
        position: index,
        status: targetStatus as string,
      }));

      // Optimistic update: apply the final state to localItems immediately
      // so there's no bounce-back while the server round-trip happens
      setLocalItems((prev) => {
        if (!prev) return prev;
        const positionMap = new Map(updates.map((u) => [u.id, u]));
        return prev.map((item) => {
          const update = positionMap.get(item.id);
          if (update) {
            return {
              ...item,
              position: update.position,
              status: update.status as ItemStatus,
            };
          }
          return item;
        });
      });

      // Don't clear localItems here — keep the optimistic state visible.
      // The useEffect above will clear localItems once fetchItems
      // (called inside reorderItems) updates the store.

      try {
        await reorderItems(updates);
      } catch {
        // fetchItems will restore correct state; useEffect will clear localItems
      }
    },
    [localItems, filteredItems, reorderItems]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalItems(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={measuringConfig}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-1">
        {KANBAN_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            items={itemsByStatus[status]}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{ duration: 150, easing: "ease-out" }}
      >
        {activeItem ? <KanbanCard item={activeItem} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
