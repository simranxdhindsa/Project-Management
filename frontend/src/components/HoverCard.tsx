import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Archive, RotateCcw, ExternalLink } from 'lucide-react'
import { useIgnoredBlockedSafe } from '@/contexts/IgnoredBlockedContext'
import api from '@/services/api'

// Module-level singleton so any HoverCard instance reuses the same URL
let _ytBaseUrl = ''
let _ytFetchStarted = false
function getYtBaseUrl(): string { return _ytBaseUrl }
function fetchYtBaseUrlOnce(onReady: (url: string) => void) {
  if (_ytBaseUrl) { onReady(_ytBaseUrl); return }
  if (_ytFetchStarted) return
  _ytFetchStarted = true
  api.getYouTrackStatus()
    .then(res => {
      const url = ((res as any).base_url || (res as any).data?.base_url || '').replace(/\/$/, '')
      _ytBaseUrl = url
      onReady(url)
    })
    .catch(() => { _ytFetchStarted = false })
}

function ParkButton({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const ctx = useIgnoredBlockedSafe()
  if (!ctx) return null
  const { ignoredIds, ignoreTicket, unignoreTicket } = ctx
  const isParked = ignoredIds.has(issueId)
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isParked) { unignoreTicket(issueId) }
    else { ignoreTicket(issueId); onClose() }
  }
  return (
    <button className={`hc-park-btn${isParked ? ' hc-park-btn--parked' : ''}`} onClick={handleClick}>
      {isParked ? <><RotateCcw size={10} /> Unpark</> : <><Archive size={10} /> Park</>}
    </button>
  )
}

interface HoverCardProps {
  content: React.ReactNode | null
  children: React.ReactNode
  delay?: number
  maxWidth?: number
  issueId?: string
  isBlocked?: boolean
  summary?: string
}

export default function HoverCard({ content, children, delay = 280, maxWidth = 300, issueId, isBlocked, summary }: HoverCardProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0, above: true })
  const [ytUrl, setYtUrl] = useState(getYtBaseUrl)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (issueId && !ytUrl) fetchYtBaseUrlOnce(setYtUrl)
  }, [issueId, ytUrl])

  const show = useCallback(() => {
    if (!wrapRef.current) return
    // display:contents wrappers may return zero rect when children are position:absolute.
    // Fall back to the first visible child element when that happens.
    let rect = wrapRef.current.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      const child = wrapRef.current.firstElementChild as HTMLElement | null
      if (child) rect = child.getBoundingClientRect()
    }
    if (rect.width === 0 && rect.height === 0) return
    const spaceAbove = rect.top
    const above = spaceAbove > 180
    let x = rect.left + rect.width / 2 - maxWidth / 2
    x = Math.max(8, Math.min(x, window.innerWidth - maxWidth - 8))
    const y = above ? rect.top - 4 : rect.bottom + 4
    setPos({ x, y, above })
    setVisible(true)
  }, [maxWidth])

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setVisible(false), 3500)
  }, [])

  const handleEnter = useCallback(() => {
    if (!content && !issueId) return
    cancelHide()
    timerRef.current = setTimeout(show, delay)
  }, [show, delay, content, issueId, cancelHide])

  const handleLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    startHideTimer()
  }, [startHideTimer])

  const close = useCallback(() => setVisible(false), [])

  const ytHref = issueId && ytUrl ? `${ytUrl}/issue/${issueId}` : null

  return (
    <div
      ref={wrapRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ display: 'contents' }}
    >
      {children}
      {visible && createPortal(
        <div
          className={`hc-card${pos.above ? ' hc-card--above' : ' hc-card--below'}`}
          style={{ left: pos.x, top: pos.y, maxWidth }}
          onMouseEnter={cancelHide}
          onMouseLeave={startHideTimer}
        >
          {content}
          {issueId && (
            <>
              <div className="hc-divider" style={{ margin: '8px 0 6px' }} />
              <div className="hc-footer">
                {ytHref ? (
                  <a
                    className="hc-footer-id"
                    href={ytHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink size={10} />
                    {issueId}
                  </a>
                ) : (
                  <span className="hc-footer-id hc-footer-id--plain">{issueId}</span>
                )}
                {summary && <span className="hc-footer-summary">{summary}</span>}
                {isBlocked && <ParkButton issueId={issueId} onClose={close} />}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Reusable content blocks ──────────────────────────────────────────────────

export function HCRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="hc-row">
      <span className="hc-label">{label}</span>
      <span className={`hc-value${accent ? ` hc-value--${accent}` : ''}`}>{value}</span>
    </div>
  )
}

export function HCBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="hc-bar-track">
      <div className="hc-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

export function HCDivider() {
  return <div className="hc-divider" />
}

export function HCBadge({ label, variant }: { label: string; variant?: 'dev' | 'stg' | 'prd' | 'warn' | 'danger' | 'ok' }) {
  return <span className={`hc-badge${variant ? ` hc-badge--${variant}` : ''}`}>{label}</span>
}
