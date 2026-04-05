import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw, ChevronDown, ChevronRight, Copy, Send, Zap,
  AlertTriangle, CheckCircle, Clock, Users, Hash, Search,
  ChevronsDownUp, ChevronsUpDown, Check, X, Bell, BookmarkCheck,
} from 'lucide-react'
import { api } from '../services/api'
import type { DailyBrief, EODSummary, DeveloperLoad, DailyOpsIssue, CarryoverItem, CarryoverData } from '../services/api'
import { getDailyBrief, getEODSummary, getDeveloperLoad, getBlockerReasons, saveCarryoverPlan, getCarryover } from '../services/pmDataService'

interface Props {
  onBlockersChange: (ids: Set<string>) => void
  sprintId?: string
}

interface Channel { id: string; name: string }

// ── helpers ───────────────────────────────────────────────────────────────────

function priorityClass(priority: string) {
  const p = priority.toUpperCase()
  if (p === 'P0' || p === 'CRITICAL') return 'do-priority-p0'
  if (p === 'P1') return 'do-priority-p1'
  if (p === 'P2') return 'do-priority-p2'
  return 'do-priority-p3'
}

function priorityLabel(p: string) {
  const up = p.toUpperCase()
  if (up === 'P0' || up === 'CRITICAL') return 'P0'
  if (up === 'P1') return 'P1'
  if (up === 'P2') return 'P2'
  return 'P3'
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

function tomorrowDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function matchesFilters(
  issue: DailyOpsIssue,
  search: string,
  priority: string,
  assignee: string,
) {
  if (search) {
    const q = search.toLowerCase()
    if (!issue.id.toLowerCase().includes(q) && !issue.summary.toLowerCase().includes(q)) return false
  }
  if (priority !== 'all' && priorityLabel(issue.priority) !== priority.toUpperCase()) return false
  if (assignee !== 'all' && issue.assignee !== assignee) return false
  return true
}

// ── IssueRow ──────────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: DailyOpsIssue
  noMovement?: boolean
  expandedRowId: string | null
  onExpand: (id: string | null) => void
}

