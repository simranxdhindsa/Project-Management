import { useState, useEffect } from 'react'
import { Palette, RotateCcw, Save, Moon, Sun } from 'lucide-react'
import api from '@/services/api'
import { applyUserTheme } from '@/utils/themeUtils'

const DEFAULTS = {
  darkAccent:  '#6366f1',
  darkBg:      '#020617',
  darkText:    '#f1f5f9',
  lightAccent: '#6366f1',
  lightBg:     '#f8fafc',
  lightText:   '#0f172a',
}

export function ThemeSettingsPage() {
  const [activeMode, setActiveMode] = useState<'dark' | 'light'>('dark')
  const [darkAccent,  setDarkAccent]  = useState(DEFAULTS.darkAccent)
  const [darkBg,      setDarkBg]      = useState(DEFAULTS.darkBg)
  const [darkText,    setDarkText]    = useState(DEFAULTS.darkText)
  const [lightAccent, setLightAccent] = useState(DEFAULTS.lightAccent)
  const [lightBg,     setLightBg]     = useState(DEFAULTS.lightBg)
  const [lightText,   setLightText]   = useState(DEFAULTS.lightText)
  const [saving,  setSaving]  = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getUserTheme().then(res => {
      if (res.data) {
        const { dark_accent, dark_bg, dark_text, light_accent, light_bg, light_text } = res.data
        setDarkAccent(dark_accent)
        setDarkBg(dark_bg)
        setDarkText(dark_text || DEFAULTS.darkText)
        setLightAccent(light_accent)
        setLightBg(light_bg)
        setLightText(light_text || DEFAULTS.lightText)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const accent = activeMode === 'dark' ? darkAccent : lightAccent
  const bg     = activeMode === 'dark' ? darkBg     : lightBg
  const text   = activeMode === 'dark' ? darkText   : lightText

  function applyAll(da=darkAccent, db=darkBg, dt=darkText, la=lightAccent, lb=lightBg, lt=lightText) {
    applyUserTheme(da, db, la, lb, dt, lt)
  }

  function setAccent(val: string) {
    if (activeMode === 'dark') { setDarkAccent(val);  applyAll(val, darkBg, darkText, lightAccent, lightBg, lightText) }
    else                       { setLightAccent(val); applyAll(darkAccent, darkBg, darkText, val, lightBg, lightText) }
  }
  function setBg(val: string) {
    if (activeMode === 'dark') { setDarkBg(val);  applyAll(darkAccent, val, darkText, lightAccent, lightBg, lightText) }
    else                       { setLightBg(val); applyAll(darkAccent, darkBg, darkText, lightAccent, val, lightText) }
  }
  function setText(val: string) {
    if (activeMode === 'dark') { setDarkText(val);  applyAll(darkAccent, darkBg, val, lightAccent, lightBg, lightText) }
    else                       { setLightText(val); applyAll(darkAccent, darkBg, darkText, lightAccent, lightBg, val) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.saveUserTheme({ dark_accent: darkAccent, dark_bg: darkBg, dark_text: darkText, light_accent: lightAccent, light_bg: lightBg, light_text: lightText })
      applyAll()
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2500)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  function handleReset() {
    setDarkAccent(DEFAULTS.darkAccent); setDarkBg(DEFAULTS.darkBg); setDarkText(DEFAULTS.darkText)
    setLightAccent(DEFAULTS.lightAccent); setLightBg(DEFAULTS.lightBg); setLightText(DEFAULTS.lightText)
    applyUserTheme(DEFAULTS.darkAccent, DEFAULTS.darkBg, DEFAULTS.lightAccent, DEFAULTS.lightBg, DEFAULTS.darkText, DEFAULTS.lightText)
    api.saveUserTheme({ dark_accent: DEFAULTS.darkAccent, dark_bg: DEFAULTS.darkBg, dark_text: DEFAULTS.darkText, light_accent: DEFAULTS.lightAccent, light_bg: DEFAULTS.lightBg, light_text: DEFAULTS.lightText }).catch(() => {})
  }

  if (loading) {
    return (
      <div className="tsp-page">
        <div className="tsp-skeleton-header skeleton" />
        <div className="tsp-skeleton-body skeleton" />
      </div>
    )
  }

  return (
    <div className="tsp-page">
      {/* Page header */}
      <div className="tsp-page-header">
        <div className="tsp-page-title-wrap">
          <Palette size={22} />
          <h1 className="tsp-page-title">Theme Customization</h1>
        </div>
        <p className="tsp-page-subtitle">Personalize accent and background colors for each mode. Changes apply live as you pick.</p>
      </div>

      <div className="tsp-layout">
        {/* Left: controls */}
        <div className="tsp-controls-col">

          {/* Mode tabs */}
          <div className="tsp-mode-tabs">
            <button
              className={`tsp-mode-tab${activeMode === 'dark' ? ' active' : ''}`}
              onClick={() => setActiveMode('dark')}
            >
              <Moon size={14} />
              Dark Mode
            </button>
            <button
              className={`tsp-mode-tab${activeMode === 'light' ? ' active' : ''}`}
              onClick={() => setActiveMode('light')}
            >
              <Sun size={14} />
              Light Mode
            </button>
          </div>

          {/* Accent color picker */}
          <div className="tsp-card">
            <div className="tsp-card-header">
              <span className="tsp-card-title">Accent Color</span>
              <span className="tsp-card-desc">Buttons, badges, links, active states, logo gradient</span>
            </div>
            <div className="tsp-picker-row">
              <label className="tsp-swatch-label" htmlFor="accent-picker">
                <div className="tsp-swatch" style={{ background: accent }} />
                <input
                  id="accent-picker"
                  type="color"
                  value={accent}
                  onChange={e => setAccent(e.target.value)}
                  className="tsp-color-input"
                />
              </label>
              <span className="tsp-hex-value">{accent}</span>
              <div className="tsp-derived-chips">
                <span className="tsp-chip" style={{ background: accent, opacity: 0.7 }}>Base</span>
                <span className="tsp-chip" style={{ background: accent, opacity: 0.45 }}>Hover</span>
                <span className="tsp-chip" style={{ background: accent, opacity: 0.25 }}>Muted</span>
              </div>
            </div>
          </div>

          {/* Background color picker */}
          <div className="tsp-card">
            <div className="tsp-card-header">
              <span className="tsp-card-title">Background Color</span>
              <span className="tsp-card-desc">Page background, surfaces, and ambient gradient</span>
            </div>
            <div className="tsp-picker-row">
              <label className="tsp-swatch-label" htmlFor="bg-picker">
                <div className="tsp-swatch" style={{ background: bg }} />
                <input
                  id="bg-picker"
                  type="color"
                  value={bg}
                  onChange={e => setBg(e.target.value)}
                  className="tsp-color-input"
                />
              </label>
              <span className="tsp-hex-value">{bg}</span>
            </div>
          </div>

          {/* Text color picker */}
          <div className="tsp-card">
            <div className="tsp-card-header">
              <span className="tsp-card-title">Text Color</span>
              <span className="tsp-card-desc">Primary text across the entire app</span>
            </div>
            <div className="tsp-picker-row">
              <label className="tsp-swatch-label" htmlFor="text-picker">
                <div className="tsp-swatch tsp-swatch--text" style={{ background: text }} />
                <input
                  id="text-picker"
                  type="color"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  className="tsp-color-input"
                />
              </label>
              <span className="tsp-hex-value">{text}</span>
              <span className="tsp-text-sample" style={{ color: text, background: bg }}>Aa</span>
            </div>
          </div>

          {/* Actions */}
          <div className="tsp-actions">
            <button className="tsp-reset-btn" onClick={handleReset}>
              <RotateCcw size={14} />
              Reset to Default
            </button>
            <button className="tsp-save-btn" onClick={handleSave} disabled={saving}>
              <Save size={14} />
              {saving ? 'Saving…' : savedMsg ? 'Saved!' : 'Apply & Save'}
            </button>
          </div>

          {savedMsg && (
            <div className="tsp-saved-banner">Theme saved and applied successfully.</div>
          )}
        </div>

        {/* Right: live preview */}
        <div className="tsp-preview-col">
          <span className="tsp-preview-label">Live Preview</span>
          <div className="tsp-preview-shell" style={{ background: bg, borderColor: accent }}>
            {/* Fake sidebar strip */}
            <div className="tsp-preview-sidebar" style={{ borderColor: `${accent}30` }}>
              <div className="tsp-preview-logo" style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}99 100%)` }} />
              {[1, 2, 3].map(i => (
                <div key={i} className={`tsp-preview-nav-item${i === 1 ? ' active' : ''}`}
                  style={i === 1 ? { background: `${accent}22`, borderColor: `${accent}55` } : {}} />
              ))}
            </div>
            {/* Fake content */}
            <div className="tsp-preview-content">
              {/* Header strip */}
              <div className="tsp-preview-header" style={{ borderColor: `${accent}20` }}>
                <div className="tsp-preview-title-bar" />
                <div className="tsp-preview-action-btn" style={{ background: accent }} />
              </div>
              {/* Cards */}
              <div className="tsp-preview-cards">
                {[1, 2, 3].map(i => (
                  <div key={i} className="tsp-preview-card" style={{ borderColor: `${accent}22` }}>
                    <div className="tsp-preview-card-tag" style={{ background: `${accent}25`, color: accent }} />
                    <div className="tsp-preview-card-line" />
                    <div className="tsp-preview-card-line tsp-short" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
