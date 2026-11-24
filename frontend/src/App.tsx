import { NavLink, Outlet } from 'react-router'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Расписание</span>
        <nav>
          <NavLink to="/" end>
            Рабочее место
          </NavLink>
          <NavLink to="/make-timetable">Составить расписание</NavLink>
          <NavLink to="/vizualize-timetable">Визуализировать</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
