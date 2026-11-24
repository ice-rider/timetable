import ExcelJS from 'exceljs'
import type { Schedule } from './scheduler.ts'

const DAYS = [
  { code: 'MO', label: 'ПОНЕДЕЛЬНИК' },
  { code: 'TU', label: 'ВТОРНИК' },
  { code: 'WE', label: 'СРЕДА' },
  { code: 'TH', label: 'ЧЕТВЕРГ' },
  { code: 'FR', label: 'ПЯТНИЦА' },
  { code: 'SA', label: 'СУББОТА' },
  { code: 'SU', label: 'ВОСКРЕСЕНЬЕ' },
] as const

const GROUP_HEADERS = ['Дисциплина', 'Вид занятий', 'ФИО преподавателя', '№ ауд.', 'Ссылка']
const GROUP_COLUMN_COUNT = GROUP_HEADERS.length
const WEEK_ROWS = [
  { parity: 'odd', label: 'I' },
  { parity: 'even', label: 'II' },
] as const

function lessonKindLabel(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'lecture':
      return 'Л'
    case 'seminar':
    case 'practice':
      return 'П'
    case 'lab':
      return 'ЛР'
    default:
      return kind
  }
}

function parityLabel(parity: 'every' | 'odd' | 'even' | undefined): string {
  if (parity === 'odd') return '1 н. '
  if (parity === 'even') return '2 н. '
  return ''
}

function checkExportable(schedule: Schedule): void {
  const unplaced = schedule.lessons.filter((lesson) => !lesson.placed)
  if (unplaced.length > 0) {
    throw new Error(`Нельзя экспортировать расписание: не размещено занятий — ${unplaced.length}.`)
  }

  for (const lesson of schedule.lessons) {
    if (!lesson.day || !DAYS.some((day) => day.code === lesson.day)) {
      throw new Error(`У занятия «${lesson.discipline}» отсутствует корректный день недели.`)
    }
    if (!lesson.period || lesson.period < 1 || lesson.period > schedule.periods_per_day) {
      throw new Error(`У занятия «${lesson.discipline}» отсутствует корректный номер пары.`)
    }
    if (lesson.parity && !['every', 'odd', 'even'].includes(lesson.parity)) {
      throw new Error(`У занятия «${lesson.discipline}» неизвестный тип недели.`)
    }
  }
}

export function createStudentScheduleWorkbook(schedule: Schedule): ExcelJS.Workbook {
  checkExportable(schedule)

  const groupNames = [...new Set(schedule.lessons.flatMap((lesson) => lesson.audience))].sort(
    (a, b) => a.localeCompare(b, 'ru'),
  )
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Расписание'
  workbook.subject = 'Расписание занятий'
  workbook.title = schedule.name
  workbook.created = new Date(schedule.created_at)

  const sheetNames = new Set<string>()
  for (const [groupIndex, group] of groupNames.entries()) {
    const sheetName = createUniqueSheetName(group, groupIndex, sheetNames)
    sheetNames.add(sheetName.toLocaleLowerCase('en-US'))
    addGroupWorksheet(workbook, schedule, group, sheetName)
  }

  return workbook
}

