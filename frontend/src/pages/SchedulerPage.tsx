import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, getCurrentUser, login, logout, type User } from '../api/client.ts'
import {
  downloadSchedule,
  PENDING_TTX_STORAGE_KEY,
  serializeSchedule,
} from '../api/scheduleExport.ts'
import { downloadScheduleExcel } from '../api/scheduleExcelExport.ts'
import {
  fetchDatasetSummary,
  getDemoDatasetStatus,
  getGenerationJob,
  getSchedule,
  listSchedules,
  loadDemoDataset,
  createWeightProfile,
  deleteWeightProfile,
  listWeightProfiles,
  startGeneration,
  stopGeneration,
  updateWeightProfile,
  type GenerationPreview,
  type GenerationJob,
  type Schedule,
  type WeightProfile,
} from '../api/scheduler.ts'
import { DatasetEditor } from './DatasetEditor.tsx'
import { WeightProfileEditor } from './WeightProfileEditor.tsx'
import { DEFAULT_WEIGHTS, normalizeWeights, type Weights } from '../schedulerWeights.ts'

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const DAY_LABELS: Record<string, string> = {
  MO: 'Понедельник',
  TU: 'Вторник',
  WE: 'Среда',
  TH: 'Четверг',
  FR: 'Пятница',
  SA: 'Суббота',
  SU: 'Воскресенье',
}
const STATUS_LABELS: Record<GenerationJob['status'], string> = {
  queued: 'В очереди',
  running: 'Составляем расписание',
  completed: 'Готово',
  failed: 'Ошибка генерации',
  cancelled: 'Остановлено',
}
const STAGE_LABELS: Record<string, string> = {
  queued: 'Ожидает свободного запуска',
  feasibility: 'Ищем вариант, в котором все занятия размещены без конфликтов',
  optimization: 'Улучшаем найденное расписание; лучший вариант обновляется ниже',
  completed: 'Расписание сохранено',
}

export function SchedulerPage() {
  const queryClient = useQueryClient()
  const account = useQuery({
    queryKey: ['current-user'],
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
  })

  if (account.isPending) return <div className="page-loading">Проверяем сессию…</div>
  if (account.isError && account.error instanceof ApiError && account.error.status === 401)
    return <LoginPanel onLogin={(user) => queryClient.setQueryData(['current-user'], user)} />
  if (account.isError)
    return <PageError title="Не удалось подключиться" message={account.error.message} />
  if (account.data.role !== 'admin')
    return (
      <PageError
        title="Нужен доступ администратора"
        message={`Текущая учётная запись имеет роль «${account.data.role}».`}
      />
    )

  return <Workspace user={account.data} onLogout={() => queryClient.clear()} />
}

