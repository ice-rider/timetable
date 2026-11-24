import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchHealth } from '../api/health.ts'

export function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
  })

  let status: string
  if (health.isPending) status = 'проверка…'
  else if (health.isError) status = 'недоступен'
  else status = health.data.status === 'ok' ? 'работает' : health.data.status

  return (
    <section>
      <h1>Система составления расписания</h1>
      <p>
        API: <span data-testid="api-status">{status}</span>
      </p>
      <div className="workflow-grid">
        <article className="workflow-card">
          <h2>Планирование расписания</h2>
          <p>
            Откройте рабочее место: загрузите учебные данные, запустите генерацию и выберите
            сохранённый результат.
          </p>
          <Link className="button primary" to="/make-timetable">
            Открыть рабочее место
          </Link>
        </article>
        <article className="workflow-card">
          <h2>Визуализировать расписание</h2>
          <p>Загрузите Excel или JSON расписания, чтобы просмотреть сетку и нарушения.</p>
          <Link className="button secondary" to="/vizualize-timetable">
            Открыть визуализатор
          </Link>
        </article>
      </div>
    </section>
  )
}
