import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { PENDING_TTX_STORAGE_KEY } from '../api/scheduleExport.ts'
import { uploadFile } from './api/review'
import type { MergedModel, ReviewReport } from './api/types'
import { CommonFreeSlots } from './components/CommonFreeSlots'
import { ComparePanel } from './components/ComparePanel'
import { DensityToggle } from './components/DensityToggle'
import { Dropzone } from './components/Dropzone'
import { FilterChips, type FilterKey } from './components/FilterChips'
import { GroupPicker } from './components/GroupPicker'
import { Loader } from './components/Loader'
import { MultiTeacherGrid } from './components/MultiTeacherGrid'
import { OrientationToggle } from './components/OrientationToggle'
import { ParityTabs } from './components/ParityTabs'
import { RoomGrid } from './components/RoomGrid'
import { RoomPicker } from './components/RoomPicker'
import { ScheduleGrid } from './components/ScheduleGrid'
import { TeacherPicker } from './components/TeacherPicker'
import { TeacherSelect } from './components/TeacherSelect'
import { ViolationsBadge } from './components/ViolationsBadge'
import { ViolationsPage } from './components/ViolationsPage'
import { groupWeek, roomsWeek, teacherWeek, teachersWeek } from './lib/schedule'
import type { EntityRef, EntityWeek, ParityTab } from './lib/schedule'
import { mergeReports } from './lib/merge'
import { useScheduleViewPreferences } from './lib/viewPreferences'
import { downloadTimetable } from './lib/ttx'

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'uploading'
      done: number
      total: number
      errors: { file: string; message: string }[]
    }
  | { kind: 'ready'; model: MergedModel; errors: { file: string; message: string }[] }
  | { kind: 'error'; message: string; errors: { file: string; message: string }[] }

type Screen =
  'single-teacher' | 'single-group' | 'multi-teacher' | 'room' | 'compare' | 'violations'

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'single-teacher', label: 'Преподаватель' },
  { id: 'single-group', label: 'Группа' },
  { id: 'multi-teacher', label: 'Несколько преподавателей' },
  { id: 'room', label: 'Кабинеты' },
  { id: 'compare', label: 'Сравнение' },
  { id: 'violations', label: 'Накладки и окна' },
]

function filterTeacherWeek(
  week: EntityWeek,
  filters: Set<FilterKey>,
  violatedLessons: Set<number>,
  selectedLessonIds: Set<number> | null,
): EntityWeek {
  if (
    (!selectedLessonIds || selectedLessonIds.size === 0) &&
    (filters.size === 0 || filters.has('all'))
  ) {
    return week
  }

  const lessons = week.lessons.filter((lesson) => {
    if (selectedLessonIds && !selectedLessonIds.has(lesson.id)) return false
    return (
      filters.has('all') ||
      filters.size === 0 ||
      (filters.has('lecture') && lesson.lesson_type === 'lecture') ||
      (filters.has('practice') && lesson.lesson_type === 'practice') ||
      (filters.has('lab') && lesson.lesson_type === 'lab') ||
      (filters.has('violations') && violatedLessons.has(lesson.id))
    )
  })
  const grid = new Map<string, typeof lessons>()
  for (const lesson of lessons) {
    const key = `${lesson.day}-${lesson.period}`
    const cell = grid.get(key)
    if (cell) cell.push(lesson)
    else grid.set(key, [lesson])
  }
  const ids = new Set(lessons.map((lesson) => lesson.id))

  return {
    ...week,
    lessons,
    grid,
    violations: week.violations.filter((violation) =>
      violation.lesson_ids.some((id) => ids.has(id)),
    ),
  }
}

