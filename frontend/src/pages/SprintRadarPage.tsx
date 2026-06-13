import { useState, useMemo } from 'react'
import {
  AlertTriangle, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Zap, Clock,
} from 'lucide-react'
import type { SprintBoardStatusResponse, SprintBoardIssue, YouTrackSprint } from '@/services/api'
import { useWorkflowConfig } from '@/hooks/useWorkflowConfig'
import '@/styles/pages/sprint-radar.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const DONE_ROLES = new Set(['dev_done', 'verified', 'deployed', 'closed'])
const SLA_HOURS: Record<number, number> = { 1: 1, 2: 24 }

// ── Pure helpers ──────────────────────────────────────────────────────────────

function classifyTier(priority: string, issueType: string, isHotfix: boolean): number {
  if (isHotfix) return 1
  const p = priority.toLowerCase()
  if (p === 'p0' || p === 'a0' || p === 'critical') return 1
  const t = issueType.toLowerCase()
  if (t === 'regression' || t.includes('regression')) return 0
  if (p === 'p1' || p === 'a1' || p === 'major') return 2
  if (p === 'p2' || p === 'a2') return 3
  return 4
}

function priorityDotColor(priority: string, isHotfix: boolean): string {
  if (isHotfix) return 'var(--color-danger)'
  const p = priority.toLowerCase()
  if (p === 'p0' || p === 'a0' || p === 'critical') return 'var(--color-danger)'
  if (p === 'p1' || p === 'a1' || p === 'major') return 'var(--color-warning)'
  if (p === 'p2' || p === 'a2') return 'var(--color-primary)'
  return 'transparent'
}

