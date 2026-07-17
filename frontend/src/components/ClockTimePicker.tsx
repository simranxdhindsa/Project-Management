import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Keyboard, ChevronDown } from 'lucide-react'
import '../styles/components/clock-time-picker.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

type AMPM = 'AM' | 'PM'
type Phase = 'hour' | 'minute'

function parse(value: string): { hour: number; minute: number; ampm: AMPM } {
  const [h = 9, m = 0] = value.split(':').map(Number)
  return {
    hour: h % 12 || 12,
    minute: Math.round(m / 5) * 5 % 60,
    ampm: h < 12 ? 'AM' : 'PM',
  }
}

function to24(hour: number, ampm: AMPM): number {
  if (ampm === 'AM') return hour === 12 ? 0 : hour
  return hour === 12 ? 12 : hour + 12
}

function toHHMM(hour: number, minute: number, ampm: AMPM): string {
  const h = to24(hour, ampm)
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function displayTime(value: string): string {
  const { hour, minute, ampm } = parse(value)
  return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`
}

// ── Clock face geometry ───────────────────────────────────────────────────────

const SIZE = 260       // SVG canvas px
const CR = SIZE / 2    // center x/y
const NR = CR * 0.72   // number ring radius
const THUMB_R = 20     // selected-number circle radius

function clockPos(index: number) {
  // index 0 = 12 o'clock, going clockwise
  const rad = (index / 12) * 2 * Math.PI - Math.PI / 2
  return { x: CR + NR * Math.cos(rad), y: CR + NR * Math.sin(rad) }
}

// hour value (1-12) → position index (0-11; 12→0, 1→1, ..., 11→11)
function hourToIndex(h: number) { return h % 12 }
// minute value (0-55 step 5) → position index (0-11)
function minuteToIndex(m: number) { return m / 5 }
// click angle (deg, 0=top CW) → index 0-11
function angleToIndex(deg: number) { return Math.round(deg / 30) % 12 }

function getAngle(e: React.MouseEvent<SVGSVGElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  const dx = e.clientX - rect.left - CR
  const dy = e.clientY - rect.top - CR
  let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90
  if (deg < 0) deg += 360
  return deg
}

// ── Clock SVG ─────────────────────────────────────────────────────────────────

function ClockFace({
  phase, hour, minute,
  onChange,
}: {
  phase: Phase
  hour: number
  minute: number
  onChange: (hour: number, minute: number, advance: boolean) => void
}) {
  const selIndex = phase === 'hour' ? hourToIndex(hour) : minuteToIndex(minute)
  const selPos = clockPos(selIndex)

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = angleToIndex(getAngle(e))
    if (phase === 'hour') {
      const h = idx === 0 ? 12 : idx
      onChange(h, minute, true) // advance to minute phase
    } else {
      const m = idx * 5
      onChange(hour, m, false)
    }
  }

  const labels =
    phase === 'hour'
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

  return (
    <svg
      className="ctp-clock-svg"
      width={SIZE}
      height={SIZE}
      onClick={handleClick}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {/* Background circle */}
      <circle cx={CR} cy={CR} r={CR - 6} className="ctp-clock-bg" />

      {/* Hand line */}
      <line
        x1={CR} y1={CR}
        x2={selPos.x} y2={selPos.y}
        className="ctp-clock-hand"
        strokeWidth={2}
      />

      {/* Center dot */}
      <circle cx={CR} cy={CR} r={5} className="ctp-clock-center" />

      {/* Selected highlight */}
      <circle cx={selPos.x} cy={selPos.y} r={THUMB_R} className="ctp-clock-thumb" />

      {/* Numbers */}
      {labels.map((label, idx) => {
        const pos = clockPos(idx)
        const isSel = idx === selIndex
        return (
          <text
            key={label}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={14}
            fontWeight={isSel ? 700 : 400}
            className={isSel ? 'ctp-num ctp-num--sel' : 'ctp-num'}
          >
            {phase === 'minute' ? String(label).padStart(2, '0') : label}
          </text>
        )
      })}
    </svg>
  )
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function ClockDialog({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string
  onConfirm: (v: string) => void
  onCancel: () => void
}) {
  const { hour: ih, minute: im, ampm: iap } = parse(initial || '09:00')
  const [hour, setHour] = useState(ih)
  const [minute, setMinute] = useState(im)
  const [ampm, setAMPM] = useState<AMPM>(iap)
  const [phase, setPhase] = useState<Phase>('hour')
  const [textMode, setTextMode] = useState(false)
  const [textVal, setTextVal] = useState(displayTime(initial || '09:00'))

  const handleClockChange = (h: number, m: number, advance: boolean) => {
    setHour(h)
    setMinute(m)
    if (advance) setPhase('minute')
  }

  const handleOK = () => {
    if (textMode) {
      // parse "H:MM AM/PM" or "HH:MM"
      const match = textVal.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
      if (match) {
        const h = parseInt(match[1])
        const m = parseInt(match[2])
        const ap = (match[3]?.toUpperCase() as AMPM) ?? ampm
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          // If hour > 12, treat as 24h
          if (h > 12) {
            onConfirm(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
            return
          }
          onConfirm(toHHMM(h || 12, m, ap))
          return
        }
      }
    }
    onConfirm(toHHMM(hour, minute, ampm))
  }

  return createPortal(
    <div className="ctp-overlay" onMouseDown={onCancel}>
      <div className="ctp-dialog" onMouseDown={e => e.stopPropagation()}>
        <div className="ctp-title">SELECT TIME</div>

        {/* Time display */}
        <div className="ctp-display">
          <button
            className={`ctp-display-seg${phase === 'hour' ? ' ctp-display-seg--active' : ''}`}
            onClick={() => setPhase('hour')}
          >
            {String(hour).padStart(2, '0')}
          </button>
          <span className="ctp-display-colon">:</span>
          <button
            className={`ctp-display-seg${phase === 'minute' ? ' ctp-display-seg--active' : ''}`}
            onClick={() => setPhase('minute')}
          >
            {String(minute).padStart(2, '0')}
          </button>
          <div className="ctp-ampm">
            {(['AM', 'PM'] as AMPM[]).map(ap => (
              <button
                key={ap}
                className={`ctp-ampm-btn${ampm === ap ? ' ctp-ampm-btn--active' : ''}`}
                onClick={() => setAMPM(ap)}
              >
                {ap}
              </button>
            ))}
          </div>
        </div>

        {/* Clock or text input */}
        {textMode ? (
          <div className="ctp-text-wrap">
            <input
              className="ctp-text-input"
              value={textVal}
              onChange={e => setTextVal(e.target.value)}
              placeholder="7:00 AM"
              autoFocus
            />
          </div>
        ) : (
          <ClockFace
            phase={phase}
            hour={hour}
            minute={minute}
            onChange={handleClockChange}
          />
        )}

        {/* Footer */}
        <div className="ctp-footer">
          <button
            className="ctp-keyboard-btn"
            title="Enter time manually"
            onClick={() => setTextMode(t => !t)}
          >
            <Keyboard size={18} />
          </button>
          <button className="ctp-btn-cancel" onClick={onCancel}>CANCEL</button>
          <button className="ctp-btn-ok" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Exported component ────────────────────────────────────────────────────────

export interface ClockTimePickerProps {
  /** HH:MM in 24-hour format */
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}

export function ClockTimePicker({ value, onChange, className = '', placeholder }: ClockTimePickerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const label = value ? displayTime(value) : (placeholder ?? 'Select time…')

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  const handleConfirm = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
  }, [onChange])

  return (
    <div className={`pm-custom-dropdown ctp-root ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="pm-custom-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        style={{ gap: 8 }}
      >
        <Clock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        <ChevronDown size={11} className={`dropdown-chevron${open ? ' open' : ''}`} />
      </button>

      {open && (
        <ClockDialog
          initial={value}
          onConfirm={handleConfirm}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  )
}
