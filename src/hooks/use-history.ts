'use client'

import { useState, useEffect, useCallback } from 'react'

export interface HistoryEntry {
  id: string
  label: string
  url: string
  modelRange: string
  modelCode: string
  country: string
  cheapestCountry: string
  cheapestPrice: number
  currency: string
  timestamp: number
}

const STORAGE_KEY = 'bmw-comparator-history'
const MAX_ENTRIES = 20

// Read history from localStorage lazily (avoids setState-in-effect lint error)
function readHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function useHistory() {
  // Lazy initializer - runs once on first render, not in an effect
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory())

  const save = useCallback((entries: HistoryEntry[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // ignore quota errors
    }
  }, [])

  const addEntry = useCallback(
    (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => {
      setHistory((prev) => {
        const filtered = prev.filter((e) => e.url !== entry.url)
        const newEntry: HistoryEntry = {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
        }
        const updated = [newEntry, ...filtered].slice(0, MAX_ENTRIES)
        save(updated)
        return updated
      })
    },
    [save]
  )

  const removeEntry = useCallback(
    (id: string) => {
      setHistory((prev) => {
        const updated = prev.filter((e) => e.id !== id)
        save(updated)
        return updated
      })
    },
    [save]
  )

  const clearHistory = useCallback(() => {
    setHistory([])
    save([])
  }, [save])

  return { history, addEntry, removeEntry, clearHistory, loaded: true }
}

