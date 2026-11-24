import { createBrowserRouter } from 'react-router'
import { App } from './App.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { Navigate } from 'react-router'
import { SchedulerPage } from './pages/SchedulerPage.tsx'
import { TimetablePage } from './pages/TimetablePage.tsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <SchedulerPage /> },
      { path: 'make-timetable', element: <SchedulerPage /> },
      { path: 'vizualize-timetable', element: <TimetablePage /> },
      { path: 'review', element: <Navigate to="/vizualize-timetable" replace /> },
      { path: 'status', element: <HomePage /> },
    ],
  },
])
