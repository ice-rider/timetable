import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import { importDataset, type DatasetImportCounts, type PortableDataset } from '../api/dataset.ts'

const ROOM_TYPES = [
  { code: 'lecture', name: 'Лекционная аудитория' },
  { code: 'seminar', name: 'Аудитория для практики' },
  { code: 'lab', name: 'Лаборатория' },
  { code: 'computer', name: 'Компьютерный класс' },
  { code: 'gym', name: 'Спортивный зал' },
]

const PERIODS: [string, string][] = [
  ['08:30', '10:00'],
  ['10:10', '11:40'],
  ['12:20', '13:50'],
  ['14:00', '15:30'],
  ['15:40', '17:10'],
  ['17:20', '18:50'],
  ['19:00', '20:30'],
]

const SECTIONS = [
  { id: 'groups', label: 'Группы', icon: '01' },
  { id: 'teachers', label: 'Преподаватели', icon: '02' },
  { id: 'disciplines', label: 'Дисциплины', icon: '03' },
  { id: 'rooms', label: 'Аудитории', icon: '04' },
  { id: 'load', label: 'Учебная нагрузка', icon: '05' },
] as const

type SectionID = (typeof SECTIONS)[number]['id']
type LessonKind = PortableDataset['curriculum_items'][number]['kind']

