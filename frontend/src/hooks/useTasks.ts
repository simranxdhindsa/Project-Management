import { useState, useEffect } from 'react'
import { api } from '@/services/api'
import type { Task } from '@/types'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const response = await api.request('/tasks')

      if (response.success && response.data) {
        setTasks(Array.isArray(response.data) ? response.data : [])
      } else {
        setTasks([])
      }
      setError(null)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
      setError('Failed to load tasks')
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  return { tasks, loading, error, refetch: fetchTasks }
}
