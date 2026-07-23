/** Routes served by the desktop identity shell (hash paths, no leading #). */
export const DESKTOP_PORTAL_ROUTES = ['/', '/lookup', '/me', '/about', '/admin/stats'] as const

export function isDesktopPortalPath(path: string): boolean {
  if (path.startsWith('/u/')) return true
  return (DESKTOP_PORTAL_ROUTES as readonly string[]).includes(path)
}
