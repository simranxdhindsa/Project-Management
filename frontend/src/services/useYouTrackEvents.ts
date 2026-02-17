import { useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

export interface YouTrackUpdateEvent {
  issue_id: string
  field: string
  old_value: string
  new_value: string
  summary: string
}

/**
 * React hook that connects to the SSE endpoint and calls onUpdate
 * whenever a YouTrack change event is received.
 */
export function useYouTrackEvents(onUpdate: (event: YouTrackUpdateEvent) => void) {
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  useEffect(() => {
    const es = new EventSource(`${API_URL}/events`)

    es.addEventListener('youtrack_update', (e: MessageEvent) => {
      try {
        const data: YouTrackUpdateEvent = JSON.parse(e.data)
        onUpdateRef.current(data)
      } catch {
        // Ignore malformed events
      }
    })

    es.onerror = () => {
      // EventSource auto-reconnects on error, nothing to do
    }

    return () => es.close()
  }, [])
}