function createUniqueSheetName(group: string, index: number, existingNames: Set<string>): string {
  const baseName = (group.replace(/[\\/?*[\]:]/g, ' ').trim() || `Группа ${index + 1}`)
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
  let name = baseName
  let suffix = 2
  while (existingNames.has(name.toLocaleLowerCase('en-US'))) {
    const suffixText = ` (${suffix})`
    name = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`
    suffix++
  }
  return name
}

function addGroupWorksheet(
  workbook: ExcelJS.Workbook,
  schedule: Schedule,
  group: string,
  sheetName: string,
): void {
  const lastColumn = 5 + GROUP_COLUMN_COUNT
  const sheet = workbook.addWorksheet(sheetName, {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    },
    views: [{ state: 'frozen', ySplit: 3, xSplit: 5 }],
    properties: { defaultRowHeight: 28 },
  })

  sheet.mergeCells(1, 1, 1, lastColumn)
  sheet.getCell(1, 1).value = `РАСПИСАНИЕ · ${schedule.name} · ${group}`
  sheet.getCell(1, 1).font = { name: 'Arial', size: 15, bold: true }
  sheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 34

  const fixedHeaders = [
    { column: 1, value: 'День недели', width: 18 },
    { column: 2, value: '№ пары', width: 8 },
    { column: 3, value: 'Начало занятий', width: 11 },
    { column: 4, value: 'Окончание занятий', width: 11 },
    { column: 5, value: 'Неделя', width: 8 },
  ]
  for (const header of fixedHeaders) {
    sheet.mergeCells(2, header.column, 3, header.column)
    sheet.getCell(2, header.column).value = header.value
    sheet.getColumn(header.column).width = header.width
  }

  sheet.mergeCells(2, 6, 2, lastColumn)
  sheet.getCell(2, 6).value = group
  GROUP_HEADERS.forEach((header, index) => {
    sheet.getCell(3, 6 + index).value = header
  })
  sheet.getColumn(6).width = 38
  sheet.getColumn(7).width = 12
  sheet.getColumn(8).width = 24
  sheet.getColumn(9).width = 25
  sheet.getColumn(10).width = 12

  for (let rowNumber = 2; rowNumber <= 3; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    row.height = 34
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Arial', size: 9, bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowNumber === 2 ? 'FFE8EEF8' : 'FFF1F3F7' },
      }
    })
  }

  const periodTimes = new Map(schedule.periods.map((period) => [period.number, period] as const))
  const dayCount = Math.min(schedule.days, DAYS.length)
  let firstDataRow = 4
  const dayBlocks: { day: string; firstRow: number; lastRow: number }[] = []

  for (const day of DAYS.slice(0, dayCount)) {
    const dayFirstRow = firstDataRow
    for (let period = 1; period <= schedule.periods_per_day; period++) {
      const periodFirstRow = firstDataRow
      const times = periodTimes.get(period)

      for (const week of WEEK_ROWS) {
        const row = sheet.getRow(firstDataRow)
        row.height = 42
        row.getCell(5).value = week.label
        row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }

        const groupLessons = schedule.lessons.filter(
          (lesson) =>
            lesson.audience.includes(group) &&
            lesson.day === day.code &&
            lesson.period === period &&
            (lesson.parity === 'every' ||
              lesson.parity === undefined ||
              lesson.parity === week.parity),
        )
        const values = [
          groupLessons.map((lesson) => `${parityLabel(lesson.parity)}${lesson.discipline}`),
          groupLessons.map((lesson) => lessonKindLabel(lesson.kind)),
          groupLessons.map((lesson) => lesson.teacher),
          groupLessons.map((lesson) => lesson.room ?? ''),
          groupLessons.map(() => ''),
        ]
        values.forEach((items, offset) => {
          const cell = row.getCell(6 + offset)
          cell.value = items.length > 0 ? items.join('\n') : null
          cell.alignment = {
            horizontal: offset === 0 ? 'left' : 'center',
            vertical: 'middle',
            wrapText: true,
          }
        })

        firstDataRow++
      }

      for (const column of [2, 3, 4]) {
        sheet.mergeCells(periodFirstRow, column, firstDataRow - 1, column)
      }
      sheet.getCell(periodFirstRow, 2).value = period
      sheet.getCell(periodFirstRow, 3).value = times?.starts_at.replace(':', '-') ?? ''
      sheet.getCell(periodFirstRow, 4).value = times?.ends_at.replace(':', '-') ?? ''
      for (const column of [2, 3, 4]) {
        sheet.getCell(periodFirstRow, column).alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        }
      }
    }
    dayBlocks.push({ day: day.label, firstRow: dayFirstRow, lastRow: firstDataRow - 1 })
  }

  for (const block of dayBlocks) {
    sheet.mergeCells(block.firstRow, 1, block.lastRow, 1)
    const cell = sheet.getCell(block.firstRow, 1)
    cell.value = block.day
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.font = { name: 'Arial', size: 9, bold: true }
  }

  for (let rowNumber = 2; rowNumber < firstDataRow; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    for (let column = 1; column <= lastColumn; column++) {
      const cell = row.getCell(column)
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF808080' } },
        left: { style: 'thin', color: { argb: 'FF808080' } },
        bottom: { style: 'thin', color: { argb: 'FF808080' } },
        right: { style: 'thin', color: { argb: 'FF808080' } },
      }
      if (rowNumber >= 4 && rowNumber % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFAFBFD' },
        }
      }
    }
  }

  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${firstDataRow - 1}`
  sheet.pageSetup.printTitlesRow = '1:3'
}

export async function serializeScheduleExcel(schedule: Schedule): Promise<ArrayBuffer> {
  const data = await createStudentScheduleWorkbook(schedule).xlsx.writeBuffer()
  const bytes = new Uint8Array(data)
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
}

export async function downloadScheduleExcel(schedule: Schedule): Promise<void> {
  const data = await serializeScheduleExcel(schedule)
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `schedule-${schedule.id}.xlsx`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
