import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchedulerPage } from './SchedulerPage.tsx'
import { downloadScheduleExcel } from '../api/scheduleExcelExport.ts'

vi.mock('../api/scheduleExcelExport.ts', () => ({
  downloadScheduleExcel: vi.fn().mockResolvedValue(undefined),
}))

const user = {
  id: 1,
  login: 'dispatcher',
  role: 'admin',
  display_name: 'Диспетчер',
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <MemoryRouter initialEntries={['/make-timetable']}>
      <QueryClientProvider client={queryClient}>
        <SchedulerPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function workspaceResponse(path: string): Response {
  if (path === '/api/auth/me') return jsonResponse(user)
  if (path === '/api/demo/dataset') return jsonResponse({ enabled: false })
  if (path === '/api/groups') return jsonResponse([{ id: 1 }])
  if (path === '/api/teachers') return jsonResponse([{ id: 1 }])
  if (path === '/api/rooms') return jsonResponse([{ id: 1 }])
  if (path === '/api/curriculum-items') return jsonResponse([{ lessons: [{ id: 1 }] }])
  if (path === '/api/schedules')
    return jsonResponse([{ id: 7, name: 'План весна', created_at: '2026-01-01T00:00:00Z' }])
  if (path === '/api/schedules/7')
    return jsonResponse({
      id: 7,
      name: 'План весна',
      created_at: '2026-01-01T00:00:00Z',
      days: 2,
      periods_per_day: 2,
      periods: [{ number: 1, starts_at: '08:00', ends_at: '09:30' }],
      lessons: [
        {
          id: 1,
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
        {
          id: 2,
          placed: true,
          day: 'TU',
          period: 1,
          parity: 'odd',
          discipline: 'История',
          kind: 'seminar',
          teacher: 'И. Примеров',
          audience: ['ГР-1'],
          room: 'А-102',
        },
      ],
      placed: 2,
      hard_violations: 0,
      soft_penalty: 12,
    })
  return jsonResponse({ error: { code: 'not_found', message: `No mock for ${path}` } }, 404)
}

describe('SchedulerPage', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('authenticates an administrator and opens the workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === '/api/auth/me' && !init?.method) return Promise.resolve(jsonResponse({}, 401))
        if (path === '/api/auth/refresh') return Promise.resolve(jsonResponse({}, 401))
        if (path === '/api/auth/login')
          return Promise.resolve(jsonResponse({ user, access_token: 'token', expires_at: '' }))
        return Promise.resolve(workspaceResponse(path))
      }),
    )
    renderPage()

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'dispatcher' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    expect(
      await screen.findByRole('heading', { name: 'Планирование расписания' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('занятие в плане')).toBeInTheDocument()
  })

  it('shows the saved timetable and applies odd/even week filtering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => Promise.resolve(workspaceResponse(String(input)))),
    )
    renderPage()

    expect(await screen.findByText('Алгебра')).toBeInTheDocument()
    expect(screen.getByText('История')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
    await waitFor(() => expect(downloadScheduleExcel).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Знаменатель' }))

    await waitFor(() => expect(screen.queryByText('История')).not.toBeInTheDocument())
    expect(screen.getByText('Алгебра')).toBeInTheDocument()
  })

  it('loads the synthetic dataset after explicit confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === '/api/demo/dataset' && init?.method === 'POST')
          return Promise.resolve(
            jsonResponse({
              groups: 20,
              teachers: 40,
              lessons: 411,
            }),
          )
        if (path === '/api/demo/dataset') return Promise.resolve(jsonResponse({ enabled: true }))
        return Promise.resolve(workspaceResponse(path))
      }),
    )
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Загрузить демо-данные' }))

    expect(await screen.findByText(/Демо-данные загружены: 20 групп/)).toBeInTheDocument()
    expect(window.confirm).toHaveBeenCalledOnce()
  })

  it('shows the remaining-time estimate and live best schedule preview', async () => {
    const jobID = 'a'.repeat(32)
    localStorage.setItem('timetable-generation-job', jobID)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input)
        if (path === `/api/schedule-jobs/${jobID}`) {
          return Promise.resolve(
            jsonResponse({
              id: jobID,
              status: 'running',
              stage: 'optimization',
              progress: 40,
              lessons: 2,
              placed: 2,
              hard_violations: 0,
              soft_penalty: 12,
              steps: 512,
              elapsed: '7s',
              budget_seconds: 30,
              preview: {
                days: 2,
                periods_per_day: 2,
                lessons: [
                  {
                    id: 1,
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
                  {
                    id: 2,
                    placed: true,
                    day: 'TU',
                    period: 1,
                    parity: 'odd',
                    discipline: 'История',
                    kind: 'seminar',
                    teacher: 'И. Примеров',
                    audience: ['ГР-1'],
                    room: 'А-102',
                  },
                ],
                placed: 2,
                hard_violations: 0,
                soft_penalty: 12,
              },
            }),
          )
        }
        return Promise.resolve(workspaceResponse(path))
      }),
    )
    renderPage()

    expect(await screen.findByText(/осталось около 23 сек/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'Первый вариант без жёстких конфликтов найден. Продолжаем улучшать качество.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Промежуточное расписание' })).toBeInTheDocument()
  })
})
