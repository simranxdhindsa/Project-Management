import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown, Check, RefreshCw, GitBranch,
  BarChart2, Zap, Target, Activity,
} from 'lucide-react'
import api from '@/services/api'
import type {
  YouTrackSprint, SprintBoardIssue, SprintBoardColumn,
  SprintSummary, SprintBoardStatusResponse, YouTrackIssue,
} from '@/services/api'
import { IssueDetailPanel } from '@/components/IssueDetailPanel'
import '../styles/pages/dashboard.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const SPRINT_ID_KEY   = 'pm_active_sprint_id'
const SPRINT_NAME_KEY = 'pm_active_sprint_name'

type DesignMode = 'velocity' | 'bento' | 'ops'

const DESIGN_MODES: { id: DesignMode; label: string; icon: typeof Activity }[] = [
  { id: 'velocity', label: 'Velocity',    icon: Activity },
  { id: 'bento',   label: 'Bento Grid',  icon: BarChart2 },
  { id: 'ops',     label: 'Ops Command', icon: Zap },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSprintDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtHours(hours: number): string {
  if (!hours || hours <= 0) return '—'
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  if (d > 0 && h > 0) return `${d}d ${h}h`
  if (d > 0) return `${d}d`
  return `${h}h`
}

function fmtCountdown(finishMs: number): string {
  const diff = finishMs - Date.now()
  if (diff < 0) return 'OVERDUE'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
}

/** Backend sends completion_pct as a 0–100 float; round to integer for display */
function toPct(raw: number): number {
  return Math.round(raw ?? 0)
}

function getPriClass(priority: string): string {
  const p = (priority || '').toLowerCase()
  if (p === 'a1' || p === 'p0' || p === 'critical') return 'db-pri--critical'
  if (p === 'a2' || p === 'p1' || p === 'high')     return 'db-pri--high'
  if (p === 'a3' || p === 'p2' || p === 'medium' || p === 'normal') return 'db-pri--medium'
  return 'db-pri--low'
}

function urgencyClass(iss: SprintBoardIssue): string {
  if (iss.overdue_level === 'deadline') return 'db-urgency--deadline'
  if (iss.overdue_level === 'sprint' || iss.overdue_level === 'sla') return 'db-urgency--risk'
  if (iss.bounce_count > 0) return 'db-urgency--bounced'
  return ''
}

function urgencyScore(iss: SprintBoardIssue): number {
  if (iss.overdue_level === 'deadline') return 4
  if (iss.overdue_level === 'sprint')   return 3
  if (iss.overdue_level === 'sla')      return 2
  if (iss.is_delayed)                   return 1.5
  if (iss.bounce_count > 0)             return 1
  return 0
}

function isBlockedCol(name: string): boolean {
  return (name || '').toLowerCase().includes('block')
}
function isProgressCol(name: string): boolean {
  return (name || '').toLowerCase().includes('progress')
}
function isDoneCol(name: string): boolean {
  const n = (name || '').toLowerCase()
  return n.includes('done') || n.includes('clos') || n.includes('deploy') ||
         n.includes('verif') || n.includes('prod') || n.includes('stage')
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

function DBAvatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  if (url) {
    return (
      <img
        src={url} alt={name}
        className="db-avatar"
        style={{ width: size, height: size }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div
      className="db-avatar db-avatar--initials"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </div>
  )
}

function PriPill({ priority }: { priority: string }) {
  return <span className={`db-pri-pill ${getPriClass(priority)}`}>{priority || '?'}</span>
}

function VerifBadges({ dev, stg, prd }: { dev?: string; stg?: string; prd?: string }) {
  if (!dev && !stg && !prd) return null
  return (
    <div className="db-verif-badges">
      {dev && <span className="db-verif-badge db-verif-badge--dev" title={`DEV: ${dev}`}>DEV✓</span>}
      {stg && <span className="db-verif-badge db-verif-badge--stg" title={`STG: ${stg}`}>STG✓</span>}
      {prd && <span className="db-verif-badge db-verif-badge--prd" title={`PRD: ${prd}`}>PRD✓</span>}
    </div>
  )
}

function KpiChip({ label, value, cls }: { label: string; value: number | string; cls?: string }) {
  return (
    <div className={`db-kpi-chip${cls ? ` ${cls}` : ''}`}>
      <span className="db-kpi-chip-val">{value}</span>
      <span className="db-kpi-chip-label">{label}</span>
    </div>
  )
}

function SprintTrack({ pct }: { pct: number }) {
  return (
    <div className="db-sprint-track">
      <div className="db-sprint-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function Countdown({ finishMs }: { finishMs: number }) {
  if (!finishMs) return null
  const label = fmtCountdown(finishMs)
  const overdue = Date.now() > finishMs
  const urgent  = !overdue && finishMs - Date.now() < 86400000 * 2
  return (
    <span className={`db-countdown${overdue ? ' db-countdown--overdue' : urgent ? ' db-countdown--urgent' : ''}`}>
      {overdue ? '⚠ ' : '⏱ '}{label}
    </span>
  )
}

// ─── KPI Summary Bar (shared across all views) ────────────────────────────────

function KpiBar({ summary }: { summary: SprintSummary }) {
  const pct = toPct(summary.completion_pct)
  const isOverdue = summary.sprint_finish_ms > 0 && Date.now() > summary.sprint_finish_ms
  const isUrgent  = !isOverdue && summary.sprint_finish_ms > 0 &&
                    summary.sprint_finish_ms - Date.now() < 86400000 * 2
  return (
    <div className="db-kpi-bar">
      <div className="db-kpi-bar-item db-kpi-bar-item--primary">
        <span className="db-kpi-bar-val">{summary.done_issues}/{summary.total_issues}</span>
        <span className="db-kpi-bar-label">Done</span>
        <div className="db-kpi-bar-track">
          <div className="db-kpi-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="db-kpi-bar-pct">{pct}%</span>
      </div>

      <div className="db-kpi-bar-sep" />

      <div className={`db-kpi-bar-item${summary.blocked_count > 0 ? ' db-kpi-bar-item--danger' : ''}`}>
        <span className="db-kpi-bar-val">{summary.blocked_count}</span>
        <span className="db-kpi-bar-label">Blocked</span>
      </div>

      <div className={`db-kpi-bar-item${summary.bounced_count > 0 ? ' db-kpi-bar-item--warn' : ''}`}>
        <span className="db-kpi-bar-val">{summary.bounced_count}</span>
        <span className="db-kpi-bar-label">Bounced</span>
      </div>

      <div className={`db-kpi-bar-item${summary.overdue_count > 0 ? ' db-kpi-bar-item--danger' : ''}`}>
        <span className="db-kpi-bar-val">{summary.overdue_count}</span>
        <span className="db-kpi-bar-label">Overdue</span>
      </div>

      <div className="db-kpi-bar-item db-kpi-bar-item--info">
        <span className="db-kpi-bar-val">{summary.in_progress_count}</span>
        <span className="db-kpi-bar-label">In Progress</span>
      </div>

      {summary.hotfix_count > 0 && (
        <div className="db-kpi-bar-item db-kpi-bar-item--hotfix">
          <span className="db-kpi-bar-val">{summary.hotfix_count}</span>
          <span className="db-kpi-bar-label">Hotfixes</span>
        </div>
      )}

      {summary.sprint_finish_ms > 0 && (
        <>
          <div className="db-kpi-bar-sep" />
          <div className={`db-kpi-bar-item${isOverdue ? ' db-kpi-bar-item--danger' : isUrgent ? ' db-kpi-bar-item--warn' : ''}`}>
            <span className="db-kpi-bar-val">{fmtCountdown(summary.sprint_finish_ms)}</span>
            <span className="db-kpi-bar-label">Sprint ends</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Skeleton Loaders ─────────────────────────────────────────────────────────

function SkeletonBar({ w, h = 10, radius = 4 }: { w: string | number; h?: number; radius?: number }) {
  return (
    <div
      className="skeleton"
      style={{ width: w, height: h, borderRadius: radius, flexShrink: 0 }}
    />
  )
}

function SkeletonKpiBar() {
  return (
    <div className="db-kpi-bar db-kpi-bar--skeleton">
      {[80, 60, 60, 60, 70, 90].map((w, i) => (
        <div key={i} className="db-kpi-bar-item">
          <SkeletonBar w={w} h={18} />
          <SkeletonBar w={40} h={9} />
        </div>
      ))}
    </div>
  )
}

function SkeletonVelocity() {
  return (
    <div className="db-mc-layout">
      <div className="db-mc-col db-mc-col--left">
        <SkeletonBar w="60%" h={11} />
        {[1,2,3,4].map(i => (
          <div key={i} className="db-mc-dev-card" style={{ gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <SkeletonBar w={26} h={26} radius={99} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <SkeletonBar w="50%" h={10} />
                <SkeletonBar w="70%" h={8} />
              </div>
            </div>
            <SkeletonBar w="100%" h={6} radius={99} />
          </div>
        ))}
      </div>
      <div className="db-mc-col db-mc-col--center">
        <SkeletonBar w="50%" h={11} />
        {[1,2,3].map(i => (
          <div key={i} className="db-mc-focus-card" style={{ gap: 7 }}>
            <SkeletonBar w="80%" h={10} />
            <SkeletonBar w="100%" h={12} />
            <SkeletonBar w="60%" h={8} />
          </div>
        ))}
      </div>
      <div className="db-mc-col db-mc-col--right">
        <SkeletonBar w="60%" h={11} />
        <div className="db-mc-kpi-grid">
          {[1,2,3,4].map(i => <div key={i} className="db-kpi-chip"><SkeletonBar w="100%" h={36} /></div>)}
        </div>
        <SkeletonBar w="100%" h={8} radius={99} />
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '5px 0' }}>
            <SkeletonBar w="40%" h={9} />
            <SkeletonBar w="40%" h={6} radius={99} />
            <SkeletonBar w={20} h={9} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonBento() {
  return (
    <div className="db-bg-layout">
      <div className="db-bg-row db-bg-row--r1">
        {[1,2].map(i => (
          <div key={i} className="db-bg-card">
            <div className="db-bg-topline skeleton" style={{ animation: 'none', opacity: 0.3 }} />
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SkeletonBar w="50%" h={11} />
              <SkeletonBar w="80%" h={34} />
              <SkeletonBar w="100%" h={8} radius={99} />
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4].map(j => <div key={j} className="db-kpi-chip"><SkeletonBar w="100%" h={36} /></div>)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="db-bg-row db-bg-row--r2">
        {[1,2].map(i => (
          <div key={i} className="db-bg-card">
            <div className="db-bg-topline skeleton" style={{ animation: 'none', opacity: 0.3 }} />
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SkeletonBar w="50%" h={11} />
              {[1,2,3,4].map(j => (
                <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SkeletonBar w={22} h={22} radius={99} />
                  <SkeletonBar w="60%" h={9} />
                  <SkeletonBar w="30%" h={6} radius={99} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="db-bg-row db-bg-row--r3">
        <div className="db-bg-card" style={{ gridColumn: '1/-1' }}>
          <div className="db-bg-topline skeleton" style={{ animation: 'none', opacity: 0.3 }} />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <SkeletonBar w="30%" h={11} />
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <SkeletonBar w={60} h={9} />
                <SkeletonBar w={30} h={9} />
                <SkeletonBar w="40%" h={9} />
                <SkeletonBar w="15%" h={9} />
                <SkeletonBar w="10%" h={9} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SkeletonOps() {
  return (
    <div className="db-oc-layout">
      <div className="db-oc-left">
        {[1,2,3].map(i => (
          <div key={i} className="db-oc-panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonBar w="70%" h={11} />
            <SkeletonBar w="100%" h={8} radius={99} />
            <SkeletonBar w="50%" h={16} />
          </div>
        ))}
        <div className="db-oc-panel-section db-oc-kpi-grid">
          {[1,2,3,4].map(i => <div key={i} className="db-kpi-chip"><SkeletonBar w="100%" h={36} /></div>)}
        </div>
        <div className="db-oc-panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <SkeletonBar w={22} h={22} radius={99} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SkeletonBar w="50%" h={9} />
                <SkeletonBar w="80%" h={5} radius={99} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="db-oc-right">
        <div className="db-oc-feed">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="db-oc-feed-row" style={{ padding: '10px 16px', gap: 10 }}>
              <div className="db-oc-feed-left-bar skeleton" style={{ opacity: 0.2 }} />
              <div className="db-oc-feed-content" style={{ gap: 6 }}>
                <SkeletonBar w="30%" h={9} />
                <SkeletonBar w="70%" h={11} />
                <SkeletonBar w="40%" h={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Design 1: Velocity ───────────────────────────────────────────────────────

interface DevStat {
  name: string; avatarUrl: string
  active: SprintBoardIssue[]; blocked: SprintBoardIssue[]; done: SprintBoardIssue[]
  bounceCount: number; totalActiveHours: number
}

interface DesignProps {
  summary: SprintSummary
  columns: SprintBoardColumn[]
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
  ytDetailLoading?: boolean
}

function Design1({ summary, columns, onTitleClick, onIdClick, ytDetailLoading }: DesignProps) {
  const [expandedDev, setExpandedDev] = useState<string | null>(null)

  const developers = useMemo<DevStat[]>(() => {
    const map = new Map<string, DevStat>()
    columns.forEach(col => col.issues.forEach(iss => {
      const key = iss.assignee || 'Unassigned'
      if (!map.has(key)) map.set(key, {
        name: key, avatarUrl: iss.avatarUrl,
        active: [], blocked: [], done: [], bounceCount: 0, totalActiveHours: 0,
      })
      const d = map.get(key)!
      d.bounceCount += iss.bounce_count
      d.totalActiveHours += iss.total_active_hours
      if (isBlockedCol(col.name))       d.blocked.push(iss)
      else if (isDoneCol(col.name))     d.done.push(iss)
      else                              d.active.push(iss)
    }))
    return Array.from(map.values()).sort((a, b) => b.active.length - a.active.length)
  }, [columns])

  const atRisk = useMemo(() =>
    columns.flatMap(c => c.issues)
      .filter(i => urgencyScore(i) > 0)
      .sort((a, b) => urgencyScore(b) - urgencyScore(a))
      .slice(0, 5)
  , [columns])

  const delayRows = useMemo(() =>
    columns.filter(c => isProgressCol(c.name))
      .flatMap(c => c.issues)
      .sort((a, b) => b.cycle_time_hours - a.cycle_time_hours)
      .slice(0, 5)
  , [columns])

  const barW = 220
  function barSegs(iss: SprintBoardIssue) {
    const scale = barW / (10 * 24)
    const workPx   = Math.min(barW, iss.total_active_hours * scale)
    const bouncePx = Math.min(barW - workPx, iss.bounce_count * 0.5 * 24 * scale)
    const idlePx   = Math.max(0, Math.min(barW - workPx - bouncePx,
      (iss.cycle_time_hours - iss.total_active_hours) * scale))
    return { workPx, bouncePx, idlePx }
  }

  return (
    <div className="db-mc-layout">
      {/* ── Left: Developer Load ── */}
      <div className="db-mc-col db-mc-col--left">
        <div className="db-mc-section-label">Developer Load</div>
        {developers.map(dev => {
          const total = dev.active.length + dev.blocked.length + dev.done.length
          return (
            <div key={dev.name} className="db-mc-dev-card">
              <div
                className="db-mc-dev-header"
                onClick={() => setExpandedDev(expandedDev === dev.name ? null : dev.name)}
              >
                <DBAvatar name={dev.name} url={dev.avatarUrl} size={26} />
                <div className="db-mc-dev-info">
                  <span className="db-mc-dev-name">{dev.name.split(' ')[0]}</span>
                  <span className="db-mc-dev-meta">
                    {dev.active.length} active
                    {dev.blocked.length > 0 && <span className="db-mc-dev-blocked"> · {dev.blocked.length} blocked</span>}
                    {dev.bounceCount > 0    && <span className="db-mc-dev-bounced"> · ↩{dev.bounceCount}</span>}
                  </span>
                </div>
                <span className="db-mc-dev-hours">{fmtHours(dev.totalActiveHours)}</span>
              </div>
              {total > 0 && (
                <div className="db-mc-load-bar">
                  <div className="db-mc-load-seg db-mc-load-seg--active"  style={{ width: `${(dev.active.length  / total) * 100}%` }} />
                  <div className="db-mc-load-seg db-mc-load-seg--blocked" style={{ width: `${(dev.blocked.length / total) * 100}%` }} />
                  <div className="db-mc-load-seg db-mc-load-seg--done"    style={{ width: `${(dev.done.length    / total) * 100}%` }} />
                </div>
              )}
              {expandedDev === dev.name && (
                <div className="db-mc-dev-tickets">
                  {[...dev.active, ...dev.blocked].map(iss => (
                    <div key={iss.idReadable} className={`db-mc-ticket-row ${urgencyClass(iss)}`}>
                      <PriPill priority={iss.priority} />
                      <span
                        className="db-ticket-id db-ticket-id--link"
                        onClick={(e) => onIdClick(iss.idReadable, e)}
                        title={`Open ${iss.idReadable} in YouTrack`}
                      >{iss.idReadable}</span>
                      <span
                        className="db-mc-ticket-title db-ticket-title--link"
                        onClick={(e) => onTitleClick(iss.idReadable, e)}
                        title={iss.summary}
                      >{iss.summary}</span>
                      <span className="db-mc-ticket-time">{fmtHours(iss.hours_in_state)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Center: At Risk + Delay Bars ── */}
      <div className="db-mc-col db-mc-col--center">
        <div>
          <div className="db-mc-section-label">
            At Risk
            {atRisk.length > 0 && <span className="db-mc-section-count">{atRisk.length}</span>}
          </div>
          {atRisk.slice(0, 4).map(iss => (
            <div key={iss.idReadable} className={`db-mc-focus-card ${urgencyClass(iss)}`}>
              <div className="db-mc-focus-top">
                <PriPill priority={iss.priority} />
                <span
                  className="db-ticket-id db-ticket-id--link"
                  onClick={(e) => onIdClick(iss.idReadable, e)}
                  title={`Open ${iss.idReadable} in YouTrack`}
                >{iss.idReadable}</span>
                {iss.is_hotfix && <span className="db-hotfix-chip">HF</span>}
                {iss.bounce_count > 0 && <span className="db-bounce-chip">↩{iss.bounce_count}</span>}
                <span className="db-ticket-state" style={{ marginLeft: 'auto' }}>{iss.current_state}</span>
              </div>
              <div
                className="db-mc-focus-title db-ticket-title--link"
                onClick={(e) => onTitleClick(iss.idReadable, e)}
              >{iss.summary}</div>
              <div className="db-mc-focus-footer">
                <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={16} />
                <span className="db-mc-focus-assignee">{iss.assignee?.split(' ')[0] || 'Unassigned'}</span>
                <span
                  className="db-mc-focus-time"
                  style={{ color: iss.overdue_level === 'deadline' ? 'var(--color-danger)' : undefined }}
                >
                  {fmtHours(iss.hours_in_state)} in state
                </span>
                <VerifBadges dev={iss.verified_on_dev} stg={iss.verified_on_stage} prd={iss.verified_on_prod} />
              </div>
            </div>
          ))}
          {atRisk.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-success)', padding: '8px 0' }}>
              ✓ No at-risk tickets
            </div>
          )}
        </div>

        {delayRows.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="db-mc-section-label">Delay Analysis</div>
            <div className="db-mc-delay-legend">
              <span className="db-mc-legend-item db-mc-legend-work">Work</span>
              <span className="db-mc-legend-item db-mc-legend-bounce">Bounce</span>
              <span className="db-mc-legend-item db-mc-legend-idle">Idle</span>
            </div>
            {delayRows.map(iss => {
              const { workPx, bouncePx, idlePx } = barSegs(iss)
              return (
                <div key={iss.idReadable} className="db-mc-delay-row">
                  <div className="db-mc-delay-id">
                    <PriPill priority={iss.priority} />
                    <span
                      className="db-ticket-id db-ticket-id--link"
                      onClick={(e) => onIdClick(iss.idReadable, e)}
                      title={`Open ${iss.idReadable} in YouTrack`}
                    >{iss.idReadable}</span>
                  </div>
                  <div className="db-mc-delay-bar-wrap">
                    <div className="db-mc-timebar" style={{ width: barW }}>
                      <div className="db-mc-tb-seg db-mc-tb-seg--work"   style={{ width: workPx }} />
                      <div className="db-mc-tb-seg db-mc-tb-seg--bounce" style={{ width: bouncePx, left: workPx }} />
                      <div className="db-mc-tb-seg db-mc-tb-seg--idle"   style={{ width: idlePx,   left: workPx + bouncePx }} />
                    </div>
                    <span className="db-mc-delay-time">{fmtHours(iss.cycle_time_hours)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Right: Sprint Health + Column Breakdown ── */}
      <div className="db-mc-col db-mc-col--right">
        <div className="db-mc-section-label">Sprint Health</div>
        <div className="db-mc-kpi-grid">
          <KpiChip label="Done"     value={`${summary.done_issues}/${summary.total_issues}`} cls="db-kpi-chip--success" />
          <KpiChip label="Blocked"  value={summary.blocked_count}  cls="db-kpi-chip--danger" />
          <KpiChip label="Bounced"  value={summary.bounced_count}  cls="db-kpi-chip--warn" />
          <KpiChip label="Overdue"  value={summary.overdue_count}  cls="db-kpi-chip--danger" />
        </div>
        <SprintTrack pct={toPct(summary.completion_pct)} />
        {summary.sprint_finish_ms > 0 && <Countdown finishMs={summary.sprint_finish_ms} />}

        <div className="db-mc-section-label" style={{ marginTop: 16 }}>By Column</div>
        {columns.map(col => (
          <div key={col.name} className="db-mc-col-row">
            <span className="db-mc-col-name" title={col.name}>{col.name}</span>
            <div className="db-mc-col-bar-track">
              <div
                className="db-mc-col-bar-fill"
                style={{
                  width: `${summary.total_issues ? (col.total / summary.total_issues) * 100 : 0}%`,
                  background: isBlockedCol(col.name)  ? 'var(--color-danger)'
                            : isProgressCol(col.name) ? 'var(--color-primary)'
                            : isDoneCol(col.name)      ? 'var(--color-success)'
                            : 'var(--text-faint)',
                }}
              />
            </div>
            <span className="db-mc-col-cnt">{col.total}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Design 2: Bento Intelligence Grid ───────────────────────────────────────

function SprintDonut({ pct, size = 110 }: { pct: number; size?: number }) {
  const r = (size - 16) / 2
  const cx = size / 2; const cy = size / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--glass-border)" strokeWidth={10} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke="var(--color-primary)" strokeWidth={10}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  )
}

function Design2({ summary, columns, onTitleClick, onIdClick }: DesignProps) {
  const allIssues = useMemo(() => columns.flatMap(c => c.issues), [columns])
  const pct = toPct(summary.completion_pct)

  const criticalIssues = useMemo(() =>
    [...allIssues].sort((a, b) => urgencyScore(b) - urgencyScore(a)).slice(0, 4)
  , [allIssues])

  const developers = useMemo(() => {
    const map = new Map<string, { name: string; url: string; active: number; blocked: number; done: number; hours: number }>()
    columns.forEach(col => col.issues.forEach(iss => {
      const key = iss.assignee || 'Unassigned'
      if (!map.has(key)) map.set(key, { name: key, url: iss.avatarUrl, active: 0, blocked: 0, done: 0, hours: 0 })
      const d = map.get(key)!
      d.hours += iss.total_active_hours
      if (isBlockedCol(col.name))       d.blocked++
      else if (isDoneCol(col.name))     d.done++
      else                              d.active++
    }))
    return Array.from(map.values())
  }, [columns])

  return (
    <div className="db-bg-layout">
      {/* Row 1: Sprint Health (2/3) + Column Distribution (1/3) */}
      <div className="db-bg-row db-bg-row--r1">
        <div className="db-bg-card db-bg-card--health">
          <div className="db-bg-topline db-bg-topline--indigo" />
          <div className="db-bg-health-inner">
            <div className="db-bg-donut-wrap">
              <SprintDonut pct={pct} size={110} />
              <div className="db-bg-donut-center">
                <span className="db-bg-donut-pct">{pct}%</span>
                <span className="db-bg-donut-label">DONE</span>
              </div>
            </div>
            <div className="db-bg-health-right">
              <span className="db-bg-health-count">{summary.done_issues} / {summary.total_issues} issues</span>
              {summary.sprint_finish_ms > 0 && <Countdown finishMs={summary.sprint_finish_ms} />}
              <SprintTrack pct={pct} />
              <div className="db-bg-kpi-row">
                <KpiChip label="Blocked"  value={summary.blocked_count}  cls="db-kpi-chip--danger" />
                <KpiChip label="Bounced"  value={summary.bounced_count}  cls="db-kpi-chip--warn" />
                <KpiChip label="Overdue"  value={summary.overdue_count}  cls="db-kpi-chip--danger" />
                <KpiChip label="Hotfixes" value={summary.hotfix_count}   cls="db-kpi-chip--info" />
              </div>
            </div>
          </div>
        </div>

        <div className="db-bg-card">
          <div className="db-bg-topline db-bg-topline--violet" />
          <div className="db-bg-card-label">By Column</div>
          <div className="db-bg-col-bars">
            {columns.map(col => (
              <div key={col.name} className="db-bg-col-bar-row">
                <span className="db-bg-col-bar-name" title={col.name}>{col.name}</span>
                <div className="db-bg-col-bar-track">
                  <div
                    className="db-bg-col-bar-fill"
                    style={{
                      width: `${summary.total_issues ? (col.total / summary.total_issues) * 100 : 0}%`,
                      background: isBlockedCol(col.name)  ? 'var(--color-danger)'
                                : isProgressCol(col.name) ? 'var(--color-primary)'
                                : isDoneCol(col.name)      ? 'var(--color-success)'
                                : 'var(--text-faint)',
                    }}
                  />
                </div>
                <span className="db-bg-col-bar-cnt">{col.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Critical Issues (1/2) + Developer Load (1/2) */}
      <div className="db-bg-row db-bg-row--r2">
        <div className="db-bg-card">
          <div className="db-bg-topline db-bg-topline--danger" />
          <div className="db-bg-card-label">
            Critical Issues
            {criticalIssues.length > 0 && <span className="db-bg-card-count">{criticalIssues.length}</span>}
          </div>
          <div className="db-bg-critical-list">
            {criticalIssues.length === 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-success)', padding: '4px 0' }}>✓ No critical issues</div>
            )}
            {criticalIssues.map(iss => (
              <div key={iss.idReadable} className={`db-bg-critical-row ${urgencyClass(iss)}`}>
                <div className="db-bg-cr-top">
                  <PriPill priority={iss.priority} />
                  <span
                    className="db-ticket-id db-ticket-id--link"
                    onClick={(e) => onIdClick(iss.idReadable, e)}
                    title={`Open ${iss.idReadable} in YouTrack`}
                  >{iss.idReadable}</span>
                  {iss.is_hotfix && <span className="db-hotfix-chip">HF</span>}
                  {iss.bounce_count > 0 && <span className="db-bounce-chip">↩{iss.bounce_count}</span>}
                  <span className="db-ticket-state" style={{ marginLeft: 'auto' }}>{iss.current_state}</span>
                </div>
                <div
                  className="db-bg-cr-title db-ticket-title--link"
                  onClick={(e) => onTitleClick(iss.idReadable, e)}
                >{iss.summary}</div>
                <div className="db-bg-cr-footer">
                  <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={16} />
                  <span className="db-bg-cr-assignee">{iss.assignee?.split(' ')[0] || 'Unassigned'}</span>
                  <span
                    className="db-bg-cr-time"
                    style={{ color: iss.overdue_level ? 'var(--color-danger)' : undefined }}
                  >
                    {fmtHours(iss.hours_in_state)}
                  </span>
                  <VerifBadges dev={iss.verified_on_dev} stg={iss.verified_on_stage} prd={iss.verified_on_prod} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="db-bg-card">
          <div className="db-bg-topline db-bg-topline--green" />
          <div className="db-bg-card-label">Developer Load</div>
          <div className="db-bg-dev-list">
            {developers.map(dev => {
              const total = dev.active + dev.blocked + dev.done
              return (
                <div key={dev.name} className="db-bg-dev-row">
                  <DBAvatar name={dev.name} url={dev.url} size={24} />
                  <div className="db-bg-dev-info">
                    <span className="db-bg-dev-name">{dev.name.split(' ')[0]}</span>
                    <div className="db-bg-dev-bar">
                      {total > 0 && <>
                        <div className="db-bg-dev-bar-seg db-bg-dev-bar-seg--active"  style={{ width: `${(dev.active  / total) * 100}%` }} />
                        <div className="db-bg-dev-bar-seg db-bg-dev-bar-seg--blocked" style={{ width: `${(dev.blocked / total) * 100}%` }} />
                        <div className="db-bg-dev-bar-seg db-bg-dev-bar-seg--done"    style={{ width: `${(dev.done    / total) * 100}%` }} />
                      </>}
                    </div>
                  </div>
                  <span className="db-bg-dev-hours">{fmtHours(dev.hours)}</span>
                  <div className="db-bg-dev-chips">
                    <span>{dev.active}</span>
                    {dev.blocked > 0 && <span className="db-bg-dev-chip--blocked">⛔{dev.blocked}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Row 3: All Issues Table */}
      <div className="db-bg-row db-bg-row--r3">
        <div className="db-bg-card" style={{ gridColumn: '1 / -1' }}>
          <div className="db-bg-topline db-bg-topline--indigo" />
          <div className="db-bg-card-label">All Issues</div>
          <div className="db-bg-table-head">
            <span>ID</span><span>Pri</span><span>Title</span><span>State</span>
            <span>Assignee</span><span>Cycle</span><span>In State</span><span>Verified</span>
          </div>
          {[...allIssues]
            .sort((a, b) => urgencyScore(b) - urgencyScore(a))
            .slice(0, 12)
            .map(iss => (
              <div key={iss.idReadable} className={`db-bg-table-row ${urgencyClass(iss)}`}>
                <span
                  className="db-ticket-id db-ticket-id--link"
                  onClick={(e) => onIdClick(iss.idReadable, e)}
                  title={`Open ${iss.idReadable} in YouTrack`}
                >{iss.idReadable}</span>
                <span><PriPill priority={iss.priority} /></span>
                <span
                  className="db-bg-table-title db-ticket-title--link"
                  title={iss.summary}
                  onClick={(e) => onTitleClick(iss.idReadable, e)}
                >{iss.summary}</span>
                <span className="db-bg-table-assignee">{iss.current_state}</span>
                <span className="db-bg-table-assignee">{iss.assignee?.split(' ')[0] || '—'}</span>
                <span className="db-bg-table-num">{fmtHours(iss.cycle_time_hours)}</span>
                <span
                  className="db-bg-table-num"
                  style={{ color: iss.overdue_level ? 'var(--color-danger)' : undefined }}
                >
                  {fmtHours(iss.hours_in_state)}
                </span>
                <span><VerifBadges dev={iss.verified_on_dev} stg={iss.verified_on_stage} prd={iss.verified_on_prod} /></span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

// ─── Design 3: Ops Command + Live Feed ───────────────────────────────────────

function FeedDivider({ label, color }: { label: string; color?: string }) {
  return (
    <div className="db-oc-feed-divider" style={{ color }}>
      {label}
    </div>
  )
}

function Design3({
  summary, columns, activeSprint, onTitleClick, onIdClick,
}: {
  summary: SprintSummary
  columns: SprintBoardColumn[]
  activeSprint: YouTrackSprint | null
  onTitleClick: (id: string, e?: React.MouseEvent) => void
  onIdClick: (id: string, e: React.MouseEvent) => void
}) {
  const pct = toPct(summary.completion_pct)
  const allIssues = useMemo(() => columns.flatMap(c => c.issues), [columns])

  const blockedIds = useMemo(() => {
    const ids = new Set<string>()
    columns.filter(c => isBlockedCol(c.name)).flatMap(c => c.issues).forEach(i => ids.add(i.idReadable))
    return ids
  }, [columns])

  const blockedIssues = useMemo(() =>
    columns.filter(c => isBlockedCol(c.name)).flatMap(c => c.issues)
  , [columns])

  const sorted = useMemo(() =>
    [...allIssues].sort((a, b) => urgencyScore(b) - urgencyScore(a))
  , [allIssues])

  const atRiskIssues = useMemo(() =>
    sorted.filter(i => (i.overdue_level === 'deadline' || i.overdue_level === 'sprint') && !blockedIds.has(i.idReadable))
  , [sorted, blockedIds])

  const inProgressIssues = useMemo(() =>
    sorted.filter(i => isProgressCol(i.current_state) && !i.overdue_level && !blockedIds.has(i.idReadable))
  , [sorted, blockedIds])

  const otherIssues = useMemo(() =>
    sorted.filter(i =>
      !isProgressCol(i.current_state) && !blockedIds.has(i.idReadable) && !i.overdue_level &&
      !isDoneCol(i.current_state)
    ).slice(0, 10)
  , [sorted, blockedIds])

  const developers = useMemo(() => {
    const map = new Map<string, { name: string; url: string; active: number; blocked: number; total: number }>()
    columns.forEach(col => col.issues.forEach(iss => {
      const key = iss.assignee || 'Unassigned'
      if (!map.has(key)) map.set(key, { name: key, url: iss.avatarUrl, active: 0, blocked: 0, total: 0 })
      const d = map.get(key)!
      d.total++
      if (isProgressCol(col.name)) d.active++
      if (isBlockedCol(col.name))  d.blocked++
    }))
    return Array.from(map.values()).sort((a, b) => b.active - a.active)
  }, [columns])

  function FeedRow({ iss, leftBarCls }: { iss: SprintBoardIssue; leftBarCls?: string }) {
    return (
      <div className={`db-oc-feed-row${blockedIds.has(iss.idReadable) ? ' db-oc-feed-row--blocked' : iss.overdue_level ? ' db-oc-feed-row--overdue' : ''}`}>
        <div className={`db-oc-feed-left-bar${leftBarCls ? ` ${leftBarCls}` : ''}`} />
        <div className="db-oc-feed-content">
          <div className="db-oc-feed-top">
            <PriPill priority={iss.priority} />
            <span
              className="db-ticket-id db-ticket-id--link"
              onClick={(e) => onIdClick(iss.idReadable, e)}
              title={`Open ${iss.idReadable} in YouTrack`}
            >{iss.idReadable}</span>
            {iss.is_hotfix  && <span className="db-hotfix-chip">HF</span>}
            {iss.bounce_count > 0 && <span className="db-bounce-chip">↩{iss.bounce_count}</span>}
            <span className="db-ticket-state">{iss.current_state}</span>
            <span className="db-oc-feed-time" style={{ marginLeft: 'auto' }}>
              {fmtHours(iss.hours_in_state)}
            </span>
          </div>
          <div
            className="db-oc-feed-title db-ticket-title--link"
            title={iss.summary}
            onClick={(e) => onTitleClick(iss.idReadable, e)}
          >{iss.summary}</div>
          <div className="db-oc-feed-bottom">
            <DBAvatar name={iss.assignee || '?'} url={iss.avatarUrl} size={15} />
            <span className="db-oc-feed-assignee">{iss.assignee?.split(' ')[0] || '—'}</span>
            <VerifBadges dev={iss.verified_on_dev} stg={iss.verified_on_stage} prd={iss.verified_on_prod} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="db-oc-layout">
      {/* ── Left Command Panel ── */}
      <div className="db-oc-left">
        {activeSprint && (
          <div className="db-oc-panel-section db-oc-sprint-info">
            <div className="db-oc-sprint-name">{activeSprint.name}</div>
            <div className="db-oc-sprint-dates">
              {fmtSprintDate(activeSprint.start)} – {fmtSprintDate(activeSprint.finish)}
            </div>
            <SprintTrack pct={pct} />
            <div className="db-oc-pct-row">
              <span className="db-oc-pct">{pct}%</span>
              <span className="db-oc-pct-label">{summary.done_issues}/{summary.total_issues} done</span>
              {summary.sprint_finish_ms > 0 && <Countdown finishMs={summary.sprint_finish_ms} />}
            </div>
          </div>
        )}

        <div className="db-oc-panel-section db-oc-blocked-banner">
          <div className="db-oc-blocked-count">{summary.blocked_count}</div>
          <div className="db-oc-blocked-label">tickets blocked</div>
        </div>

        <div className="db-oc-panel-section">
          <div className="db-oc-kpi-grid">
            <KpiChip label="In Progress" value={summary.in_progress_count} cls="db-kpi-chip--info" />
            <KpiChip label="Bounced"     value={summary.bounced_count}     cls="db-kpi-chip--warn" />
            <KpiChip label="Overdue"     value={summary.overdue_count}     cls="db-kpi-chip--danger" />
            <KpiChip label="Hotfixes"    value={summary.hotfix_count}      cls="db-kpi-chip--info" />
          </div>
        </div>

        <div className="db-oc-panel-section">
          <div className="db-oc-panel-label">Developer Load</div>
          {developers.map(dev => (
            <div key={dev.name} className="db-oc-dev-row">
              <DBAvatar name={dev.name} url={dev.url} size={22} />
              <div className="db-oc-dev-info">
                <span className="db-oc-dev-name">{dev.name.split(' ')[0]}</span>
                <div className="db-oc-mini-bar">
                  {dev.total > 0 && <>
                    <div className="db-oc-mini-bar-active"  style={{ width: `${(dev.active  / dev.total) * 100}%` }} />
                    {dev.blocked > 0 && <div className="db-oc-mini-bar-blocked" style={{ width: `${(dev.blocked / dev.total) * 100}%` }} />}
                  </>}
                </div>
              </div>
              <span className="db-oc-dev-cnt">
                {dev.active} <span style={{ opacity: 0.45 }}>active</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right Feed ── */}
      <div className="db-oc-right">
        <div className="db-oc-feed">
          {blockedIssues.length > 0 && (
            <>
              <FeedDivider label={`BLOCKED (${blockedIssues.length})`} color="var(--color-danger)" />
              {blockedIssues.map(iss => <FeedRow key={iss.idReadable} iss={iss} />)}
            </>
          )}

          {atRiskIssues.length > 0 && (
            <>
              <FeedDivider label={`OVERDUE (${atRiskIssues.length})`} color="var(--color-warning)" />
              {atRiskIssues.map(iss => (
                <FeedRow key={iss.idReadable} iss={iss} leftBarCls="db-oc-feed-left-bar--warn" />
              ))}
            </>
          )}

          {inProgressIssues.length > 0 && (
            <>
              <FeedDivider label={`IN PROGRESS (${inProgressIssues.length})`} color="var(--color-primary-light)" />
              {inProgressIssues.map(iss => (
                <FeedRow key={iss.idReadable} iss={iss} leftBarCls="db-oc-feed-left-bar--primary" />
              ))}
            </>
          )}

          {otherIssues.length > 0 && (
            <>
              <FeedDivider label={`OTHER (${otherIssues.length})`} />
              {otherIssues.map(iss => (
                <FeedRow key={iss.idReadable} iss={iss} leftBarCls="db-oc-feed-left-bar--muted" />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SprintDashboardPage() {
  const [designMode, setDesignMode] = useState<DesignMode>('velocity')
  const [designOpen, setDesignOpen] = useState(false)
  const [sprints, setSprints]       = useState<YouTrackSprint[]>([])
  const [activeSprint, setActiveSprint] = useState<YouTrackSprint | null>(null)
  const [sprintOpen, setSprintOpen] = useState(false)
  const [boardData, setBoardData]   = useState<SprintBoardStatusResponse | null>(null)
  const [loading, setLoading]       = useState(false)
  const [ytDetailIssue, setYtDetailIssue] = useState<YouTrackIssue | null>(null)
  const [ytDetailLoading, setYtDetailLoading] = useState(false)
  const [ytBaseUrl, setYtBaseUrl]   = useState('')

  const designRef     = useRef<HTMLDivElement>(null)
  const sprintRef     = useRef<HTMLDivElement>(null)
  const designMenuRef = useRef<HTMLDivElement>(null)
  const sprintMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getYouTrackIntegration().then(res => {
      const d = (res as any)
      setYtBaseUrl((d?.base_url || d?.data?.base_url || '').replace(/\/$/, ''))
    }).catch(() => {})
  }, [])

  const openIssueDetail = useCallback(async (idReadable: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (ytDetailLoading) return
    setYtDetailLoading(true)
    try {
      const res = await api.getYouTrackIssue(idReadable)
      const issue = (res as any).data as YouTrackIssue
      if (issue) setYtDetailIssue(issue)
    } catch {}
    finally { setYtDetailLoading(false) }
  }, [ytDetailLoading])

  const openInYt = useCallback((idReadable: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!idReadable) return
    const url = ytBaseUrl ? `${ytBaseUrl}/issue/${idReadable}` : null
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [ytBaseUrl])

  useEffect(() => {
    api.getYouTrackSprints().then(res => {
      const list = ((res as any).data as YouTrackSprint[]) ?? []
      setSprints(list)
      const savedId = localStorage.getItem(SPRINT_ID_KEY)
      const saved   = savedId ? list.find(s => s.id === savedId) : null
      setActiveSprint(saved || list.find(s => !s.isCompleted) || list[0] || null)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeSprint) { setBoardData(null); return }
    setLoading(true)
    api.getSprintBoardStatus({
      sprint_id: activeSprint.id,
      sprint_finish_ms: activeSprint.finish,
    }).then(res => {
      const data = (res as any).data as SprintBoardStatusResponse
      setBoardData(data ?? null)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [activeSprint?.id])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (designOpen && !designRef.current?.contains(t) && !designMenuRef.current?.contains(t)) setDesignOpen(false)
      if (sprintOpen && !sprintRef.current?.contains(t) && !sprintMenuRef.current?.contains(t)) setSprintOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [designOpen, sprintOpen])

  function handleSprintChange(s: YouTrackSprint) {
    setActiveSprint(s)
    setSprintOpen(false)
    localStorage.setItem(SPRINT_ID_KEY,   s.id)
    localStorage.setItem(SPRINT_NAME_KEY, s.name)
  }

  const sortedSprints = [...sprints].sort((a, b) => b.finish - a.finish)
  const currentDesign = DESIGN_MODES.find(d => d.id === designMode)!

  return (
    <div className="db-page">
      {/* Controls bar */}
      <div className="db-controls">
        <div ref={designRef} className="db-design-selector">
          <button
            className="pm-custom-dropdown-trigger db-design-btn"
            onClick={() => setDesignOpen(o => !o)}
          >
            <currentDesign.icon size={13} />
            {currentDesign.label}
            <ChevronDown size={11} style={{ opacity: 0.5 }} />
          </button>
          {designOpen && createPortal(
            <div
              ref={designMenuRef}
              className="pm-custom-dropdown-menu"
              style={{
                position: 'fixed',
                top:  (designRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                left: designRef.current?.getBoundingClientRect().left ?? 0,
                minWidth: 180,
                zIndex: 9999,
              }}
            >
              {DESIGN_MODES.map(d => (
                <button
                  key={d.id}
                  className={`pm-dropdown-item${designMode === d.id ? ' active' : ''}`}
                  onClick={() => { setDesignMode(d.id); setDesignOpen(false) }}
                >
                  <span style={{ width: 13, display: 'inline-flex', alignItems: 'center' }}>
                    {designMode === d.id && <Check size={12} />}
                  </span>
                  <d.icon size={12} style={{ marginRight: 6 }} />
                  {d.label}
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>

        <div className="db-controls-spacer" />

        {/* Sprint selector */}
        <div ref={sprintRef} className="db-sprint-selector">
          <button
            className="pm-custom-dropdown-trigger"
            onClick={() => setSprintOpen(o => !o)}
          >
            <GitBranch size={13} />
            {activeSprint
              ? <>{activeSprint.name}<span className="db-sprint-dates">{fmtSprintDate(activeSprint.start)}–{fmtSprintDate(activeSprint.finish)}</span></>
              : <span>Select sprint</span>
            }
            <ChevronDown size={11} style={{ opacity: 0.5 }} />
          </button>
          {sprintOpen && createPortal(
            <div
              ref={sprintMenuRef}
              className="pm-custom-dropdown-menu"
              style={{
                position: 'fixed',
                top:   (sprintRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                right: window.innerWidth - (sprintRef.current?.getBoundingClientRect().right ?? 0),
                minWidth: 240,
                zIndex: 9999,
              }}
            >
              {sortedSprints.length === 0 && (
                <div style={{ padding: '9px 14px', fontSize: 13, opacity: 0.5 }}>No sprints found</div>
              )}
              {sortedSprints.map(s => (
                <button
                  key={s.id}
                  className={`pm-dropdown-item${activeSprint?.id === s.id ? ' active' : ''}`}
                  onClick={() => handleSprintChange(s)}
                  style={{ opacity: s.isCompleted ? 0.6 : 1 }}
                >
                  <span style={{ width: 13, display: 'inline-flex', alignItems: 'center' }}>
                    {activeSprint?.id === s.id && <Check size={12} />}
                  </span>
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 8 }}>
                    {fmtSprintDate(s.start)}–{fmtSprintDate(s.finish)}
                  </span>
                  {s.isCompleted && <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 4 }}>✓</span>}
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* KPI bar — shown when data is loaded or loading */}
      {loading && <SkeletonKpiBar />}
      {!loading && boardData && <KpiBar summary={boardData.summary} />}

      {/* No sprint selected */}
      {!loading && !activeSprint && (
        <div className="db-empty">
          <Target size={38} />
          <span>Select a sprint to see the dashboard</span>
        </div>
      )}

      {/* No data */}
      {!loading && activeSprint && !boardData && (
        <div className="db-empty">
          <RefreshCw size={38} />
          <span>No data available for this sprint</span>
        </div>
      )}

      {/* Skeleton views while loading */}
      {loading && (
        <div className="db-content">
          {designMode === 'velocity' && <SkeletonVelocity />}
          {designMode === 'bento'    && <SkeletonBento />}
          {designMode === 'ops'      && <SkeletonOps />}
        </div>
      )}

      {/* Design views */}
      {!loading && boardData && (
        <div className="db-content">
          {designMode === 'velocity' && (
            <Design1
              summary={boardData.summary}
              columns={boardData.columns}
              onTitleClick={openIssueDetail}
              onIdClick={openInYt}
              ytDetailLoading={ytDetailLoading}
            />
          )}
          {designMode === 'bento' && (
            <Design2
              summary={boardData.summary}
              columns={boardData.columns}
              onTitleClick={openIssueDetail}
              onIdClick={openInYt}
            />
          )}
          {designMode === 'ops' && (
            <Design3
              summary={boardData.summary}
              columns={boardData.columns}
              activeSprint={activeSprint}
              onTitleClick={openIssueDetail}
              onIdClick={openInYt}
            />
          )}
        </div>
      )}

      {/* Ticket detail panel */}
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
