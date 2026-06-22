import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import api from '@/services/api'
import { useWorkflowConfig } from '@/hooks/useWorkflowConfig'
import HoverCard from '@/components/HoverCard'
import { IssueDetailPanel } from '@/components/IssueDetailPanel'
import { SprintControlsBar } from '@/components/SprintControlsBar'
import type { ModeOption } from '@/components/SprintControlsBar'
import type {
  YouTrackSprint,
  SprintBoardStatusResponse,
  SprintBoardIssue,
  WorkflowConfig,
} from '@/services/api'
import { updatePMIssueState } from '@/services/pmDataService'
import {
  GitBranch, RefreshCw, ChevronRight,
  LayoutGrid, AlignLeft, BarChart2, Layers, Tag,
} from 'lucide-react'
import { VelocityBarsLoader, SprintScanLoader, SvgVelocityBarsLoader } from '@/components/brand/VelocityLoaders'
import { VelocityLogo } from '@/components/brand/VelocityLogo'
import '@/styles/pages/sprint-pulse.css'

// ─── Constants ───────────────────────────────────────────────────────────────

const SPRINT_ID_KEY   = 'pm_active_sprint_id'
const SPRINT_NAME_KEY = 'pm_active_sprint_name'
const DONE_ROLES      = new Set(['dev_done', 'verified', 'deployed', 'closed'])

type ViewMode = 'a' | 'c' | '1' | '4' | 'p'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PulseIssue extends SprintBoardIssue {
  tier:       number   // 0=regression, 1=critical/hotfix, 2=urgent, 3=scheduled, 4=normal
  colRole:    string
  stageGroup: 'active' | 'blocked' | 'dev_done' | 'stage' | 'deployed'
  isDone:     boolean
}

interface TierGroups {
  t1:  PulseIssue[]
  t2:  PulseIssue[]
  t3:  PulseIssue[]
  t4:  PulseIssue[]
  reg: PulseIssue[]
}

interface StageCounts {
  active:   number
  blocked:  number
  devDone:  number
  stage:    number
  deployed: number
}

