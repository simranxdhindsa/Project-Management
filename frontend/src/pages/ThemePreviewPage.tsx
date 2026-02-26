import React from 'react'

// ─── Mini mockup components ───────────────────────────────────────────────────

function MockHeader({ vars }: { vars: Record<string, string> }) {
  return (
    <div style={{
      background: vars['--surface-bg'],
      borderBottom: `1px solid ${vars['--border-color']}`,
      padding: '0.6rem 1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      <span style={{ color: vars['--text-primary'], fontWeight: 700, fontSize: '0.9rem' }}>
        PM Command Centre
      </span>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: vars['--color-primary'], opacity: 0.7 }} />
      </div>
    </div>
  )
}

function MockSidebar({ vars }: { vars: Record<string, string> }) {
  const items = ['⚡', '📋', '👥', '🔔', '⚙️']
  return (
    <div style={{
      width: 52,
      background: vars['--surface-bg'],
      borderRight: `1px solid ${vars['--border-color']}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '0.75rem 0',
      gap: '0.5rem',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      {items.map((icon, i) => (
        <div key={i} style={{
          width: 34, height: 34, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.9rem',
          background: i === 1 ? vars['--color-primary'] : 'transparent',
          cursor: 'default',
        }}>
          {icon}
        </div>
      ))}
    </div>
  )
}

function MockCard({ vars, children }: { vars: Record<string, string>; children: React.ReactNode }) {
  return (
    <div style={{
      background: vars['--glass-bg'],
      border: `1px solid ${vars['--glass-border']}`,
      borderRadius: 12,
      padding: '0.75rem',
      backdropFilter: vars['--glass-blur'],
      WebkitBackdropFilter: vars['--glass-blur'],
      boxShadow: vars['--glass-shadow'],
    }}>
      {children}
    </div>
  )
}

function MockPanel({
  label,
  vars,
  bgStyle,
  onSelect,
  optionKey,
}: {
  label: string
  vars: Record<string, string>
  bgStyle: React.CSSProperties
  onSelect: (opt: 'A' | 'B') => void
  optionKey: 'A' | 'B'
}) {
  const priorities = [
    { color: '#ef4444', label: 'P0', text: 'Avatar chat transcript missing' },
    { color: '#f59e0b', label: 'P1', text: 'CSV import drops accented chars' },
    { color: '#6366f1', label: 'P2', text: 'Studio mic stays on between sessions' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
      {/* Label */}
      <div style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-block',
          background: vars['--color-primary'],
          color: '#fff',
          borderRadius: 20,
          padding: '0.2rem 0.9rem',
          fontSize: '0.78rem',
          fontWeight: 600,
          letterSpacing: '0.03em',
        }}>
          {label}
        </span>
      </div>

      {/* App mockup */}
      <div style={{
        ...bgStyle,
        borderRadius: 14,
        overflow: 'hidden',
        border: `1px solid ${vars['--border-color']}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        height: 420,
      }}>
        <MockHeader vars={vars} />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <MockSidebar vars={vars} />
          <div style={{ flex: 1, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', overflow: 'hidden' }}>

            {/* Stat chips row */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[
                { label: '12 Done', color: '#10b981' },
                { label: '4 Blocked', color: '#ef4444' },
                { label: '28 Open', color: vars['--text-secondary'] },
              ].map(c => (
                <div key={c.label} style={{
                  fontSize: '0.68rem', fontWeight: 600,
                  color: c.color,
                  background: vars['--glass-bg'],
                  border: `1px solid ${vars['--border-color']}`,
                  borderRadius: 20,
                  padding: '0.2rem 0.55rem',
                }}>
                  {c.label}
                </div>
              ))}
            </div>

            {/* Issues card */}
            <MockCard vars={vars}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: vars['--text-muted'], marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Open Issues
              </div>
              {priorities.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.3rem 0',
                  borderBottom: i < priorities.length - 1 ? `1px solid ${vars['--border-color']}` : 'none',
                }}>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, color: '#fff',
                    background: p.color, borderRadius: 4,
                    padding: '0.1rem 0.3rem', flexShrink: 0,
                  }}>{p.label}</span>
                  <span style={{ fontSize: '0.72rem', color: vars['--text-primary'], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.text}
                  </span>
                </div>
              ))}
            </MockCard>

            {/* Report card */}
            <MockCard vars={vars}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: vars['--text-muted'], marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Daily Report — Thu, Feb 26
              </div>
              {['• ARD-812 FE MC: Sanitize LLM output before render', '• ARD-803 BE UI: Fix course unassign issue'].map((line, i) => (
                <div key={i} style={{ fontSize: '0.7rem', color: vars['--text-secondary'], lineHeight: 1.6 }}>{line}</div>
              ))}
            </MockCard>

          </div>
        </div>
      </div>

      {/* Select button */}
      <button
        onClick={() => onSelect(optionKey)}
        style={{
          background: vars['--color-primary'],
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          padding: '0.65rem 1.5rem',
          fontWeight: 600,
          fontSize: '0.88rem',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
          alignSelf: 'center',
          width: '100%',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        Select Option {optionKey}
      </button>
    </div>
  )
}

