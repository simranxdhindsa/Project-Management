// ── Gantt chart types & pure helpers ─────────────────────────────────────────

export interface GanttIssue {
  id: string
  memberId: string   // YT gantt member ID (used for API updates)
  idReadable: string
  summary: string
  assignee: string
  avatarUrl: string
  state: string
  priority: string
  startDate: number | null  // Unix ms (from gantt member)
  dueDate: number | null    // Unix ms (startDate + estimation*60 000)
  estimation: number        // minutes
}

export interface GanttChartSummary {
  id: string
  name: string
}

export interface GanttDependency {
  sourceId: string  // gantt member ID of the prerequisite
  targetId: string  // gantt member ID of the dependent
}

export type GanttView = 'day' | 'week' | 'month'

// Pixels per day for each view
export const DAY_PX: Record<GanttView, number> = { day: 100, week: 44, month: 16 }

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Start of day in local time, returned as a Date */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Add N days to a date */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** Difference in whole days (b - a), floored */
export function diffDays(a: Date, b: Date): number {
  const msPerDay = 86_400_000
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / msPerDay)
}

/** Format a date as "Mon 2" (day view) or "2" (month view) */
export function fmtDayLabel(d: Date, view: GanttView): string {
  if (view === 'month') return String(d.getDate())
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getDay()]} ${d.getDate()}`
}

/** Format a date as "Jun 2026" for month headers */
export function fmtMonth(d: Date): string {
  return d.toLocaleString('default', { month: 'short', year: 'numeric' })
}

/** Format a date as "Week 27" for week grouping label */
export function fmtWeek(d: Date): string {
  // ISO week number
  const tmp = new Date(d)
  tmp.setHours(0, 0, 0, 0)
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
  const week1 = new Date(tmp.getFullYear(), 0, 4)
  const wn = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `Wk ${wn}`
}

/** Returns true if a date is a weekend */
export function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6
}

/** Convert Unix ms to local midnight Date */
export function msToDate(ms: number): Date {
  return startOfDay(new Date(ms))
}

/** Convert a local midnight Date to Unix ms */
export function dateToMs(d: Date): number {
  return startOfDay(d).getTime()
}

// ── Bar position helpers ──────────────────────────────────────────────────────

export interface BarRect {
  left: number
  width: number
}

export function barRect(
  startMs: number | null,
  dueMs: number | null,
  viewStart: Date,
  dayPx: number
): BarRect | null {
  if (!startMs && !dueMs) return null
  const s = startMs ? msToDate(startMs) : msToDate(dueMs!)
  const e = dueMs ? msToDate(dueMs) : msToDate(startMs!)
  const left = diffDays(viewStart, s) * dayPx
  const width = Math.max((diffDays(s, e) + 1) * dayPx, dayPx)
  return { left, width }
}

// ── Priority → colour ─────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical:  'var(--color-danger)',
  blocker:   'var(--color-danger)',
  major:     'var(--color-warning)',
  normal:    'var(--color-primary)',
  minor:     'var(--color-success)',
  trivial:   'var(--text-muted)',
}

export function priorityColor(p: string): string {
  return PRIORITY_COLORS[p.toLowerCase()] ?? 'var(--color-primary)'
}