interface ViewProps {
  tierGroups:  TierGroups
  stageCounts?: StageCounts
  wfConfig:    WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick:    (id: string, e: React.MouseEvent) => void
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function classifyTier(iss: SprintBoardIssue): number {
  if (iss.issue_type.toLowerCase().includes('regress')) return 0
  if (iss.is_hotfix) return 1
  const p = iss.priority.toLowerCase()
  if (p.includes('critical') || p === 'p0' || p === 'a0') return 1
  if (p.includes('major')    || p === 'p1' || p === 'a1') return 2
  if (p.includes('minor')    || p === 'p2' || p === 'a2') return 3
  if (p === 'normal') return 3
  return 4
}

function mapStage(colRole: string): PulseIssue['stageGroup'] {
  if (colRole === 'blocked')                          return 'blocked'
  if (colRole === 'dev_done')                         return 'dev_done'
  if (colRole === 'verified')                         return 'stage'
  if (colRole === 'deployed' || colRole === 'closed') return 'deployed'
  return 'active'
}

function fmtHours(h: number): string {
  if (!h) return '—'
  if (h < 1)  return `${Math.round(h * 60)}m`
  if (h < 24) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

function fmtSprintDate(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sprintCountdown(finishMs: number): string {
  const diff = finishMs - Date.now()
  if (diff <= 0) return 'OVERDUE'
  const days  = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

function dangerLevel(iss: SprintBoardIssue): 0 | 1 | 2 {
  if (iss.overdue_level === 'deadline' || iss.bounce_count >= 3) return 2
  if (iss.overdue_level === 'sprint'   || iss.bounce_count >= 2) return 2
  if (iss.overdue_level === 'sla'      || iss.is_delayed)         return 1
  return 0
}

function tierLabel(tier: number): string {
  if (tier === 0) return 'Regressions'
  if (tier === 1) return 'Critical / Hotfix'
  if (tier === 2) return 'Urgent'
  if (tier === 3) return 'Scheduled'
  return 'Normal'
}

function tierCssClass(tier: number): string {
  if (tier === 1) return 'spl-t1'
  if (tier === 2) return 'spl-t2'
  if (tier === 3) return 'spl-t3'
  if (tier === 0) return 'spl-treg'
  return 'spl-t4'
}

// ─── Local components ─────────────────────────────────────────────────────────

function DBAvatar({ name, url, size = 22 }: { name: string; url?: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (url && !imgFailed) {
    return (
      <img
        src={url} alt={name} width={size} height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setImgFailed(true)}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--color-primary)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, flexShrink: 0,
    }}>{initials}</div>
  )
}

function PriPill({ priority, tags }: { priority: string; tags?: WorkflowConfig['priority_tags'] }) {
  if (!priority) return null
  const tag  = tags?.find(t =>
    t.label.toLowerCase() === priority.toLowerCase() ||
    t.yt_mappings?.some(m => m.toLowerCase() === priority.toLowerCase())
  )
  const color = tag?.color || 'var(--text-muted)'
  return (
    <span
      className="spl-pri-pill"
      style={{ color, borderColor: `${color}55`, background: `${color}1A` }}
    >
      {priority}
    </span>
  )
}

function IssueTypePill({ type }: { type: string }) {
  if (!type) return null
  const lower  = type.toLowerCase()
  const isHf   = lower.includes('hotfix')
  const isReg  = lower.includes('regress')
  const isBug  = lower.includes('bug')
  return (
    <span className={`spl-type-pill${isHf ? ' spl-type-pill--hf' : isReg ? ' spl-type-pill--reg' : isBug ? ' spl-type-pill--bug' : ''}`}>
      {type}
    </span>
  )
}

function buildHoverContent(iss: PulseIssue): React.ReactNode {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>{iss.summary}</div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>State: <strong style={{ color: 'var(--text-primary)' }}>{iss.current_state}</strong></div>
      {iss.assignee && <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Assignee: {iss.assignee}</div>}
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Time in state: {fmtHours(iss.hours_in_state)}</div>
      {iss.cycle_time_hours > 0 && <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Cycle time: {fmtHours(iss.cycle_time_hours)}</div>}
      {iss.bounce_count > 0 && <div style={{ color: 'var(--color-warning)', marginBottom: 2 }}>↩ Bounced {iss.bounce_count}×</div>}
      {iss.is_hotfix && <div style={{ color: 'var(--color-danger)' }}>⚡ Hotfix</div>}
      {iss.overdue_level && <div style={{ color: 'var(--color-danger)' }}>⚠ {iss.overdue_level} overdue</div>}
    </div>
  )
}

// ─── IssueCard (shared across views) ─────────────────────────────────────────

function IssueCard({
  iss, wfConfig, onTitleClick, onIdClick, showStage = false,
}: {
  iss: PulseIssue
  wfConfig: WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
  showStage?: boolean
}) {
  const danger = dangerLevel(iss)
  const canPulse = danger === 2 && !iss.isDone && iss.colRole !== 'backlog'
  return (
    <HoverCard content={buildHoverContent(iss)} delay={250}>
      <div className={`spl-card${iss.isDone ? ' spl-card--done' : ''}${danger === 2 ? ' spl-card--crit' : danger === 1 ? ' spl-card--warn' : ''}${canPulse ? ' spl-card--pulse' : ''}`}>
        <div className="spl-card-top">
          <PriPill priority={iss.priority} tags={wfConfig?.priority_tags} />
          <IssueTypePill type={iss.issue_type} />
          <span
            className="spl-ticket-id"
            onClick={(e) => onIdClick(iss.idReadable, e)}
            title={`Open ${iss.idReadable} in YouTrack`}
          >
            {iss.idReadable}
          </span>
          {iss.is_hotfix && <span className="spl-hf-chip">HF</span>}
          {iss.bounce_count > 0 && <span className="spl-bounce-chip">↩{iss.bounce_count}</span>}
          {showStage && <span className={`spl-stage-chip spl-stage-chip--${iss.stageGroup}`}>{iss.current_state}</span>}
          {!showStage && <span className="spl-state-chip">{iss.current_state}</span>}
        </div>
        <div className="spl-card-title" onClick={(e) => onTitleClick(iss.idReadable, e)}>
          {iss.summary}
        </div>
        <div className="spl-card-footer">
          <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={16} />
          <span className="spl-card-assignee">{iss.assignee?.split(' ')[0] || 'Unassigned'}</span>
          <span className="spl-card-time" style={{ color: danger >= 1 ? 'var(--color-danger)' : undefined }}>
            {fmtHours(iss.hours_in_state)}
          </span>
        </div>
      </div>
    </HoverCard>
  )
}

// ─── View A — Swimlane Kanban ─────────────────────────────────────────────────

const TIER_DEFS: { tier: number; label: string }[] = [
  { tier: 0, label: 'Regression' },
  { tier: 1, label: 'Critical / Hotfix' },
  { tier: 2, label: 'Urgent' },
  { tier: 3, label: 'Scheduled' },
  { tier: 4, label: 'Normal' },
]

function SwimDraggableCard({
  iss, wfConfig, onTitleClick, onIdClick,
}: {
  iss:          PulseIssue
  wfConfig:     WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick:    (id: string, e: React.MouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: iss.id })
  return (
    <div
      ref={setNodeRef}
      className={`spl-swim-drag${isDragging ? ' spl-swim-drag--ghost' : ''}`}
      {...attributes}
      {...listeners}
    >
      <IssueCard iss={iss} wfConfig={wfConfig} onTitleClick={onTitleClick} onIdClick={onIdClick} />
    </div>
  )
}

function SwimDroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`spl-swim-cell${isOver ? ' spl-swim-cell--over' : ''}`}>
      {children}
    </div>
  )
}

