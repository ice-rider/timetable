import { postJSON } from './client.ts'

export interface PortableDataset {
  format: 'timetable-dataset'
  version: 2
  name: string
  source_notes?: string[]
  semester_weeks: number
  time_grid: { days: number; periods_per_day: number }
  periods: { number: number; start: string; end: string }[]
  room_types: { code: string; name: string }[]
  buildings: { key: string; name: string; address?: string }[]
  rooms: {
    key: string
    building: string
    name: string
    type: string
    capacity: number
  }[]
  groups: { key: string; course: number; size: number }[]
  subgroups: { group: string; division: string; part: number; size: number }[]
  teachers: { key: string; full_name: string; short_name?: string }[]
  disciplines: { key: string; name: string }[]
  teacher_availability?: {
    teacher: string
    day: number
    period: number
    parity: 'every' | 'odd' | 'even'
    status: 'preferred' | 'undesired' | 'unavailable'
  }[]
  room_availability?: {
    room: string
    day: number
    period: number
    parity: 'every' | 'odd' | 'even'
    status: 'preferred' | 'undesired' | 'unavailable'
  }[]
  curriculum_items: {
    discipline: string
    kind: 'lecture' | 'seminar' | 'lab'
    teacher: string
    room_type: string
    semester_hours: number
    audience: { group: string; division?: string; part?: number }[]
  }[]
}

export interface DatasetImportCounts {
  periods: number
  buildings: number
  room_types: number
  rooms: number
  groups: number
  subgroups: number
  teachers: number
  disciplines: number
  curriculum_items: number
  curriculum_audience: number
  lessons: number
}

export function importDataset(dataset: PortableDataset): Promise<DatasetImportCounts> {
  return postJSON('/api/dataset', { confirm_replace: true, dataset })
}
