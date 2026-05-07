import { useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

export interface YouTrackUpdateEvent {
  issue_id: string
  field: string
  old_value: string
  new_value: string
  summary: string
}

// Errors must accumulate to this count before we consider the backend "was down".
// A single transient error (e.g. browser tab going to background) won't trigger a reload.
const DOWN_THRESHOLD = 4

/**
 * React hook that connects to the SSE endpoint and calls onUpdate
 * whenever a YouTrack change event is received.
 *
 * Also auto-reloads the page when the backend comes back up after being
 * continuously down (>= DOWN_THRESHOLD consecutive errors).
 */
export function useYouTrackEvents(onUpdate: (event: YouTrackUpdateEvent) => void) {
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  useEffect(() => {
    const es = new EventSource(`${API_URL}/events`)
    let errorCount = 0
    let wasDown = false

    es.onopen = () => {
      if (wasDown) {
        // Backend came back after being down — reload to refresh all stale data.
        window.location.reload()
        return
      }
      // Successful open resets the error streak (covers reconnect after a single blip).
      errorCount = 0
    }

    es.addEventListener('youtrack_update', (e: MessageEvent) => {
      try {
        const data: YouTrackUpdateEvent = JSON.parse(e.data)
        onUpdateRef.current(data)
      } catch {
        // Ignore malformed events
      }
    })

    es.onerror = () => {
      errorCount++
      if (errorCount >= DOWN_THRESHOLD) {
        wasDown = true
      }
    }

    return () => es.close()
  }, [])
}
