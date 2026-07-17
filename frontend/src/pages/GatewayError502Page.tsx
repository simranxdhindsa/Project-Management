import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { KanbanSquare, RefreshCw, Wifi } from 'lucide-react'
import { useGatewayError } from '@/contexts/GatewayErrorContext'
import { VelocityLogo } from '@/components/brand/VelocityLogo'

const MESSAGES = [
  'Deploying something new. Hang tight.',
  'The server is warming up.',
  'Your data is safe. Back in a moment.',
  'Database migrations are chugging along.',
  'Compiling the good stuff.',
  'Patience — shipping code, not pizza.',
  'CI passed. Deploy is catching up.',
  'Server had a nap. Waking it up now.',
  'Spinning up fresh containers.',
  'Almost there. Probably.',
  'kubectl apply is doing its thing.',
  'Still here. Still watching.',
]

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  return sec === 0 ? `${m}m` : `${m}m ${sec}s`
}

export default function GatewayError502Page() {
  const { clear } = useGatewayError()
  const [msgQueue] = useState(() => shuffle(MESSAGES))
  const [msgIndex, setMsgIndex] = useState(0)
  const [checking, setChecking] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const checkingRef = useRef(false)

  const probe = async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    try {
      const res = await fetch(`${API_URL}/health`, { method: 'GET', cache: 'no-store' })
      if (res.ok || res.status < 500) {
        clear()
        return
      }
    } catch {
      // still down
    }
    checkingRef.current = false
    setChecking(false)
  }

  // Poll every 2 seconds, unlimited
  useEffect(() => {
    probe()
    const interval = setInterval(probe, 2000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotate messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % msgQueue.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [msgQueue.length])

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const handleManualRetry = () => {
    checkingRef.current = false
    probe()
  }

  return (
    <div className="g5-root">
      <div className="g5-blob g5-blob-1" />
      <div className="g5-blob g5-blob-2" />

      <div className="g5-card">
        <div className="g5-wordmark">
          <KanbanSquare size={18} />
          <span>Velocity</span>
        </div>

        {/* Logo — gentle breathe */}
        <motion.div
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <VelocityLogo variant="icon" size="xl" mark="chevron" showStatusDot={false} />
        </motion.div>

        {/* Wifi icon */}
        <motion.div
          className="g5-icon-wrap"
          animate={checking ? { scale: [1, 1.12, 1] } : { scale: 1 }}
          transition={{ duration: 0.6, repeat: checking ? Infinity : 0, ease: 'easeInOut' }}
        >
          <Wifi size={36} />
        </motion.div>

        <h1 className="g5-heading">Server Unreachable</h1>

        {/* Rotating message with crossfade */}
        <div className="g5-message-wrap">
          <AnimatePresence mode="wait">
            <motion.p
              key={msgIndex}
              className="g5-message"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4 }}
            >
              {msgQueue[msgIndex]}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Animated dots */}
        <div className="g5-dots">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="g5-dot"
              animate={{ y: [0, -7, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
            />
          ))}
        </div>

        {/* Elapsed time */}
        <p className="g5-elapsed">
          {checking ? 'Checking connection' : `Reconnecting for ${fmtElapsed(elapsed)}`}
        </p>

        <div className="g5-actions">
          <button
            className="g5-btn-retry"
            onClick={handleManualRetry}
            disabled={checking}
          >
            <RefreshCw size={14} className={checking ? 'g5-spin' : ''} />
            {checking ? 'Checking' : 'Retry now'}
          </button>
        </div>

        <p className="g5-footnote">
          502 · Bad Gateway · Auto-retrying every 2s
        </p>
      </div>
    </div>
  )
}
