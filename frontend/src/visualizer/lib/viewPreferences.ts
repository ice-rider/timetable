import { useEffect, useState } from 'react'

export type ScheduleOrientation = 'horizontal' | 'vertical'
export type ScheduleDensity = 'wide' | 'compact'

export interface ScheduleViewPreferences {
  orientation: ScheduleOrientation
  density: ScheduleDensity
}

const STORAGE_KEY = 'timetable.scheduleView'

const DEFAULT_PREFERENCES: ScheduleViewPreferences = {
  orientation: 'horizontal',
  density: 'wide',
}

function isPreferences(value: unknown): value is ScheduleViewPreferences {
  if (typeof value !== 'object' || value === null) return false
  const preferences = value as Record<string, unknown>
  return (
    (preferences.orientation === 'horizontal' || preferences.orientation === 'vertical') &&
    (preferences.density === 'wide' || preferences.density === 'compact')
  )
}

function loadPreferences(): ScheduleViewPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed: unknown = JSON.parse(raw)
    if (isPreferences(parsed)) return parsed
    console.warn('Saved schedule view preferences are invalid; using defaults.')
  } catch (error) {
    console.warn('Unable to load saved schedule view preferences.', error)
  }
  return DEFAULT_PREFERENCES
}

export function useScheduleViewPreferences() {
  const [preferences, setPreferences] = useState(loadPreferences)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch (error) {
      console.warn('Unable to save schedule view preferences.', error)
    }
  }, [preferences])

  return [preferences, setPreferences] as const
}
