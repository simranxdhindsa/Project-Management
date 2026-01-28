import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { SortableTaskCard } from './SortableTaskCard'
import type { Task, TaskStatus } from '../../types'

interface KanbanColumnProps {
  id: TaskStatus
  title: string
  tasks: Task[]
  onTaskClick?: (task: Task) => void
  onTaskEdit?: (task: Task) => void
}

const getColumnColor = (status: TaskStatus): string => {
  switch (status) {
    case 'todo':
      return 'var(--glass-border)'
    case 'in_progress':
      return 'var(--status-in-progress)'
    case 'review':
      return 'var(--status-review)'
    case 'done':
      return 'var(--status-done)'
    default:
      return 'var(--glass-border)'
  }
}

export function KanbanColumn({ id, title, tasks, onTaskClick, onTaskEdit }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
  })

  const taskIds = tasks.map((task) => task.id)

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'column-drag-over' : ''}`}
      data-status={id}
    >
      <div className="kanban-column-header">
        <div className="column-header-title">
          <span
            className="column-status-dot"
            style={{ backgroundColor: getColumnColor(id) }}
          />
          <h3 className="column-title">{title}</h3>
          <span className="column-task-count">{tasks.length}</span>
        </div>
      </div>

      <div className="kanban-column-content">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className="column-empty-state">
              <p>No tasks</p>
            </div>
          ) : (
            tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick?.(task)}
                onEdit={() => onTaskEdit?.(task)}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}