function fmtH(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  const d = Math.floor(h / 24)
  const hr = h % 24
  if (d > 0) return `${d}d ${Math.floor(hr)}h`
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

function fmtAge(h: number): string {
  if (h < 24) return `${Math.floor(h)}h`
  return `${Math.floor(h / 24)}d`
}

function ageClass(h: number): string {
  if (h > 7 * 24) return 'sp-age-red'
  if (h > 3 * 24) return 'sp-age-amber'
  return 'sp-age-green'
}

function slaBreach(tier: number, h: number): boolean {
  return SLA_HOURS[tier] != null && h >= SLA_HOURS[tier]
}

function slaRatio(tier: number, h: number): number {
  return SLA_HOURS[tier] != null ? Math.min(h / SLA_HOURS[tier], 1) : 0
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ── Extended issue type ───────────────────────────────────────────────────────

interface PulseIssue extends SprintBoardIssue {
  tier: number
  isDone: boolean
  colRole: string
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PriorityDot({ color }: { color: string }) {
  return <span className="sp-dot" style={{ background: color }} />
}

function AssigneeAvatar({ name }: { name: string }) {
  if (!name) return null
  return <span className="sp-avatar">{initials(name)}</span>
}

function StateChip({ state, role }: { state: string; role: string }) {
  const cls = role === 'active' ? 'sp-state-active'
    : role === 'blocked' ? 'sp-state-blocked'
    : DONE_ROLES.has(role) ? 'sp-state-done'
    : 'sp-state-default'
  return <span className={`sp-state ${cls}`}>{state}</span>
}

function SLABadge({ hours, tier, isDone }: { hours: number; tier: number; isDone: boolean }) {
  if (isDone || !SLA_HOURS[tier]) return null
  const ratio = slaRatio(tier, hours)
  const breached = slaBreach(tier, hours)
  const cls = breached ? 'sp-sla-breach' : ratio > 0.7 ? 'sp-sla-warn' : 'sp-sla-ok'
  return (
    <span className={`sp-sla ${cls}`}>
      <Clock size={9} />
      {fmtH(hours)}{breached && ' ⚠'}
    </span>
  )
}

function TypeBadge({ type, isHotfix }: { type: string; isHotfix: boolean }) {
  if (isHotfix) return <span className="sp-tag sp-tag-hotfix">HOTFIX</span>
  const t = type.toLowerCase()
  if (t === 'regression') return <span className="sp-tag sp-tag-regression">REGRESSION</span>
  if (t === 'bug') return <span className="sp-tag sp-tag-bug">BUG</span>
  return null
}

interface IssueRowProps {
  iss: PulseIssue
  onIdClick: (id: string, e: React.MouseEvent) => void
  onTitleClick: (id: string, e?: React.MouseEvent) => void
}

function IssueRow({ iss, onIdClick, onTitleClick }: IssueRowProps) {
  const dot = priorityDotColor(iss.priority, iss.is_hotfix)
  const breached = !iss.isDone && slaBreach(iss.tier, iss.hours_in_state)
  return (
    <div className={`sp-issue-row${breached ? ' sp-row-breach' : ''}`}>
      <PriorityDot color={dot} />
      <button className="sp-id" onClick={e => onIdClick(iss.idReadable, e)}>{iss.idReadable}</button>
      <TypeBadge type={iss.issue_type} isHotfix={iss.is_hotfix} />
      <button className="sp-summary" onClick={e => onTitleClick(iss.idReadable, e)}>
        {iss.summary}
      </button>
      <div className="sp-meta">
        <StateChip state={iss.current_state} role={iss.colRole} />
        <AssigneeAvatar name={iss.assignee} />
        <SLABadge hours={iss.hours_in_state} tier={iss.tier} isDone={iss.isDone} />
      </div>
    </div>
  )
}

interface TierBlockProps {
  title: string
  tier: number
  issues: PulseIssue[]
  defaultOpen?: boolean
  onIdClick: (id: string, e: React.MouseEvent) => void
  onTitleClick: (id: string, e?: React.MouseEvent) => void
}

function TierBlock({ title, tier, issues, defaultOpen = true, onIdClick, onTitleClick }: TierBlockProps) {
  const [open, setOpen] = useState(defaultOpen)
  const active = issues.filter(i => !i.isDone)
  const done = issues.filter(i => i.isDone)
  const breached = active.filter(i => slaBreach(tier, i.hours_in_state))
  const borderCls = tier === 1 ? 'sp-t1' : tier === 2 ? 'sp-t2' : tier === 3 ? 'sp-t3' : 'sp-t4'

  return (
    <div className={`sp-tier ${borderCls}`}>
      <button className="sp-tier-hd" onClick={() => setOpen(o => !o)}>
        <span className="sp-tier-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        <span className="sp-tier-name">{title}</span>
        <span className="sp-tier-active">{active.length} active</span>
        {done.length > 0 && <span className="sp-tier-done">{done.length} done</span>}
        {breached.length > 0 && <span className="sp-tier-breach">{breached.length} ⚠ SLA</span>}
      </button>
      {open && (
        <div className="sp-tier-body">
          {issues.length === 0
            ? <p className="sp-empty">No issues in this tier</p>
            : issues.map(i => <IssueRow key={i.idReadable} iss={i} onIdClick={onIdClick} onTitleClick={onTitleClick} />)
          }
        </div>
      )}
    </div>
  )
}

function HealthBar({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="sp-hbar">
      <span className="sp-hbar-label">{label}</span>
      <div className="sp-hbar-track">
        <div className="sp-hbar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sp-hbar-frac" style={{ color }}>{done}<span className="sp-hbar-sep">/</span>{total}</span>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────

export interface SprintPulseViewProps {
  activeSprint: YouTrackSprint | null
  boardData: SprintBoardStatusResponse | null
  boardLoading: boolean
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
}

export function SprintPulseView({ activeSprint, boardData, boardLoading, onTitleClick, onIdClick }: SprintPulseViewProps) {
  const { config: wfConfig } = useWorkflowConfig()
  const [regOpen, setRegOpen] = useState(true)
  const [t4Open, setT4Open] = useState(false)

  // Build role lookup from workflow config
  const roleMap = useMemo(() => {
    const m = new Map<string, string>()
    wfConfig?.column_hierarchy?.forEach(col => {
      m.set(col.state.toLowerCase(), col.role)
      col.aliases?.forEach(a => m.set(a.toLowerCase(), col.role))
    })
    return m
  }, [wfConfig])

  // Build PulseIssue list from board data
  const allIssues = useMemo((): PulseIssue[] => {
    if (!boardData) return []
    const out: PulseIssue[] = []
    for (const col of boardData.columns) {
      const colRole = roleMap.get(col.name.toLowerCase()) ?? ''
      const isDone = DONE_ROLES.has(colRole)
      for (const iss of col.issues) {
        out.push({ ...iss, tier: classifyTier(iss.priority, iss.issue_type, iss.is_hotfix), isDone, colRole })
      }
    }
    return out
  }, [boardData, roleMap])

  const tier1 = useMemo(() => allIssues.filter(i => i.tier === 1), [allIssues])
  const tier2 = useMemo(() => allIssues.filter(i => i.tier === 2), [allIssues])
  const tier3 = useMemo(() => allIssues.filter(i => i.tier === 3), [allIssues])
  const tier4 = useMemo(() => allIssues.filter(i => i.tier === 4), [allIssues])
  const regs  = useMemo(() => allIssues.filter(i => i.tier === 0).sort((a, b) => b.hours_in_state - a.hours_in_state), [allIssues])

  const totalDone = allIssues.filter(i => i.isDone).length
  const totalAll  = allIssues.length
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0

  const t1Breached = tier1.filter(i => !i.isDone && slaBreach(1, i.hours_in_state))
  const t2Breached = tier2.filter(i => !i.isDone && slaBreach(2, i.hours_in_state))
  const atRisk = allIssues.filter(i => i.is_delayed && !i.isDone)

  if (!activeSprint) {
    return (
      <div className="sp-no-sprint">
        <Zap size={28} />
        <p>Select a sprint to view Sprint Pulse</p>
      </div>
    )
  }

  if (boardLoading || !boardData) {
    return (
      <div className="sp-loading">
        <div className="sp-spinner" />
        Loading Sprint Pulse — {activeSprint.name}…
      </div>
    )
  }

  return (
    <div className="sp-page">

      {/* ── Status strip ─────────────────────────────── */}
      <div className="sp-strip">
        <div className="sp-strip-left">
          {t1Breached.length > 0 && (
            <span className="sp-pill sp-pill-crit"><AlertTriangle size={12} /> {t1Breached.length} CRITICAL SLA breached</span>
          )}
          {t2Breached.length > 0 && (
            <span className="sp-pill sp-pill-urg"><AlertCircle size={12} /> {t2Breached.length} urgent SLA stalled</span>
          )}
          {t1Breached.length === 0 && t2Breached.length === 0 && (
            <span className="sp-pill sp-pill-ok"><CheckCircle2 size={12} /> All SLAs on track</span>
          )}
          {atRisk.length > 0 && (
            <span className="sp-pill sp-pill-delay"><AlertTriangle size={12} /> {atRisk.length} delayed</span>
          )}
        </div>
        <div className="sp-strip-right">
          <span className="sp-sprint-name">{activeSprint.name}</span>
          <span className="sp-pct">{pct}% done</span>
          <span className="sp-total">{totalDone}/{totalAll}</span>
        </div>
      </div>

      {/* ── Main grid ─────────────────────────────────── */}
      <div className="sp-grid">

        {/* Left: tiers */}
        <div className="sp-tiers">
          <TierBlock title="CRITICAL / HOTFIX" tier={1} issues={tier1} defaultOpen onIdClick={onIdClick} onTitleClick={onTitleClick} />
          <TierBlock title="URGENT" tier={2} issues={tier2} defaultOpen onIdClick={onIdClick} onTitleClick={onTitleClick} />
          <TierBlock title="SCHEDULED" tier={3} issues={tier3} defaultOpen={false} onIdClick={onIdClick} onTitleClick={onTitleClick} />

          {/* Tier 4 — collapsed by default */}
          <div className="sp-tier sp-t4">
            <button className="sp-tier-hd" onClick={() => setT4Open(o => !o)}>
              <span className="sp-tier-chevron">{t4Open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              <span className="sp-tier-name">NORMAL</span>
              <span className="sp-tier-active">{tier4.filter(i => !i.isDone).length} active</span>
              <span className="sp-tier-done">{tier4.filter(i => i.isDone).length} done</span>
            </button>
            {t4Open && (
              <div className="sp-tier-body">
                {tier4.map(i => <IssueRow key={i.idReadable} iss={i} onIdClick={onIdClick} onTitleClick={onTitleClick} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right: health panel */}
        <div className="sp-panel">
          <div className="sp-card">
            <div className="sp-card-title">Sprint Health</div>
            <div className="sp-hbars">
              <HealthBar
                label="Critical"
                done={tier1.filter(i => i.isDone).length}
                total={tier1.length}
                color="var(--color-danger)"
              />
              <HealthBar
                label="Urgent"
                done={tier2.filter(i => i.isDone).length}
                total={tier2.length}
                color="var(--color-warning)"
              />
              <HealthBar
                label="Normal"
                done={tier4.filter(i => i.isDone).length}
                total={tier4.length}
                color="var(--color-success)"
              />
            </div>
            <div className="sp-health-footer">
              <span className="sp-health-label">{totalDone} / {totalAll} delivered</span>
              <span className="sp-health-pct">{pct}%</span>
            </div>
          </div>

          {atRisk.length > 0 && (
            <div className="sp-card sp-card-risk">
              <div className="sp-card-title">⚠ Delayed</div>
              <div className="sp-risk-list">
                {atRisk.slice(0, 8).map(i => (
                  <button key={i.idReadable} className="sp-risk-id" onClick={e => onIdClick(i.idReadable, e)}>
                    {i.idReadable}
                  </button>
                ))}
                {atRisk.length > 8 && <span className="sp-risk-more">+{atRisk.length - 8} more</span>}
              </div>
            </div>
          )}

          <div className="sp-card">
            <div className="sp-card-title">Breakdown</div>
            {([
              { label: 'Critical / Hotfix', n: tier1.length, color: 'var(--color-danger)' },
              { label: 'Urgent (P1/A1)',    n: tier2.length, color: 'var(--color-warning)' },
              { label: 'Scheduled (P2/A2)', n: tier3.length, color: 'var(--color-primary)' },
              { label: 'Normal',            n: tier4.length, color: 'var(--text-muted)' },
              { label: 'Regressions',       n: regs.length,  color: 'var(--color-warning)' },
            ] as const).map(r => (
              <div key={r.label} className="sp-bk-row">
                <span className="sp-bk-dot" style={{ background: r.color }} />
                <span className="sp-bk-label">{r.label}</span>
                <span className="sp-bk-n">{r.n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Regressions ──────────────────────────────── */}
      <div className="sp-reg-wrap">
        <button className="sp-reg-hd" onClick={() => setRegOpen(o => !o)}>
          {regOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="sp-reg-title">REGRESSIONS</span>
          <span className="sp-tier-active">{regs.filter(i => !i.isDone).length} active</span>
          {regs.filter(i => i.isDone).length > 0 && (
            <span className="sp-tier-done">{regs.filter(i => i.isDone).length} done</span>
          )}
          <span className="sp-reg-sub">sorted by age — oldest first</span>
        </button>
        {regOpen && (
          <div className="sp-tier-body">
            {regs.length === 0 ? (
              <p className="sp-empty">No regressions in this sprint</p>
            ) : (
              <>
                <div className="sp-reg-cols">
                  <span>ID</span><span>Age</span><span>State</span>
                  <span>Assignee</span><span>Priority</span><span>Summary</span>
                </div>
                {regs.map(i => (
                  <div key={i.idReadable} className="sp-reg-row">
                    <button className="sp-id" onClick={e => onIdClick(i.idReadable, e)}>{i.idReadable}</button>
                    <span className={`sp-reg-age ${ageClass(i.hours_in_state)}`}>{fmtAge(i.hours_in_state)}</span>
                    <StateChip state={i.current_state} role={i.colRole} />
                    {i.assignee ? <AssigneeAvatar name={i.assignee} /> : <span className="sp-assignee-none">—</span>}
                    <span className="sp-priority-tag">{i.priority || '—'}</span>
                    <button className="sp-summary" onClick={e => onTitleClick(i.idReadable, e)}>{i.summary}</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
