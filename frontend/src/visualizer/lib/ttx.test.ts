import { describe, expect, it } from 'vitest'
import type { MergedModel, ReviewReport } from '../api/types.ts'
import { mergeReports } from './merge.ts'
import { serializeTimetable } from './ttx.ts'

const model: MergedModel = {
  periods: [{ n: 1, start: '08:30', end: '10:00' }],
  lessons: [
    {
      id: 1,
      refs: [],
      audience: [{ group: 'ГР-1', subgroup: null }],
      day: 'mon',
      period: 1,
      parity: 'every',
      lesson_type: 'lecture',
      discipline: 'Математика',
      teachers: ['Иванов И.И.'],
      room: '1-101',
    },
  ],
  teachers: ['Иванов И.И.'],
  groups: ['ГР-1'],
  rooms: [{ key: '1-101', building: '1', type: 'lecture', title: '1-101', capacity: 30 }],
  violations: [],
  soft: [],
  softTotal: 0,
  sources: [{ id: 'source-1', adapter: 'tandem-xls-t1', file: 'schedule.xls' }],
  issues: [],
  violatedLessons: new Set(),
}

describe('serializeTimetable', () => {
  it('exports a complete TTX/1 batch as JSON Lines', () => {
    const records = serializeTimetable(model)
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
    expect(records[0]).toMatchObject({ format: 'ttx/1', adapter: 'timetable-frontend' })
    expect(records.at(-1)).toMatchObject({
      id: 1,
      audience: [{ group: 'ГР-1', subgroup: null }],
      room: '1-101',
    })
  })

  describe('mergeReports', () => {
    it('rejects source files with different period grids', () => {
      const report: ReviewReport = {
        source: { id: 'source', adapter: 'tandem' },
        periods: [{ n: 1, start: '08:30', end: '10:00' }],
        stats: { lessons: 0, groups: 0, teachers: 0, rooms: 0, disciplines: 0, hard: 0 },
        lessons: [],
        rooms: [],
        violations: [],
        soft: [],
        soft_total: 0,
        groups: [],
        teachers: [],
        issues: [],
        notes: [],
      }

      expect(() =>
        mergeReports([report, { ...report, periods: [{ n: 1, start: '09:00', end: '10:30' }] }]),
      ).toThrow('у файлов разные сетки времени')
    })
  })
})
