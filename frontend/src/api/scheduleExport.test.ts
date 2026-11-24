import { describe, expect, it } from 'vitest'
import type { Schedule } from './scheduler.ts'
import { serializeSchedule } from './scheduleExport.ts'

const schedule: Schedule = {
  id: 3,
  name: 'План весна',
  created_at: '2026-01-01T00:00:00Z',
  days: 2,
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

describe('serializeSchedule', () => {
  it('exports a saved schedule as a complete TTX/1 JSON Lines batch', () => {
    const records = serializeSchedule(schedule)
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(records.map((record) => record.kind)).toEqual([
      'source',
      'period',
      'group',
      'teacher',
      'room',
      'lesson',
    ])
    expect(records[0]).toMatchObject({
      id: 'schedule-3',
      format: 'ttx/1',
      title: 'План весна',
    })
    expect(records.at(-1)).toMatchObject({
      id: 12,
      day: 'mon',
      audience: [{ group: 'ГР-1', subgroup: null }],
      room: 'А-101',
    })
  })

  it('refuses to export unplaced lessons as a complete timetable', () => {
    expect(() =>
      serializeSchedule({
        ...schedule,
        lessons: [{ ...schedule.lessons[0]!, placed: false }],
      }),
    ).toThrow('не размещено занятий — 1')
  })
})
