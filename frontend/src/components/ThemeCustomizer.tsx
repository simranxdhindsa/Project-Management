import { useState, useEffect, useRef } from 'react'
import { Palette } from 'lucide-react'
import api from '@/services/api'
import { applyUserTheme } from '@/utils/themeUtils'

const DEFAULTS = {
  darkAccent: '#6366f1',
  darkBg: '#020617',
  lightAccent: '#6366f1',
  lightBg: '#f8fafc',
}

interface ThemeCustomizerProps {
  onSaved?: () => void
}

export function ThemeCustomizer({ onSaved }: ThemeCustomizerProps) {
  const [open, setOpen] = useState(false)
  const [activeMode, setActiveMode] = useState<'dark' | 'light'>('dark')
  const [darkAccent, setDarkAccent] = useState(DEFAULTS.darkAccent)
  const [darkBg, setDarkBg] = useState(DEFAULTS.darkBg)
  const [lightAccent, setLightAccent] = useState(DEFAULTS.lightAccent)
  const [lightBg, setLightBg] = useState(DEFAULTS.lightBg)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Load saved preferences on mount
  useEffect(() => {
    api.getUserTheme().then(res => {
      if (res.data) {
        const { dark_accent, dark_bg, light_accent, light_bg } = res.data
        setDarkAccent(dark_accent)
        setDarkBg(dark_bg)
        setLightAccent(light_accent)
        setLightBg(light_bg)
        applyUserTheme(dark_accent, dark_bg, light_accent, light_bg)
      }
    }).catch(() => {})
  }, [])

  // Outside-click handler
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const currentAccent = activeMode === 'dark' ? darkAccent : lightAccent
  const currentBg = activeMode === 'dark' ? darkBg : lightBg

  function handleAccentChange(val: string) {
    if (activeMode === 'dark') {
      setDarkAccent(val)
      applyUserTheme(val, darkBg, lightAccent, lightBg)
    } else {
      setLightAccent(val)
      applyUserTheme(darkAccent, darkBg, val, lightBg)
    }
  }

  function handleBgChange(val: string) {
    if (activeMode === 'dark') {
      setDarkBg(val)
      applyUserTheme(darkAccent, val, lightAccent, lightBg)
    } else {
      setLightBg(val)
      applyUserTheme(darkAccent, darkBg, lightAccent, val)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.saveUserTheme({
        dark_accent: darkAccent,
        dark_bg: darkBg,
        light_accent: lightAccent,
        light_bg: lightBg,
      })
      applyUserTheme(darkAccent, darkBg, lightAccent, lightBg)
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2000)
      onSaved?.()
    } catch {
      // fail silently
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setDarkAccent(DEFAULTS.darkAccent)
    setDarkBg(DEFAULTS.darkBg)
    setLightAccent(DEFAULTS.lightAccent)
    setLightBg(DEFAULTS.lightBg)
    applyUserTheme(DEFAULTS.darkAccent, DEFAULTS.darkBg, DEFAULTS.lightAccent, DEFAULTS.lightBg)
    api.saveUserTheme({
      dark_accent: DEFAULTS.darkAccent,
      dark_bg: DEFAULTS.darkBg,
      light_accent: DEFAULTS.lightAccent,
      light_bg: DEFAULTS.lightBg,
    }).catch(() => {})
  }

  return (
    <div className="theme-cust-wrap" ref={panelRef}>
      <button
        className="theme-cust-btn"
        onClick={() => setOpen(o => !o)}
        title="Customize Theme"
      >
        <Palette size={16} />
      </button>

      {open && (
        <div className="theme-cust-panel">
          <div className="theme-cust-header">
            <span>Theme Colors</span>
            <button className="theme-cust-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="theme-cust-tabs">
            <button
              className={`theme-cust-tab${activeMode === 'dark' ? ' active' : ''}`}
              onClick={() => setActiveMode('dark')}
            >
              Dark Mode
            </button>
            <button
              className={`theme-cust-tab${activeMode === 'light' ? ' active' : ''}`}
              onClick={() => setActiveMode('light')}
            >
              Light Mode
            </button>
          </div>

          <div className="theme-cust-controls">
            <div className="theme-cust-row">
              <label className="theme-cust-label">Accent Color</label>
              <div className="theme-cust-picker-wrap">
                <div
                  className="theme-cust-swatch"
                  style={{ background: currentAccent }}
                />
                <input
                  type="color"
                  value={currentAccent}
                  onChange={e => handleAccentChange(e.target.value)}
                  className="theme-cust-color-input"
                />
                <span className="theme-cust-hex">{currentAccent}</span>
              </div>
              <p className="theme-cust-hint">Buttons, badges, links, highlights</p>
            </div>

            <div className="theme-cust-row">
              <label className="theme-cust-label">Background</label>
              <div className="theme-cust-picker-wrap">
                <div
                  className="theme-cust-swatch"
                  style={{ background: currentBg }}
                />
                <input
                  type="color"
                  value={currentBg}
                  onChange={e => handleBgChange(e.target.value)}
                  className="theme-cust-color-input"
                />
                <span className="theme-cust-hex">{currentBg}</span>
              </div>
              <p className="theme-cust-hint">Page background base</p>
            </div>

            <div
              className="theme-cust-preview"
              style={{
                background: currentBg,
                borderColor: currentAccent,
              }}
            >
              <span style={{ color: currentAccent }}>Preview</span>
              <div
                className="theme-cust-preview-btn"
                style={{ background: currentAccent }}
              >
                Button
              </div>
            </div>
          </div>

          <div className="theme-cust-actions">
            <button className="theme-cust-reset" onClick={handleReset}>
              Reset Default
            </button>
            <button
              className="theme-cust-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : savedMsg ? 'Saved!' : 'Apply & Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
