import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Report } from '../api/review.ts'
import type { Schedule } from '../api/scheduler.ts'
import { PENDING_TTX_STORAGE_KEY, serializeSchedule } from '../api/scheduleExport.ts'
import { VisualizerApp } from './VisualizerApp.tsx'

const schedule: Schedule = {
  id: 3,
  name: 'План весна',
  created_at: '2026-01-01T00:00:00Z',
  days: 1,
  periods_per_day: 1,
  periods: [{ number: 1, starts_at: '08:30', ends_at: '10:00' }],
  lessons: [
    {
      id: 12,
      placed: true,
      day: 'MO',
      period: 1,
      parity: 'every',
      discipline: 'Алгебра',
      kind: 'lecture',
      teacher: 'А. Примеров',
      audience: ['ГР-1'],
      room: 'А-101',
    },
  ],
  placed: 1,
  hard_violations: 0,
  soft_penalty: 12,
}

const report: Report = {
  source: { id: 'schedule-3', adapter: 'timetable-generator', file: 'schedule-3.ttx' },
  periods: [{ n: 1, start: '08:30', end: '10:00' }],
  stats: { lessons: 1, groups: 1, teachers: 1, rooms: 1, disciplines: 1, hard: 0 },
  lessons: [
    {
      id: 12,
      refs: [],
      audience: [{ group: 'ГР-1', subgroup: null }],
      day: 'mon',
      period: 1,
      parity: 'every',
      lesson_type: 'lecture',
      discipline: 'Алгебра',
      teachers: ['А. Примеров'],
      room: 'А-101',
    },
  ],
  rooms: [],
  violations: [],
  soft: [],
  soft_total: 0,
  groups: [],
  teachers: [],
  issues: [],
  notes: [],
}

describe('VisualizerApp', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('loads the generated schedule through the shared TTX review flow', async () => {
    sessionStorage.setItem(PENDING_TTX_STORAGE_KEY, serializeSchedule(schedule))
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(report)))
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = new QueryClient()

    render(
      <MemoryRouter initialEntries={['/vizualize-timetable?generated=1']}>
        <QueryClientProvider client={queryClient}>
          <VisualizerApp />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    expect(await screen.findAllByText('Алгебра')).not.toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/review',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    expect(sessionStorage.getItem(PENDING_TTX_STORAGE_KEY)).toBeNull()
  })
})
