import { useState, useEffect, useRef, useCallback } from 'react'
import '@/styles/components/world-clock.css'

const CLAMP_MIN = -720
const CLAMP_MAX = 720
const RESET_MS = 7500
const PX_PER_MIN = 1

function fmtTime(date: Date, tz: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function fmtOffsetLabel(min: number): string {
  const h = min / 60
  const rounded = Math.round(h * 10) / 10
  return (rounded >= 0 ? '+' : '') + rounded + 'h'
}

export default function WorldClock() {
  const [realNow, setRealNow] = useState(() => new Date())
  const [offsetMin, setOffsetMin] = useState(0)
  const [copied, setCopied] = useState<'IST' | 'CET' | null>(null)

  // Drag state stored in refs to avoid stale closures in event listeners
  const dragZoneRef = useRef<'IST' | 'CET' | null>(null)
  const startXRef = useRef(0)
  const startOffsetRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live clock tick
  useEffect(() => {
    const id = setInterval(() => setRealNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => {
      setOffsetMin(0)
      dragZoneRef.current = null
    }, RESET_MS)
  }, [])

  const onMouseMove = useCallback((e: MouseEvent) => {
    const dx = e.clientX - startXRef.current
    const newOffset = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, startOffsetRef.current + dx * PX_PER_MIN))
    setOffsetMin(newOffset)
    scheduleReset()
  }, [scheduleReset])

  const onMouseUp = useCallback(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    // Keep timer running — auto-reset will fire
  }, [onMouseMove])

  const startDrag = useCallback((e: React.MouseEvent, zone: 'IST' | 'CET') => {
    e.preventDefault()
    dragZoneRef.current = zone
    startXRef.current = e.clientX
    startOffsetRef.current = offsetMin
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [offsetMin, onMouseMove, onMouseUp])

  const onLeave = useCallback((zone: 'IST' | 'CET') => {
    if (dragZoneRef.current !== zone || offsetMin === 0) return
    // Copy the OTHER zone's time to clipboard
    const displayDate = new Date(realNow.getTime() + offsetMin * 60_000)
    const otherTime = zone === 'IST' ? fmtTime(displayDate, 'Europe/Berlin') : fmtTime(displayDate, 'Asia/Kolkata')
    const otherZone = zone === 'IST' ? 'CET' : 'IST'
    navigator.clipboard.writeText(otherTime).catch(() => {})
    setCopied(otherZone)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(null), 1800)
  }, [offsetMin, realNow])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const displayDate = new Date(realNow.getTime() + offsetMin * 60_000)
  const istStr = fmtTime(displayDate, 'Asia/Kolkata')
  const cetStr = fmtTime(displayDate, 'Europe/Berlin')
  const isLive = offsetMin === 0

  return (
    <div className="wc-wrap">
      <span
        className={`wc-zone${copied === 'IST' ? ' wc-zone--copied' : ''}`}
        onMouseDown={e => startDrag(e, 'IST')}
        onMouseLeave={() => onLeave('IST')}
        title="India Standard Time — drag to explore"
      >
        <span className="wc-label">IST</span>
        <span className={`wc-time${!isLive ? ' wc-time--offset' : ''}`}>{istStr}</span>
        {copied === 'IST' && <span className="wc-copied">copied</span>}
      </span>
      <span className="wc-sep">·</span>
      <span
        className={`wc-zone${copied === 'CET' ? ' wc-zone--copied' : ''}`}
        onMouseDown={e => startDrag(e, 'CET')}
        onMouseLeave={() => onLeave('CET')}
        title="Central European Time — drag to explore"
      >
        <span className="wc-label">CET</span>
        <span className={`wc-time${!isLive ? ' wc-time--offset' : ''}`}>{cetStr}</span>
        {copied === 'CET' && <span className="wc-copied">copied</span>}
      </span>
      {!isLive && (
        <span className="wc-offset-badge">{fmtOffsetLabel(offsetMin)}</span>
      )}
    </div>
  )
}
