import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import type { WorkflowConfig, PriorityTag, ColumnState } from '../services/api'

let _cache: WorkflowConfig | null = null
let _cacheTs = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min

export function useWorkflowConfig() {
  const [config, setConfig] = useState<WorkflowConfig | null>(_cache)
  const [loading, setLoading] = useState(!_cache)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async (force = false) => {
    if (!force && _cache && Date.now() - _cacheTs < CACHE_TTL) {
      setConfig(_cache)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.getWorkflowConfig()
      if (res.success && res.data) {
        _cache = res.data
        _cacheTs = Date.now()
        setConfig(res.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflow config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch()
  }, [fetch])

  const invalidate = useCallback(() => {
    _cache = null
    _cacheTs = 0
    fetch(true)
  }, [fetch])

  // Helpers
  const getPriorityColor = useCallback((label: string): string => {
    if (!config) return '#94a3b8'
    const tag = config.priority_tags.find(t => t.label === label)
    return tag?.color ?? '#94a3b8'
  }, [config])

  const getStatePriorityTags = useCallback((): PriorityTag[] => {
    return config?.priority_tags ?? []
  }, [config])

  const getColumnHierarchy = useCallback((): ColumnState[] => {
    return config?.column_hierarchy ?? []
  }, [config])

  const getStateRank = useCallback((state: string): number => {
    if (!config) return 999
    const col = config.column_hierarchy.find(
      c => c.state.toLowerCase() === state.toLowerCase() ||
           c.aliases?.some(a => a.toLowerCase() === state.toLowerCase())
    )
    return col?.rank ?? 999
  }, [config])

  const extractPriority = useCallback((summary: string): string => {
    if (!config) return 'Other'
    for (const tag of config.priority_tags) {
      for (const prefix of tag.prefixes ?? []) {
        if (summary.startsWith(prefix + ':') || summary.startsWith(prefix + ' ')) {
          return tag.label
        }
      }
    }
    return 'Other'
  }, [config])

  return {
    config,
    loading,
    error,
    invalidate,
    getPriorityColor,
    getStatePriorityTags,
    getColumnHierarchy,
    getStateRank,
    extractPriority,
  }
}
