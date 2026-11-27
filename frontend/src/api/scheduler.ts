import { deleteJSON, getJSON, postJSON, putJSON } from './client.ts'

export interface WeightProfile {
  id: number
  name: string
  weights: Record<string, number>
  created_at: string
  updated_at: string
}

export interface ScheduleCriterion {
  key: string
  title: string
  value: number
  weight: number
  weighted: number
  available: boolean
}

export interface ScheduleSummary {
  id: number
  name: string
  created_at: string
}

export interface GenerationResult {
  schedule_id: number
  name: string
  lessons: number
  placed: number
  hard_violations: number
  soft_penalty: number
  steps: number
  duration: string
  cancelled: boolean
  violations: { rule: string; message: string; lesson_ids: number[]; strictness: string }[]
  weight_profile_id?: number
  weights_snapshot?: Record<string, number>
}

export interface GenerationJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: string
  progress: number
  lessons: number
  placed: number
  hard_violations: number
  soft_penalty: number
  steps: number
  elapsed: string
  budget_seconds: number
  preview?: GenerationPreview
  schedule_id?: number
  result?: GenerationResult
  error?: string
  weight_profile_id?: number
  weights_snapshot?: Record<string, number>
}

export interface GenerationPreview {
  days: number
  periods_per_day: number
  lessons: Schedule['lessons']
  placed: number
  hard_violations: number
  soft_penalty: number
}

export interface Schedule {
  id: number
  name: string
  created_at: string
  days: number
  periods_per_day: number
  periods: { number: number; starts_at: string; ends_at: string }[]
  lessons: {
    id: number
    placed: boolean
    day?: string
    period?: number
    parity?: 'every' | 'odd' | 'even'
    discipline: string
    kind: string
    teacher: string
    audience: string[]
    room?: string
  }[]
  placed: number
  hard_violations: number
  soft_penalty: number
  weight_profile_id?: number
  weights_snapshot?: Record<string, number>
  soft?: ScheduleCriterion[]
}

export interface DatasetSummary {
  groups: number
  teachers: number
  rooms: number
  items: number
  lessons: number
}

export interface DemoLoadCounts {
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

export function getDemoDatasetStatus(signal?: AbortSignal): Promise<{ enabled: boolean }> {
  return getJSON('/api/demo/dataset', signal)
}

export function loadDemoDataset(): Promise<DemoLoadCounts> {
  return postJSON('/api/demo/dataset', { confirm_replace: true })
}

export async function fetchDatasetSummary(signal?: AbortSignal): Promise<DatasetSummary> {
  const [groups, teachers, rooms, items] = await Promise.all([
    getJSON<unknown[]>('/api/groups', signal),
    getJSON<unknown[]>('/api/teachers', signal),
    getJSON<unknown[]>('/api/rooms', signal),
    getJSON<{ lessons: { id: number }[] }[]>('/api/curriculum-items', signal),
  ])
  return {
    groups: groups.length,
    teachers: teachers.length,
    rooms: rooms.length,
    items: items.length,
    lessons: items.reduce((total, item) => total + item.lessons.length, 0),
  }
}

export function listSchedules(signal?: AbortSignal): Promise<ScheduleSummary[]> {
  return getJSON('/api/schedules', signal)
}

export function getSchedule(id: number, signal?: AbortSignal): Promise<Schedule> {
  return getJSON(`/api/schedules/${id}`, signal)
}

export function getGenerationJob(id: string, signal?: AbortSignal): Promise<GenerationJob> {
  return getJSON(`/api/schedule-jobs/${id}`, signal)
}

export async function startGeneration(input: {
  name: string
  budget_seconds: number
  seed?: number
  weight_profile_id?: number | null
  weights?: Record<string, number>
  stop_when_zero?: boolean
  total_budget_seconds?: number
}): Promise<GenerationJob> {
  return postJSON('/api/schedule-jobs', input)
}

export function listWeightProfiles(signal?: AbortSignal): Promise<WeightProfile[]> {
  return getJSON('/api/weight-profiles', signal)
}

export function getWeightProfile(id: number, signal?: AbortSignal): Promise<WeightProfile> {
  return getJSON(`/api/weight-profiles/${id}`, signal)
}

export function createWeightProfile(input: {
  name: string
  weights: Record<string, number>
}): Promise<WeightProfile> {
  return postJSON('/api/weight-profiles', input)
}

export function updateWeightProfile(
  id: number,
  input: { name: string; weights: Record<string, number> },
): Promise<WeightProfile> {
  return putJSON(`/api/weight-profiles/${id}`, input)
}

export async function deleteWeightProfile(id: number): Promise<void> {
  await deleteJSON(`/api/weight-profiles/${id}`)
}

export async function stopGeneration(id: string): Promise<GenerationJob> {
  return postJSON(`/api/schedule-jobs/${id}/stop`)
}
