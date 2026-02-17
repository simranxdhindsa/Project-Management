import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, ExternalLink, ArrowUpDown, ChevronUp, ChevronDown, X, Copy, CheckCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/services/api'
import type { YouTrackIssue } from '@/services/api'

type SortField = 'id' | 'summary' | 'status' | 'priority' | 'assignee' | 'updated'
type SortDir = 'asc' | 'desc'

interface ListViewPageProps {
  showMyTasks: boolean
}

const PRIORITY_ORDER: Record<string, number> = {
  'show-stopper': 0,
  critical: 1,
  major: 2,
  normal: 3,
  minor: 4,
  cosmetic: 5,
}

function getStatusBadgeClass(status: string) {
  const s = status?.toLowerCase() || ''
  if (s === 'in progress') return 'badge-progress'
  if (s === 'dev') return 'badge-review'
  if (s === 'done' || s === 'fixed') return 'badge-done'
  return 'badge-todo'
}

function getPriorityBadgeClass(priority: string) {
  const p = priority?.toLowerCase() || ''
  if (p === 'critical' || p === 'show-stopper') return 'priority-high'
  if (p === 'minor' || p === 'cosmetic') return 'priority-low'
  return 'priority-medium'
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export function ListViewPage({ showMyTasks }: ListViewPageProps) {
  const { user } = useAuth()
  const [issues, setIssues] = useState<YouTrackIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedIssue, setSelectedIssue] = useState<YouTrackIssue | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const lastClickedIndex = useRef<number>(-1)

  useEffect(() => {
    fetchIssues()
  }, [])

  const fetchIssues = async () => {
    try {
      setLoading(true)
      const response = await api.getYouTrackIssues()
      if (response.success && response.data) {
        setIssues(response.data as YouTrackIssue[])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  // Get unique assignees for filter dropdown
  const assignees = useMemo(() => {
    const names = new Set<string>()
    issues.forEach(i => {
      if (i.assignee?.fullName) names.add(i.assignee.fullName)
    })
    return Array.from(names).sort()
  }, [issues])

  // Filter & sort
  const filteredIssues = useMemo(() => {
    let result = issues

    // My Tasks filter
    if (showMyTasks && user) {
      result = result.filter(i => {
        const aName = i.assignee?.fullName?.toLowerCase() || ''
        const aEmail = i.assignee?.email?.toLowerCase() || ''
        const uName = user.name?.toLowerCase() || ''
        const uEmail = user.email?.toLowerCase() || ''
        return aName === uName || aEmail === uEmail ||
               aName.includes(uName) || uName.includes(aName)
      })
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(i => i.status?.toLowerCase() === statusFilter.toLowerCase())
    }

    // Assignee filter
    if (assigneeFilter !== 'all') {
      result = result.filter(i => i.assignee?.fullName === assigneeFilter)
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(i =>
        i.id.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q) ||
        i.assignee?.fullName?.toLowerCase().includes(q)
      )
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'id':
          cmp = a.id.localeCompare(b.id)
          break
        case 'summary':
          cmp = a.summary.localeCompare(b.summary)
          break
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '')
          break
        case 'priority': {
          const pa = PRIORITY_ORDER[a.priority?.toLowerCase()] ?? 3
          const pb = PRIORITY_ORDER[b.priority?.toLowerCase()] ?? 3
          cmp = pa - pb
          break
        }
        case 'assignee':
          cmp = (a.assignee?.fullName || 'zzz').localeCompare(b.assignee?.fullName || 'zzz')
          break
        case 'updated':
          cmp = (a.updated || 0) - (b.updated || 0)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [issues, showMyTasks, user, statusFilter, assigneeFilter, search, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const handleRowClick = useCallback((e: React.MouseEvent, issue: YouTrackIssue, index: number) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle individual selection
      e.preventDefault()
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(issue.id)) {
          next.delete(issue.id)
        } else {
          next.add(issue.id)
        }
        return next
      })
      lastClickedIndex.current = index
    } else if (e.shiftKey && lastClickedIndex.current >= 0) {
      // Shift+click: select range
      e.preventDefault()
      const start = Math.min(lastClickedIndex.current, index)
      const end = Math.max(lastClickedIndex.current, index)
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (let i = start; i <= end; i++) {
          next.add(filteredIssues[i].id)
        }
        return next
      })
    } else {
      // Normal click: open detail modal (only if no multi-select active)
      if (selectedIds.size > 0) {
        // If there's an active selection, normal click clears it and selects this one
        setSelectedIds(new Set([issue.id]))
        lastClickedIndex.current = index
      } else {
        setSelectedIssue(issue)
      }
    }
  }, [filteredIssues, selectedIds.size])

  const clearSelection = () => {
    setSelectedIds(new Set())
    lastClickedIndex.current = -1
  }

  const selectedIssues = useMemo(() =>
    filteredIssues.filter(i => selectedIds.has(i.id)),
    [filteredIssues, selectedIds]
  )

  const copySelectedToClipboard = async () => {
    const lines = selectedIssues.map(i =>
      `${i.id} ${i.summary} — https://simran.youtrack.cloud/issue/${i.id}`
    )
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="sort-arrow" />
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="sort-arrow" />
      : <ChevronDown size={12} className="sort-arrow" />
  }

  if (loading) {
    return (
      <div className="list-view-page">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading issues...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="list-view-page">
      <div className="list-view-header">
        <div className="list-view-filters">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search issues..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: '1.75rem' }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in progress">In Progress</option>
            <option value="dev">DEV</option>
            <option value="done">Done</option>
            <option value="fixed">Fixed</option>
          </select>
          <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
            <option value="all">All Assignees</option>
            {assignees.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <span className="list-view-count">{filteredIssues.length} issues</span>
      </div>

      {/* Selection Action Bar */}
      {selectedIds.size > 0 && (
        <div className="lv-selection-bar">
          <span className="lv-selection-count">{selectedIds.size} selected</span>
          <div className="lv-selection-actions">
            <button className="lv-selection-btn" onClick={copySelectedToClipboard}>
              {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button className="lv-selection-btn lv-selection-btn--clear" onClick={clearSelection}>
              <X size={14} /> Clear
            </button>
          </div>
        </div>
      )}

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="list-view-table-wrapper">
          <table className="list-view-table">
            <thead>
              <tr>
                <th className={sortField === 'id' ? 'sorted' : ''} onClick={() => handleSort('id')}>
                  ID <SortIcon field="id" />
                </th>
                <th className={sortField === 'summary' ? 'sorted' : ''} onClick={() => handleSort('summary')}>
                  Summary <SortIcon field="summary" />
                </th>
                <th className={sortField === 'status' ? 'sorted' : ''} onClick={() => handleSort('status')}>
                  Status <SortIcon field="status" />
                </th>
                <th className={sortField === 'priority' ? 'sorted' : ''} onClick={() => handleSort('priority')}>
                  Priority <SortIcon field="priority" />
                </th>
                <th className={sortField === 'assignee' ? 'sorted' : ''} onClick={() => handleSort('assignee')}>
                  Assignee <SortIcon field="assignee" />
                </th>
                <th className={sortField === 'updated' ? 'sorted' : ''} onClick={() => handleSort('updated')}>
                  Updated <SortIcon field="updated" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="list-view-empty">No issues found</div>
                  </td>
                </tr>
              ) : (
                filteredIssues.map((issue, index) => (
                  <tr
                    key={issue.id}
                    className={selectedIds.has(issue.id) ? 'lv-row-selected' : ''}
                    onClick={e => handleRowClick(e, issue, index)}
                  >
                    <td><span className="issue-id">{issue.id}</span></td>
                    <td><span className="issue-summary">{issue.summary}</span></td>
                    <td>
                      <span className={`badge ${getStatusBadgeClass(issue.status)}`}>
                        {issue.status || 'Open'}
                      </span>
                    </td>
                    <td>
                      <span className={`task-priority-badge ${getPriorityBadgeClass(issue.priority)}`}>
                        {issue.priority || 'Normal'}
                      </span>
                    </td>
                    <td>
                      {issue.assignee ? (
                        <div className="assignee-cell">
                          <div className="avatar">{getInitials(issue.assignee.fullName)}</div>
                          <span>{issue.assignee.fullName}</span>
                        </div>
                      ) : (
                        <span className="lv-unassigned">Unassigned</span>
                      )}
                    </td>
                    <td className="lv-updated-cell">
                      {issue.updated ? new Date(issue.updated).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Issues Panel */}
      {selectedIds.size > 0 && (
        <div className="lv-selected-panel glass-card">
          <div className="lv-selected-panel-header">
            <span>Selected Tickets</span>
            <button className="lv-selection-btn lv-selection-btn--clear" onClick={clearSelection}>
              <X size={14} />
            </button>
          </div>
          <ul className="lv-selected-list">
            {selectedIssues.map(issue => (
              <li key={issue.id} className="lv-selected-item">
                <a
                  href={`https://simran.youtrack.cloud/issue/${issue.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lv-selected-link"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="lv-selected-id">{issue.id}</span>
                  <span className="lv-selected-summary">{issue.summary}</span>
                  <ExternalLink size={12} className="lv-selected-external" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <div className="modal-overlay" onClick={() => setSelectedIssue(null)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '520px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <span style={{ color: '#8250df', fontSize: '0.8rem', fontWeight: 600 }}>{selectedIssue.id}</span>
                <h3 style={{ margin: '0.25rem 0 0', fontSize: '1.1rem' }}>{selectedIssue.summary}</h3>
              </div>
              <button
                onClick={() => setSelectedIssue(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</label>
                <div><span className={`badge ${getStatusBadgeClass(selectedIssue.status)}`}>{selectedIssue.status || 'Open'}</span></div>
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</label>
                <div><span className={`task-priority-badge ${getPriorityBadgeClass(selectedIssue.priority)}`}>{selectedIssue.priority || 'Normal'}</span></div>
              </div>
              {selectedIssue.assignee && (
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assignee</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.6rem' }}>{getInitials(selectedIssue.assignee.fullName)}</div>
                    <span style={{ fontSize: '0.85rem' }}>{selectedIssue.assignee.fullName}</span>
                  </div>
                </div>
              )}
              {selectedIssue.updated && (
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Updated</label>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{new Date(selectedIssue.updated).toLocaleString()}</div>
                </div>
              )}
            </div>

            {selectedIssue.description && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</label>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.5, marginTop: '0.25rem', color: 'var(--text-secondary)' }}>{selectedIssue.description}</p>
              </div>
            )}

            <a
              href={`https://simran.youtrack.cloud/issue/${selectedIssue.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ color: '#8250df', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <ExternalLink size={14} />
              View in YouTrack
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
