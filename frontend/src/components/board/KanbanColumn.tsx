import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableTaskCard } from './SortableTaskCard'
import type { YouTrackIssue } from '../../services/api'

// Icon + color per state name — matches dashboard visual language
function getColumnMeta(title: string): { color: string } {
  const t = title.toLowerCase()
  if (t === 'in progress')                                      return { color: 'var(--color-warning)' }
  if (t === 'dev')                                              return { color: '#8250df' }
  if (t.includes('stage') || t.includes('prod') || t.includes('ready')) return { color: '#a78bfa' }
  if (t.includes('done') || t.includes('fixed') || t.includes('mobile done') || t.includes('verified')) return { color: 'var(--color-success)' }
  if (t.includes('block'))                                      return { color: 'var(--color-danger)' }
  return { color: '#888' }
}

interface KanbanColumnProps {
  id: string
  title: string
  issues: YouTrackIssue[]
  avatarMap: Record<string, string>
  onIssueClick?: (issue: YouTrackIssue) => void
}

export function KanbanColumn({ id, title, issues, avatarMap, onIssueClick }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id })
  const issueIds = issues.map(i => i.id)
  const { color } = getColumnMeta(title)

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'drop-zone-active' : ''}`}
      data-status={id}
    >
      {/* Header — matches dashboard: title left, count right */}
      <div className="kanban-column-header">
        <span className="kanban-column-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
          {title}
        </span>
        <span className="kanban-column-count">{issues.length}</span>
      </div>

      {/* Body — same class as dashboard */}
      <div className="kanban-column-body">
        <SortableContext items={issueIds} strategy={verticalListSortingStrategy}>
          {issues.length === 0 ? (
            <p className="text-muted" style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
              No issues
            </p>
          ) : (
            issues.map(issue => (
              <SortableTaskCard
                key={issue.id}
                issue={issue}
                avatarMap={avatarMap}
                onClick={() => onIssueClick?.(issue)}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}
