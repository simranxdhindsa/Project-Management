import { useState, useEffect } from 'react'
import { api } from '@/services/api'

export interface TaskStats {
  total: number
  todo: number
  in_progress: number
  review: number
  done: number
  blocked: number
  overdue: number
}

export function useTaskStats() {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    blocked: 0,
    overdue: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await api.request('/tasks/stats')

      if (response.success && response.data) {
        setStats(response.data)
      }
      setError(null)
    } catch (err) {
      console.error('Failed to fetch task stats:', err)
      setError('Failed to load statistics')
    } finally {
      setLoading(false)
    }
  }

  return { stats, loading, error, refetch: fetchStats }
}
