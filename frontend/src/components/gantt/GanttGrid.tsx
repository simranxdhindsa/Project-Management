import React, { useRef, useCallback, useMemo } from 'react'
import {
  type GanttIssue, type GanttView, DAY_PX,
  addDays, diffDays, fmtDayLabel, fmtMonth, fmtWeek,
  isWeekend, msToDate, dateToMs, barRect, priorityColor,
} from '../../pages/gantt-types'

// ── Constants ────────────────────────────────────────────────────────────────

const ROW_H = 44          // px per row
const HDR_H = 56          // timeline header height (two rows: month + day)
const SIDEBAR_W = 280     // left issue list width

// ── Header builder ───────────────────────────────────────────────────────────

function buildDayColumns(viewStart: Date, totalDays: number, view: GanttView) {
  const dayPx = DAY_PX[view]
  const cols: { date: Date; label: string; isWeekend: boolean }[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(viewStart, i)
    cols.push({ date: d, label: fmtDayLabel(d, view), isWeekend: isWeekend(d) })
  }
  return cols
}

function buildGroupHeaders(viewStart: Date, totalDays: number, view: GanttView) {
  const dayPx = DAY_PX[view]
  const groups: { label: string; width: number }[] = []
  let cur = addDays(viewStart, 0)
  let i = 0
  while (i < totalDays) {
    let groupLabel: string
    let groupEnd: Date
    if (view === 'month') {
      groupLabel = fmtMonth(cur)
      groupEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    } else {
      // Week groups for day + week views
      const monday = new Date(cur)
      const dayOfWeek = cur.getDay() === 0 ? 6 : cur.getDay() - 1
      monday.setDate(cur.getDate() - dayOfWeek)
      const sunday = addDays(monday, 6)
      groupLabel = fmtWeek(monday)
      groupEnd = addDays(sunday, 1)
    }
    const endDay = Math.min(diffDays(viewStart, groupEnd), totalDays)
    const width = (endDay - i) * dayPx
    groups.push({ label: groupLabel, width })
    cur = groupEnd
    i = endDay
  }
  return groups
}

// ── Avatar ───────────────────────────────────────────────────────────────────

const Avatar = React.memo(({ name, url }: { name: string; url: string }) => {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (url) return <img className="gt-avatar" src={url} alt={name} title={name} />
  return <div className="gt-avatar gt-avatar-initials" title={name}>{initials}</div>
})

// ── Single bar ───────────────────────────────────────────────────────────────

interface BarProps {
  issue: GanttIssue
  viewStart: Date
  view: GanttView
  editMode: boolean
  onDragStart: (e: React.MouseEvent, issueId: string, mode: 'move' | 'resize-left' | 'resize-right') => void
  onConnectStart?: (e: React.MouseEvent, issueId: string) => void
  onClick: (issue: GanttIssue) => void
}

const GanttBar = React.memo(({
  issue, viewStart, view, editMode, onDragStart, onConnectStart, onClick,
}: BarProps) => {
  const dayPx = DAY_PX[view]
  const rect = barRect(issue.startDate, issue.dueDate, viewStart, dayPx)
  if (!rect) return null
  const color = priorityColor(issue.priority)

  return (
    <div
      className={`gt-bar${editMode ? ' gt-bar--edit' : ''}`}
      style={{
        left: rect.left,
        width: rect.width,
        '--bar-color': color,
      } as React.CSSProperties}
      onClick={() => onClick(issue)}
    >
      {editMode && (
        <div
          className="gt-bar-handle gt-bar-handle--left"
          onMouseDown={e => { e.stopPropagation(); onDragStart(e, issue.memberId, 'resize-left') }}
        />
      )}
      <div
        className="gt-bar-inner"
        onMouseDown={editMode ? e => { e.stopPropagation(); onDragStart(e, issue.memberId, 'move') } : undefined}
      >
        <span className="gt-bar-label">{issue.idReadable} — {issue.summary}</span>
      </div>
      {editMode && (
        <>
          <div
            className="gt-bar-handle gt-bar-handle--right"
            onMouseDown={e => { e.stopPropagation(); onDragStart(e, issue.memberId, 'resize-right') }}
          />
          {onConnectStart && (
            <div
              className="gt-connect-dot"
              onMouseDown={e => { e.stopPropagation(); onConnectStart(e, issue.memberId) }}
              title="Drag to create dependency"
            />
          )}
        </>
      )}
    </div>
  )
})

// ── GanttGrid ────────────────────────────────────────────────────────────────

interface DragState {
  memberId: string
  mode: 'move' | 'resize-left' | 'resize-right'
  startX: number
  origStart: number | null
  origDue: number | null
}

interface Props {
  issues: GanttIssue[]
  viewStart: Date
  totalDays: number
  view: GanttView
  editMode: boolean
  // memberId, startMs, dueMs
  onUpdateDates: (memberId: string, startMs: number | null, dueMs: number | null) => void
  onConnectStart: (e: React.MouseEvent, memberId: string) => void
  onIssueClick: (issue: GanttIssue) => void
  connectingFrom: string | null  // memberId
  gridRef: React.RefObject<HTMLDivElement>
}