function PulseSwimKanban({
  allIssues, boardData, roleMap, wfConfig, onTitleClick, onIdClick,
}: {
  allIssues:    PulseIssue[]
  boardData:    SprintBoardStatusResponse
  roleMap:      Map<string, string>
  wfConfig:     WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick:    (id: string, e: React.MouseEvent) => void
}) {
  const [stateOverrides, setStateOverrides] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => { setStateOverrides({}) }, [boardData])

  const columns = useMemo(() => boardData.columns.map(c => c.name), [boardData])

  const activeTiers = useMemo(
    () => TIER_DEFS.filter(t => allIssues.some(i => i.tier === t.tier)),
    [allIssues],
  )

  const getEffectiveState = useCallback(
    (iss: PulseIssue) => stateOverrides[iss.id] || iss.current_state,
    [stateOverrides],
  )

  const getCellIssues = useCallback((tier: number, col: string): PulseIssue[] => {
    const colRole = roleMap.get(col.toLowerCase()) || ''
    const isDoneCol = DONE_ROLES.has(colRole)
    return allIssues
      .filter(i => i.tier === tier && getEffectiveState(i) === col)
      .map(i => ({ ...i, current_state: col, colRole, isDone: isDoneCol, stageGroup: mapStage(colRole) }))
      .sort((a, b) => dangerLevel(b) - dangerLevel(a))
  }, [allIssues, getEffectiveState, roleMap])

  const activeIss = useMemo(
    () => activeId ? (allIssues.find(i => i.id === activeId) ?? null) : null,
    [activeId, allIssues],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string)
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    setActiveId(null)
    if (!over) return
    const colonIdx = (over.id as string).indexOf(':')
    const newCol = colonIdx >= 0 ? (over.id as string).slice(colonIdx + 1) : (over.id as string)
    const issueId = active.id as string
    const iss = allIssues.find(i => i.id === issueId)
    if (!iss || getEffectiveState(iss) === newCol) return
    setStateOverrides(prev => ({ ...prev, [issueId]: newCol }))
    updatePMIssueState(issueId, newCol)
  }, [allIssues, getEffectiveState])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="spl-swim-kanban">
        {/* Column header row */}
        <div className="spl-swim-hdr-row">
          <div className="spl-swim-hdr-tier-spacer" />
          {columns.map(col => (
            <div key={col} className="spl-swim-hdr-col">{col}</div>
          ))}
        </div>

        {/* Tier swimlane rows */}
        {activeTiers.map(({ tier, label }) => {
          const breachCount = allIssues.filter(i => {
            if (i.tier !== tier) return false
            const role = roleMap.get(getEffectiveState(i).toLowerCase()) || ''
            return !DONE_ROLES.has(role) && role !== 'backlog' && dangerLevel(i) >= 2
          }).length
          const totalInTier = allIssues.filter(i => i.tier === tier).length
          return (
            <div key={tier} className={`spl-swim-tier-row ${tierCssClass(tier)}`}>
              {/* Sticky left header */}
              <div className="spl-swim-tier-hd">
                <span className="spl-swim-tier-name">{label}</span>
                <span className="spl-swim-tier-cnt">{totalInTier}</span>
                {breachCount > 0 && (
                  <span className="spl-tier-col-breach">⚠ {breachCount}</span>
                )}
              </div>

              {/* State column cells */}
              {columns.map(col => (
                <SwimDroppableCell key={col} id={`${tier}:${col}`}>
                  {getCellIssues(tier, col).map(iss => (
                    <SwimDraggableCard
                      key={iss.id}
                      iss={iss}
                      wfConfig={wfConfig}
                      onTitleClick={onTitleClick}
                      onIdClick={onIdClick}
                    />
                  ))}
                </SwimDroppableCell>
              ))}
            </div>
          )
        })}
      </div>

      {/* Floating drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeIss && (
          <div style={{ opacity: 0.92, transform: 'rotate(1.5deg)', width: 205, boxShadow: '0 16px 40px rgba(0,0,0,0.4)' }}>
            <IssueCard iss={activeIss} wfConfig={wfConfig} onTitleClick={onTitleClick} onIdClick={onIdClick} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ─── View P — Priority Swimlane Kanban ───────────────────────────────────────
// Groups rows by the actual priority value fetched from the sprint (fully dynamic,
// no hardcoded priority names). Order comes from wfConfig.priority_tags if present,
// with classifyTier as a fallback for unrecognised values.

function PrioritySwimKanban({
  allIssues, boardData, roleMap, wfConfig, onTitleClick, onIdClick,
}: {
  allIssues:    PulseIssue[]
  boardData:    SprintBoardStatusResponse
  roleMap:      Map<string, string>
  wfConfig:     WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick:    (id: string, e: React.MouseEvent) => void
}) {
  const [stateOverrides, setStateOverrides] = useState<Record<string, string>>({})
  const [activeId,       setActiveId]       = useState<string | null>(null)

  useEffect(() => { setStateOverrides({}) }, [boardData])

  const columns = useMemo(() => boardData.columns.map(c => c.name), [boardData])

  // Returns a numeric sort key for a priority string.
  // P-series first (P0, P1, P2…), A-series second (A0, A1…), Normal near bottom,
  // everything else last. wfConfig is NOT used for ordering — only for colors.
  const prioritySortKey = useCallback((priority: string): number => {
    const p = priority.trim()
    const pMatch = p.match(/^[Pp](\d+)$/)
    if (pMatch) return parseInt(pMatch[1], 10)
    const aMatch = p.match(/^[Aa](\d+)$/)
    if (aMatch) return 1000 + parseInt(aMatch[1], 10)
    if (p.toLowerCase() === 'normal') return 9000
    return 9999
  }, [])

  // Collect unique priority values present in the sprint, sorted by urgency
  const priorities = useMemo(() => {
    const seen = new Set<string>()
    allIssues.forEach(i => { if (i.priority) seen.add(i.priority) })
    return [...seen].sort((a, b) => prioritySortKey(a) - prioritySortKey(b))
  }, [allIssues, prioritySortKey])

  // Priority pill color from wfConfig, falling back to text-muted
  const priorityColor = useCallback((priority: string): string => {
    const tag = wfConfig?.priority_tags?.find(t =>
      t.label.toLowerCase() === priority.toLowerCase() ||
      t.yt_mappings?.some(m => m.toLowerCase() === priority.toLowerCase())
    )
    return tag?.color ?? 'var(--text-muted)'
  }, [wfConfig])

  const getEffectiveState = useCallback(
    (iss: PulseIssue) => stateOverrides[iss.id] || iss.current_state,
    [stateOverrides],
  )

  const getCellIssues = useCallback((priority: string, col: string): PulseIssue[] => {
    const colRole  = roleMap.get(col.toLowerCase()) || ''
    const isDoneCol = DONE_ROLES.has(colRole)
    return allIssues
      .filter(i => i.priority === priority && getEffectiveState(i) === col)
      .map(i => ({ ...i, current_state: col, colRole, isDone: isDoneCol, stageGroup: mapStage(colRole) }))
      .sort((a, b) => dangerLevel(b) - dangerLevel(a))
  }, [allIssues, getEffectiveState, roleMap])

  const activeIss = useMemo(
    () => activeId ? (allIssues.find(i => i.id === activeId) ?? null) : null,
    [activeId, allIssues],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string)
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    setActiveId(null)
    if (!over) return
    // id format: "pri:<priority>:<col>" — col is everything after the second colon
    const overId  = over.id as string
    const parts   = overId.split(':')
    // parts[0]='pri', parts[1]=priority, parts[2..]=col (col may contain colons)
    const newCol  = parts.length >= 3 ? parts.slice(2).join(':') : overId
    const issueId = active.id as string
    const iss     = allIssues.find(i => i.id === issueId)
    if (!iss || getEffectiveState(iss) === newCol) return
    setStateOverrides(prev => ({ ...prev, [issueId]: newCol }))
    updatePMIssueState(issueId, newCol)
  }, [allIssues, getEffectiveState])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="spl-swim-kanban">
        {/* Column header row */}
        <div className="spl-swim-hdr-row">
          <div className="spl-swim-hdr-tier-spacer" />
          {columns.map(col => (
            <div key={col} className="spl-swim-hdr-col">{col}</div>
          ))}
        </div>

        {/* One row per unique priority value — fully dynamic */}
        {priorities.map(priority => {
          const inPriority  = allIssues.filter(i => i.priority === priority)
          const activeCount = inPriority.filter(i => !DONE_ROLES.has(i.colRole)).length
          const breachCount = inPriority.filter(i => !DONE_ROLES.has(i.colRole) && dangerLevel(i) >= 2).length
          const color       = priorityColor(priority)
          return (
            <div
              key={priority}
              className="spl-swim-tier-row spl-swim-tier-row--pri"
              style={{ '--spl-pri-accent': color } as React.CSSProperties}
            >
              <div className="spl-swim-tier-hd">
                <span className="spl-swim-tier-name" style={{ color }}>{priority}</span>
                <span className="spl-swim-tier-cnt">{activeCount}</span>
                {breachCount > 0 && <span className="spl-tier-col-breach">⚠ {breachCount}</span>}
              </div>
              {columns.map(col => (
                <SwimDroppableCell key={col} id={`pri:${priority}:${col}`}>
                  {getCellIssues(priority, col).map(iss => (
                    <SwimDraggableCard
                      key={iss.id}
                      iss={iss}
                      wfConfig={wfConfig}
                      onTitleClick={onTitleClick}
                      onIdClick={onIdClick}
                    />
                  ))}
                </SwimDroppableCell>
              ))}
            </div>
          )
        })}

        {priorities.length === 0 && (
          <div className="spl-feed-empty">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <VelocityLogo variant="icon" size="lg" mark="chevron" showStatusDot={false} style={{ opacity: 0.25 }} />
            </div>
            No issues with priority data found
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeIss && (
          <div style={{ opacity: 0.92, transform: 'rotate(1.5deg)', width: 205, boxShadow: '0 16px 40px rgba(0,0,0,0.4)' }}>
            <IssueCard iss={activeIss} wfConfig={wfConfig} onTitleClick={onTitleClick} onIdClick={onIdClick} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ─── View C — Focus (split panel) ────────────────────────────────────────────

function ViewC({ tierGroups, stageCounts, wfConfig, onTitleClick, onIdClick }: ViewProps) {
  const allIssues = useMemo(() => {
    const tiers = [tierGroups.t1, tierGroups.t2, tierGroups.t3, tierGroups.t4, tierGroups.reg]
    return tiers.flat().filter(i => !i.isDone).sort((a, b) => {
      const da = dangerLevel(a), db = dangerLevel(b)
      if (da !== db) return db - da
      return a.tier - b.tier
    })
  }, [tierGroups])

  const groups: { tier: number; items: PulseIssue[] }[] = [
    { tier: 1, items: tierGroups.t1 },
    { tier: 2, items: tierGroups.t2 },
    { tier: 3, items: tierGroups.t3 },
    { tier: 4, items: tierGroups.t4 },
    { tier: 0, items: tierGroups.reg },
  ]

  const totalActive = allIssues.length
  const dangerCount = allIssues.filter(i => dangerLevel(i) >= 1).length

  return (
    <div className="spl-split">
      {/* Left sticky panel */}
      <div className="spl-split-panel">
        <div className="spl-panel-card">
          <div className="spl-panel-title">Tier Health</div>
          <div className="spl-hbars">
            {groups.map(({ tier, items }) => {
              const activeItems = items.filter(i => !i.isDone)
              const doneItems   = items.filter(i => i.isDone)
              const total = activeItems.length + doneItems.length
              const pct = total > 0 ? Math.round((doneItems.length / total) * 100) : 0
              const barColor = tier === 1 ? 'var(--color-danger)' : tier === 2 ? 'var(--color-warning)' : tier === 0 ? 'var(--color-warning)' : 'var(--color-primary)'
              return (
                <div key={tier} className="spl-hbar">
                  <span className="spl-hbar-label">{tierLabel(tier).split(' ')[0]}</span>
                  <div className="spl-hbar-track">
                    <div className="spl-hbar-fill" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <span className="spl-hbar-frac">
                    <span style={{ color: 'var(--color-success)' }}>{doneItems.length}</span>
                    <span className="spl-hbar-sep">/</span>
                    {total}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="spl-panel-footer">
            <span className="spl-panel-footer-label">{dangerCount} needs attention</span>
            <span className="spl-panel-footer-val">{totalActive} active</span>
          </div>
        </div>

        {stageCounts && (
          <div className="spl-panel-card">
            <div className="spl-panel-title">Delivery Pipeline</div>
            {([
              { key: 'active',   label: 'Active',    color: 'var(--color-primary)'  },
              { key: 'devDone',  label: 'Dev Done',  color: 'var(--color-success)'  },
              { key: 'stage',    label: 'Stage',     color: 'var(--color-warning)'  },
              { key: 'deployed', label: 'Deployed',  color: 'var(--text-muted)'     },
              { key: 'blocked',  label: 'Blocked',   color: 'var(--color-danger)'   },
            ] as const).map(({ key, label, color }) => (
              <div key={key} className="spl-bk-row">
                <div className="spl-bk-dot" style={{ background: color }} />
                <span className="spl-bk-label">{label}</span>
                <span className="spl-bk-n" style={{ color }}>{stageCounts[key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right priority feed */}
      <div className="spl-split-feed">
        <div className="spl-feed-hd">
          <span className="spl-feed-hd-title">Priority Feed</span>
          <span className="spl-feed-hd-sub">{allIssues.length} active issues · sorted by urgency</span>
        </div>
        {allIssues.length === 0 && (
          <div className="spl-feed-empty">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <VelocityLogo variant="icon" size="lg" mark="chevron" showStatusDot={false} style={{ opacity: 0.25 }} />
            </div>
            ✓ No active issues
          </div>
        )}
        {allIssues.map(iss => (
          <IssueCard
            key={iss.id}
            iss={iss}
            wfConfig={wfConfig}
            onTitleClick={onTitleClick}
            onIdClick={onIdClick}
            showStage
          />
        ))}
      </div>
    </div>
  )
}

// ─── View 1 — Signal (flat linear list) ──────────────────────────────────────

function SignalRow({
  iss, wfConfig, onTitleClick, onIdClick,
}: {
  iss: PulseIssue
  wfConfig: WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
}) {
  const danger = dangerLevel(iss)
  return (
    <HoverCard content={buildHoverContent(iss)} delay={250}>
      <div className={`spl-signal-row${iss.isDone ? ' spl-signal-row--done' : ''}${danger === 2 ? ' spl-signal-row--crit' : danger === 1 ? ' spl-signal-row--warn' : ''}`}>
        <PriPill priority={iss.priority} tags={wfConfig?.priority_tags} />
        <IssueTypePill type={iss.issue_type} />
        <span
          className="spl-ticket-id"
          onClick={(e) => onIdClick(iss.idReadable, e)}
          title={`Open ${iss.idReadable} in YouTrack`}
        >
          {iss.idReadable}
        </span>
        <span className="spl-signal-title" onClick={(e) => onTitleClick(iss.idReadable, e)}>
          {iss.summary}
        </span>
        <span className={`spl-stage-chip spl-stage-chip--${iss.stageGroup}`}>{iss.current_state}</span>
        <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={18} />
        <span className="spl-signal-assignee">{iss.assignee?.split(' ')[0] || '—'}</span>
        <span className="spl-signal-time" style={{ color: danger >= 1 ? 'var(--color-danger)' : undefined }}>
          {fmtHours(iss.hours_in_state)}
        </span>
        {iss.bounce_count > 0 && <span className="spl-bounce-chip">↩{iss.bounce_count}</span>}
        {iss.is_hotfix && <span className="spl-hf-chip">HF</span>}
      </div>
    </HoverCard>
  )
}

function View1({ tierGroups, wfConfig, onTitleClick, onIdClick }: ViewProps) {
  const sections: { tier: number; issues: PulseIssue[] }[] = [
    { tier: 1, issues: tierGroups.t1 },
    { tier: 2, issues: tierGroups.t2 },
    { tier: 3, issues: tierGroups.t3 },
    { tier: 4, issues: tierGroups.t4 },
    { tier: 0, issues: tierGroups.reg },
  ]

  return (
    <div className="spl-signal">
      {/* Column headers */}
      <div className="spl-signal-hdr">
        <span style={{ minWidth: 52 }}>Priority</span>
        <span style={{ minWidth: 60 }}>Type</span>
        <span style={{ minWidth: 70 }}>ID</span>
        <span style={{ flex: 1 }}>Title</span>
        <span style={{ minWidth: 100 }}>State</span>
        <span style={{ minWidth: 120 }}>Assignee</span>
        <span style={{ minWidth: 55, textAlign: 'right' }}>In State</span>
        <span style={{ minWidth: 30 }}></span>
      </div>

      {sections.map(({ tier, issues }) => {
        const active = issues.filter(i => !i.isDone)
        const done   = issues.filter(i => i.isDone)
        if (active.length === 0 && done.length === 0) return null
        return (
          <TierSection
            key={tier}
            tier={tier}
            active={active}
            done={done}
            wfConfig={wfConfig}
            onTitleClick={onTitleClick}
            onIdClick={onIdClick}
          />
        )
      })}
    </div>
  )
}

function TierSection({
  tier, active, done, wfConfig, onTitleClick, onIdClick,
}: {
  tier: number
  active: PulseIssue[]
  done: PulseIssue[]
  wfConfig: WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
}) {
  const [showDone, setShowDone] = useState(false)
  const breachCount = active.filter(i => dangerLevel(i) >= 1).length
  return (
    <div className={`spl-signal-section ${tierCssClass(tier)}`}>
      <div className="spl-signal-section-hd">
        <span className="spl-signal-tier-name">{tierLabel(tier)}</span>
        <span className="spl-signal-tier-cnt">{active.length}</span>
        {breachCount > 0 && <span className="spl-tier-col-breach">⚠ {breachCount}</span>}
        {done.length > 0 && <span className="spl-tier-col-done">{done.length} done</span>}
      </div>
      {active.length === 0 && <div className="spl-signal-empty">✓ Nothing active</div>}
      {active.map(iss => (
        <SignalRow key={iss.id} iss={iss} wfConfig={wfConfig} onTitleClick={onTitleClick} onIdClick={onIdClick} />
      ))}
      {done.length > 0 && (
        <button className="spl-done-toggle" onClick={() => setShowDone(v => !v)}>
          {showDone ? '↑ Hide done' : `↓ ${done.length} done`}
        </button>
      )}
      {showDone && done.map(iss => (
        <SignalRow key={iss.id} iss={iss} wfConfig={wfConfig} onTitleClick={onTitleClick} onIdClick={onIdClick} />
      ))}
    </div>
  )
}

// ─── View 4 — Pulse Board (swimlanes) ────────────────────────────────────────

const STAGE_COLS: { key: PulseIssue['stageGroup']; label: string }[] = [
  { key: 'active',   label: 'Active' },
  { key: 'blocked',  label: 'Blocked' },
  { key: 'dev_done', label: 'Dev Done' },
  { key: 'stage',    label: 'Stage' },
  { key: 'deployed', label: 'Deployed' },
]

function PulseCell({
  issues, wfConfig, onTitleClick, onIdClick,
}: {
  issues: PulseIssue[]
  wfConfig: WorkflowConfig | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
}) {
  const MAX_VISIBLE = 4
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? issues : issues.slice(0, MAX_VISIBLE)
  const overflow = issues.length - MAX_VISIBLE

  if (issues.length === 0) {
    return <div className="spl-sw-empty">—</div>
  }

  return (
    <div className="spl-sw-cell">
      {visible.map(iss => {
        const danger = dangerLevel(iss)
        return (
          <HoverCard key={iss.id} content={buildHoverContent(iss)} delay={250}>
            <div className={`spl-sw-card${danger === 2 ? ' spl-sw-card--crit' : danger === 1 ? ' spl-sw-card--warn' : ''}${iss.isDone ? ' spl-sw-card--done' : ''}`}>
              <div className="spl-sw-card-top">
                <span
                  className="spl-ticket-id spl-ticket-id--sm"
                  onClick={(e) => onIdClick(iss.idReadable, e)}
                >
                  {iss.idReadable}
                </span>
                {iss.is_hotfix && <span className="spl-hf-chip spl-hf-chip--xs">HF</span>}
                {iss.bounce_count > 0 && <span className="spl-bounce-chip spl-bounce-chip--xs">↩{iss.bounce_count}</span>}
              </div>
              <div
                className="spl-sw-card-title"
                onClick={(e) => onTitleClick(iss.idReadable, e)}
              >
                {iss.summary}
              </div>
              <div className="spl-sw-card-footer">
                <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={14} />
                <span className="spl-sw-card-time" style={{ color: danger >= 1 ? 'var(--color-danger)' : undefined }}>
                  {fmtHours(iss.hours_in_state)}
                </span>
              </div>
            </div>
          </HoverCard>
        )
      })}
      {!expanded && overflow > 0 && (
        <button className="spl-sw-more" onClick={() => setExpanded(true)}>
          +{overflow} more
        </button>
      )}
      {expanded && issues.length > MAX_VISIBLE && (
        <button className="spl-sw-more" onClick={() => setExpanded(false)}>
          ↑ Show less
        </button>
      )}
    </div>
  )
}

function View4({ tierGroups, wfConfig, onTitleClick, onIdClick }: ViewProps) {
  const tiers: { tier: number; issues: PulseIssue[] }[] = [
    { tier: 1, issues: tierGroups.t1 },
    { tier: 2, issues: tierGroups.t2 },
    { tier: 3, issues: tierGroups.t3 },
    { tier: 4, issues: tierGroups.t4 },
    { tier: 0, issues: tierGroups.reg },
  ]

  return (
    <div className="spl-swimlane">
      {/* Header row */}
      <div className="spl-sw-grid">
        <div className="spl-sw-row-hd-cell" />
        {STAGE_COLS.map(col => (
          <div key={col.key} className={`spl-sw-col-hd spl-sw-col-hd--${col.key}`}>
            {col.label}
          </div>
        ))}
      </div>

      {/* Tier rows */}
      {tiers.map(({ tier, issues }) => {
        const hasAny = issues.length > 0
        if (!hasAny) return null
        return (
          <div key={tier} className={`spl-sw-grid ${tierCssClass(tier)}`}>
            <div className="spl-sw-row-hd">
              <span className="spl-sw-row-hd-name">{tierLabel(tier)}</span>
              <span className="spl-sw-row-hd-cnt">{issues.filter(i => !i.isDone).length}</span>
            </div>
            {STAGE_COLS.map(col => (
              <PulseCell
                key={col.key}
                issues={issues.filter(i => i.stageGroup === col.key)}
                wfConfig={wfConfig}
                onTitleClick={onTitleClick}
                onIdClick={onIdClick}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const VIEW_MODES: ModeOption[] = [
  { id: 'a', label: 'Kanban',      icon: LayoutGrid },
  { id: 'p', label: 'Priority',    icon: Tag },
  { id: 'c', label: 'Focus',       icon: Layers },
  { id: '1', label: 'Signal',      icon: AlignLeft },
  { id: '4', label: 'Pulse Board', icon: BarChart2 },
]

export function SprintPulsePage() {
  const { config: wfConfig } = useWorkflowConfig()

  const [sprints,           setSprints]          = useState<YouTrackSprint[]>([])
  const [activeSprint,      setActiveSprint]      = useState<YouTrackSprint | null>(null)
  const [boardData,         setBoardData]         = useState<SprintBoardStatusResponse | null>(null)
  const [loading,           setLoading]           = useState(false)
  const [viewMode,          setViewMode]          = useState<ViewMode>('a')
  const [ytDetailIssue,     setYtDetailIssue]     = useState<YouTrackIssue | null>(null)
  const [ytDetailLoading,   setYtDetailLoading]   = useState(false)
  const [ytBaseUrl,         setYtBaseUrl]         = useState('')


  // Fetch YouTrack base URL
  useEffect(() => {
    api.getYouTrackIntegration().then(res => {
      const d = res as any
      setYtBaseUrl((d?.base_url || d?.data?.base_url || '').replace(/\/$/, ''))
    }).catch(() => {})
  }, [])

  // Fetch sprints
  useEffect(() => {
    api.getYouTrackSprints().then(res => {
      const list = ((res as any).data as YouTrackSprint[]) ?? []
      setSprints(list)
      const savedId = localStorage.getItem(SPRINT_ID_KEY)
      const saved   = savedId ? list.find(s => s.id === savedId) : null
      setActiveSprint(saved || list.find(s => !s.isCompleted) || list[0] || null)
    }).catch(() => {})
  }, [])

  // Fetch board data when sprint changes
  const fetchBoardData = useCallback((sprint: YouTrackSprint) => {
    setLoading(true)
    api.getSprintBoardStatus({
      sprint_id:       sprint.id,
      sprint_finish_ms: sprint.finish,
    }).then(res => {
      const data = (res as any).data as SprintBoardStatusResponse
      setBoardData(data ?? null)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeSprint) { setBoardData(null); return }
    fetchBoardData(activeSprint)
  }, [activeSprint, fetchBoardData])

  const handleSprintSelect = useCallback((s: YouTrackSprint) => {
    setActiveSprint(s)
    localStorage.setItem(SPRINT_ID_KEY,   s.id)
    localStorage.setItem(SPRINT_NAME_KEY, s.name)
  }, [])


  const openIssueDetail = useCallback(async (idReadable: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (ytDetailLoading) return
    setYtDetailLoading(true)
    try {
      const res   = await api.getYouTrackIssue(idReadable)
      const issue = (res as any).data as YouTrackIssue
      if (issue) setYtDetailIssue(issue)
    } catch {}
    finally { setYtDetailLoading(false) }
  }, [ytDetailLoading])

  const openInYt = useCallback((idReadable: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!idReadable || !ytBaseUrl) return
    window.open(`${ytBaseUrl}/issue/${idReadable}`, '_blank', 'noopener,noreferrer')
  }, [ytBaseUrl])

  // Build role map
  const roleMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    if (!wfConfig?.column_hierarchy) return m
    for (const col of wfConfig.column_hierarchy) {
      m.set(col.state.toLowerCase(), col.role)
      for (const alias of (col.aliases || [])) {
        m.set(alias.toLowerCase(), col.role)
      }
    }
    return m
  }, [wfConfig])

  // Build PulseIssue list
  const allIssues = useMemo<PulseIssue[]>(() => {
    if (!boardData) return []
    const result: PulseIssue[] = []
    for (const col of boardData.columns) {
      const colRole = roleMap.get(col.name.toLowerCase()) || ''
      const isDone  = DONE_ROLES.has(colRole)
      for (const iss of col.issues) {
        result.push({
          ...iss,
          tier:       classifyTier(iss),
          colRole,
          stageGroup: mapStage(colRole),
          isDone,
        })
      }
    }
    return result
  }, [boardData, roleMap])

  const stageCounts = useMemo<StageCounts>(() => ({
    active:   allIssues.filter(i => i.stageGroup === 'active').length,
    blocked:  allIssues.filter(i => i.stageGroup === 'blocked').length,
    devDone:  allIssues.filter(i => i.stageGroup === 'dev_done').length,
    stage:    allIssues.filter(i => i.stageGroup === 'stage').length,
    deployed: allIssues.filter(i => i.stageGroup === 'deployed').length,
  }), [allIssues])

  const tierGroups = useMemo<TierGroups>(() => ({
    t1:  allIssues.filter(i => i.tier === 1),
    t2:  allIssues.filter(i => i.tier === 2),
    t3:  allIssues.filter(i => i.tier === 3),
    t4:  allIssues.filter(i => i.tier === 4),
    reg: allIssues.filter(i => i.tier === 0),
  }), [allIssues])

  const summary = boardData?.summary

  const sprintLabel = useMemo(
    () => activeSprint?.finish ? sprintCountdown(activeSprint.finish) : null,
    [activeSprint],
  )


  return (
    <div className="db-page">

      {/* ── Controls bar — shared SprintControlsBar component ── */}
      <SprintControlsBar
        modes={VIEW_MODES}
        activeMode={viewMode}
        onModeChange={(id) => setViewMode(id as ViewMode)}
        sprints={sprints}
        activeSprint={activeSprint}
        onSprintChange={handleSprintSelect}
      >
        <button
          className="pm-custom-dropdown-trigger"
          style={{ gap: 5 }}
          disabled={loading || !activeSprint}
          onClick={() => activeSprint && fetchBoardData(activeSprint)}
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'spl-spin' : ''} />
        </button>
      </SprintControlsBar>

      {/* ── Scrollable content ── */}
      <div className="db-content spl-content">

        {/* ── KPI cards — reuse pm-tracking-kpi-* (same as Tracking tab) ── */}
        {summary && (
          <div className="pm-tracking-kpi-row">
            <div className="pm-tracking-kpi pm-tracking-kpi--green">
              <div className="pm-tracking-kpi-lbl">Completion</div>
              <div className="pm-tracking-kpi-val">
                {Math.round(summary.completion_pct)}<span className="pm-tracking-kpi-unit">%</span>
              </div>
              <div className="pm-tracking-kpi-prog">
                <div className="pm-tracking-kpi-prog-f" style={{ width: `${Math.round(summary.completion_pct)}%` }} />
              </div>
              <div className="pm-tracking-kpi-note">{summary.done_issues} / {summary.total_issues} tickets</div>
            </div>

            <div className="pm-tracking-kpi pm-tracking-kpi--blue">
              <div className="pm-tracking-kpi-lbl">In Progress</div>
              <div className="pm-tracking-kpi-val">{summary.in_progress_count}</div>
              <div className="pm-tracking-kpi-note">
                {summary.overdue_count} overdue · {summary.blocked_count} blocked
              </div>
            </div>

            <div className="pm-tracking-kpi pm-tracking-kpi--red">
              <div className="pm-tracking-kpi-lbl">Blocked</div>
              <div className="pm-tracking-kpi-val">{summary.blocked_count}</div>
              <div className="pm-tracking-kpi-note">
                {summary.hotfix_count} hotfix{summary.hotfix_count !== 1 ? 'es' : ''} · {summary.overdue_count} overdue
              </div>
            </div>

            <div className="pm-tracking-kpi pm-tracking-kpi--amber">
              <div className="pm-tracking-kpi-lbl">Bounced</div>
              <div className="pm-tracking-kpi-val">{summary.bounced_count}</div>
              <div className="pm-tracking-kpi-note">backward moves</div>
            </div>

            {activeSprint?.finish && (
              <div className={`pm-tracking-kpi ${sprintLabel === 'OVERDUE' ? 'pm-tracking-kpi--red' : 'pm-tracking-kpi--amber'}`}>
                <div className="pm-tracking-kpi-lbl">Sprint Ends</div>
                <div className={`pm-tracking-kpi-val${sprintLabel === 'OVERDUE' ? ' pm-tracking-kpi-val--danger' : ''}`}>
                  {sprintLabel}
                </div>
                <div className="pm-tracking-kpi-note">{fmtSprintDate(activeSprint.finish)}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Delivery pipeline strip ── */}
        <div className="spl-pipeline">
          <span className="spl-pipeline-label">Delivery</span>
          <div className="spl-pipe-stages">
            <div className="spl-pipe-stage spl-pipe-stage--active">
              <div className="spl-pipe-count">{stageCounts.active}</div>
              <div className="spl-pipe-lbl">Active</div>
            </div>
            <ChevronRight size={12} className="spl-pipe-arrow" />
            <div className="spl-pipe-stage spl-pipe-stage--devdone">
              <div className="spl-pipe-count">{stageCounts.devDone}</div>
              <div className="spl-pipe-lbl">Dev Done</div>
            </div>
            <ChevronRight size={12} className="spl-pipe-arrow" />
            <div className="spl-pipe-stage spl-pipe-stage--stage">
              <div className="spl-pipe-count">{stageCounts.stage}</div>
              <div className="spl-pipe-lbl">Stage</div>
            </div>
            <ChevronRight size={12} className="spl-pipe-arrow" />
            <div className="spl-pipe-stage spl-pipe-stage--deployed">
              <div className="spl-pipe-count">{stageCounts.deployed}</div>
              <div className="spl-pipe-lbl">Deployed</div>
            </div>
          </div>
          {stageCounts.blocked > 0 && (
            <div className="spl-pipe-blocked">
              <span className="spl-pipe-blocked-count">{stageCounts.blocked}</span>
              <span className="spl-pipe-blocked-lbl">blocked</span>
            </div>
          )}
        </div>

        {/* ── States ── */}
        {!activeSprint && !loading && (
          <div className="sp-no-sprint">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <VelocityLogo variant="icon" size="lg" mark="chevron" showStatusDot={false} style={{ opacity: 0.25 }} />
            </div>
            <GitBranch size={24} />
            <span>Select a sprint to load Sprint Pulse</span>
          </div>
        )}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
            <SvgVelocityBarsLoader size={128} />
          </div>
        )}

        {/* ── Content views ── */}
        {!loading && boardData && (
          <>
            {viewMode === 'a' && (
              <PulseSwimKanban
                allIssues={allIssues}
                boardData={boardData}
                roleMap={roleMap}
                wfConfig={wfConfig}
                onTitleClick={openIssueDetail}
                onIdClick={openInYt}
              />
            )}
            {viewMode === 'p' && (
              <PrioritySwimKanban
                allIssues={allIssues}
                boardData={boardData}
                roleMap={roleMap}
                wfConfig={wfConfig}
                onTitleClick={openIssueDetail}
                onIdClick={openInYt}
              />
            )}
            {viewMode === 'c' && (
              <ViewC
                tierGroups={tierGroups}
                stageCounts={stageCounts}
                wfConfig={wfConfig}
                onTitleClick={openIssueDetail}
                onIdClick={openInYt}
              />
            )}
            {viewMode === '1' && (
              <View1
                tierGroups={tierGroups}
                wfConfig={wfConfig}
                onTitleClick={openIssueDetail}
                onIdClick={openInYt}
              />
            )}
            {viewMode === '4' && (
              <View4
                tierGroups={tierGroups}
                wfConfig={wfConfig}
                onTitleClick={openIssueDetail}
                onIdClick={openInYt}
              />
            )}
          </>
        )}
      </div>

      {/* ── Issue Detail Panel ── */}
      {ytDetailIssue && (
        <IssueDetailPanel
          issue={ytDetailIssue}
          onClose={() => setYtDetailIssue(null)}
          ytBaseUrl={ytBaseUrl}
        />
      )}
    </div>
  )
}
