import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Copy, CheckCheck, X, ChevronDown, ChevronUp,
  ArrowUpDown, RefreshCw, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { YouTrackIssue } from '@/services/api'
import { getPMIssues, getPMStates, getActiveSource } from '@/services/pmDataService'

type SortField = 'summary' | 'priority' | 'assignee' | 'updated' | 'created' | 'due_date'
type SortDir   = 'asc' | 'desc'

const YT_BASE = 'https://simran.youtrack.cloud/issue/'

const PRIORITY_ORDER: Record<string, number> = {
  'show-stopper': 0, critical: 1, major: 2, normal: 3, minor: 4, cosmetic: 5,
}

function getIssueUrl(issue: YouTrackIssue): string {
  if (getActiveSource() === 'asana' && issue.permalink) return issue.permalink
  return `${YT_BASE}${issue.id}`
}

function getPriorityClass(p: string) {
  const s = (p || '').toLowerCase()
  if (s === 'critical' || s === 'show-stopper') return 'lv-pri lv-pri-critical'
  if (s === 'major') return 'lv-pri lv-pri-major'
  if (s === 'minor' || s === 'cosmetic') return 'lv-pri lv-pri-minor'
  return 'lv-pri lv-pri-normal'
}

function fmtDate(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const today = new Date()
  const diff = Math.round((d.getTime() - today.setHours(0,0,0,0)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

function isOverdue(ms?: number): boolean {
  if (!ms) return false
  return ms < Date.now()
}

function isToday(ms?: number): boolean {
  if (!ms) return false
  const d = new Date(ms)
  const n = new Date()
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()
}

function getInitials(name: string) {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ── Portal filter dropdown ────────────────────────────────────────────────────
interface FDropdownProps {
  id: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  placeholder?: string
  openId: string | null
  onOpenChange: (id: string | null) => void
}
function FilterDropdown({ id, value, options, onChange, placeholder = 'All', openId, onOpenChange }: FDropdownProps) {
  const open = openId === id
  const [rect, setRect] = useState<DOMRect | null>(null)
  const label = options.find(o => o.value === value)?.label ?? placeholder

  useEffect(() => {
    if (!open) { setRect(null); return }
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.lv-fdropdown')) onOpenChange(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div className="pm-custom-dropdown lv-fdropdown">
      <button type="button" className="pm-custom-dropdown-trigger lv-fdropdown-trigger"
        onClick={e => {
          const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
          setRect(r)
          onOpenChange(open ? null : id)
        }}>
        <span>{label}</span>
        <ChevronDown size={11} className={`dropdown-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && rect && createPortal(
        <div className="pm-custom-dropdown-menu" style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 160), zIndex: 9999 }}>
          {options.map(opt => (
            <button key={opt.value} type="button" className={`pm-dropdown-item ${value === opt.value ? 'active' : ''}`}
              onClick={() => { onChange(opt.value); onOpenChange(null) }}>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Collapsible section group ─────────────────────────────────────────────────
interface SectionGroupProps {
  name: string
  issues: YouTrackIssue[]
  sortField: SortField
  sortDir: SortDir
  selectedIds: Set<string>
  onRowClick: (e: React.MouseEvent, issue: YouTrackIssue, globalIndex: number) => void
  onRowDblClick: (issue: YouTrackIssue) => void
  globalIndexOffset: number
}

function SectionGroup({
  name, issues, sortField, sortDir,
  selectedIds, onRowClick, onRowDblClick, globalIndexOffset,
}: SectionGroupProps) {
  const [expanded, setExpanded] = useState(true)

  const sorted = useMemo(() => [...issues].sort((a, b) => {
    let cmp = 0
    switch (sortField) {
      case 'summary':  cmp = a.summary.localeCompare(b.summary); break
      case 'priority': cmp = (PRIORITY_ORDER[a.priority?.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.priority?.toLowerCase()] ?? 3); break
      case 'assignee': cmp = (a.assignee?.fullName || 'zzz').localeCompare(b.assignee?.fullName || 'zzz'); break
      case 'updated':  cmp = (a.updated || 0) - (b.updated || 0); break
      case 'created':  cmp = (a.created || 0) - (b.created || 0); break
      case 'due_date': cmp = (a.due_date || 0) - (b.due_date || 0); break
    }
    return sortDir === 'asc' ? cmp : -cmp
  }), [issues, sortField, sortDir])

  return (
    <div className="lv-section-group">
      {/* Section header */}
      <div className="lv-section-header" onClick={() => setExpanded(e => !e)}>
        <span className={`lv-section-chevron ${expanded ? 'lv-section-chevron--open' : ''}`}>
          <ChevronRight size={13} />
        </span>
        <span className="lv-section-name">{name}</span>
        <span className="lv-section-count">{issues.length}</span>
      </div>

      {/* Animated body */}
      <div className={`lv-section-body ${expanded ? 'lv-section-body--open' : ''}`}>
        <div className="lv-section-body-inner">
          {sorted.map((issue, i) => {
            const due = issue.due_date
            return (
              <div
                key={issue.id}
                className={`lv-row${selectedIds.has(issue.id) ? ' lv-row--selected' : ''}`}
                onClick={e => onRowClick(e, issue, globalIndexOffset + i)}
                onDoubleClick={() => onRowDblClick(issue)}
              >
                <div className="lv-cell lv-cell-name">
                  <span className="lv-title-text">{issue.summary}</span>
                </div>
                <div className="lv-cell lv-cell-assignee">
                  {issue.assignee ? (
                    <div className="lv-assignee">
                      <div className="lv-avatar">{getInitials(issue.assignee.fullName)}</div>
                      <span className="lv-assignee-name">{issue.assignee.fullName}</span>
                    </div>
                  ) : (
                    <span className="lv-unassigned">—</span>
                  )}
                </div>
                <div className={`lv-cell lv-cell-date${isOverdue(due) && !isToday(due) ? ' lv-date-overdue' : isToday(due) ? ' lv-date-today' : ''}`}>
                  {fmtDate(due)}
                </div>
                <div className="lv-cell lv-cell-date">{fmtDate(issue.created)}</div>
                <div className="lv-cell lv-cell-date">{fmtDate(issue.updated)}</div>
                <div className="lv-cell lv-cell-priority">
                  {issue.priority ? (
                    <span className={getPriorityClass(issue.priority)}>{issue.priority}</span>
                  ) : (
                    <span className="lv-unassigned">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
interface ListViewPageProps { showMyTasks: boolean }

export function ListViewPage({ showMyTasks }: ListViewPageProps) {
  const { user } = useAuth()
  const [issues, setIssues]           = useState<YouTrackIssue[]>([])
  const [sectionOrder, setSectionOrder] = useState<string[]>([])
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [search, setSearch]           = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [sortField, setSortField]     = useState<SortField>('updated')
  const [sortDir, setSortDir]         = useState<SortDir>('desc')
  const [selectedIssue, setSelectedIssue] = useState<YouTrackIssue | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copied, setCopied]           = useState(false)
  const lastClickedIndex = useRef<number>(-1)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async (force = false) => {
    try {
      force ? setRefreshing(true) : setLoading(true)
      const [issuesRes, statesRes] = await Promise.all([
        getPMIssues(force),
        getPMStates().catch(() => ({ data: [] })),
      ])
      if ((issuesRes as any).success && (issuesRes as any).data)
        setIssues((issuesRes as any).data as YouTrackIssue[])
      const states = ((statesRes as any).data ?? statesRes ?? []) as { name: string }[]
      if (states.length) setSectionOrder(states.map(s => s.name))
    } catch { /* ignore */ }
    finally { setLoading(false); setRefreshing(false) }
  }

  // Derived filter option lists
  const priorityOptions = useMemo(() => {
    const p = new Set<string>()
    issues.forEach(i => { if (i.priority) p.add(i.priority) })
    return [{ value: 'all', label: 'All Priorities' },
      ...Array.from(p).sort((a, b) => (PRIORITY_ORDER[a.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.toLowerCase()] ?? 3))
        .map(v => ({ value: v, label: v }))]
  }, [issues])

  const assigneeOptions = useMemo(() => {
    const a = new Set<string>()
    issues.forEach(i => { if (i.assignee?.fullName) a.add(i.assignee.fullName) })
    return [{ value: 'all', label: 'All Assignees' },
      ...Array.from(a).sort().map(v => ({ value: v, label: v }))]
  }, [issues])

  // Filter
  const filteredIssues = useMemo(() => {
    let r = issues
    if (showMyTasks && user) {
      r = r.filter(i => {
        const an = (i.assignee?.fullName || '').toLowerCase()
        const ue = (user.email || '').toLowerCase()
        const un = (user.name || '').toLowerCase()
        return an === un || (i.assignee?.email || '').toLowerCase() === ue || an.includes(un)
      })
    }
    if (priorityFilter !== 'all') r = r.filter(i => i.priority === priorityFilter)
    if (assigneeFilter !== 'all') r = r.filter(i => i.assignee?.fullName === assigneeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(i =>
        i.summary.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        (i.assignee?.fullName || '').toLowerCase().includes(q)
      )
    }
    return r
  }, [issues, showMyTasks, user, priorityFilter, assigneeFilter, search])

  // Group by section, in the canonical section order from the API
  const groups = useMemo(() => {
    const map = new Map<string, YouTrackIssue[]>()
    filteredIssues.forEach(i => {
      const s = i.status || 'Backlog'
      if (!map.has(s)) map.set(s, [])
      map.get(s)!.push(i)
    })

    // Order: API section order first, then any remaining sections alphabetically
    const ordered: Array<{ name: string; issues: YouTrackIssue[] }> = []
    const seen = new Set<string>()
    const order = sectionOrder.length ? sectionOrder : Array.from(map.keys()).sort()
    for (const name of order) {
      if (map.has(name)) { ordered.push({ name, issues: map.get(name)! }); seen.add(name) }
    }
    for (const [name, iss] of map) {
      if (!seen.has(name)) ordered.push({ name, issues: iss })
    }
    return ordered
  }, [filteredIssues, sectionOrder])

  // Global flat list for shift-click range indexing
  const flatList = useMemo(() => groups.flatMap(g => g.issues), [groups])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const handleRowClick = useCallback((e: React.MouseEvent, issue: YouTrackIssue, globalIndex: number) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedIds(prev => { const n = new Set(prev); n.has(issue.id) ? n.delete(issue.id) : n.add(issue.id); return n })
      lastClickedIndex.current = globalIndex
    } else if (e.shiftKey && lastClickedIndex.current >= 0) {
      e.preventDefault()
      const start = Math.min(lastClickedIndex.current, globalIndex)
      const end   = Math.max(lastClickedIndex.current, globalIndex)
      setSelectedIds(prev => { const n = new Set(prev); for (let i = start; i <= end; i++) n.add(flatList[i].id); return n })
    } else {
      setSelectedIds(prev => (prev.size === 1 && prev.has(issue.id)) ? new Set() : new Set([issue.id]))
      lastClickedIndex.current = globalIndex
    }
  }, [flatList])

  const clearSelection = () => { setSelectedIds(new Set()); lastClickedIndex.current = -1 }

  const selectedIssues = useMemo(() => flatList.filter(i => selectedIds.has(i.id)), [flatList, selectedIds])

  const copySelected = async () => {
    const plain = selectedIssues.map(i => `${i.summary} — ${getIssueUrl(i)}`).join('\n')
    const html  = selectedIssues.map(i =>
      `<a href="${getIssueUrl(i)}">${i.summary.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</a>`
    ).join('<br>')
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([html],  { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })])
    } catch { await navigator.clipboard.writeText(plain) }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedIds.size > 0) { e.preventDefault(); copySelected() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [selectedIds, selectedIssues])

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField !== field
      ? <ArrowUpDown size={11} className="lv-sort-icon" />
      : sortDir === 'asc'
        ? <ChevronUp size={11} className="lv-sort-icon lv-sort-icon--active" />
        : <ChevronDown size={11} className="lv-sort-icon lv-sort-icon--active" />

  // Running global index for shift-select across groups
  let globalIdx = 0

  if (loading) return (
    <div className="list-view-page">
      <div className="loading-state"><div className="loading-spinner" /><p>Loading issues…</p></div>
    </div>
  )

  return (
    <div className="list-view-page">

      {/* ── Toolbar ── */}
      <div className="lv-toolbar">
        <div className="lv-toolbar-left">
          <div className="lv-search-box">
            <Search size={13} className="lv-search-icon" />
            <input type="text" placeholder="Search…" value={search}
              onChange={e => setSearch(e.target.value)} className="lv-search-input" />
            {search && <button className="lv-search-clear" onClick={() => setSearch('')}><X size={11} /></button>}
          </div>
          <FilterDropdown id="priority" value={priorityFilter} options={priorityOptions} onChange={setPriorityFilter} openId={openDropdown} onOpenChange={setOpenDropdown} />
          <FilterDropdown id="assignee" value={assigneeFilter} options={assigneeOptions} onChange={setAssigneeFilter} openId={openDropdown} onOpenChange={setOpenDropdown} />
        </div>
        <div className="lv-toolbar-right">
          <span className="lv-count">{filteredIssues.length} tasks</span>
          <button className="lv-refresh-btn" onClick={() => fetchAll(true)} disabled={refreshing} title="Refresh">
            <RefreshCw size={13} className={refreshing ? 'lv-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Selection bar ── */}
      {selectedIds.size > 0 && (
        <div className="lv-selection-bar">
          <span className="lv-selection-count">{selectedIds.size} selected</span>
          <div className="lv-selection-actions">
            <button className="lv-selection-btn" onClick={copySelected}>
              {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy links'}
            </button>
            <button className="lv-selection-btn lv-selection-btn--clear" onClick={clearSelection}>
              <X size={13} /> Clear
            </button>
          </div>
          <span className="lv-selection-hint">Ctrl+C to copy · Shift+click to range-select</span>
        </div>
      )}

      {/* ── List ── */}
      <div className="lv-table-card">
        {/* Sticky column headers */}
        <div className="lv-col-header">
          <div className="lv-ch lv-ch-name" onClick={() => handleSort('summary')}>
            Name <SortIcon field="summary" />
          </div>
          <div className="lv-ch lv-ch-assignee" onClick={() => handleSort('assignee')}>
            Assignee <SortIcon field="assignee" />
          </div>
          <div className="lv-ch lv-ch-date" onClick={() => handleSort('due_date')}>
            Due date <SortIcon field="due_date" />
          </div>
          <div className="lv-ch lv-ch-date" onClick={() => handleSort('created')}>
            Created on <SortIcon field="created" />
          </div>
          <div className="lv-ch lv-ch-date" onClick={() => handleSort('updated')}>
            Last modified <SortIcon field="updated" />
          </div>
          <div className="lv-ch lv-ch-priority" onClick={() => handleSort('priority')}>
            Priority <SortIcon field="priority" />
          </div>
        </div>

        <div className="lv-groups-scroll">
          {groups.length === 0 ? (
            <div className="lv-empty">No issues match your filters</div>
          ) : (
            groups.map(group => {
              const offset = globalIdx
              globalIdx += group.issues.length
              return (
                <SectionGroup
                  key={group.name}
                  name={group.name}
                  issues={group.issues}
                  sortField={sortField}
                  sortDir={sortDir}
                  selectedIds={selectedIds}
                  onRowClick={handleRowClick}
                  onRowDblClick={i => { setSelectedIds(new Set()); setSelectedIssue(i) }}
                  globalIndexOffset={offset}
                />
              )
            })
          )}
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {selectedIssue && (
        <div className="modal-overlay" onClick={() => setSelectedIssue(null)}>
          <div className="lv-detail-modal glass-card" onClick={e => e.stopPropagation()}>
            <div className="lv-detail-header">
              <div className="lv-detail-title-block">
                <span className="lv-detail-id">{selectedIssue.id}</span>
                <h3 className="lv-detail-title">{selectedIssue.summary}</h3>
              </div>
              <button className="lv-detail-close" onClick={() => setSelectedIssue(null)}>&times;</button>
            </div>
            <div className="lv-detail-meta">
              <div className="lv-detail-field">
                <span className="lv-detail-label">Section</span>
                <span className="lv-detail-value">{selectedIssue.status || '—'}</span>
              </div>
              <div className="lv-detail-field">
                <span className="lv-detail-label">Priority</span>
                {selectedIssue.priority
                  ? <span className={getPriorityClass(selectedIssue.priority)}>{selectedIssue.priority}</span>
                  : <span className="lv-detail-value">—</span>}
              </div>
              {selectedIssue.assignee && (
                <div className="lv-detail-field">
                  <span className="lv-detail-label">Assignee</span>
                  <div className="lv-assignee">
                    <div className="lv-avatar lv-avatar-sm">{getInitials(selectedIssue.assignee.fullName)}</div>
                    <span>{selectedIssue.assignee.fullName}</span>
                  </div>
                </div>
              )}
              {selectedIssue.due_date ? (
                <div className="lv-detail-field">
                  <span className="lv-detail-label">Due date</span>
                  <span className={isOverdue(selectedIssue.due_date) ? 'lv-date-overdue' : ''}>{fmtDate(selectedIssue.due_date)}</span>
                </div>
              ) : null}
              {selectedIssue.updated ? (
                <div className="lv-detail-field">
                  <span className="lv-detail-label">Last modified</span>
                  <span className="lv-detail-value">{new Date(selectedIssue.updated).toLocaleString()}</span>
                </div>
              ) : null}
              {selectedIssue.created ? (
                <div className="lv-detail-field">
                  <span className="lv-detail-label">Created on</span>
                  <span className="lv-detail-value">{new Date(selectedIssue.created).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
            {selectedIssue.description && (
              <div className="lv-detail-desc">
                <span className="lv-detail-label">Description</span>
                <p className="lv-detail-desc-text">{selectedIssue.description}</p>
              </div>
            )}
            <a href={getIssueUrl(selectedIssue)} target="_blank" rel="noopener noreferrer" className="lv-detail-link">
              {getActiveSource() === 'asana' ? 'View in Asana ↗' : 'View in YouTrack ↗'}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