export function GanttGrid({
  issues, viewStart, totalDays, view, editMode,
  onUpdateDates, onConnectStart, onIssueClick, connectingFrom, gridRef,
}: Props) {
  const dayPx = DAY_PX[view]
  const totalW = totalDays * dayPx
  const dragRef = useRef<DragState | null>(null)
  // Keyed by memberId
  const previewRef = useRef<Map<string, { startDate: number | null; dueDate: number | null }>>(new Map())

  const dayCols = useMemo(() => buildDayColumns(viewStart, totalDays, view), [viewStart, totalDays, view])
  const groupHdrs = useMemo(() => buildGroupHeaders(viewStart, totalDays, view), [viewStart, totalDays, view])

  const handleDragStart = useCallback((
    e: React.MouseEvent, memberId: string, mode: 'move' | 'resize-left' | 'resize-right'
  ) => {
    if (!editMode) return
    e.preventDefault()
    const issue = issues.find(i => i.memberId === memberId)
    if (!issue) return
    dragRef.current = { memberId, mode, startX: e.clientX, origStart: issue.startDate, origDue: issue.dueDate }
    previewRef.current.clear()

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = ev.clientX - drag.startX
      const dayDelta = Math.round(dx / dayPx)
      if (dayDelta === 0) return

      const MS = 86_400_000
      let newStart = drag.origStart
      let newDue = drag.origDue

      if (drag.mode === 'move') {
        if (drag.origStart) newStart = drag.origStart + dayDelta * MS
        if (drag.origDue) newDue = drag.origDue + dayDelta * MS
      } else if (drag.mode === 'resize-right') {
        const base = drag.origDue ?? drag.origStart
        if (base) newDue = base + dayDelta * MS
      } else if (drag.mode === 'resize-left') {
        const base = drag.origStart ?? drag.origDue
        if (base) newStart = base + dayDelta * MS
      }

      previewRef.current.set(drag.memberId, { startDate: newStart, dueDate: newDue })
      gridRef.current?.dispatchEvent(new CustomEvent('gantt-preview', { detail: drag.memberId }))
    }

    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      const dx = ev.clientX - drag.startX
      const dayDelta = Math.round(dx / dayPx)
      if (dayDelta === 0) { previewRef.current.clear(); return }

      const MS = 86_400_000
      let newStart = drag.origStart
      let newDue = drag.origDue

      if (drag.mode === 'move') {
        if (drag.origStart) newStart = drag.origStart + dayDelta * MS
        if (drag.origDue) newDue = drag.origDue + dayDelta * MS
      } else if (drag.mode === 'resize-right') {
        const base = drag.origDue ?? drag.origStart
        if (base) newDue = base + dayDelta * MS
      } else if (drag.mode === 'resize-left') {
        const base = drag.origStart ?? drag.origDue
        if (base) newStart = base + dayDelta * MS
      }

      previewRef.current.clear()
      onUpdateDates(drag.memberId, newStart, newDue)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [editMode, issues, dayPx, onUpdateDates, gridRef])

  const today = new Date()

  return (
    <div className="gt-grid-wrap" ref={gridRef}>
      {/* ── Header ── */}
      <div className="gt-hdr" style={{ width: totalW }}>
        {/* Month / week group row */}
        <div className="gt-hdr-groups">
          {groupHdrs.map((g, i) => (
            <div key={i} className="gt-hdr-group" style={{ width: g.width }}>{g.label}</div>
          ))}
        </div>
        {/* Day row */}
        <div className="gt-hdr-days">
          {dayCols.map((col, i) => (
            <div
              key={i}
              className={`gt-hdr-day${col.isWeekend ? ' gt-hdr-day--weekend' : ''}`}
              style={{ width: dayPx }}
            >
              {col.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="gt-canvas" style={{ width: totalW, height: issues.length * ROW_H }}>
        {/* Column backgrounds */}
        {dayCols.map((col, i) => (
          <div
            key={i}
            className={`gt-col${col.isWeekend ? ' gt-col--weekend' : ''}`}
            style={{ left: i * dayPx, width: dayPx, height: '100%' }}
          />
        ))}

        {/* Today line */}
        {(() => {
          const todayOffset = diffDays(viewStart, today)
          if (todayOffset >= 0 && todayOffset < totalDays) {
            return (
              <div
                className="gt-today-line"
                style={{ left: todayOffset * dayPx + dayPx / 2 }}
              />
            )
          }
          return null
        })()}

        {/* Row stripes + bars */}
        {issues.map((issue, rowIdx) => {
          const preview = previewRef.current.get(issue.memberId)
          const displayIssue = preview
            ? { ...issue, startDate: preview.startDate, dueDate: preview.dueDate }
            : issue

          return (
            <div
              key={issue.memberId}
              className="gt-row"
              style={{ top: rowIdx * ROW_H, height: ROW_H, width: totalW }}
            >
              <GanttBar
                issue={displayIssue}
                viewStart={viewStart}
                view={view}
                editMode={editMode}
                onDragStart={handleDragStart}
                onConnectStart={editMode ? onConnectStart : undefined}
                onClick={onIssueClick}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ROW_H, HDR_H, SIDEBAR_W }
