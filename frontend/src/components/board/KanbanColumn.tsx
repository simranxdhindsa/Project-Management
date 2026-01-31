import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { SortableTaskCard } from './SortableTaskCard'
import type { Task } from '../../types'

interface KanbanColumnProps {
  id: string
  title: string
  tasks: Task[]
  position: number
  onTaskClick?: (task: Task) => void
  onTaskEdit?: (task: Task) => void
}

// Generate column color based on position and column name
const getColumnColor = (position: number, title: string): string => {
  // First check for common column name patterns
  const lowerTitle = title.toLowerCase()

  if (lowerTitle.includes('done') || lowerTitle.includes('complete')) {
    return 'var(--status-done)'
  }
  if (lowerTitle.includes('progress') || lowerTitle.includes('doing') || lowerTitle.includes('working')) {
    return 'var(--status-in-progress)'
  }
  if (lowerTitle.includes('review') || lowerTitle.includes('testing') || lowerTitle.includes('qa')) {
    return 'var(--status-review)'
  }

  // Fallback to position-based colors for custom sections
  const colors = [
    'var(--glass-border)',           // First column (usually backlog/todo)
    'var(--status-in-progress)',     // Second column
    'var(--status-review)',          // Third column
    'var(--status-done)',            // Fourth column
    '#8b5cf6',                        // Purple
    '#ec4899',                        // Pink
    '#f97316',                        // Orange
    '#14b8a6',                        // Teal
  ]

  return colors[position % colors.length]
}

export function KanbanColumn({ id, title, tasks, position, onTaskClick, onTaskEdit }: KanbanColumnProps) {
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
            style={{ backgroundColor: getColumnColor(position, title) }}
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
