import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatasetEditor } from './DatasetEditor.tsx'

describe('DatasetEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates reference data and imports curriculum measured in semester hours', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ groups: 1, teachers: 1, rooms: 1, lessons: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const onImported = vi.fn()
    render(<DatasetEditor onImported={onImported} />)
    const form = (title: string) =>
      within(screen.getByRole('heading', { name: title }).closest('form') as HTMLFormElement)

    fireEvent.change(screen.getByLabelText('Шифр группы'), { target: { value: 'Б26-071-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу' }))

    fireEvent.click(screen.getByRole('button', { name: /Преподаватели/ }))
    fireEvent.change(form('Добавить преподавателя').getByLabelText('Фамилия, имя, отчество'), {
      target: { value: 'Иванов Иван Иванович' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить преподавателя' }))

    fireEvent.click(screen.getByRole('button', { name: /Дисциплины/ }))
    fireEvent.change(form('Добавить дисциплину').getByLabelText('Название дисциплины'), {
      target: { value: 'Математика' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дисциплину' }))

    fireEvent.click(screen.getByRole('button', { name: /Аудитории/ }))
    fireEvent.change(form('Корпус').getByLabelText('Название корпуса'), {
      target: { value: 'Корпус 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить корпус' }))
    fireEvent.change(form('Аудитория').getByLabelText('Корпус'), {
      target: { value: 'building-1' },
    })
    fireEvent.change(form('Аудитория').getByLabelText('Номер аудитории'), {
      target: { value: '1-101' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить аудиторию' }))

    fireEvent.click(screen.getByRole('button', { name: /Учебная нагрузка/ }))
    fireEvent.change(screen.getByLabelText('Дисциплина'), { target: { value: 'discipline-1' } })
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'Б26-071-1' } })
    fireEvent.change(screen.getByLabelText('Преподаватель'), {
      target: { value: 'teacher-1' },
    })
    fireEvent.change(screen.getByLabelText('Часов за семестр'), { target: { value: '36' } })
    expect(screen.getByText('1 пара в неделю')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить нагрузку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и загрузить набор' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dataset',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"semester_hours":36'),
      }),
    )
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(requestBody.dataset).toMatchObject({
      format: 'timetable-dataset',
      version: 2,
      semester_weeks: 18,
      groups: [{ key: 'Б26-071-1' }],
      curriculum_items: [
        {
          discipline: 'discipline-1',
          kind: 'lecture',
          teacher: 'teacher-1',
          semester_hours: 36,
          audience: [{ group: 'Б26-071-1' }],
        },
      ],
    })
    expect(screen.getByText('36', { selector: '.dataset-summary-card strong' })).toBeInTheDocument()
  })

  it('opens a previously saved versioned JSON dump', async () => {
    const dataset = {
      format: 'timetable-dataset',
      version: 2,
      name: 'Пробный набор',
      semester_weeks: 18,
      time_grid: { days: 6, periods_per_day: 7 },
      periods: [],
      room_types: [],
      buildings: [],
      rooms: [],
      groups: [{ key: 'Б26-071-1', course: 1, size: 25 }],
      subgroups: [],
      teachers: [],
      disciplines: [],
      curriculum_items: [],
    }
    const file = new File([''], 'dataset.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve(JSON.stringify(dataset)),
    })
    render(<DatasetEditor onImported={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Выбрать JSON-дамп'), {
      target: { files: [file] },
    })

    expect(await screen.findAllByText('Б26-071-1')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Учебная нагрузка/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
  })
})
