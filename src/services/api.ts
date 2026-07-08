const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/** API origin. Empty string means relative `/api/...` (Vite dev proxy). */
export function resolveApiBase(): string {
  if (API_BASE) return API_BASE.replace(/\/$/, '')
  if (import.meta.env.DEV) return ''
  return ''
}

/** True when a production API URL was baked in at build time, or in Vite dev (proxy). */
export function hasApiBase(): boolean {
  return !!API_BASE || import.meta.env.DEV
}

export function apiUrl(path: string): string {
  const base = resolveApiBase()
  return base ? `${base}${path}` : path
}
