/**
 * IsoTicketCard — animated ticket card for the 3D isometric boards on the Login page.
 *
 * Design sources:
 *  - 21st.dev Typewriter component: char-by-char state machine + framer-motion cursor blink
 *  - 21st.dev Animated Support Card: AnimatePresence key={index} pattern for exit/enter
 *  - ui-ux-pro-max: ease-out enter / ease-in exit, prefers-reduced-motion, stagger offsets
 *
 * Layout (3 rows, justify-content: space-between fills 100px height evenly):
 *   [PM-127]          [● P1]   ← meta
 *   [AS] ⏱ 3h                  ← mid row (assignee + estimate)
 *   Sprint board drag & drop|  ← typewriter title
 */
import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface IsoTicketCardProps {
  color: 'red' | 'yellow' | 'green' | 'indigo' | 'purple'
  titles: string[]
  ticketId: string
  priority: 'P0' | 'P1' | 'P2'
  assignee: string    // 2-letter initials e.g. "AS"
  estimate: string    // e.g. "2h", "1d"
  initialDelay?: number
}

const PRIORITY_BG: Record<string, string> = {
  P0: 'rgba(239,68,68,0.30)',
  P1: 'rgba(245,158,11,0.30)',
  P2: 'rgba(99,102,241,0.30)',
}

// Subtle avatar background per initials (deterministic color variety)
const AVATAR_COLORS = [
  'rgba(99,102,241,0.35)',
  'rgba(139,92,246,0.35)',
  'rgba(16,185,129,0.35)',
  'rgba(245,158,11,0.35)',
  'rgba(236,72,153,0.35)',
]
function avatarColor(initials: string) {
  const idx = (initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

const CHAR_SPEED  = 42    // ms per character
const WAIT_TIME   = 2200  // ms hold after full title
const EXIT_MS     = 180   // ms for exit animation
const ENTER_PAUSE = 80    // ms gap between exit and next typing start

type Phase = 'idle' | 'typing' | 'waiting' | 'exiting'

export default function IsoTicketCard({
  color,
  titles,
  ticketId,
  priority,
  assignee,
  estimate,
  initialDelay = 0,
}: IsoTicketCardProps) {
  const [phase, setPhase]           = useState<Phase>('idle')
  const [displayedText, setDisplay] = useState('')
  const [titleIndex, setTitleIndex] = useState(0)
  const [visible, setVisible]       = useState(true)

  // 21st.dev Typewriter: respect prefers-reduced-motion
  const reducedMotion = useRef(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  )

  // ── Phase: idle → typing (after initialDelay) ──────────────
  useEffect(() => {
    const t = setTimeout(() => setPhase('typing'), initialDelay)
    return () => clearTimeout(t)
  }, [initialDelay])

  // ── Phase: typing ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'typing') return
    const currentTitle = titles[titleIndex]

    if (reducedMotion.current) {
      setDisplay(currentTitle)
      setPhase('waiting')
      return
    }

    if (displayedText.length < currentTitle.length) {
      const t = setTimeout(() => {
        setDisplay(currentTitle.slice(0, displayedText.length + 1))
      }, CHAR_SPEED)
      return () => clearTimeout(t)
    }

    setPhase('waiting')
  }, [phase, displayedText, titleIndex, titles])

  // ── Phase: waiting → exiting ───────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting') return
    const t = setTimeout(() => setPhase('exiting'), WAIT_TIME)
    return () => clearTimeout(t)
  }, [phase])

  // ── Phase: exiting → next typing cycle ────────────────────
  useEffect(() => {
    if (phase !== 'exiting') return
    setVisible(false)
    const t = setTimeout(() => {
      setTitleIndex(i => (i + 1) % titles.length)
      setDisplay('')
      setVisible(true)
      setPhase('typing')
    }, EXIT_MS + ENTER_PAUSE)
    return () => clearTimeout(t)
  }, [phase, titles.length])

  const isTyping = phase === 'typing'

  return (
    <div className={`iso-card ${color}`}>

      {/* ── Row 1: typewriter title (top) ── */}
      <div className="iso-card-title-wrap">
        <AnimatePresence mode="wait">
          {visible && (
            <motion.div
              key={titleIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { duration: EXIT_MS / 1000, ease: 'easeOut' },
              }}
              exit={{
                opacity: 0,
                y: -6,
                transition: { duration: EXIT_MS / 1000, ease: 'easeIn' },
              }}
              className="iso-card-title"
            >
              {displayedText}
              {/* framer-motion blinking cursor — from 21st.dev Typewriter source */}
              {isTyping && (
                <motion.span
                  className="iso-card-cursor"
                  variants={{
                    initial: { opacity: 0 },
                    animate: {
                      opacity: 1,
                      transition: {
                        duration: 0.01,
                        repeat: Infinity,
                        repeatDelay: 0.4,
                        repeatType: 'reverse',
                      },
                    },
                  }}
                  initial="initial"
                  animate="animate"
                >
                  |
                </motion.span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Row 2: assignee avatar + time estimate ── */}
      <div className="iso-card-midrow">
        <span className="iso-card-avatar" style={{ background: avatarColor(assignee) }}>
          {assignee}
        </span>
        <span className="iso-card-estimate">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          {estimate}
        </span>
      </div>

      {/* ── Row 3: ticket ID + priority pill (bottom) ── */}
      <div className="iso-card-meta">
        <span className="iso-card-id">{ticketId}</span>
        <span className="iso-card-priority" style={{ background: PRIORITY_BG[priority] }}>
          {priority}
        </span>
      </div>

    </div>
  )
}
