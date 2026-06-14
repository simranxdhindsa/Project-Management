import { useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableTaskCard } from './SortableTaskCard'
import type { YouTrackIssue } from '../../services/api'

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
  getExtraClass?: (issue: YouTrackIssue) => string
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function KanbanColumn({ id, title, issues, avatarMap, onIssueClick, getExtraClass, hasMore, isLoadingMore, onLoadMore }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id })
  const issueIds = issues.map(i => i.id)
  const { color } = getColumnMeta(title)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Trigger onLoadMore when user scrolls within 80px of the column bottom
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !onLoadMore) return
    const handleScroll = () => {
      if (!hasMore || isLoadingMore) return
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        onLoadMore()
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [hasMore, isLoadingMore, onLoadMore])

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'drop-zone-active' : ''}`}
      data-status={id}
    >
      <div className="kanban-column-header">
        <span className="kanban-column-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
          {title}
        </span>
        <span className="kanban-column-count">{issues.length}{hasMore ? '+' : ''}</span>
      </div>

      <div className="kanban-column-body" ref={bodyRef}>
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
                extraClass={getExtraClass?.(issue)}
                onClick={() => onIssueClick?.(issue)}
              />
            ))
          )}
        </SortableContext>

        {isLoadingMore && (
          <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}