function blankDataset(name: string): PortableDataset {
  return {
    format: 'timetable-dataset',
    version: 2,
    name,
    semester_weeks: 18,
    time_grid: { days: 6, periods_per_day: PERIODS.length },
    periods: PERIODS.map(([start, end], index) => ({ number: index + 1, start, end })),
    room_types: ROOM_TYPES,
    buildings: [],
    rooms: [],
    groups: [],
    subgroups: [],
    teachers: [],
    disciplines: [],
    curriculum_items: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPortableDataset(value: unknown): value is PortableDataset {
  if (
    !isRecord(value) ||
    value.format !== 'timetable-dataset' ||
    value.version !== 2 ||
    typeof value.semester_weeks !== 'number' ||
    !isRecord(value.time_grid) ||
    typeof value.time_grid.days !== 'number' ||
    typeof value.time_grid.periods_per_day !== 'number'
  ) {
    return false
  }
  const all = (key: string, guard: (entry: unknown) => boolean) =>
    Array.isArray(value[key]) && value[key].every(guard)
  const hasString = (entry: unknown, key: string) =>
    isRecord(entry) && typeof entry[key] === 'string'
  const hasNumber = (entry: unknown, key: string) =>
    isRecord(entry) && typeof entry[key] === 'number'
  return (
    all(
      'periods',
      (entry) => hasNumber(entry, 'number') && hasString(entry, 'start') && hasString(entry, 'end'),
    ) &&
    all('room_types', (entry) => hasString(entry, 'code') && hasString(entry, 'name')) &&
    all('buildings', (entry) => hasString(entry, 'key') && hasString(entry, 'name')) &&
    all(
      'rooms',
      (entry) =>
        hasString(entry, 'key') &&
        hasString(entry, 'building') &&
        hasString(entry, 'name') &&
        hasString(entry, 'type') &&
        hasNumber(entry, 'capacity'),
    ) &&
    all(
      'groups',
      (entry) => hasString(entry, 'key') && hasNumber(entry, 'course') && hasNumber(entry, 'size'),
    ) &&
    all(
      'subgroups',
      (entry) =>
        hasString(entry, 'group') &&
        hasString(entry, 'division') &&
        hasNumber(entry, 'part') &&
        hasNumber(entry, 'size'),
    ) &&
    all('teachers', (entry) => hasString(entry, 'key') && hasString(entry, 'full_name')) &&
    all('disciplines', (entry) => hasString(entry, 'key') && hasString(entry, 'name')) &&
    all(
      'curriculum_items',
      (entry) =>
        hasString(entry, 'discipline') &&
        hasString(entry, 'kind') &&
        hasString(entry, 'teacher') &&
        hasString(entry, 'room_type') &&
        hasNumber(entry, 'semester_hours') &&
        isRecord(entry) &&
        Array.isArray(entry.audience) &&
        entry.audience.every((member) => hasString(member, 'group')),
    )
  )
}

function readDataset(value: unknown): PortableDataset {
  if (!isPortableDataset(value)) {
    throw new Error(
      'Файл должен содержать набор формата timetable-dataset версии 2 с нагрузкой в часах.',
    )
  }
  return value
}

function projectHours(hours: number, semesterWeeks: number) {
  const units = Math.round(hours / semesterWeeks)
  const weeklyCount = Math.floor(units / 2)
  const biweeklyCount = units % 2
  return {
    weeklyCount,
    biweeklyCount,
    scheduledHours: (2 * weeklyCount + biweeklyCount) * semesterWeeks,
  }
}

function pairWord(count: number): string {
  const remainder = count % 100
  if (remainder >= 11 && remainder <= 14) return 'пар'
  switch (count % 10) {
    case 1:
      return 'пара'
    case 2:
    case 3:
    case 4:
      return 'пары'
    default:
      return 'пар'
  }
}

function sectionCount(dataset: PortableDataset, section: SectionID): number {
  switch (section) {
    case 'groups':
      return dataset.groups.length
    case 'teachers':
      return dataset.teachers.length
    case 'disciplines':
      return dataset.disciplines.length
    case 'rooms':
      return dataset.rooms.length
    case 'load':
      return dataset.curriculum_items.length
  }
}

export function DatasetEditor({
  onImported,
}: {
  onImported: (counts: DatasetImportCounts) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [dataset, setDataset] = useState(() => blankDataset('Новое расписание'))
  const [section, setSection] = useState<SectionID>('groups')
  const [group, setGroup] = useState({ key: '', course: 1, size: 25 })
  const [teacher, setTeacher] = useState({ full_name: '', short_name: '' })
  const [discipline, setDiscipline] = useState({ name: '' })
  const [building, setBuilding] = useState({ name: '', address: '' })
  const [room, setRoom] = useState({
    building: '',
    name: '',
    type: 'lecture',
    capacity: 60,
  })
  const [item, setItem] = useState({
    discipline: '',
    kind: 'lecture' as LessonKind,
    teacher: '',
    room_type: 'lecture',
    group: '',
    semester_hours: 36,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const totals = useMemo(() => {
    const enteredHours = dataset.curriculum_items.reduce(
      (total, current) => total + current.semester_hours,
      0,
    )
    const scheduledHours = dataset.curriculum_items.reduce(
      (total, current) =>
        total + projectHours(current.semester_hours, dataset.semester_weeks).scheduledHours,
      0,
    )
    return {
      enteredHours,
      scheduledHours,
      weeklyHours: scheduledHours / dataset.semester_weeks,
    }
  }, [dataset.curriculum_items, dataset.semester_weeks])

  function updateDataset(change: (current: PortableDataset) => PortableDataset) {
    setDataset((current) => change(current))
  }

  function addGroup(event: FormEvent) {
    event.preventDefault()
    if (dataset.groups.some((entry) => entry.key === group.key.trim())) {
      setError(`Группа «${group.key.trim()}» уже добавлена.`)
      return
    }
    updateDataset((current) => ({
      ...current,
      groups: [...current.groups, { ...group, key: group.key.trim() }],
    }))
    setGroup({ ...group, key: '' })
    setError('')
  }

  function addTeacher(event: FormEvent) {
    event.preventDefault()
    const key = `teacher-${dataset.teachers.length + 1}`
    updateDataset((current) => ({
      ...current,
      teachers: [...current.teachers, { ...teacher, key }],
    }))
    setTeacher({ full_name: '', short_name: '' })
    setError('')
  }

  function addDiscipline(event: FormEvent) {
    event.preventDefault()
    const key = `discipline-${dataset.disciplines.length + 1}`
    updateDataset((current) => ({
      ...current,
      disciplines: [...current.disciplines, { ...discipline, key }],
    }))
    setDiscipline({ name: '' })
    setError('')
  }

  function addBuilding(event: FormEvent) {
    event.preventDefault()
    const key = `building-${dataset.buildings.length + 1}`
    updateDataset((current) => ({
      ...current,
      buildings: [...current.buildings, { ...building, key }],
    }))
    setBuilding({ name: '', address: '' })
    setRoom((current) => ({ ...current, building: key }))
    setError('')
  }

  function addRoom(event: FormEvent) {
    event.preventDefault()
    const key = `room-${dataset.rooms.length + 1}`
    updateDataset((current) => ({
      ...current,
      rooms: [...current.rooms, { ...room, key }],
    }))
    setRoom((current) => ({ ...current, name: '' }))
    setError('')
  }

  function addCurriculumItem(event: FormEvent) {
    event.preventDefault()
    if (item.semester_hours < 1) {
      setError('Укажите академические часы за семестр.')
      return
    }
    const projected = projectHours(item.semester_hours, dataset.semester_weeks)
    if (projected.weeklyCount > 20) {
      setError('Такая нагрузка превышает поддерживаемую частоту занятий.')
      return
    }
    updateDataset((current) => ({
      ...current,
      curriculum_items: [
        ...current.curriculum_items,
        {
          discipline: item.discipline,
          kind: item.kind,
          teacher: item.teacher,
          room_type: item.room_type,
          semester_hours: item.semester_hours,
          audience: [{ group: item.group }],
        },
      ],
    }))
    setError('')
  }

  async function loadFile(file?: File) {
    if (!file) return
    try {
      const imported = readDataset(JSON.parse(await file.text()))
      setDataset(imported)
      setSection('load')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать JSON-файл.')
    }
  }

  function downloadFile() {
    const blob = new Blob([`${JSON.stringify(dataset, null, 2)}\n`], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'timetable-dataset.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function applyDataset() {
    if (
      !window.confirm(
        'Заменить текущие справочники, учебный план и сохранённые расписания этим набором? Учётные записи и журнал действий сохранятся.',
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    try {
      onImported(await importDataset(dataset))
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось загрузить набор данных.')
    } finally {
      setBusy(false)
    }
  }

  function renderSectionForm() {
    const projection = projectHours(item.semester_hours, dataset.semester_weeks)
    switch (section) {
      case 'groups':
        return (
          <form className="dataset-entry" onSubmit={addGroup}>
            <div className="entry-heading">
              <span className="entry-icon">01</span>
              <div>
                <h3>Добавить учебную группу</h3>
                <p>Курс и число студентов нужны для оценки размера потока.</p>
              </div>
            </div>
            <label>
              Шифр группы
              <input
                required
                placeholder="Б26-071-1"
                value={group.key}
                onChange={(e) => setGroup({ ...group, key: e.target.value })}
              />
            </label>
            <div className="form-pair">
              <label>
                Курс
                <input
                  required
                  type="number"
                  min="0"
                  max="6"
                  value={group.course}
                  onChange={(e) => setGroup({ ...group, course: Number(e.target.value) })}
                />
              </label>
              <label>
                Студентов
                <input
                  required
                  type="number"
                  min="1"
                  value={group.size}
                  onChange={(e) => setGroup({ ...group, size: Number(e.target.value) })}
                />
              </label>
            </div>
            <button className="primary-button" type="submit">
              Добавить группу <span aria-hidden="true">＋</span>
            </button>
          </form>
        )
      case 'teachers':
        return (
          <form className="dataset-entry" onSubmit={addTeacher}>
            <div className="entry-heading">
              <span className="entry-icon">02</span>
              <div>
                <h3>Добавить преподавателя</h3>
                <p>Ключ будет создан автоматически.</p>
              </div>
            </div>
            <label>
              Фамилия, имя, отчество
              <input
                required
                placeholder="Иванов Иван Иванович"
                value={teacher.full_name}
                onChange={(e) => setTeacher({ ...teacher, full_name: e.target.value })}
              />
            </label>
            <label>
              Краткое имя <span className="optional">необязательно</span>
              <input
                placeholder="Иванов И.И."
                value={teacher.short_name}
                onChange={(e) => setTeacher({ ...teacher, short_name: e.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Добавить преподавателя <span aria-hidden="true">＋</span>
            </button>
          </form>
        )
      case 'disciplines':
        return (
          <form className="dataset-entry" onSubmit={addDiscipline}>
            <div className="entry-heading">
              <span className="entry-icon">03</span>
              <div>
                <h3>Добавить дисциплину</h3>
                <p>Например, «Социология» или «Математический анализ».</p>
              </div>
            </div>
            <label>
              Название дисциплины
              <input
                required
                placeholder="Социология"
                value={discipline.name}
                onChange={(e) => setDiscipline({ name: e.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Добавить дисциплину <span aria-hidden="true">＋</span>
            </button>
          </form>
        )
      case 'rooms':
        return (
          <div className="dataset-room-forms">
            <form className="dataset-entry" onSubmit={addBuilding}>
              <div className="entry-heading">
                <span className="entry-icon">А</span>
                <div>
                  <h3>Корпус</h3>
                  <p>Сначала добавьте корпус, чтобы привязать аудитории.</p>
                </div>
              </div>
              <label>
                Название корпуса
                <input
                  required
                  placeholder="Корпус 1"
                  value={building.name}
                  onChange={(e) => setBuilding({ ...building, name: e.target.value })}
                />
              </label>
              <label>
                Адрес <span className="optional">необязательно</span>
                <input
                  placeholder="Улица, дом"
                  value={building.address}
                  onChange={(e) => setBuilding({ ...building, address: e.target.value })}
                />
              </label>
              <button className="quiet-button" type="submit">
                Добавить корпус
              </button>
            </form>
            <form className="dataset-entry" onSubmit={addRoom}>
              <div className="entry-heading">
                <span className="entry-icon">Б</span>
                <div>
                  <h3>Аудитория</h3>
                  <p>Тип помещения помогает подбору подходящих комнат.</p>
                </div>
              </div>
              <label>
                Корпус
                <select
                  required
                  value={room.building}
                  onChange={(e) => setRoom({ ...room, building: e.target.value })}
                >
                  <option value="">Выберите корпус</option>
                  {dataset.buildings.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Номер аудитории
                <input
                  required
                  placeholder="1-101"
                  value={room.name}
                  onChange={(e) => setRoom({ ...room, name: e.target.value })}
                />
              </label>
              <div className="form-pair">
                <label>
                  Тип
                  <select
                    value={room.type}
                    onChange={(e) => setRoom({ ...room, type: e.target.value })}
                  >
                    {dataset.room_types.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Вместимость
                  <input
                    required
                    type="number"
                    min="1"
                    value={room.capacity}
                    onChange={(e) => setRoom({ ...room, capacity: Number(e.target.value) })}
                  />
                </label>
              </div>
              <button className="primary-button" type="submit" disabled={!dataset.buildings.length}>
                Добавить аудиторию <span aria-hidden="true">＋</span>
              </button>
            </form>
          </div>
        )
      case 'load':
        return (
          <form className="dataset-entry workload-form" onSubmit={addCurriculumItem}>
            <div className="entry-heading">
              <span className="entry-icon">05</span>
              <div>
                <h3>Добавить строку учебной нагрузки</h3>
                <p>Часы указываются за весь семестр отдельно для каждого вида занятий.</p>
              </div>
            </div>
            <div className="form-pair">
              <label>
                Семестр, учебных недель
                <input
                  required
                  type="number"
                  min="1"
                  max="52"
                  value={dataset.semester_weeks}
                  onChange={(e) =>
                    updateDataset((current) => ({
                      ...current,
                      semester_weeks: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Часов за семестр
                <input
                  required
                  type="number"
                  min="1"
                  max={40 * dataset.semester_weeks}
                  value={item.semester_hours}
                  onChange={(e) => setItem({ ...item, semester_hours: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="form-pair">
              <label>
                Дисциплина
                <select
                  required
                  value={item.discipline}
                  onChange={(e) => setItem({ ...item, discipline: e.target.value })}
                >
                  <option value="">Выберите дисциплину</option>
                  {dataset.disciplines.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Группа
                <select
                  required
                  value={item.group}
                  onChange={(e) => setItem({ ...item, group: e.target.value })}
                >
                  <option value="">Выберите группу</option>
                  {dataset.groups.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.key}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-pair">
              <label>
                Вид занятий
                <select
                  value={item.kind}
                  onChange={(e) => setItem({ ...item, kind: e.target.value as LessonKind })}
                >
                  <option value="lecture">Лекции</option>
                  <option value="seminar">Практические занятия</option>
                  <option value="lab">Лабораторные занятия</option>
                </select>
              </label>
              <label>
                Преподаватель
                <select
                  required
                  value={item.teacher}
                  onChange={(e) => setItem({ ...item, teacher: e.target.value })}
                >
                  <option value="">Выберите преподавателя</option>
                  {dataset.teachers.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Тип аудитории
              <select
                value={item.room_type}
                onChange={(e) => setItem({ ...item, room_type: e.target.value })}
              >
                {dataset.room_types.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="hour-projection">
              <strong>
                {projection.weeklyCount > 0
                  ? `${projection.weeklyCount} ${pairWord(projection.weeklyCount)} в неделю`
                  : `${projection.biweeklyCount} пара через неделю`}
              </strong>
              <span>
                Для генератора ·{' '}
                {projectHours(item.semester_hours, dataset.semester_weeks).scheduledHours} акад. ч.
                за семестр
              </span>
            </div>
            <button className="primary-button" type="submit">
              Добавить нагрузку <span aria-hidden="true">＋</span>
            </button>
            <small>
              Лекции, практику и лабораторные добавляйте отдельными строками — у каждого вида может
              быть свой преподаватель.
            </small>
          </form>
        )
    }
  }

  const selectedSection = SECTIONS.find((entry) => entry.id === section)

  return (
    <section className="dataset-editor panel" aria-labelledby="dataset-editor-title">
      <header className="dataset-editor-header">
        <div>
          <span className="eyebrow">ИСХОДНЫЕ ДАННЫЕ</span>
          <h2 id="dataset-editor-title">Подготовка расписания</h2>
          <p>Заполните справочники и распределите часы по дисциплинам.</p>
        </div>
        <div className="dataset-editor-actions">
          <button className="quiet-button" onClick={() => fileInput.current?.click()}>
            <span aria-hidden="true">↥</span> Загрузить JSON
          </button>
          <button className="quiet-button" onClick={downloadFile}>
            Скачать JSON <span aria-hidden="true">↧</span>
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label="Выбрать JSON-дамп"
            onChange={(event) => {
              void loadFile(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </div>
      </header>

      <div className="dataset-summary">
        <SummaryCard value={dataset.groups.length} label="учебных групп" />
        <SummaryCard value={dataset.teachers.length} label="преподавателей" />
        <SummaryCard value={dataset.rooms.length} label="аудиторий" />
        <SummaryCard value={dataset.curriculum_items.length} label="строк нагрузки" />
        <SummaryCard
          value={totals.enteredHours.toLocaleString('ru-RU')}
          label="академических часов / семестр"
        />
      </div>

      <div className="dataset-builder">
        <nav className="dataset-steps" aria-label="Разделы исходных данных">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              className={`dataset-step ${section === entry.id ? 'active' : ''}`}
              aria-current={section === entry.id ? 'step' : undefined}
              onClick={() => setSection(entry.id)}
            >
              <span className="step-number">{entry.icon}</span>
              <span>{entry.label}</span>
              <b>{sectionCount(dataset, entry.id)}</b>
            </button>
          ))}
        </nav>

        <div className="dataset-work-area">
          <div className="dataset-form-area">
            <div className="section-title">
              <div>
                <span className="eyebrow">ШАГ {selectedSection?.icon}</span>
                <h3>{selectedSection?.label}</h3>
              </div>
              <span className="data-status">Изменения локально в редакторе</span>
            </div>
            {renderSectionForm()}
          </div>

          <aside className="dataset-side-panel">
            <div className="side-panel-heading">
              <span className="eyebrow">СВОДКА</span>
              <strong>Набор данных</strong>
            </div>
            <div className="side-metric">
              <span>Семестр</span>
              <b>{dataset.semester_weeks} недель</b>
            </div>
            <div className="side-metric">
              <span>Введено часов</span>
              <b>{totals.enteredHours.toLocaleString('ru-RU')} акад. ч.</b>
            </div>
            <div className="side-metric">
              <span>Для генератора</span>
              <b>{totals.scheduledHours.toLocaleString('ru-RU')} акад. ч.</b>
            </div>
            <div className="side-metric">
              <span>Средняя нагрузка</span>
              <b>
                {(totals.weeklyHours / Math.max(dataset.groups.length, 1)).toFixed(1)} ч. / группа /
                нед.
              </b>
            </div>
            <p className="side-note">
              Пара длится 90 минут и равна двум академическим часам. Нечётные остатки округляются до
              ближайшей частоты, которую поддерживает расписание.
            </p>
            {dataset.source_notes?.length ? (
              <details className="source-notes">
                <summary>Примечания к исходному набору</summary>
                {dataset.source_notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </details>
            ) : null}
          </aside>
        </div>

        {section === 'load' && dataset.curriculum_items.length > 0 && (
          <div className="dataset-load-list">
            <div className="load-list-heading">
              <div>
                <span className="eyebrow">ВВЕДЁННАЯ НАГРУЗКА</span>
                <strong>{dataset.curriculum_items.length} строк</strong>
              </div>
            </div>
            <div className="load-list-scroll">
              {dataset.curriculum_items.map((entry, index) => {
                const subject =
                  dataset.disciplines.find((value) => value.key === entry.discipline)?.name ??
                  entry.discipline
                const instructor =
                  dataset.teachers.find((value) => value.key === entry.teacher)?.full_name ??
                  entry.teacher
                const audience = entry.audience.map((member) => member.group).join(', ')
                const projected = projectHours(entry.semester_hours, dataset.semester_weeks)
                return (
                  <div className="load-row" key={`${entry.discipline}-${entry.kind}-${index}`}>
                    <div className="load-subject">
                      <strong>{subject}</strong>
                      <span>
                        {audience} · {instructor}
                      </span>
                    </div>
                    <span className={`kind-pill kind-${entry.kind}`}>{kindLabel(entry.kind)}</span>
                    <strong className="load-hours">{entry.semester_hours} ч.</strong>
                    <span className="load-frequency">
                      {projected.weeklyCount
                        ? `${projected.weeklyCount} / нед.`
                        : `${projected.biweeklyCount} через неделю`}
                    </span>
                    <button
                      className="remove-load"
                      aria-label={`Удалить нагрузку ${subject}`}
                      onClick={() =>
                        updateDataset((current) => ({
                          ...current,
                          curriculum_items: current.curriculum_items.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="error dataset-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dataset-editor-footer">
          <span>
            {dataset.groups.length} групп · {dataset.teachers.length} преподавателей ·{' '}
            {dataset.rooms.length} аудиторий · {dataset.curriculum_items.length} строк нагрузки
          </span>
          <button
            className="primary-button"
            disabled={
              busy ||
              !dataset.groups.length ||
              !dataset.teachers.length ||
              !dataset.rooms.length ||
              !dataset.curriculum_items.length
            }
            onClick={() => void applyDataset()}
          >
            {busy ? 'Загружаем набор…' : 'Проверить и загрузить набор'}
            {!busy && <span aria-hidden="true"> →</span>}
          </button>
        </footer>
      </div>
    </section>
  )
}

function SummaryCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="dataset-summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function kindLabel(kind: LessonKind): string {
  switch (kind) {
    case 'lecture':
      return 'Лекции'
    case 'seminar':
      return 'Практика'
    case 'lab':
      return 'Лабораторные'
  }
}