export function VisualizerApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const consumedGeneratedFile = useRef(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [screen, setScreen] = useState<Screen>('single-teacher')
  const [tab, setTab] = useState<ParityTab>('collapse')
  const [viewPreferences, setViewPreferences] = useScheduleViewPreferences()
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set(['all']))
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<number> | null>(null)
  const [teacher, setTeacher] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([])
  const [compactTeachers, setCompactTeachers] = useState(false)
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const [commonFreeOpen, setCommonFreeOpen] = useState(false)
  const [highlightCommonFree, setHighlightCommonFree] = useState(false)

  const handleFiles = useCallback(async (files: File[]) => {
    setPhase({ kind: 'uploading', done: 0, total: files.length, errors: [] })
    const reports: ReviewReport[] = []
    const errors: { file: string; message: string }[] = []

    for (let index = 0; index < files.length; index++) {
      const file = files[index]!
      try {
        reports.push(await uploadFile(file))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ file: file.name, message })
      }
      setPhase({
        kind: 'uploading',
        done: index + 1,
        total: files.length,
        errors: [...errors],
      })
    }

    if (reports.length === 0) {
      setPhase({ kind: 'error', message: 'Ни один файл не загрузился', errors })
      return
    }

    let model: MergedModel
    try {
      model = mergeReports(reports)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPhase({
        kind: 'error',
        message: `Не удалось объединить отчёты: ${message}`,
        errors,
      })
      return
    }

    setPhase({ kind: 'ready', model, errors })
    setScreen('single-teacher')
    setTab('collapse')
    setTeacher(model.teachers[0] ?? null)
    setGroup(model.groups[0] ?? null)
    setSelectedTeachers(model.teachers.slice(0, 2))
    setSelectedRooms(model.rooms.slice(0, 2).map((room) => room.key))
    setHighlightCommonFree(false)
    setCommonFreeOpen(false)
    setFilters(new Set(['all']))
    setSelectedLessonIds(null)
  }, [])

  useEffect(() => {
    if (
      consumedGeneratedFile.current ||
      new URLSearchParams(location.search).get('generated') !== '1'
    ) {
      return
    }

    consumedGeneratedFile.current = true
    const ttx = window.sessionStorage.getItem(PENDING_TTX_STORAGE_KEY)
    if (!ttx) return

    window.sessionStorage.removeItem(PENDING_TTX_STORAGE_KEY)
    window.setTimeout(() => {
      void handleFiles([
        new File([ttx], 'generated-schedule.ttx', {
          type: 'application/x-ndjson',
        }),
      ])
    }, 0)
    navigate(location.pathname, { replace: true })
  }, [handleFiles, location.pathname, location.search, navigate])

  function reset() {
    setPhase({ kind: 'idle' })
    setTeacher(null)
    setGroup(null)
    setSelectedTeachers([])
    setSelectedRooms([])
    setCommonFreeOpen(false)
    setFilters(new Set(['all']))
    setSelectedLessonIds(null)
  }

  const commonFreeRefs: EntityRef[] =
    screen === 'multi-teacher'
      ? selectedTeachers.map((name) => ({ kind: 'teacher', name }))
      : selectedRooms.map((name) => ({ kind: 'room', name }))
  const generatedFileMissing =
    new URLSearchParams(location.search).get('generated') === '1' &&
    !window.sessionStorage.getItem(PENDING_TTX_STORAGE_KEY)

  return (
    <div className="app-root min-h-screen bg-slate-50 text-slate-900">
      {phase.kind === 'idle' &&
        (generatedFileMissing ? (
          <div className="upload-screen no-print mx-auto max-w-3xl px-4 py-16" role="alert">
            Не найдено расписание для визуализации. Вернитесь к сохранённым вариантам.
          </div>
        ) : (
          <div className="upload-screen no-print mx-auto max-w-3xl px-4 py-16">
            <div className="app-brand mb-5">
              <span className="app-brand-icon">Р</span>
              <span>Расписание</span>
            </div>
            <h1 className="mb-2 text-2xl font-semibold">Визуализация расписания</h1>
            <p className="mb-6 text-sm text-slate-600">
              Загрузите Excel из «Тандема» или готовый файл TTX/JSON Lines. Файл обрабатывается на
              сервере и не сохраняется.
            </p>
            <Dropzone onFiles={handleFiles} />
          </div>
        ))}

      {phase.kind === 'uploading' && (
        <div className="no-print">
          <Loader done={phase.done} total={phase.total} errors={phase.errors} />
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="upload-screen no-print mx-auto max-w-3xl px-4 py-16">
          <div className="error-panel rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="text-lg font-semibold text-red-800">{phase.message}</h2>
            <ul className="mt-3 space-y-1 text-sm text-red-700">
              {phase.errors.map((error, index) => (
                <li key={`${error.file}-${index}`}>
                  <span className="font-medium">{error.file}:</span> {error.message}
                </li>
              ))}
            </ul>
            <button
              onClick={reset}
              className="mt-4 rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'ready' && (
        <div className="app-main mx-auto max-w-[1600px] px-4 py-4">
          {phase.errors.length > 0 && (
            <div
              role="status"
              className="upload-warning no-print mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              Не удалось обработать {phase.errors.length} файл(ов); в расписание вошли успешно
              обработанные файлы.
              <ul className="mt-2 space-y-1">
                {phase.errors.map((error, index) => (
                  <li key={`${error.file}-${index}`}>
                    <span className="font-medium">{error.file}:</span> {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <section className="visualizer-summary no-print mb-3 flex flex-wrap items-center gap-3">
            <div className="app-counts text-sm text-slate-600">
              {phase.model.sources.length} файл(ов) · {phase.model.lessons.length} занятий ·{' '}
              {phase.model.teachers.length} преподавателей · {phase.model.groups.length} групп ·{' '}
              {phase.model.rooms.length} кабинетов
            </div>
            <div className="app-header-actions ml-auto flex items-center gap-2">
              <button
                onClick={() => downloadTimetable(phase.model)}
                className="app-button rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              >
                Скачать JSON (TTX/1)
              </button>
              <ViolationsBadge
                violations={phase.model.violations}
                softTotal={phase.model.softTotal}
                onOpen={() => setScreen('violations')}
                activeLessonIds={selectedLessonIds}
                onSelect={(lessonIds) => {
                  if (lessonIds.length === 0) {
                    setSelectedLessonIds(null)
                    return
                  }
                  const selectedIds = new Set(lessonIds)
                  setSelectedLessonIds(selectedIds)
                  const selectedTeacher = phase.model.lessons.find(
                    (lesson) => selectedIds.has(lesson.id) && lesson.teachers.length > 0,
                  )?.teachers[0]
                  if (selectedTeacher) {
                    setScreen('single-teacher')
                    setTeacher(selectedTeacher)
                  }
                }}
              />
              <button
                onClick={() => window.print()}
                className="app-button rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              >
                Печать
              </button>
              <button
                onClick={reset}
                className="app-button rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              >
                Загрузить ещё
              </button>
            </div>
          </section>

          <nav className="app-nav no-print mb-3 flex flex-wrap gap-1 border-b border-slate-200">
            {SCREENS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setScreen(item.id)
                  setCommonFreeOpen(false)
                  if (item.id !== 'single-teacher') setSelectedLessonIds(null)
                }}
                className={
                  'app-nav-button ' +
                  'rounded-t px-3 py-1.5 text-sm ' +
                  (screen === item.id
                    ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:bg-white/60')
                }
                aria-pressed={screen === item.id}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="app-toolbar no-print mb-3 flex flex-wrap items-center gap-3">
            {screen === 'single-teacher' && (
              <TeacherSelect
                teachers={phase.model.teachers}
                value={teacher}
                onChange={(name) => {
                  setTeacher(name)
                  setSelectedLessonIds(null)
                }}
              />
            )}

            {screen !== 'violations' && (
              <>
                <OrientationToggle
                  value={viewPreferences.orientation}
                  onChange={(orientation) =>
                    setViewPreferences((current) => ({ ...current, orientation }))
                  }
                />
                <DensityToggle
                  value={viewPreferences.density}
                  onChange={(density) => setViewPreferences((current) => ({ ...current, density }))}
                />
              </>
            )}

            {screen === 'single-group' && (
              <GroupPicker groups={phase.model.groups} value={group} onChange={setGroup} />
            )}

            {screen === 'multi-teacher' && (
              <>
                <TeacherPicker
                  teachers={phase.model.teachers}
                  selected={selectedTeachers}
                  onChange={setSelectedTeachers}
                />
                <label className="app-checkbox flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={compactTeachers}
                    onChange={(event) => setCompactTeachers(event.target.checked)}
                  />
                  Компактно
                </label>
                <label className="app-checkbox flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={highlightCommonFree}
                    onChange={(event) => setHighlightCommonFree(event.target.checked)}
                  />
                  Общие окна
                </label>
                <button
                  type="button"
                  onClick={() => setCommonFreeOpen(true)}
                  disabled={selectedTeachers.length === 0}
                  className="app-button rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
                >
                  Показать только результаты
                </button>
              </>
            )}

            {screen === 'room' && (
              <>
                <RoomPicker
                  rooms={phase.model.rooms}
                  selected={selectedRooms}
                  onChange={setSelectedRooms}
                />
                <label className="app-checkbox flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={highlightCommonFree}
                    onChange={(event) => setHighlightCommonFree(event.target.checked)}
                  />
                  Общие окна
                </label>
                <button
                  type="button"
                  onClick={() => setCommonFreeOpen(true)}
                  disabled={selectedRooms.length === 0}
                  className="app-button rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
                >
                  Показать только результаты
                </button>
              </>
            )}

            {screen !== 'violations' && <ParityTabs value={tab} onChange={setTab} />}
          </div>

          {screen === 'single-teacher' && (
            <div className="app-filters no-print mb-3">
              <FilterChips
                active={filters}
                onChange={setFilters}
                hasViolations={phase.model.violatedLessons.size > 0}
              />
            </div>
          )}

          {screen === 'single-teacher' &&
            (teacher ? (
              <ScheduleGrid
                week={filterTeacherWeek(
                  teacherWeek(phase.model, teacher, tab),
                  filters,
                  phase.model.violatedLessons,
                  selectedLessonIds,
                )}
                violated={phase.model.violatedLessons}
                variant="teacher"
                tab={tab}
                dense={viewPreferences.density === 'compact'}
                layout={viewPreferences.orientation}
                highlightedIds={selectedLessonIds ?? undefined}
              />
            ) : (
              <p className="text-slate-600">Выберите преподавателя.</p>
            ))}

          {screen === 'single-group' &&
            (group ? (
              <ScheduleGrid
                week={groupWeek(phase.model, group, tab)}
                violated={phase.model.violatedLessons}
                variant="group"
                tab={tab}
                dense={viewPreferences.density === 'compact'}
                layout={viewPreferences.orientation}
              />
            ) : (
              <p className="text-slate-600">Выберите группу.</p>
            ))}

          {screen === 'multi-teacher' &&
            (selectedTeachers.length > 0 ? (
              <MultiTeacherGrid
                week={teachersWeek(phase.model, selectedTeachers, tab)}
                violated={phase.model.violatedLessons}
                compact={compactTeachers}
                dense={viewPreferences.density === 'compact'}
                layout={viewPreferences.orientation}
                highlightCommonFree={highlightCommonFree}
                tab={tab}
              />
            ) : (
              <p className="text-slate-600">Выберите хотя бы одного преподавателя.</p>
            ))}

          {screen === 'room' &&
            (selectedRooms.length > 0 ? (
              <RoomGrid
                week={roomsWeek(phase.model, selectedRooms, tab)}
                violated={phase.model.violatedLessons}
                highlightCommonFree={highlightCommonFree}
                dense={viewPreferences.density === 'compact'}
                layout={viewPreferences.orientation}
                tab={tab}
              />
            ) : (
              <p className="text-slate-600">Выберите хотя бы один кабинет.</p>
            ))}

          {screen === 'compare' && (
            <ComparePanel
              model={phase.model}
              tab={tab}
              dense={viewPreferences.density === 'compact'}
              layout={viewPreferences.orientation}
            />
          )}

          {screen === 'violations' && (
            <ViolationsPage
              model={phase.model}
              onOpenTeacher={(name) => {
                setScreen('single-teacher')
                setTeacher(name)
              }}
              onOpenGroup={(name) => {
                setScreen('single-group')
                setGroup(name)
              }}
              onOpenRoom={(key) => {
                setScreen('room')
                setSelectedRooms([key])
              }}
            />
          )}

          {commonFreeOpen && (
            <CommonFreeSlots
              open
              onClose={() => setCommonFreeOpen(false)}
              refs={commonFreeRefs}
              model={phase.model}
              tab={tab}
            />
          )}
        </div>
      )}
    </div>
  )
}
