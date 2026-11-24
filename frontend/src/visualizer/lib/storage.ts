const PREFIX = 'tt.presets.'

export interface Preset<T> {
  name: string
  value: T
  updatedAt: number
}

function isPreset(value: unknown): value is Preset<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const preset = value as Record<string, unknown>
  return (
    typeof preset.name === 'string' && typeof preset.updatedAt === 'number' && 'value' in preset
  )
}

export function listPresets<T>(key: string): Preset<T>[] {
  const raw = localStorage.getItem(PREFIX + key)
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn(`Unable to parse saved presets for "${key}".`, error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.warn(`Saved presets for "${key}" are not an array.`)
    return []
  }

  return parsed.filter(isPreset) as Preset<T>[]
}

export function savePreset<T>(key: string, name: string, value: T): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const presets = listPresets<T>(key).filter((p) => p.name !== trimmed)
  presets.push({ name: trimmed, value, updatedAt: Date.now() })
  localStorage.setItem(PREFIX + key, JSON.stringify(presets))
}

export function deletePreset(key: string, name: string): void {
  const presets = listPresets(key).filter((p) => p.name !== name)
  localStorage.setItem(PREFIX + key, JSON.stringify(presets))
}

export const PRESET_KEYS = {
  teachers: 'teachers',
  rooms: 'rooms',
} as const
