import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Download, ChevronLeft, ChevronRight, Music, FileText,
  File, AlertCircle, Play, Pause, Volume2, VolumeX, Maximize2,
  Image as ImageIcon, Video, FileCode,
} from 'lucide-react'
import api from '@/services/api'
import type { YouTrackAttachment } from '@/services/api'

interface AttachmentViewerProps {
  attachments: YouTrackAttachment[]
  initialIndex: number
  onClose: () => void
}

type ViewerType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'office' | 'unsupported'

function detectType(a: YouTrackAttachment): ViewerType {
  const mime = (a.mimeType || '').toLowerCase()
  const ext  = (a.extension || a.name?.split('.').pop() || '').toLowerCase()
  if (mime.startsWith('image/')  || ['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return 'image'
  if (mime.startsWith('video/')  || ['mp4','webm','mov','mkv','avi','m4v','wmv','flv'].includes(ext)) return 'video'
  if (mime.startsWith('audio/')  || ['mp3','wav','ogg','aac','flac','m4a','opus','wma'].includes(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf')  return 'pdf'
  if (mime.startsWith('text/')   || ['txt','md','json','csv','xml','log','yaml','yml','toml','ini','env','sh','ts','tsx','js','jsx','py','go','rs','java','c','cpp','h','css','html'].includes(ext)) return 'text'
  if (['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp'].includes(ext)) return 'office'
  return 'unsupported'
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function TypeIcon({ type, size = 18 }: { type: ViewerType; size?: number }) {
  switch (type) {
    case 'image': return <ImageIcon size={size} />
    case 'video': return <Video size={size} />
    case 'audio': return <Music size={size} />
    case 'pdf':   return <FileText size={size} />
    case 'text':  return <FileCode size={size} />
    default:      return <File size={size} />
  }
}

export function AttachmentViewer({ attachments, initialIndex, onClose }: AttachmentViewerProps) {
  const [index, setIndex] = useState(initialIndex)
  const [blobUrl, setBlobUrl]           = useState<string | null>(null)
  const [textContent, setTextContent]   = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<'failed' | 'large' | null>(null)
  const [officeError, setOfficeError]   = useState(false)
  const [retryKey, setRetryKey]         = useState(0)
  const blobRef = useRef<string | null>(null)

  // Image zoom + pan
  const [zoom, setZoom]       = useState(1)
  const [pan, setPan]         = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  // Video controls
  const videoRef                        = useRef<HTMLVideoElement>(null)
  const audioRef                        = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying]           = useState(false)
  const [currentTime, setCurrentTime]   = useState(0)
  const [duration, setDuration]         = useState(0)
  const [volume, setVolume]             = useState(1)
  const [muted, setMuted]               = useState(false)
  const [videoError, setVideoError]     = useState(false)
  const [showControls, setShowControls] = useState(true)
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Thumbnail blob URLs (images only)
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({})
  const thumbRevoke = useRef<Record<number, string>>({})

  const current = attachments[index]
  const type    = detectType(current)

  // ── Load attachment content ────────────────────────────────────────────────
  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null

    setLoading(true)
    setBlobUrl(null)
    setTextContent(null)
    setError(null)
    setOfficeError(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setPlaying(false)
    setVideoError(false)
    setCurrentTime(0)
    setDuration(0)

    const a = attachments[index]
    const t = detectType(a)

    // Skip blob for very large binary files (> 150MB)
    if (a.size > 150 * 1024 * 1024 && t !== 'text' && t !== 'office') {
      setLoading(false)
      setError('large')
      return
    }

    const load = async () => {
      try {
        if (t === 'text') {
          const text = await api.fetchAttachmentText(a.url)
          if (!revoked) setTextContent(text)
        } else if (t === 'office') {
          // Pass proxy URL to Google Docs Viewer — works in production when server is reachable
          const proxyUrl = api.buildProxyUrl(a.url)
          if (!revoked) setBlobUrl(proxyUrl)
        } else {
          const blob = await api.fetchAttachmentBlob(a.url)
          if (!revoked) {
            objectUrl = URL.createObjectURL(blob)
            blobRef.current = objectUrl
            setBlobUrl(objectUrl)
          }
        }
      } catch {
        if (!revoked) setError('failed')
      } finally {
        if (!revoked) setLoading(false)
      }
    }
    load()

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [index, retryKey])

  // ── Load image thumbnails for strip ───────────────────────────────────────
  useEffect(() => {
    attachments.forEach((a, i) => {
      if (detectType(a) === 'image' && !thumbRevoke.current[i]) {
        api.fetchAttachmentBlob(a.url)
          .then(blob => {
            const url = URL.createObjectURL(blob)
            thumbRevoke.current[i] = url
            setThumbUrls(prev => ({ ...prev, [i]: url }))
          })
          .catch(() => {})
      }
    })
    return () => {
      Object.values(thumbRevoke.current).forEach(u => URL.revokeObjectURL(u))
    }
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const el = videoRef.current || audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play().then(() => setPlaying(true)).catch(() => {}) }
  }, [playing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, attachments.length - 1))
      if (e.key === 'ArrowLeft')  setIndex(i => Math.max(i - 1, 0))
      if (e.key === ' ' && (type === 'video' || type === 'audio')) { e.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, type, attachments.length, onClose])

  // ── Video auto-hide controls ───────────────────────────────────────────────
  const resetControlsTimer = () => {
    setShowControls(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }

  // ── Image zoom + pan ───────────────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => {
      const next = Math.min(8, Math.max(1, z - e.deltaY * 0.004))
      if (next <= 1) setPan({ x: 0, y: 0 })
      return next
    })
  }

  const handleImgMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) { setZoom(2.5); return }
    e.preventDefault()
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }

  const handleImgMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    setPan({
      x: dragStart.current.px + e.clientX - dragStart.current.mx,
      y: dragStart.current.py + e.clientY - dragStart.current.my,
    })
  }

  const handleImgMouseUp = () => setDragging(false)

  // ── Video handlers ─────────────────────────────────────────────────────────
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    if (videoRef.current) videoRef.current.currentTime = t
    setCurrentTime(t)
  }

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = false }
    setVolume(v); setMuted(v === 0)
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    const next = !muted
    videoRef.current.muted = next
    setMuted(next)
  }

  const handleFullscreen = () => {
    const el = videoRef.current?.closest('.avw-video-wrap') as HTMLElement | null
    if (!el) return
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()
  }

  // ── Audio handlers ─────────────────────────────────────────────────────────
  const handleAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    setCurrentTime(t)
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = async () => {
    try {
      const blob = await api.fetchAttachmentBlob(current.url)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = current.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch {}
  }

  // ── Render content by type ─────────────────────────────────────────────────
  const renderContent = () => {
    if (loading) {
      return (
        <div className="avw-loading">
          <div className="avw-spinner" />
          <span>Loading {current.name}…</span>
        </div>
      )
    }

    if (error === 'failed') {
      return (
        <div className="avw-error">
          <AlertCircle size={36} className="avw-error-icon" />
          <span>Failed to load attachment</span>
          <button className="avw-retry-btn" onClick={() => setRetryKey(k => k + 1)}>Retry</button>
        </div>
      )
    }

    if (error === 'large') {
      return (
        <div className="avw-unsupported">
          <div className="avw-unsupported-icon"><TypeIcon type={type} size={32} /></div>
          <div className="avw-unsupported-name">{current.name}</div>
          <div className="avw-unsupported-meta">{formatBytes(current.size)}</div>
          <div className="avw-unsupported-note">File is too large to preview in-app</div>
          <button className="avw-unsupported-dl-btn" onClick={handleDownload}>
            <Download size={15} /> Download File
          </button>
        </div>
      )
    }

    // Image
    if (type === 'image' && blobUrl) {
      return (
        <div
          className="avw-image-wrap"
          onWheel={handleWheel}
          onMouseDown={handleImgMouseDown}
          onMouseMove={handleImgMouseMove}
          onMouseUp={handleImgMouseUp}
          onMouseLeave={handleImgMouseUp}
        >
          <img
            src={blobUrl}
            alt={current.name}
            className={`avw-image ${dragging ? 'dragging' : zoom > 1 ? 'zoom-out' : 'zoom-in'}`}
            style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
            draggable={false}
          />
        </div>
      )
    }

    // Video
    if (type === 'video' && blobUrl) {
      if (videoError) {
        return (
          <div className="avw-unsupported">
            <div className="avw-unsupported-icon"><Video size={32} /></div>
            <div className="avw-unsupported-name">{current.name}</div>
            <div className="avw-unsupported-meta">{formatBytes(current.size)} · Codec not supported</div>
            <div className="avw-unsupported-note">This video format cannot be played in-browser</div>
            <button className="avw-unsupported-dl-btn" onClick={handleDownload}>
              <Download size={15} /> Download to play locally
            </button>
          </div>
        )
      }
      return (
        <div
          className="avw-video-wrap"
          onMouseMove={resetControlsTimer}
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={blobUrl}
            className="avw-video"
            preload="metadata"
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setVideoError(true)}
          />
          <div className={`avw-video-controls ${showControls ? '' : 'hidden'}`}
            onClick={e => e.stopPropagation()}>
            <div className="avw-vc-seek-row">
              <input
                type="range" min={0} max={duration || 1} step={0.1}
                value={currentTime}
                className="avw-seek-bar"
                onChange={handleSeek}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="avw-vc-bottom-row">
              <button className="avw-vc-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="avw-vc-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
              <button className="avw-vc-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range" min={0} max={1} step={0.02}
                value={muted ? 0 : volume}
                className="avw-vol-slider"
                onChange={handleVolume}
                onClick={e => e.stopPropagation()}
                aria-label="Volume"
              />
              <button className="avw-vc-btn" onClick={handleFullscreen} aria-label="Fullscreen">
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Audio
    if (type === 'audio' && blobUrl) {
      return (
        <div className="avw-audio-wrap">
          <div className="avw-audio-icon"><Music size={36} /></div>
          <div className="avw-audio-name">{current.name}</div>
          <audio
            ref={audioRef}
            src={blobUrl}
            preload="metadata"
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <div className="avw-audio-controls">
            <input
              type="range" min={0} max={duration || 1} step={0.1}
              value={currentTime}
              className="avw-audio-seek"
              onChange={handleAudioSeek}
              aria-label="Seek"
            />
            <div className="avw-audio-btns">
              <span className="avw-audio-time">{formatTime(currentTime)}</span>
              <button className="avw-audio-play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <span className="avw-audio-time">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      )
    }

    // PDF
    if (type === 'pdf' && blobUrl) {
      return (
        <embed
          src={blobUrl}
          type="application/pdf"
          className="avw-pdf"
          title={current.name}
        />
      )
    }

    // Text
    if (type === 'text' && textContent !== null) {
      return (
        <div className="avw-text-wrap">
          <pre className="avw-text">{textContent}</pre>
        </div>
      )
    }

    // Office — Google Docs Viewer (production only; localhost won't work)
    if (type === 'office' && blobUrl) {
      if (officeError) {
        return (
          <div className="avw-unsupported">
            <div className="avw-unsupported-icon"><File size={32} /></div>
            <div className="avw-unsupported-name">{current.name}</div>
            <div className="avw-unsupported-meta">{formatBytes(current.size)}</div>
            <div className="avw-unsupported-note">
              Google Docs Viewer requires a publicly accessible URL.<br />
              Download the file to view it locally.
            </div>
            <button className="avw-unsupported-dl-btn" onClick={handleDownload}>
              <Download size={15} /> Download File
            </button>
          </div>
        )
      }
      const gdocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(blobUrl)}&embedded=true`
      return (
        <iframe
          src={gdocsUrl}
          className="avw-office-frame"
          title={current.name}
          sandbox="allow-scripts allow-same-origin"
          onError={() => setOfficeError(true)}
        />
      )
    }

    // Unsupported
    return (
      <div className="avw-unsupported">
        <div className="avw-unsupported-icon"><File size={32} /></div>
        <div className="avw-unsupported-name">{current.name}</div>
        <div className="avw-unsupported-meta">
          {formatBytes(current.size)}{current.extension ? ` · .${current.extension.toUpperCase()}` : ''}
        </div>
        <div className="avw-unsupported-note">Preview not available for this file type</div>
        <button className="avw-unsupported-dl-btn" onClick={handleDownload}>
          <Download size={15} /> Download File
        </button>
      </div>
    )
  }

  // ── Thumbnail icon for non-image files in the strip ────────────────────────
  const thumbIcon = (a: YouTrackAttachment, i: number) => {
    const t = detectType(a)
    if (t === 'image' && thumbUrls[i]) {
      return <img src={thumbUrls[i]} alt={a.name} />
    }
    return <TypeIcon type={t} size={16} />
  }

  return (
    <div className="avw-overlay" onClick={onClose}>
      <div className="avw-modal" onClick={e => e.stopPropagation()}>

        {/* ── Top bar ── */}
        <div className="avw-topbar">
          <div className="avw-filename">
            <TypeIcon type={type} size={16} />
            <span className="avw-filename-text">{current.name}</span>
            <span className="avw-type-badge">{type.toUpperCase()}</span>
          </div>
          <div className="avw-topbar-actions">
            <button className="avw-download-btn" onClick={handleDownload} aria-label="Download">
              <Download size={14} /> Download
            </button>
            <button className="avw-close-btn" onClick={onClose} aria-label="Close viewer">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Stage ── */}
        <div className="avw-stage">
          <button
            className="avw-nav avw-nav--prev"
            onClick={() => setIndex(i => Math.max(i - 1, 0))}
            disabled={index === 0}
            aria-label="Previous attachment"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="avw-content-wrap">
            {renderContent()}
          </div>

          <button
            className="avw-nav avw-nav--next"
            onClick={() => setIndex(i => Math.min(i + 1, attachments.length - 1))}
            disabled={index === attachments.length - 1}
            aria-label="Next attachment"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* ── Footer: counter + thumbnail strip ── */}
        {attachments.length > 1 && (
          <div className="avw-footer">
            <span className="avw-counter">{index + 1} of {attachments.length}</span>
            <div className="avw-thumb-strip" role="list">
              {attachments.map((a, i) => (
                <button
                  key={a.id}
                  className={`avw-thumb ${i === index ? 'active' : ''}`}
                  onClick={() => setIndex(i)}
                  title={a.name}
                  aria-label={a.name}
                  role="listitem"
                >
                  {thumbIcon(a, i)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