function IssueRow({ issue, noMovement, expandedRowId, onExpand }: IssueRowProps) {
  const isExpanded = expandedRowId === issue.id
  const [remindDate, setRemindDate] = useState(tomorrowDate())
  const [remindStatus, setRemindStatus] = useState('')

  async function handleRemind() {
    try {
      await api.createIssueReminder(issue.id, issue.summary, remindDate)
      setRemindStatus('Reminder set ✓')
      setTimeout(() => { setRemindStatus(''); onExpand(null) }, 2000)
    } catch {
      setRemindStatus('Failed')
      setTimeout(() => setRemindStatus(''), 2000)
    }
  }

  return (
    <>
      <div className={`do-issue-row ${priorityClass(issue.priority)} ${noMovement ? 'do-issue-row--no-movement' : ''}`}>
        <span className={`do-prio-dot do-prio-dot--${priorityLabel(issue.priority).toLowerCase()}`} title={issue.priority} />
        <span className="do-issue-id" title={issue.id}>{issue.id}</span>
        <span className="do-issue-summary" title={issue.summary}>{issue.summary}</span>
        {issue.assignee
          ? <span className="do-assignee-chip">{issue.assignee}</span>
          : <span className="do-unassigned-flag">Unassigned</span>
        }
        {noMovement && <span className="do-no-move-chip">No move</span>}
        <div className="do-issue-actions">
          <button
            className="do-action-mini-btn"
            title="Set reminder"
            onClick={e => { e.stopPropagation(); onExpand(isExpanded ? null : issue.id) }}
          >
            <Bell size={9} />Remind
          </button>
        </div>
      </div>

      {/* Inline blocker reason */}
      {issue.blocker_reason && (
        <div className="do-blocker-reason">⚠ {issue.blocker_reason}</div>
      )}

      {/* Inline remind-me form */}
      {isExpanded && (
        <div className="do-inline-form" onClick={e => e.stopPropagation()}>
          <span className="do-inline-label">Remind me on</span>
          <input
            type="date"
            className="do-inline-date-input"
            value={remindDate}
            min={tomorrowDate()}
            onChange={e => setRemindDate(e.target.value)}
          />
          {remindStatus
            ? <span className="do-inline-status">{remindStatus}</span>
            : (
              <>
                <button className="do-inline-confirm-btn" onClick={handleRemind}>Set reminder</button>
                <button className="do-inline-cancel-btn" onClick={() => onExpand(null)}><X size={10} /></button>
              </>
            )
          }
        </div>
      )}
    </>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────────

interface SectionProps {
  id: string
  title: string
  icon: string
  issues: DailyOpsIssue[]
  defaultOpen?: boolean
  noMovement?: boolean
  forceOpen?: boolean
  search: string
  filterPriority: string
  filterAssignee: string
  expandedRowId: string | null
  onExpandRow: (id: string | null) => void
}

function Section({
  id, title, icon, issues, defaultOpen = false, noMovement = false,
  forceOpen, search, filterPriority, filterAssignee, expandedRowId, onExpandRow,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen)
  }, [forceOpen])

  const filtered = issues.filter(i => matchesFilters(i, search, filterPriority, filterAssignee))

  async function copySection() {
    const text = filtered.map(i => `${i.id}  ${i.summary}${i.assignee ? '  @' + i.assignee : ''}${i.blocker_reason ? '  [' + i.blocker_reason + ']' : ''}`).join('\n')
    await navigator.clipboard.writeText(text)
  }

  return (
    <div className="do-section" id={`do-sec-${id}`}>
      <div className="do-section-header" onClick={() => setOpen(o => !o)}>
        <span>{icon}</span>
        <span className="do-section-title">{title}</span>
        <span className="do-section-count">{filtered.length}{filtered.length !== issues.length ? `/${issues.length}` : ''}</span>
        {open && filtered.length > 0 && (
          <button
            className="do-section-copy-btn"
            title="Copy section"
            onClick={e => { e.stopPropagation(); copySection() }}
          >
            <Copy size={11} />
          </button>
        )}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </div>
      {open && (
        <div className="do-section-body">
          {filtered.length === 0
            ? <div className="do-section-empty">{issues.length > 0 ? 'No matches' : 'None'}</div>
            : filtered.map(iss => (
              <IssueRow
                key={iss.id}
                issue={iss}
                noMovement={noMovement}
                expandedRowId={expandedRowId}
                onExpand={onExpandRow}
              />
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  search: string
  onSearch: (v: string) => void
  priority: string
  onPriority: (v: string) => void
  assignees: string[]
  assignee: string
  onAssignee: (v: string) => void
  allOpen: boolean | null
  onToggleAll: (open: boolean) => void
}

function FilterBar({
  search, onSearch, priority, onPriority,
  assignees, assignee, onAssignee,
  allOpen, onToggleAll,
}: FilterBarProps) {
  return (
    <div className="do-filter-bar">
      <div className="do-filter-search-wrap">
        <Search size={12} className="do-filter-search-icon" />
        <input
          className="do-filter-search"
          placeholder="Search ID or summary…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
        {search && (
          <button className="do-filter-clear" onClick={() => onSearch('')}><X size={11} /></button>
        )}
      </div>

      <div className="do-filter-pills">
        {['all', 'P0', 'P1', 'P2', 'P3'].map(p => (
          <button
            key={p}
            className={`do-filter-pill ${priority === p ? 'active' : ''} ${p !== 'all' ? `do-filter-pill--${p.toLowerCase()}` : ''}`}
            onClick={() => onPriority(p)}
          >
            {p === 'all' ? 'All' : p}
          </button>
        ))}
      </div>

      {assignees.length > 0 && (
        <select
          className="do-filter-select"
          value={assignee}
          onChange={e => onAssignee(e.target.value)}
        >
          <option value="all">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      <div className="do-filter-sep" />

      <button
        className="do-post-btn do-post-btn--ghost"
        onClick={() => onToggleAll(allOpen !== true)}
        title={allOpen === true ? 'Collapse all' : 'Expand all'}
      >
        {allOpen === true ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
        {allOpen === true ? 'Collapse' : 'Expand'}
      </button>
    </div>
  )
}

// ── Channel picker with outside-click close ────────────────────────────────────

function ChannelPicker({
  label, channels, onPost, disabled, statusMsg, onClearStatus,
}: {
  label: string
  channels: Channel[]
  onPost: (id: string, name: string) => void
  disabled?: boolean
  statusMsg?: string
  onClearStatus?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="do-channel-picker" ref={ref}>
      <button
        className="do-post-btn do-post-btn--primary"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <Send size={12} />
        {label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="do-channel-menu">
          {channels.length === 0 && (
            <div className="do-channel-menu-item do-channel-menu-empty">No Slack channels found</div>
          )}
          {channels.map(ch => (
            <div
              key={ch.id}
              className="do-channel-menu-item"
              onClick={() => { onPost(ch.id, ch.name); setOpen(false) }}
            >
              <Hash size={11} />#{ch.name}
            </div>
          ))}
        </div>
      )}
      {statusMsg && (
        <span
          className={`do-post-status ${statusMsg.startsWith('✓') ? 'do-post-status--ok' : 'do-post-status--err'}`}
          onClick={onClearStatus}
          title="Click to dismiss"
        >
          {statusMsg.startsWith('✓') ? <Check size={10} /> : <X size={10} />}
          {statusMsg.replace(/^[✓✗] /, '')}
        </span>
      )}
    </div>
  )
}

// ── Copy button with brief feedback ───────────────────────────────────────────

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className={`do-post-btn ${copied ? 'do-post-btn--ok' : 'do-post-btn--secondary'}`} onClick={handle}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ── Morning report formatter ───────────────────────────────────────────────────

function formatMorningReport(brief: DailyBrief): string {
  const lines: string[] = []

  lines.push('Tickets Done Yesterday:')
  if (brief.done_yesterday.length === 0) {
    lines.push('  (none)')
  } else {
    for (const iss of brief.done_yesterday) lines.push(`  - ${iss.id} ${iss.summary}`)
  }

  lines.push('')
  lines.push('Currently open issues:')
  for (const [label, arr] of [
    ['P0', brief.p0], ['P1', brief.p1], ['P2', brief.p2], ['P3', brief.p3],
  ] as [string, DailyOpsIssue[]][]) {
    if (arr.length > 0) {
      lines.push(`${label}:`)
      for (const iss of arr) {
        const tag = iss.assignee ? ` --> @${iss.assignee}` : ' --> please assign'
        lines.push(`  - ${label} ${iss.summary}${tag}`)
      }
    }
  }

  if (brief.open_items.length > 0) {
    lines.push('')
    lines.push('Open Issues from our side:')
    for (const iss of brief.open_items) lines.push(`  - ${iss.id} ${iss.summary}`)
  }

  if (brief.blocked_theirs.length > 0) {
    lines.push('')
    lines.push("Blocked from Trackflow team's side:")
    for (const iss of brief.blocked_theirs) {
      const reason = iss.blocker_reason ? ` — ${iss.blocker_reason}` : ''
      lines.push(`  - ${iss.id} ${iss.summary}${reason}`)
    }
  }

  if (brief.blocked_ours.length > 0) {
    lines.push('')
    lines.push('Blocked from our side:')
    for (const iss of brief.blocked_ours) {
      const who = iss.assignee || 'unassigned'
      const reason = iss.blocker_reason ? ` — ${iss.blocker_reason}` : ''
      lines.push(`  - ${iss.id} ${iss.summary} (${who})${reason}`)
    }
  }

  return lines.join('\n')
}

// ── Unique assignees from all sections ────────────────────────────────────────

function collectAssignees(issues: DailyOpsIssue[][]): string[] {
  const set = new Set<string>()
  for (const arr of issues) for (const i of arr) if (i.assignee) set.add(i.assignee)
  return Array.from(set).sort()
}

// ── Carryover checklist ───────────────────────────────────────────────────────

function CarryoverChecklist({
  items,
  onToggle,
}: {
  items: CarryoverItem[]
  onToggle: (idx: number) => void
}) {
  const doneCount = items.filter(i => i.done).length
  return (
    <div className="do-carryover-list">
      {items.map((item, idx) => (
        <label
          key={idx}
          className={`do-carryover-item ${item.done ? 'do-carryover-item--done' : ''}`}
          onClick={() => onToggle(idx)}
        >
          <input
            type="checkbox"
            checked={item.done}
            onChange={() => onToggle(idx)}
            onClick={e => e.stopPropagation()}
          />
          <span>{item.text}</span>
          {idx === 0 && (
            <span className="do-carryover-done-count">{doneCount}/{items.length} done</span>
          )}
        </label>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DailyOpsTab({ onBlockersChange, sprintId }: Props) {
  // ── data state
  const [brief, setBrief] = useState<DailyBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState('')
  const [briefRefreshedAt, setBriefRefreshedAt] = useState<string | null>(null)

  const [eod, setEod] = useState<EODSummary | null>(null)
  const [eodLoading, setEodLoading] = useState(false)
  const [eodError, setEodError] = useState('')

  const [devLoad, setDevLoad] = useState<DeveloperLoad[]>([])
  const [devLoading, setDevLoading] = useState(false)

  const [carryover, setCarryover] = useState<CarryoverData | null>(null)
  // today's carryover items (for checking off)
  const [todayItems, setTodayItems] = useState<CarryoverItem[]>([])

  // ── text content
  const [reportText, setReportText] = useState('')
  const [planText, setPlanText] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [saveItemsStatus, setSaveItemsStatus] = useState('')

  // ── slack
  const [channels, setChannels] = useState<Channel[]>([])
  const [postStatus, setPostStatus] = useState('')
  const [eodPostStatus, setEodPostStatus] = useState('')

  // ── filters (shared across morning brief sections)
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [allOpen, setAllOpen] = useState<boolean | null>(null)

  // ── EOD filter
  const [eodFilter, setEodFilter] = useState<'all' | 'no_movement' | 'blockers'>('all')

  // ── expanded row for inline forms (shared — only one open at a time)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  // Collect unique assignees from brief
  const briefAssignees = brief ? collectAssignees([
    brief.done_yesterday, brief.p0, brief.p1, brief.p2, brief.p3,
    brief.blocked_ours, brief.blocked_theirs, brief.open_items,
  ]) : []

  // Load Slack channels on mount
  useEffect(() => {
    api.getSlackChannels().then(res => {
      if (res.data) setChannels(res.data)
    }).catch(() => {})
  }, [])

  // ── load functions
  const loadBrief = useCallback(async () => {
    setBriefLoading(true)
    setBriefError('')
    try {
      const res = await getDailyBrief(sprintId)
      if (res.data) {
        const rawBrief = res.data
        setBriefRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

        // Collect blocked issue IDs
        const allBlocked = [...rawBrief.blocked_ours, ...rawBrief.blocked_theirs]
        const blockerIds = allBlocked.map(i => i.id)
        onBlockersChange(new Set(blockerIds))

        // Enrich with AI-analysed blocker reasons
        let enrichedBrief = rawBrief
        if (blockerIds.length > 0) {
          try {
            const reasonsRes = await getBlockerReasons(blockerIds)
            if (reasonsRes.data) {
              const reasons = reasonsRes.data
              const enrich = (issues: typeof rawBrief.blocked_ours) =>
                issues.map(i => ({ ...i, blocker_reason: reasons[i.id] || i.blocker_reason }))
              enrichedBrief = {
                ...rawBrief,
                blocked_ours: enrich(rawBrief.blocked_ours),
                blocked_theirs: enrich(rawBrief.blocked_theirs),
              }
            }
          } catch {
            // non-fatal — show brief without reasons
          }
        }

        setBrief(enrichedBrief)
        setReportText(formatMorningReport(enrichedBrief))
      }
    } catch (e: any) {
      setBriefError(e.message || 'Failed to load daily brief')
    } finally {
      setBriefLoading(false)
    }
  }, [onBlockersChange, sprintId])

  const loadEOD = useCallback(async () => {
    setEodLoading(true)
    setEodError('')
    try {
      const res = await getEODSummary()
      if (res.data) setEod(res.data)
    } catch (e: any) {
      setEodError(e.message || 'Failed to load EOD summary')
    } finally {
      setEodLoading(false)
    }
  }, [])

  const loadDevLoad = useCallback(async () => {
    setDevLoading(true)
    try {
      const res = await getDeveloperLoad()
      if (res.data) setDevLoad(res.data)
    } catch {
      // non-critical
    } finally {
      setDevLoading(false)
    }
  }, [])

  const loadCarryover = useCallback(async () => {
    try {
      const res = await getCarryover()
      if (res.data) {
        setCarryover(res.data)
        setTodayItems(res.data.today)
      }
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    loadBrief()
    loadDevLoad()
    loadCarryover()
  }, [loadBrief, loadDevLoad, loadCarryover])

  // ── carry-over toggle (checkbox)
  async function handleCarryoverToggle(idx: number) {
    const updated = todayItems.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    setTodayItems(updated)
    try {
      await saveCarryoverPlan(updated)
    } catch {
      // revert on failure
      setTodayItems(todayItems)
    }
  }

  // When yesterday's items are checked off, we write to today's record
  async function handleYesterdayToggle(idx: number) {
    if (!carryover) return
    const updated = carryover.yesterday.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    setCarryover({ ...carryover, yesterday: updated })
    // Persist carry-over done state as today's items (seed today from yesterday if today is empty)
    const baseItems = todayItems.length > 0 ? todayItems : updated
    try {
      await saveCarryoverPlan(baseItems)
    } catch { /* non-critical */ }
  }

  // ── AI plan
  async function handleGeneratePlan() {
    if (!eod) return
    setPlanLoading(true)
    setPlanText('')
    try {
      const res = await api.generateEODPlan(eod)
      if (res.data) setPlanText(res.data.plan_text)
    } catch (e: any) {
      setPlanText('Failed to generate plan: ' + (e.message || ''))
    } finally {
      setPlanLoading(false)
    }
  }

  // ── save plan as carry-over action items
  async function handleSaveAsItems() {
    if (!planText.trim()) return
    const items: CarryoverItem[] = planText
      .split('\n')
      .map(line => line.replace(/^[\s•\-*]+/, '').trim())
      .filter(line => line.length > 0)
      .map(text => ({ text, done: false }))

    setSaveItemsStatus('Saving…')
    try {
      await saveCarryoverPlan(items)
      setTodayItems(items)
      setSaveItemsStatus('Saved ✓ — appears in tomorrow\'s Morning Brief')
      setTimeout(() => setSaveItemsStatus(''), 4000)
    } catch {
      setSaveItemsStatus('Failed to save')
      setTimeout(() => setSaveItemsStatus(''), 3000)
    }
  }

  // ── post handlers
  async function handlePostReport(channelId: string, channelName: string) {
    if (!reportText.trim()) return
    setPostStatus('Posting…')
    try {
      await api.postMorningReport(reportText, [channelId])
      setPostStatus(`✓ Posted to #${channelName}`)
    } catch (e: any) {
      setPostStatus('✗ ' + (e.message || 'Failed'))
    }
  }

  async function handlePostEOD(channelId: string, channelName: string) {
    if (!planText.trim()) return
    setEodPostStatus('Posting…')
    try {
      await api.postMorningReport(planText, [channelId])
      setEodPostStatus(`✓ Posted to #${channelName}`)
    } catch (e: any) {
      setEodPostStatus('✗ ' + (e.message || 'Failed'))
    }
  }

  // ── filter props passed to every Section
  const sectionFilterProps = {
    search, filterPriority, filterAssignee,
    forceOpen: allOpen ?? undefined,
    expandedRowId,
    onExpandRow: setExpandedRowId,
  }

  // ── EOD visible data based on filter
  const eodVisible = eod ? (() => {
    if (eodFilter === 'no_movement') return { completed: [], still: [], noMove: eod.no_movement, blockers: [] }
    if (eodFilter === 'blockers') return { completed: [], still: [], noMove: [], blockers: eod.new_blockers }
    return {
      completed: eod.completed_today,
      still: eod.still_in_progress,
      noMove: eod.no_movement,
      blockers: eod.new_blockers,
    }
  })() : null

  const eodSectionProps = { search: '', filterPriority: 'all', filterAssignee: 'all', expandedRowId, onExpandRow: setExpandedRowId }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="do-scroll">

      {/* ══ MORNING BRIEF ═══════════════════════════════════════ */}
      <div className="do-block">
        <div className="do-block-header">
          <span className="do-block-title">☀ Morning Brief</span>
          <div className="do-block-actions">
            {briefRefreshedAt && (
              <span className="do-ts">Last refreshed {briefRefreshedAt}</span>
            )}
            <button className="do-post-btn do-post-btn--secondary" onClick={loadBrief} disabled={briefLoading}>
              <RefreshCw size={12} className={briefLoading ? 'spin' : ''} />
              {briefLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {briefError && <div className="do-error">{briefError}</div>}

        {/* Filter bar — only show when we have data */}
        {brief && (
          <FilterBar
            search={search}
            onSearch={setSearch}
            priority={filterPriority}
            onPriority={setFilterPriority}
            assignees={briefAssignees}
            assignee={filterAssignee}
            onAssignee={setFilterAssignee}
            allOpen={allOpen}
            onToggleAll={v => setAllOpen(v)}
          />
        )}

        {briefLoading && (() => {
          const sk = (w: number | string, h: number, r = 5) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
          const rowW = ['70%','55%','82%','48%','75%','60%','88%','52%','65%','78%']
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0.5rem 0' }}>
              {/* 3 fake section headers */}
              {[100, 120, 90].map((w, si) => (
                <div key={si} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.25rem' }}>
                    {sk(16, 16, 4)}{sk(w, 14, 4)}<div style={{ marginLeft: 6 }}>{sk(28, 18, 10)}</div>
                  </div>
                  {Array.from({ length: 3 + si }).map((_, ri) => (
                    <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.75rem' }}>
                      {sk(52, 13, 4)}{sk(rowW[(si * 3 + ri) % rowW.length], 12, 4)}<div style={{ marginLeft: 'auto' }}>{sk(22, 22, '50%')}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })()}
        {!brief && !briefLoading && <div className="do-loading">Click Refresh to load</div>}

        {brief && (
          <div className="do-sections-list">

            {/* ── Carry-over from yesterday (at top) ── */}
            {carryover && carryover.yesterday.length > 0 && (
              <div className="do-section" id="do-sec-carryover">
                <div className="do-section-header" style={{ cursor: 'default' }}>
                  <span>📌</span>
                  <span className="do-section-title">Carry-over from Yesterday</span>
                  <span className="do-section-count">
                    {carryover.yesterday.filter(i => i.done).length}/{carryover.yesterday.length} done
                  </span>
                </div>
                <CarryoverChecklist
                  items={carryover.yesterday}
                  onToggle={handleYesterdayToggle}
                />
              </div>
            )}

            <Section id="done" title="Done Yesterday"        icon="✅" issues={brief.done_yesterday} defaultOpen {...sectionFilterProps} />
            <Section id="p0"   title="P0 — Critical"         icon="🔴" issues={brief.p0}            defaultOpen {...sectionFilterProps} />
            <Section id="p1"   title="P1"                    icon="🟠" issues={brief.p1}            defaultOpen {...sectionFilterProps} />
            <Section id="p2"   title="P2"                    icon="🟡" issues={brief.p2}                       {...sectionFilterProps} />
            <Section id="p3"   title="P3"                    icon="🔵" issues={brief.p3}                       {...sectionFilterProps} />
            <Section id="bl-ours"   title="Blocked — Our Side"    icon="🚫" issues={brief.blocked_ours}   defaultOpen {...sectionFilterProps} />
            <Section id="bl-theirs" title="Blocked — Trackflow Side" icon="⚠️" issues={brief.blocked_theirs} defaultOpen {...sectionFilterProps} />
            <Section id="open"  title="Open Items (Unassigned)"    icon="📋" issues={brief.open_items}              {...sectionFilterProps} />
          </div>
        )}

        {/* Report preview + post */}
        {brief && (
          <div className="do-section do-section--report">
            <div className="do-section-header" style={{ cursor: 'default', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="do-section-title">Report Preview (editable)</span>
              <CopyBtn text={reportText} label="Copy report" />
            </div>
            <div className="do-report-wrap">
              <textarea
                className="do-report-textarea"
                value={reportText}
                onChange={e => setReportText(e.target.value)}
              />
              <div className="do-action-bar">
                <ChannelPicker
                  label="Post to Slack"
                  channels={channels}
                  onPost={handlePostReport}
                  disabled={!reportText.trim()}
                  statusMsg={postStatus}
                  onClearStatus={() => setPostStatus('')}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ EOD WRAP-UP ══════════════════════════════════════════ */}
      <div className="do-block">
        <div className="do-block-header">
          <span className="do-block-title">🌙 EOD Wrap-up</span>
          <div className="do-block-actions">
            <button className="do-post-btn do-post-btn--secondary" onClick={loadEOD} disabled={eodLoading}>
              <Clock size={12} />
              {eodLoading ? 'Loading…' : "Load Today's Data"}
            </button>
          </div>
        </div>

        {eodError && <div className="do-error">{eodError}</div>}
        {eodLoading && (() => {
          const sk = (w: number | string, h: number, r = 5) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
          const rowW = ['65%','80%','50%','72%','45%','85%','58%','68%']
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0.5rem 0' }}>
              {[4, 3, 5].map((count, gi) => (
                <div key={gi} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.25rem' }}>
                    {sk(gi === 0 ? 90 : gi === 1 ? 110 : 75, 14, 4)}{sk(28, 18, 10)}
                  </div>
                  {Array.from({ length: count }).map((_, ri) => (
                    <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3rem 0.75rem' }}>
                      {sk(50, 12, 4)}{sk(rowW[(gi * 3 + ri) % rowW.length], 11, 4)}<div style={{ marginLeft: 'auto' }}>{sk(44, 18, 10)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })()}
        {!eod && !eodLoading && <div className="do-loading">Click "Load Today's Data" to see EOD summary</div>}

        {eod && (
          <>
            {/* Quick EOD filter tabs */}
            <div className="do-eod-filters">
              {(['all', 'no_movement', 'blockers'] as const).map(f => (
                <button
                  key={f}
                  className={`do-eod-filter-btn ${eodFilter === f ? 'active' : ''}`}
                  onClick={() => setEodFilter(f)}
                >
                  {f === 'all' && 'All'}
                  {f === 'no_movement' && `⏭ No Movement (${eod.no_movement.length})`}
                  {f === 'blockers' && `🚧 Blockers (${eod.new_blockers.length})`}
                </button>
              ))}
            </div>

            <div className="do-sections-list">
              {eodVisible && eodFilter === 'all' && (
                <>
                  <Section id="eod-done" title="Completed Today"  icon="✅" issues={eodVisible.completed} defaultOpen {...eodSectionProps} />
                  <Section id="eod-prog" title="Still In Progress" icon="🔄" issues={eodVisible.still}     defaultOpen {...eodSectionProps} />
                </>
              )}
              {eodVisible && (eodFilter === 'all' || eodFilter === 'no_movement') && (
                <Section id="eod-nom"  title="No Movement Today"  icon="⏭" issues={eodVisible.noMove}   defaultOpen noMovement {...eodSectionProps} />
              )}
              {eodVisible && (eodFilter === 'all' || eodFilter === 'blockers') && (
                <Section id="eod-blk"  title="New Blockers Raised" icon="🚧" issues={eodVisible.blockers} defaultOpen {...eodSectionProps} />
              )}
            </div>
          </>
        )}

        {/* AI plan */}
        {eod && (
          <div className="do-section do-section--report" style={{ marginTop: '0.75rem' }}>
            <div className="do-section-header" style={{ cursor: 'default', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="do-section-title">Next-Day Action Plan (AI Draft)</span>
              {planText && <CopyBtn text={planText} label="Copy plan" />}
            </div>
            <div className="do-report-wrap">
              <textarea
                className="do-plan-textarea"
                value={planText}
                onChange={e => setPlanText(e.target.value)}
                placeholder="Click 'AI Generate Plan' to draft tomorrow's action plan…"
              />
              <div className="do-action-bar">
                <button
                  className="do-post-btn do-post-btn--primary"
                  onClick={handleGeneratePlan}
                  disabled={planLoading}
                >
                  <Zap size={12} />
                  {planLoading ? 'Generating…' : 'AI Generate Plan'}
                </button>
                <button
                  className="do-save-items-btn"
                  onClick={handleSaveAsItems}
                  disabled={!planText.trim()}
                  title="Save plan lines as tomorrow's carry-over checklist"
                >
                  <BookmarkCheck size={12} />
                  Save as Action Items
                </button>
                <ChannelPicker
                  label="Post EOD to Slack"
                  channels={channels}
                  onPost={handlePostEOD}
                  disabled={!planText.trim()}
                  statusMsg={eodPostStatus}
                  onClearStatus={() => setEodPostStatus('')}
                />
              </div>
              {saveItemsStatus && (
                <div className="do-inline-status" style={{ padding: '0.3rem 0.5rem', fontSize: '0.7rem' }}>
                  {saveItemsStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ DEVELOPER LOAD ═══════════════════════════════════════ */}
      <div className="do-block">
        <div className="do-block-header">
          <span className="do-block-title">
            <Users size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Developer Load
          </span>
          <div className="do-block-actions">
            <button className="do-post-btn do-post-btn--secondary" onClick={loadDevLoad} disabled={devLoading}>
              <RefreshCw size={12} className={devLoading ? 'spin' : ''} />
              {devLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {devLoading && (() => {
          const sk = (w: number | string, h: number, r = 5) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
          const barW = [72, 45, 88, 55, 63, 78, 40, 95, 50, 67, 82, 38]
          // Dev load is displayed as cards in a grid — fake 8 developer cards
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, padding: '0.5rem 0' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {sk(28, 28, '50%')}{sk(80 + (i * 13 % 40), 13, 4)}
                  </div>
                  {/* Load bar */}
                  <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div className="skeleton" style={{ height: '100%', width: `${barW[i % barW.length]}%`, borderRadius: 4 }} />
                  </div>
                  {/* Issue count + stat */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {sk(40, 18, 10)}{sk(50, 18, 10)}
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
        {!devLoading && devLoad.length === 0 && <div className="do-loading">No developer data yet — move some issues first</div>}

        <div className="do-dev-grid">
          {devLoad
            .slice()
            .sort((a, b) => (b.overloaded ? 1 : 0) - (a.overloaded ? 1 : 0) || b.active_issues.length - a.active_issues.length)
            .map(dev => (
              <div key={dev.assignee} className={`do-dev-card ${dev.overloaded ? 'do-dev-card--overloaded' : ''}`}>
                <div className="do-dev-card-header">
                  <span className="do-dev-name">{dev.assignee}</span>
                  <div className="do-dev-badges">
                    {dev.overloaded && <span className="do-overloaded-badge">⚠ Overloaded</span>}
                    {dev.missing_update && <span className="do-missing-badge">⏰ No update today</span>}
                  </div>
                </div>

                <div className="do-dev-stats">
                  <div className="do-dev-stat">
                    <CheckCircle size={10} />
                    <span>{dev.done_today} done today</span>
                  </div>
                  <div className="do-dev-stat">
                    <Clock size={10} />
                    <span>{dev.active_issues.length} in progress</span>
                  </div>
                  {dev.blocked_issues.length > 0 && (
                    <div className="do-dev-stat do-dev-stat--blocked">
                      <AlertTriangle size={10} />
                      <span>{dev.blocked_issues.length} blocked</span>
                    </div>
                  )}
                  {dev.avg_hours_per_p1 > 0 && (
                    <div className="do-dev-stat">
                      <span>P1 avg {dev.avg_hours_per_p1.toFixed(1)}h</span>
                    </div>
                  )}
                  {dev.avg_hours_per_p2 > 0 && (
                    <div className="do-dev-stat">
                      <span>P2 avg {dev.avg_hours_per_p2.toFixed(1)}h</span>
                    </div>
                  )}
                  {dev.last_activity_at && (
                    <div className="do-dev-stat">
                      <span>Last: {fmtTime(dev.last_activity_at)}</span>
                    </div>
                  )}
                </div>

                {dev.active_issues.length > 0 && (
                  <div className="do-dev-issues">
                    {dev.active_issues.slice(0, 4).map(iss => (
                      <div key={iss.id} className={`do-dev-issue-row ${priorityClass(iss.priority)}`}>
                        <span className={`do-prio-dot do-prio-dot--${priorityLabel(iss.priority).toLowerCase()}`} />
                        <span className="do-issue-id">{iss.id}</span>
                        <span className="do-issue-summary">{iss.summary}</span>
                      </div>
                    ))}
                    {dev.active_issues.length > 4 && (
                      <div className="do-dev-more">+{dev.active_issues.length - 4} more</div>
                    )}
                  </div>
                )}

                {dev.blocked_issues.length > 0 && (
                  <div className="do-dev-issues do-dev-issues--blocked">
                    {dev.blocked_issues.map(iss => (
                      <div key={iss.id} className="do-dev-issue-row do-priority-p0">
                        <span className="do-prio-dot do-prio-dot--p0" />
                        <span className="do-issue-id">{iss.id}</span>
                        <span className="do-issue-summary">{iss.summary}</span>
                        <span className="do-blocker-badge">Blocked</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

    </div>
  )
}
