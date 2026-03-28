import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import type { WorkflowConfig, PriorityTag, ColumnState } from '../services/api'
import { getActiveSource } from '../services/pmDataService'

// Per-source in-memory cache
const _cache: Record<string, WorkflowConfig> = {}
const _cacheTs: Record<string, number> = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 min

export function useWorkflowConfig(explicitSource?: string) {
  const source = explicitSource || getActiveSource()
  const [config, setConfig] = useState<WorkflowConfig | null>(_cache[source] ?? null)
  const [loading, setLoading] = useState(!_cache[source])
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async (force = false) => {
    const src = explicitSource || getActiveSource()
    if (!force && _cache[src] && Date.now() - (_cacheTs[src] ?? 0) < CACHE_TTL) {
      setConfig(_cache[src])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.getWorkflowConfig(src)
      if (res.success && res.data) {
        _cache[src] = res.data
        _cacheTs[src] = Date.now()
        setConfig(res.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflow config')
    } finally {
      setLoading(false)
    }
  }, [explicitSource]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch()
  }, [fetch])

  // Re-fetch when the active PM source changes (fired by setActiveSource in pmDataService)
  useEffect(() => {
    if (explicitSource) return // explicit source takes priority, ignore global changes
    const handler = () => fetch(true)
    window.addEventListener('pm-source-changed', handler)
    return () => window.removeEventListener('pm-source-changed', handler)
  }, [fetch, explicitSource])

  const invalidate = useCallback((src?: string) => {
    const key = src || explicitSource || getActiveSource()
    delete _cache[key]
    delete _cacheTs[key]
    fetch(true)
  }, [fetch, explicitSource]) // eslint-disable-line react-hooks/exhaustive-deps

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
