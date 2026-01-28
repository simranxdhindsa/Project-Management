import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { TaskCard } from './TaskCard'
import type { Task } from '../../types'

interface SortableTaskCardProps {
  task: Task
  onClick?: () => void
  onEdit?: () => void
}

export function SortableTaskCard({ task, onClick, onEdit }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        isDragging={isDragging}
        onClick={onClick}
        onEdit={onEdit}
      />
    </div>
  )
}
