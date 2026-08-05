-- Ручной порядок подзадач внутри родителя.
--
-- Раньше подзадачи всегда шли по created_at: список отражал порядок заведения,
-- а не порядок работ. Позиция — double precision, как и остальные позиции в
-- схеме: вставка между соседями не требует пересчёта всего ряда.
--
-- Колонка nullable: подзадача, созданная старым кодом до перезапуска
-- приложения, позиции не получит, и выборки обязаны это переживать —
-- `ORDER BY subtask_position NULLS LAST, created_at` ставит такую в конец
-- своей ветки, а не роняет порядок целиком.

ALTER TABLE core.tasks ADD COLUMN IF NOT EXISTS subtask_position double precision;

-- Бэкфилл существующих: порядок заведения и был единственным, который команда
-- видела до сих пор, — менять его молча нельзя.
UPDATE core.tasks t
   SET subtask_position = n.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY parent_task_id ORDER BY created_at, id) AS rn
      FROM core.tasks
     WHERE parent_task_id IS NOT NULL
  ) n
 WHERE n.id = t.id AND t.subtask_position IS NULL;

-- Выборка всегда идёт по одному родителю, поэтому индекс начинается с него.
CREATE INDEX IF NOT EXISTS tasks_parent_position_idx
    ON core.tasks (parent_task_id, subtask_position)
 WHERE parent_task_id IS NOT NULL;
