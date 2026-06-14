import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TaskCard } from './TaskCard'
import type { YouTrackIssue } from '../../services/api'

interface SortableTaskCardProps {
  issue: YouTrackIssue
  avatarMap: Record<string, string>
  extraClass?: string
  onClick?: () => void
}

export function SortableTaskCard({ issue, avatarMap, extraClass, onClick }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        issue={issue}
        avatarMap={avatarMap}
        isDragging={isDragging}
        extraClass={extraClass}
        onClick={onClick}
      />
    </div>
  )
}
