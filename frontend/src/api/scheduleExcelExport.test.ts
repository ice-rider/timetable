import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { Schedule } from './scheduler.ts'
import { createStudentScheduleWorkbook, serializeScheduleExcel } from './scheduleExcelExport.ts'

const schedule: Schedule = {
  id: 3,
  name: 'План весна',
  created_at: '2026-01-01T00:00:00Z',
  days: 1,
  periods_per_day: 2,
  periods: [
    { number: 1, starts_at: '08:30', ends_at: '10:00' },
    { number: 2, starts_at: '10:10', ends_at: '11:40' },
  ],
  lessons: [
    {
      id: 12,
      placed: true,
      day: 'MO',
      period: 1,
      parity: 'odd',
      discipline: 'Алгебра',
      kind: 'lecture',
      teacher: 'А. Примеров',
      audience: ['ГР-1'],
      room: 'А-101',
    },
    {
      id: 13,
      placed: true,
      day: 'MO',
      period: 1,
      parity: 'even',
      discipline: 'История',
      kind: 'seminar',
      teacher: 'И. Примеров',
      audience: ['ГР-1'],
      room: 'А-102',
    },
    {
      id: 14,
      placed: true,
      day: 'MO',
      period: 2,
      parity: 'every',
      discipline: 'Физика',
      kind: 'lab',
      teacher: 'В. Примеров',
      audience: ['ГР-2'],
    },
  ],
  placed: 3,
  hard_violations: 0,
  soft_penalty: 12,
}

describe('scheduleExcelExport', () => {
  it('creates one student-style worksheet per group', () => {
    const workbook = createStudentScheduleWorkbook(schedule)
    const sheet = workbook.getWorksheet('ГР-1')
    const secondGroupSheet = workbook.getWorksheet('ГР-2')

    expect(sheet).toBeDefined()
    expect(secondGroupSheet).toBeDefined()
    expect(workbook.worksheets).toHaveLength(2)
    expect(sheet!.getCell('A1').value).toBe('РАСПИСАНИЕ · План весна · ГР-1')
    expect(sheet!.getCell('F2').value).toBe('ГР-1')
    expect(sheet!.getCell('F3').value).toBe('Дисциплина')
    expect(sheet!.getCell('A4').value).toBe('ПОНЕДЕЛЬНИК')
    expect(sheet!.getCell('B4').value).toBe(1)
    expect(sheet!.getCell('C4').value).toBe('08-30')
    expect(sheet!.getCell('E4').value).toBe('I')
    expect(sheet!.getCell('F4').value).toBe('1 н. Алгебра')
    expect(sheet!.getCell('G4').value).toBe('Л')
    expect(sheet!.getCell('I4').value).toBe('А-101')
    expect(sheet!.getCell('E5').value).toBe('II')
    expect(sheet!.getCell('F5').value).toBe('2 н. История')
    expect(sheet!.getCell('F6').value).toBeNull()
    expect(secondGroupSheet!.getCell('F6').value).toBe('Физика')
    expect(secondGroupSheet!.getCell('G6').value).toBe('ЛР')
    expect(secondGroupSheet!.getCell('F4').value).toBeNull()
    expect(sheet!.pageSetup.orientation).toBe('landscape')
  })

  it('produces an XLSX workbook that can be reopened', async () => {
    const data = await serializeScheduleExcel(schedule)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(data)

    expect(reopened.getWorksheet('ГР-1')?.getCell('F4').value).toBe('1 н. Алгебра')
    expect(reopened.getWorksheet('ГР-2')?.getCell('F6').value).toBe('Физика')
  })

  it('refuses to export unplaced lessons as a complete student timetable', () => {
    expect(() =>
      createStudentScheduleWorkbook({
        ...schedule,
        lessons: [{ ...schedule.lessons[0]!, placed: false }],
      }),
    ).toThrow('не размещено занятий — 1')
  })
})