// ─── Theme variable sets ───────────────────────────────────────────────────────

const OPTION_A_VARS: Record<string, string> = {
  '--text-primary': '#0f172a',
  '--text-secondary': '#334155',
  '--text-muted': '#64748b',
  '--glass-bg': 'rgba(255,255,255,0.92)',
  '--glass-bg-hover': 'rgba(255,255,255,0.98)',
  '--glass-border': 'rgba(0,0,0,0.08)',
  '--glass-shadow': '0 8px 32px rgba(0,0,0,0.08)',
  '--glass-blur': 'blur(12px)',
  '--border-color': 'rgba(0,0,0,0.1)',
  '--surface-bg': 'rgba(255,255,255,0.96)',
  '--color-primary': '#6366f1',
  '--color-primary-hover': '#4f46e5',
}

const OPTION_A_BG: React.CSSProperties = {
  background: '#f1f5f9',
}

const OPTION_B_VARS: Record<string, string> = {
  '--text-primary': '#1e1b4b',
  '--text-secondary': '#3730a3',
  '--text-muted': '#6366f1',
  '--glass-bg': 'rgba(255,255,255,0.55)',
  '--glass-bg-hover': 'rgba(255,255,255,0.7)',
  '--glass-border': 'rgba(255,255,255,0.82)',
  '--glass-shadow': '0 8px 32px rgba(99,102,241,0.12)',
  '--glass-blur': 'blur(12px)',
  '--border-color': 'rgba(99,102,241,0.18)',
  '--surface-bg': 'rgba(255,255,255,0.65)',
  '--color-primary': '#6366f1',
  '--color-primary-hover': '#4f46e5',
}

const OPTION_B_BG: React.CSSProperties = {
  background: 'linear-gradient(135deg, #e0e7ff 0%, #f0f4ff 50%, #dbeafe 100%)',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ThemePreviewPage() {
  const [selected, setSelected] = React.useState<'A' | 'B' | null>(null)

  function handleSelect(opt: 'A' | 'B') {
    setSelected(opt)
    // Scroll to top so user sees the confirmation banner
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e3a5f 100%)',
      backgroundAttachment: 'fixed',
      padding: '2rem',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          Pick your light theme style
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
          See both options below, then tell us which one to implement.
        </p>
      </div>

      {/* Selection banner */}
      {selected && (
        <div style={{
          background: selected === 'A' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)',
          border: `1px solid ${selected === 'A' ? 'rgba(16,185,129,0.4)' : 'rgba(99,102,241,0.4)'}`,
          borderRadius: 12,
          padding: '0.75rem 1.25rem',
          marginBottom: '1.5rem',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.9rem',
        }}>
          <span>
            ✓ You selected <strong>Option {selected}</strong> — {selected === 'A' ? 'Clean white / light gray' : 'Glassmorphism light palette'}.
            Tell us to proceed and we'll implement the full light theme.
          </span>
          <button
            onClick={() => setSelected(null)}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Two panels */}
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
        <MockPanel
          label="Option A — Clean white / light gray"
          vars={OPTION_A_VARS}
          bgStyle={OPTION_A_BG}
          onSelect={handleSelect}
          optionKey="A"
        />
        <MockPanel
          label="Option B — Glassmorphism light palette"
          vars={OPTION_B_VARS}
          bgStyle={OPTION_B_BG}
          onSelect={handleSelect}
          optionKey="B"
        />
      </div>

      {/* Footer note */}
      <p style={{ color: '#475569', textAlign: 'center', marginTop: '2rem', fontSize: '0.78rem' }}>
        Both options keep the same brand colors (indigo/purple) and all existing functionality.
        The Dark Mode toggle will switch between your chosen light theme and the current dark theme.
      </p>
    </div>
  )
}