function LoginPanel({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (session) => onLogin(session.user),
  })

  return (
    <section className="login-page">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="eyebrow">TIMETABLE · ПЛАНИРОВАНИЕ</div>
        <h1>Вход в рабочее место</h1>
        <p className="muted">Авторизуйтесь под учётной записью администратора расписания.</p>
        <label>
          Логин
          <input
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {mutation.isError && <p className="error">{mutation.error.message}</p>}
        <button className="primary-button full-width" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </section>
  )
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [jobID, setJobID] = useState(() => localStorage.getItem('timetable-generation-job') ?? '')
  const [selectedScheduleID, setSelectedScheduleID] = useState<number | null>(null)
  const [scheduleName, setScheduleName] = useState('Рабочее расписание')
  const [budget, setBudget] = useState(30)
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS })
  const [selectedWeightProfileID, setSelectedWeightProfileID] = useState<number | null>(null)
  const [filterKind, setFilterKind] = useState<'group' | 'teacher' | 'room'>('group')
  const [filterName, setFilterName] = useState('')
  const [week, setWeek] = useState<'odd' | 'even'>('odd')
  const [notice, setNotice] = useState('')
  const [exportError, setExportError] = useState('')
  const [excelExporting, setExcelExporting] = useState(false)

  const dataset = useQuery({
    queryKey: ['dataset-summary'],
    queryFn: ({ signal }) => fetchDatasetSummary(signal),
  })
  const demoStatus = useQuery({
    queryKey: ['demo-dataset-status'],
    queryFn: ({ signal }) => getDemoDatasetStatus(signal),
  })
  const weightProfiles = useQuery({
    queryKey: ['weight-profiles'],
    queryFn: ({ signal }) => listWeightProfiles(signal),
  })
  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: ({ signal }) => listSchedules(signal),
  })
  const job = useQuery({
    queryKey: ['generation-job', jobID],
    queryFn: ({ signal }) => getGenerationJob(jobID, signal),
    enabled: Boolean(jobID),
    refetchInterval: (query) => {
      const state = query.state.data as GenerationJob | undefined
      return state && state.status !== 'queued' && state.status !== 'running' ? false : 1000
    },
  })
  const scheduleID = selectedScheduleID ?? job.data?.schedule_id ?? schedules.data?.[0]?.id ?? null
  const schedule = useQuery({
    queryKey: ['schedule', scheduleID],
    queryFn: ({ signal }) => {
      if (scheduleID === null) throw new Error('Не выбрано расписание')
      return getSchedule(scheduleID, signal)
    },
    enabled: scheduleID !== null,
  })
  useEffect(() => {
    if (job.data?.schedule_id && job.data.status !== 'failed') {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
    }
  }, [job.data?.schedule_id, job.data?.status, queryClient])
  const start = useMutation({
    mutationFn: () =>
      startGeneration({
        name: scheduleName,
        budget_seconds: budget,
        weight_profile_id: selectedWeightProfileID,
        weights,
      }),
    onSuccess: (created) => {
      setJobID(created.id)
      setSelectedScheduleID(null)
      localStorage.setItem('timetable-generation-job', created.id)
      setNotice('')
    },
  })
  const saveWeightProfile = useMutation({
    mutationFn: ({ name, weights }: { name: string; weights: Weights }) => {
      if (selectedWeightProfileID != null)
        return updateWeightProfile(selectedWeightProfileID, { name, weights })
      return createWeightProfile({ name, weights })
    },
    onSuccess: (profile: WeightProfile) => {
      setSelectedWeightProfileID(profile.id)
      setWeights(normalizeWeights(profile.weights))
      void queryClient.invalidateQueries({ queryKey: ['weight-profiles'] })
    },
  })
  const removeWeightProfile = useMutation({
    mutationFn: (id: number) => deleteWeightProfile(id),
    onSuccess: () => {
      setSelectedWeightProfileID(null)
      setWeights({ ...DEFAULT_WEIGHTS })
      void queryClient.invalidateQueries({ queryKey: ['weight-profiles'] })
    },
  })
  const loadDemo = useMutation({
    mutationFn: loadDemoDataset,
    onSuccess: (counts) => {
      setJobID('')
      setSelectedScheduleID(null)
      setNotice(
        `Демо-данные загружены: ${counts.groups} групп, ${counts.teachers} преподавателей, ${counts.lessons} занятий.`,
      )
      localStorage.removeItem('timetable-generation-job')
      void queryClient.invalidateQueries({ queryKey: ['dataset-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['generation-job'] })
    },
  })
  const stop = useMutation({
    mutationFn: () => stopGeneration(jobID),
    onSuccess: (updated) => queryClient.setQueryData(['generation-job', jobID], updated),
  })
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      onLogout()
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  })

  async function exportSchedule(selected: Schedule, format: 'ttx' | 'excel' | 'visualize') {
    try {
      if (format === 'visualize') {
        const ttx = serializeSchedule(selected)
        sessionStorage.setItem(PENDING_TTX_STORAGE_KEY, ttx)
        navigate('/vizualize-timetable?generated=1')
      } else if (format === 'ttx') {
        downloadSchedule(selected)
      } else {
        setExcelExporting(true)
        await downloadScheduleExcel(selected)
      }
      setExportError('')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExcelExporting(false)
    }
  }

  const lessonOptions = useMemo(() => {
    const lessons = schedule.data?.lessons ?? []
    if (filterKind === 'group')
      return [...new Set(lessons.flatMap((lesson) => lesson.audience))].sort()
    if (filterKind === 'teacher')
      return [...new Set(lessons.map((lesson) => lesson.teacher))].sort()
    return [
      ...new Set(
        lessons.map((lesson) => lesson.room).filter((room): room is string => Boolean(room)),
      ),
    ].sort()
  }, [filterKind, schedule.data])

  const currentJob = job.data
  const busy = currentJob?.status === 'queued' || currentJob?.status === 'running'
  const [clock, setClock] = useState(() => Date.now())
  const stopError = stop.error instanceof Error ? stop.error.message : ''
  const startError = start.error instanceof Error ? start.error.message : ''
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  const livePreview = busy && currentJob?.preview ? previewAsSchedule(currentJob.preview) : null
  const firstFeasibleFound = Boolean(
    busy &&
    currentJob?.preview &&
    currentJob.preview.placed === currentJob.lessons &&
    currentJob.preview.hard_violations === 0,
  )
  const elapsedSeconds =
    (parseElapsedSeconds(currentJob?.elapsed ?? '') ?? 0) +
    (busy && job.dataUpdatedAt ? Math.max(0, (clock - job.dataUpdatedAt) / 1000) : 0)
  const remainingSeconds = currentJob ? Math.max(0, currentJob.budget_seconds - elapsedSeconds) : 0

  return (
    <div className="workspace">
      <div className="workspace-topbar">
        <div>
          <span className="eyebrow">РАБОЧЕЕ МЕСТО</span>
          <h1>Планирование расписания</h1>
        </div>
        <div className="user-menu">
          <span>{user.display_name || user.login}</span>
          <button
            className="quiet-button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            Выйти
          </button>
        </div>
      </div>
      {signOut.isError && <p className="error">{signOut.error.message}</p>}

      <div className="workflow-steps" aria-label="Этапы работы">
        <div className="workflow-step done">
          <b>01</b>
          <span>Исходные данные</span>
        </div>
        <div className="workflow-line" />
        <div className="workflow-step active">
          <b>02</b>
          <span>Генерация</span>
        </div>
        <div className="workflow-line" />
        <div className="workflow-step">
          <b>03</b>
          <span>Расписание</span>
        </div>
      </div>

      <section className="generation-layout">
        <div className="panel generation-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">НОВЫЙ РАСЧЁТ</span>
              <h2>Составить расписание</h2>
            </div>
            <span className="icon-mark" aria-hidden="true">
              ↗
            </span>
          </div>
          <p className="muted">
            Решатель сначала размещает все занятия без нарушений, затем ищет более удобный вариант.
            Лучший найденный результат сохраняется автоматически.
          </p>
          <label className="field">
            Название варианта
            <input value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} />
          </label>
          <label className="field">
            Время поиска
            <select value={budget} onChange={(event) => setBudget(Number(event.target.value))}>
              <option value={10}>10 секунд · быстрый просмотр</option>
              <option value={30}>30 секунд · обычно</option>
              <option value={60}>1 минута · тщательнее</option>
              <option value={120}>2 минуты · расширенный поиск</option>
              <option value={300}>5 минут · максимум</option>
            </select>
          </label>
          <WeightProfileEditor
            weights={weights}
            onChange={(next) => {
              setWeights(next)
              setSelectedWeightProfileID(null)
            }}
            profiles={weightProfiles.data ?? []}
            selectedProfileId={selectedWeightProfileID}
            onSelectProfile={(id) => {
              setSelectedWeightProfileID(id)
              const profile = (weightProfiles.data ?? []).find((p) => p.id === id)
              if (profile) setWeights(normalizeWeights(profile.weights))
              else setWeights({ ...DEFAULT_WEIGHTS })
            }}
            onSaveProfile={(name, nextWeights) =>
              saveWeightProfile.mutate({ name, weights: nextWeights })
            }
            onDeleteProfile={(id) => removeWeightProfile.mutate(id)}
          />
          {saveWeightProfile.isError && <p className="error">{saveWeightProfile.error.message}</p>}
          {removeWeightProfile.isError && (
            <p className="error">{removeWeightProfile.error.message}</p>
          )}
          {startError && <p className="error">{startError}</p>}
          {notice && <p className="success-message">{notice}</p>}
          <button
            className="primary-button"
            onClick={() => start.mutate()}
            disabled={busy || start.isPending || !dataset.data?.lessons}
          >
            {start.isPending
              ? 'Запускаем…'
              : busy
                ? 'Генерация уже выполняется'
                : 'Запустить генерацию'}
            {!busy && !start.isPending && <span aria-hidden="true"> →</span>}
          </button>
          {!dataset.isPending && dataset.data?.lessons === 0 && (
            <div className="empty-data">
              <strong>Учебный план пока пуст</strong>
              <p>
                {demoStatus.data?.enabled
                  ? 'Загрузите синтетический набор кнопкой справа, чтобы попробовать генерацию.'
                  : 'Для локального демо попросите администратора загрузить синтетический набор командой make seed.'}
              </p>
            </div>
          )}
        </div>

        <div className="panel data-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ВХОДНЫЕ ДАННЫЕ</span>
              <h2>Учебный набор</h2>
            </div>
            <span className="data-status">{dataset.isError ? 'Ошибка' : 'Подключено'}</span>
          </div>
          {dataset.isPending ? (
            <p className="muted">Загружаем справочники…</p>
          ) : dataset.isError ? (
            <p className="error">{dataset.error.message}</p>
          ) : (
            <>
              <div className="data-metrics">
                <Metric
                  value={dataset.data.groups}
                  label={pluralForm(dataset.data.groups, 'группа', 'группы', 'групп')}
                />
                <Metric
                  value={dataset.data.teachers}
                  label={pluralForm(
                    dataset.data.teachers,
                    'преподаватель',
                    'преподавателя',
                    'преподавателей',
                  )}
                />
                <Metric
                  value={dataset.data.rooms}
                  label={pluralForm(dataset.data.rooms, 'аудитория', 'аудитории', 'аудиторий')}
                />
                <Metric
                  value={dataset.data.lessons}
                  label={`${pluralForm(dataset.data.lessons, 'занятие', 'занятия', 'занятий')} в плане`}
                />
              </div>
              <div className="data-footnote">
                <span className="status-dot" />
                Данные берутся из справочников и учебного плана системы
              </div>
            </>
          )}
          {demoStatus.data?.enabled && (
            <div className="demo-load">
              <div>
                <strong>Синтетический вуз для теста</strong>
                <span>Заменит справочники, учебный план и сохранённые расписания</span>
              </div>
              <button
                className="quiet-button"
                disabled={busy || loadDemo.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Заменить текущие справочники, учебный план и сохранённые расписания синтетическим набором? Учётные записи и журнал действий сохранятся.',
                    )
                  ) {
                    loadDemo.mutate()
                  }
                }}
              >
                {loadDemo.isPending ? 'Загружаем…' : 'Загрузить демо-данные'}
              </button>
            </div>
          )}
          {demoStatus.isError && <p className="error">{demoStatus.error.message}</p>}
          {loadDemo.isError && <p className="error">{loadDemo.error.message}</p>}
        </div>
      </section>

      <DatasetEditor
        onImported={(counts) => {
          setJobID('')
          setSelectedScheduleID(null)
          setNotice(
            `Набор загружен: ${counts.groups} групп, ${counts.teachers} преподавателей, ${counts.lessons} занятий.`,
          )
          localStorage.removeItem('timetable-generation-job')
          void queryClient.invalidateQueries({ queryKey: ['dataset-summary'] })
          void queryClient.invalidateQueries({ queryKey: ['schedules'] })
          void queryClient.invalidateQueries({ queryKey: ['generation-job'] })
        }}
      />

      {job.isError && (
        <p className="error">Не удалось восстановить задачу генерации: {job.error.message}</p>
      )}
      {currentJob && (
        <section className="panel progress-panel" aria-live="polite">
          <div className="progress-heading">
            <div>
              <span className="eyebrow">ЗАДАЧА · {currentJob.id.slice(0, 8)}</span>
              <h2>{STATUS_LABELS[currentJob.status]}</h2>
              <p className="muted">
                {currentJob.status === 'queued'
                  ? STAGE_LABELS.queued
                  : (STAGE_LABELS[currentJob.stage] ?? currentJob.stage)}
              </p>
            </div>
            {busy && (
              <button
                className="danger-button"
                onClick={() => stop.mutate()}
                disabled={stop.isPending}
              >
                {stop.isPending ? 'Останавливаем…' : 'Остановить и сохранить'}
              </button>
            )}
          </div>
          {stopError && <p className="error">{stopError}</p>}
          {currentJob.status === 'failed' && currentJob.error && (
            <p className="error">{currentJob.error}</p>
          )}
          {firstFeasibleFound && (
            <div className="feasible-notice" role="status">
              <span className="status-dot" />
              Первый вариант без жёстких конфликтов найден. Продолжаем улучшать качество.
            </div>
          )}
          <div className="progress-track">
            <div
              className={`progress-value ${
                currentJob.status === 'queued' || currentJob.stage === 'feasibility'
                  ? 'indeterminate'
                  : ''
              }`}
              style={
                currentJob.status === 'queued' || currentJob.stage === 'feasibility'
                  ? undefined
                  : { width: `${currentJob.progress}%` }
              }
            />
          </div>
          <div className="progress-meta">
            <span>
              {currentJob.status === 'queued'
                ? 'В очереди'
                : currentJob.stage === 'feasibility'
                  ? 'Подготовка первого варианта'
                  : `${currentJob.progress}%`}
            </span>
            <span>
              {currentJob.status === 'queued'
                ? `Лимит после запуска · ${formatDuration(currentJob.budget_seconds)}`
                : remainingSeconds === 0 && elapsedSeconds >= currentJob.budget_seconds
                  ? `Прошло ${formatDuration(elapsedSeconds)} · выбранный лимит времени достигнут`
                  : `Прошло ${formatDuration(elapsedSeconds)} из ~${formatDuration(currentJob.budget_seconds)} · осталось около ${formatDuration(remainingSeconds)}`}
            </span>
          </div>
          {busy && (
            <p className="progress-estimate">
              Время ориентировочное: сначала система ищет расписание без накладок, затем улучшает
              его до конца выбранного времени.
            </p>
          )}
          <div className="job-stats">
            <Metric
              value={`${currentJob.placed} / ${currentJob.lessons}`}
              label="размещено занятий"
            />
            <Metric value={currentJob.hard_violations} label="жёстких конфликтов" />
            <Metric value={Math.round(currentJob.soft_penalty)} label="штраф качества" />
            <Metric value={currentJob.steps.toLocaleString('ru-RU')} label="шагов поиска" />
          </div>
          {currentJob.result?.violations.length ? (
            <div className="job-violations">
              <strong>Ограничения, которые не удалось выполнить</strong>
              <ul>
                {currentJob.result.violations.map((violation, index) => (
                  <li key={`${violation.rule}-${index}`}>
                    <b>{violation.rule}</b> {violation.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {livePreview && (
        <section className="schedule-section live-schedule-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ЛУЧШИЙ НАЙДЕННЫЙ ВАРИАНТ · ЧЕРНОВИК</span>
              <h2>Промежуточное расписание</h2>
            </div>
          </div>
          <Timetable
            schedule={livePreview}
            filterKind={filterKind}
            filterName={filterName}
            filterOptions={lessonOptions}
            week={week}
            onFilterKind={setFilterKind}
            onFilterName={setFilterName}
            onWeek={setWeek}
          />
        </section>
      )}

      <section className="schedule-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">СОХРАНЁННЫЕ ВАРИАНТЫ</span>
            <h2>Расписание</h2>
          </div>
          {schedules.data && schedules.data.length > 0 && (
            <div className="schedule-actions">
              <select
                aria-label="Выбрать сохранённое расписание"
                value={scheduleID ?? ''}
                onChange={(event) => setSelectedScheduleID(Number(event.target.value))}
              >
                {schedules.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {schedule.data && (
                <>
                  <button
                    className="quiet-button"
                    onClick={() => void exportSchedule(schedule.data!, 'ttx')}
                  >
                    Скачать JSON (TTX/1)
                  </button>
                  <button
                    className="quiet-button"
                    onClick={() => void exportSchedule(schedule.data!, 'excel')}
                    disabled={excelExporting}
                  >
                    {excelExporting ? 'Готовим Excel…' : 'Скачать Excel'}
                  </button>
                  <button
                    className="quiet-button"
                    onClick={() => void exportSchedule(schedule.data!, 'visualize')}
                  >
                    Открыть в визуализаторе
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {exportError && <p className="error">{exportError}</p>}
        {schedules.isError && <p className="error">{schedules.error.message}</p>}
        {schedules.isPending || schedule.isPending ? (
          <div className="panel empty-schedule">Загружаем расписание…</div>
        ) : !schedules.data?.length ? (
          <div className="panel empty-schedule">
            <div className="empty-icon">▦</div>
            <h3>Здесь появится результат генерации</h3>
            <p className="muted">
              Запустите расчёт — расписание сохранится и будет доступно после перезагрузки.
            </p>
          </div>
        ) : schedule.isError ? (
          <div className="panel">
            <p className="error">{schedule.error.message}</p>
          </div>
        ) : schedule.data ? (
          <Timetable
            schedule={schedule.data}
            filterKind={filterKind}
            filterName={filterName}
            filterOptions={lessonOptions}
            week={week}
            onFilterKind={setFilterKind}
            onFilterName={setFilterName}
            onWeek={setWeek}
          />
        ) : null}
      </section>
    </div>
  )
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function pluralForm(count: number, one: string, few: string, many: string): string {
  const form = new Intl.PluralRules('ru').select(count)
  return form === 'one' ? one : form === 'few' ? few : many
}

type TimetableData = Omit<Schedule, 'id' | 'created_at' | 'periods'> & {
  created_at?: string
  periods?: Schedule['periods']
}

function Timetable({
  schedule,
  filterKind,
  filterName,
  filterOptions,
  week,
  onFilterKind,
  onFilterName,
  onWeek,
}: {
  schedule: TimetableData
  filterKind: 'group' | 'teacher' | 'room'
  filterName: string
  filterOptions: string[]
  week: 'odd' | 'even'
  onFilterKind: (value: 'group' | 'teacher' | 'room') => void
  onFilterName: (value: string) => void
  onWeek: (value: 'odd' | 'even') => void
}) {
  const days = DAYS.slice(0, schedule.days)
  const scheduled = schedule.lessons.filter(
    (lesson) => lesson.placed && (lesson.parity === 'every' || lesson.parity === week),
  )
  const filtered = scheduled.filter((lesson) => {
    if (!filterName) return true
    if (filterKind === 'group') return lesson.audience.includes(filterName)
    if (filterKind === 'teacher') return lesson.teacher === filterName
    return lesson.room === filterName
  })
  const periods = Array.from({ length: schedule.periods_per_day }, (_, index) => index + 1)
  const periodTimes = new Map((schedule.periods ?? []).map((period) => [period.number, period]))

  return (
    <div className="panel timetable-panel">
      <div className="timetable-toolbar">
        <div className="filter-control">
          <select
            aria-label="Тип фильтра"
            value={filterKind}
            onChange={(event) => {
              onFilterKind(event.target.value as 'group' | 'teacher' | 'room')
              onFilterName('')
            }}
          >
            <option value="group">Группа</option>
            <option value="teacher">Преподаватель</option>
            <option value="room">Аудитория</option>
          </select>
          <select
            aria-label="Фильтр расписания"
            value={filterName}
            onChange={(event) => onFilterName(event.target.value)}
          >
            <option value="">Все</option>
            {filterOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="week-tabs" role="group" aria-label="Неделя">
          <button className={week === 'odd' ? 'selected' : ''} onClick={() => onWeek('odd')}>
            Над чертой
          </button>
          <button className={week === 'even' ? 'selected' : ''} onClick={() => onWeek('even')}>
            Под чертой
          </button>
        </div>
        <div className="schedule-quality">
          <span className={schedule.hard_violations ? 'quality-bad' : 'quality-good'}>
            {schedule.hard_violations
              ? `${schedule.hard_violations} конфликтов`
              : 'Без жёстких конфликтов'}
          </span>
          <span>Штраф {Math.round(schedule.soft_penalty)}</span>
        </div>
      </div>
      <div className="timetable-scroll">
        <table className="timetable-grid">
          <thead>
            <tr>
              <th className="period-column">Пара</th>
              {days.map((day) => (
                <th key={day}>{DAY_LABELS[day]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const time = periodTimes.get(period)
              return (
                <tr key={period}>
                  <th className="period-cell">
                    <b>{period}</b>
                    <span>{time ? `${time.starts_at}–${time.ends_at}` : ''}</span>
                  </th>
                  {days.map((day) => (
                    <td key={day}>
                      {filtered
                        .filter((lesson) => lesson.day === day && lesson.period === period)
                        .map((lesson) => (
                          <LessonCard key={lesson.id} lesson={lesson} />
                        ))}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="timetable-footer">
        <span>
          {schedule.placed} размещено из {schedule.lessons.length} занятий
        </span>
        <span>
          {schedule.created_at
            ? `${schedule.name} · обновлено ${new Date(schedule.created_at).toLocaleString('ru-RU')}`
            : `${schedule.name} · черновик обновляется во время поиска`}
        </span>
      </div>
    </div>
  )
}

function previewAsSchedule(preview: GenerationPreview): TimetableData {
  return {
    ...preview,
    name: 'Текущий лучший вариант',
    periods: [],
  }
}

function parseElapsedSeconds(elapsed: string): number | undefined {
  const parts = [...elapsed.matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/g)]
  if (!parts.length || parts.map(([part]) => part).join('') !== elapsed) return undefined
  const secondsPerUnit: Record<string, number> = {
    h: 3600,
    m: 60,
    s: 1,
    ms: 0.001,
    us: 0.000001,
    µs: 0.000001,
    ns: 0.000000001,
  }
  let total = 0
  for (const part of parts) {
    const amount = part[1]
    const unit = part[2]
    if (amount === undefined || unit === undefined || secondsPerUnit[unit] === undefined)
      return undefined
    total += Number(amount) * secondsPerUnit[unit]
  }
  return total
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  if (minutes === 0) return `${remainder} сек`
  return `${minutes} мин ${remainder.toString().padStart(2, '0')} сек`
}

function LessonCard({ lesson }: { lesson: Schedule['lessons'][number] }) {
  return (
    <article className={`timetable-lesson type-${lesson.kind}`}>
      <div className="lesson-card-title">{lesson.discipline}</div>
      <div>{lesson.audience.join(', ')}</div>
      <div className="lesson-card-meta">
        {lesson.teacher}
        {lesson.room ? ` · ${lesson.room}` : ''}
      </div>
      <span className="lesson-parity">
        {lesson.parity === 'every'
          ? 'каждую неделю'
          : lesson.parity === 'odd'
            ? 'числитель'
            : 'знаменатель'}
      </span>
    </article>
  )
}

function PageError({ title, message }: { title: string; message: string }) {
  return (
    <section className="page-error">
      <h1>{title}</h1>
      <p>{message}</p>
    </section>
  )
}
