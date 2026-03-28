import React, { useState } from 'react'
import { Loader2, FolderOpen, ChevronDown } from 'lucide-react'
import api from '../../services/api'

export interface LoadedDeploymentTicket {
  url: string
  title: string
  gid: string
}

interface Props {
  onLoad: (tickets: LoadedDeploymentTicket[]) => void
  isLoading: boolean
}

export default function DeploymentProjectBrowser({ onLoad, isLoading }: Props) {
  const [sections, setSections] = useState<Array<{ gid: string; name: string }>>([])
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set())
  const [loadingSections, setLoadingSections] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const fetchSections = async () => {
    if (sections.length > 0) {
      setOpen(o => !o)
      return
    }
    setLoadingSections(true)
    setError('')
    try {
      const res = await api.getAsanaDeploymentProjectSections()
      if (res.success && res.data && res.data.length > 0) {
        setSections(res.data)
        setOpen(true)
      } else {
        setError((res as any).message || 'No sections found. Check Asana project in Integrations.')
      }
    } catch {
      setError('Failed to load sections. Check Asana connection.')
    } finally {
      setLoadingSections(false)
    }
  }

  const toggleSection = (gid: string) => {
    setSelectedSections(prev => {
      const next = new Set(prev)
      next.has(gid) ? next.delete(gid) : next.add(gid)
      return next
    })
  }

  const handleLoad = async () => {
    if (selectedSections.size === 0) return
    setLoadingTasks(true)
    setError('')
    const allTickets: LoadedDeploymentTicket[] = []
    const seen = new Set<string>()
    try {
      await Promise.all([...selectedSections].map(async (sectionGid) => {
        const res = await api.getAsanaDeploymentSectionTasks(sectionGid)
        const tasks = (res as any).data?.tasks ?? []
        for (const t of tasks) {
          if (!seen.has(t.gid)) {
            seen.add(t.gid)
            allTickets.push({
              url: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`,
              title: t.name,
              gid: t.gid,
            })
          }
        }
      }))
      onLoad(allTickets)
      setOpen(false)
    } catch {
      setError('Failed to load tasks')
    } finally {
      setLoadingTasks(false)
    }
  }

  return (
    <div className="dr-project-browser">
      <button
        className="dr-browser-toggle btn-ghost btn-sm"
        onClick={fetchSections}
        disabled={isLoading || loadingSections}
      >
        {loadingSections
          ? <Loader2 size={13} className="animate-spin" />
          : <FolderOpen size={13} />}
        Browse Project Columns
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: '0.2s' }} />
      </button>

      {open && (
        <div className="dr-browser-panel">
          {error && <p className="dr-browser-error">{error}</p>}

          {sections.length > 0 && (
            <>
              <div className="pm-config-chips" style={{ marginBottom: '0.6rem' }}>
                {sections.map(s => (
                  <button
                    key={s.gid}
                    className={`cfg-chip${selectedSections.has(s.gid) ? ' on' : ''}`}
                    onClick={() => toggleSection(s.gid)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {selectedSections.size > 0 && (
                <button
                  className="btn-primary btn-sm"
                  onClick={handleLoad}
                  disabled={loadingTasks}
                >
                  {loadingTasks && <Loader2 size={13} className="animate-spin" />}
                  {loadingTasks ? 'Loading…' : `Load Tickets (${selectedSections.size} column${selectedSections.size > 1 ? 's' : ''})`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
