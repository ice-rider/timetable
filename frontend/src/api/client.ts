export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })

  if (
    response.status === 401 &&
    retry &&
    !['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'].includes(path)
  ) {
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (refreshed.ok) return request<T>(path, init, false)
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; message?: string } } | undefined
    throw new ApiError(
      body?.error?.message ?? `Ошибка запроса: HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? 'http_error',
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export interface User {
  id: number
  login: string
  role: 'student' | 'teacher' | 'admin' | 'ai_agent'
  display_name: string
}

export interface Session {
  user: User
  access_token: string
  expires_at: string
}

export function getCurrentUser(signal?: AbortSignal): Promise<User> {
  return request('/api/auth/me', { signal })
}

export function login(login: string, password: string): Promise<Session> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) })
}

export function logout(): Promise<void> {
  return request('/api/auth/logout', { method: 'POST' })
}

export function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request(path, { signal })
}

export function postJSON<T>(path: string, body?: unknown): Promise<T> {
  return request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
}
