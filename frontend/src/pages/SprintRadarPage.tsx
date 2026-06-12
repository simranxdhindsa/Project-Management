import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, AlertCircle, CheckCircle2, Clock, RefreshCw, X, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import api from '@/services/api'
import type { RadarIssue, SprintAlert, SprintHealthStats, SprintRadarData } from '@/services/api'
import '@/styles/pages/sprint-radar.css'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  const d = Math.floor(h / 24)
  const rem = h % 24
  if (d > 0) return `${d}d ${Math.floor(rem)}h`
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

function fmtAge(h: number): string {
  if (h < 24) return `${Math.floor(h)}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function slaBreach(tier: number, hoursInState: number): boolean {
  if (tier === 1) return hoursInState >= 1
  if (tier === 2) return hoursInState >= 24
  return false
}

function slaThreshold(tier: number): number {
  return tier === 1 ? 1 : 24
}

function slaRatio(tier: number, h: number): number {
  return Math.min(h / slaThreshold(tier), 1)
}

function typeBadgeClass(t: string): string {
  const lower = t.toLowerCase()
  if (lower === 'hotfix') return 'sr-type-hotfix'
  if (lower === 'regression') return 'sr-type-regression'
  if (lower === 'bug') return 'sr-type-bug'
  if (lower === 'feature') return 'sr-type-feature'
  return 'sr-type-other'
}

function typeIcon(t: string): string {
  const lower = t.toLowerCase()
  if (lower === 'hotfix') return '🔥'
  if (lower === 'regression') return '↩'
  if (lower === 'bug') return '🐛'
  if (lower === 'feature') return '✨'
  if (lower === 'enhancement') return '⚡'
  return ''
}

function ageClass(h: number): string {
  if (h > 7 * 24) return 'sr-age-red'
  if (h > 3 * 24) return 'sr-age-amber'
  return 'sr-age-green'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ issueType }: { issueType: string }) {
  if (!issueType) return null
  return (
    <span className={`sr-type-badge ${typeBadgeClass(issueType)}`}>
      {typeIcon(issueType)} {issueType}
    </span>
  )
}

function SLATimer({ hours, tier, isDone }: { hours: number; tier: number; breached?: boolean; isDone: boolean }) {
  if (isDone) return <span className="sr-sla-done">✓ done</span>
  const ratio = slaRatio(tier, hours)
  const breached = slaBreach(tier, hours)
  const cls = breached ? 'sr-sla-breached' : ratio > 0.7 ? 'sr-sla-warn' : 'sr-sla-ok'
  return (
    <span className={`sr-sla-timer ${cls}`}>
      <Clock size={10} />
      {fmtHours(hours)}
      {breached && ' ⚠'}
    </span>
  )
}

function IssueRow({ ri, showTierBadge = false }: { ri: RadarIssue; showTierBadge?: boolean }) {
  const breached = !ri.is_done && slaBreach(ri.tier, ri.hours_in_state)
  return (
    <div className={`sr-issue-row${breached ? ' sr-row-breach' : ''}`}>
      <span className="sr-issue-id">{ri.issue_id}</span>
      {ri.issue_type && <TypeBadge issueType={ri.issue_type} />}
      <span className="sr-issue-summary">{ri.issue_summary}</span>
      <div className="sr-issue-meta">
        <span className="sr-state">{ri.current_state}</span>
        {ri.assignee && <span className="sr-assignee">{ri.assignee.split(' ')[0]}</span>}
        <SLATimer hours={ri.hours_in_state} tier={ri.tier} isDone={ri.is_done} />
      </div>
    </div>
  )
}

function TierSection({
  title, tier, issues, defaultOpen = true,
}: { title: string; tier: number; issues: RadarIssue[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const breachedCount = issues.filter(r => !r.is_done && slaBreach(tier, r.hours_in_state)).length
  const doneCount = issues.filter(r => r.is_done).length

  const tierCls = tier === 1 ? 'sr-tier-critical' : tier === 2 ? 'sr-tier-urgent' : 'sr-tier-scheduled'

  return (
    <div className={`sr-tier-section ${tierCls}`}>
      <button className="sr-tier-header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="sr-tier-title">{title}</span>
        <span className="sr-tier-count">{issues.length}</span>
        {breachedCount > 0 && <span className="sr-breach-pill">{breachedCount} breached</span>}
        {doneCount > 0 && <span className="sr-done-pill">{doneCount} done</span>}
      </button>
      {open && (
        <div className="sr-tier-body">
          {issues.length === 0
            ? <span className="sr-empty">No issues in this tier</span>
            : issues.map(ri => <IssueRow key={ri.issue_id} ri={ri} />)
          }
        </div>
      )}
    </div>
  )
}

function HealthBar({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="sr-health-row">
      <span className="sr-health-label">{label}</span>
      <div className="sr-health-track">
        <div className="sr-health-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sr-health-frac" style={{ color }}>{done}<span className="sr-health-sep">/</span>{total}</span>
    </div>
  )
}

function AlertItem({ alert, onDismiss }: { alert: SprintAlert; onDismiss: (id: number) => void }) {
  const cls = alert.tier === 1 ? 'sr-alert-critical' : 'sr-alert-urgent'
  return (
    <div className={`sr-alert-item ${cls}`}>
      <div className="sr-alert-body">
        <span className="sr-alert-id">{alert.issue_id}</span>
        <span className="sr-alert-msg">{alert.message}</span>
      </div>
      <button className="sr-alert-dismiss" onClick={() => onDismiss(alert.id)} title="Dismiss">
        <X size={12} />
      </button>
    </div>
  )
}

function RegressionRow({ ri }: { ri: RadarIssue }) {
  const ageCls = ageClass(ri.hours_in_state)
  return (
    <div className="sr-reg-row">
      <span className="sr-issue-id">{ri.issue_id}</span>
      <span className={`sr-reg-age ${ageCls}`}>{fmtAge(ri.hours_in_state)}</span>
      <span className="sr-state">{ri.current_state}</span>
      <span className="sr-assignee">{ri.assignee || '—'}</span>
      {ri.priority && <span className="sr-priority-tag">{ri.priority}</span>}
      <span className="sr-issue-summary sr-reg-summary">{ri.issue_summary}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SprintRadarPage() {
  const [data, setData] = useState<SprintRadarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [showAlerts, setShowAlerts] = useState(true)
  const [tier4Open, setTier4Open] = useState(false)
  const [regsOpen, setRegsOpen] = useState(true)

  const load = useCallback(async () => {
    try {
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000
      const res = await api.getSprintRadar(since)
      if (res?.data) {
        setData(res.data)
        setLastRefresh(new Date())
      }
    } catch (e) {
      console.error('[SprintRadar] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000) // refresh every 5min
    return () => clearInterval(interval)
  }, [load])

  const handleDismiss = async (alertId: number) => {
    await api.dismissSprintAlert(alertId)
    setData(d => d ? { ...d, alerts: d.alerts.filter(a => a.id !== alertId) } : d)
  }

  const handleDismissAll = async () => {
    await api.dismissAllSprintAlerts()
    setData(d => d ? { ...d, alerts: [] } : d)
  }

  if (loading) {
    return (
      <div className="sr-loading">
        <div className="sr-loading-spinner" />
        Loading Sprint Pulse…
      </div>
    )
  }

  if (!data) {
    return <div className="sr-empty-state">No sprint data available. Run an import first.</div>
  }

  const { tier1, tier2, tier3, tier4, regressions, health, alerts } = data
  const h = health as SprintHealthStats

  const criticalBreached = tier1.filter(r => !r.is_done && slaBreach(1, r.hours_in_state)).length
  const urgentBreached = tier2.filter(r => !r.is_done && slaBreach(2, r.hours_in_state)).length
  const activeAlerts = alerts.filter(a => a.tier === 1 || a.tier === 2)

  const totalDone = h.critical_done + h.urgent_done + h.normal_done
  const totalAll = h.critical_total + h.urgent_total + h.normal_total
  const sprintPct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0

  return (
    <div className="sr-page">

      {/* ── Alert strip ─────────────────────────────── */}
      <div className="sr-alert-strip">
        <div className="sr-strip-pills">
          {criticalBreached > 0 && (
            <span className="sr-strip-pill sr-pill-critical">
              <AlertTriangle size={13} /> {criticalBreached} CRITICAL breached
            </span>
          )}
          {urgentBreached > 0 && (
            <span className="sr-strip-pill sr-pill-urgent">
              <AlertCircle size={13} /> {urgentBreached} URGENT stalled
            </span>
          )}
          {criticalBreached === 0 && urgentBreached === 0 && (
            <span className="sr-strip-pill sr-pill-ok">
              <CheckCircle2 size={13} /> All SLAs on track
            </span>
          )}
          <span className="sr-strip-pill sr-pill-neutral">
            <Zap size={12} /> Sprint {sprintPct}% done
          </span>
        </div>
        <div className="sr-strip-actions">
          <span className="sr-last-refresh">
            Refreshed {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button className="sr-refresh-btn" onClick={load} title="Refresh now">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── In-app alerts ─────────────────────────── */}
      {activeAlerts.length > 0 && showAlerts && (
        <div className="sr-alerts-panel">
          <div className="sr-alerts-header">
            <span className="sr-alerts-title">Active Alerts ({activeAlerts.length})</span>
            <div className="sr-alerts-actions">
              <button className="sr-dismiss-all" onClick={handleDismissAll}>Dismiss all</button>
              <button className="sr-collapse-alerts" onClick={() => setShowAlerts(false)}><X size={12} /></button>
            </div>
          </div>
          {activeAlerts.map(a => <AlertItem key={a.id} alert={a} onDismiss={handleDismiss} />)}
        </div>
      )}
      {activeAlerts.length > 0 && !showAlerts && (
        <button className="sr-show-alerts-btn" onClick={() => setShowAlerts(true)}>
          <AlertTriangle size={13} /> {activeAlerts.length} active alert{activeAlerts.length > 1 ? 's' : ''} hidden
        </button>
      )}

      {/* ── Main grid ─────────────────────────────── */}
      <div className="sr-main-grid">

        {/* Left: tier lists */}
        <div className="sr-left">
          <TierSection title="CRITICAL" tier={1} issues={tier1} defaultOpen />
          <TierSection title="URGENT" tier={2} issues={tier2} defaultOpen />
          <TierSection title="SCHEDULED" tier={3} issues={tier3} defaultOpen={false} />

          {/* Tier 4 — compact */}
          <div className="sr-tier-section sr-tier-normal">
            <button className="sr-tier-header" onClick={() => setTier4Open(o => !o)}>
              {tier4Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="sr-tier-title">NORMAL</span>
              <span className="sr-tier-count">{tier4.length}</span>
              <span className="sr-done-pill">{tier4.filter(r => r.is_done).length} done</span>
            </button>
            {tier4Open && (
              <div className="sr-tier-body">
                {tier4.length === 0
                  ? <span className="sr-empty">No normal-priority issues</span>
                  : tier4.map(ri => <IssueRow key={ri.issue_id} ri={ri} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right: health + at-risk */}
        <div className="sr-right">
          <div className="sr-health-card">
            <div className="sr-card-title">Sprint Health</div>
            <div className="sr-health-bars">
              <HealthBar label="Critical" done={h.critical_done} total={h.critical_total} color="var(--color-danger)" />
              <HealthBar label="Urgent" done={h.urgent_done} total={h.urgent_total} color="var(--color-warning)" />
              <HealthBar label="Normal" done={h.normal_done} total={h.normal_total} color="var(--color-success)" />
            </div>
            <div className="sr-health-total">
              <span>{totalDone} / {totalAll} delivered</span>
              <span className="sr-health-pct">{sprintPct}%</span>
            </div>
          </div>

          {h.at_risk.length > 0 && (
            <div className="sr-at-risk-card">
              <div className="sr-card-title">⚠ At Risk — no movement in 24h</div>
              <div className="sr-at-risk-list">
                {h.at_risk.map(id => (
                  <span key={id} className="sr-at-risk-id">{id}</span>
                ))}
              </div>
            </div>
          )}

          <div className="sr-summary-card">
            <div className="sr-card-title">Priority Breakdown</div>
            {[
              { label: 'Critical / Hotfix', count: tier1.length, cls: 'sr-summary-critical' },
              { label: 'Urgent (P1/A1)', count: tier2.length, cls: 'sr-summary-urgent' },
              { label: 'Scheduled (P2/A2)', count: tier3.length, cls: 'sr-summary-scheduled' },
              { label: 'Normal', count: tier4.length, cls: 'sr-summary-normal' },
              { label: 'Regressions', count: regressions.length, cls: 'sr-summary-regression' },
            ].map(row => (
              <div key={row.label} className="sr-summary-row">
                <span className={`sr-summary-dot ${row.cls}`} />
                <span className="sr-summary-label">{row.label}</span>
                <span className="sr-summary-num">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Regression table ─────────────────────── */}
      <div className="sr-reg-section">
        <button className="sr-reg-header" onClick={() => setRegsOpen(o => !o)}>
          {regsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="sr-reg-title">REGRESSIONS</span>
          <span className="sr-tier-count">{regressions.length}</span>
          <span className="sr-reg-sub">sorted by age — oldest first</span>
        </button>
        {regsOpen && (
          <div className="sr-reg-body">
            {regressions.length === 0 ? (
              <span className="sr-empty">No regressions tracked</span>
            ) : (
              <>
                <div className="sr-reg-cols">
                  <span>ID</span><span>Age</span><span>State</span>
                  <span>Assignee</span><span>Priority</span><span>Summary</span>
                </div>
                {[...regressions].sort((a, b) => b.hours_in_state - a.hours_in_state)
                  .map(ri => <RegressionRow key={ri.issue_id} ri={ri} />)}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
