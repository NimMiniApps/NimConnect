const pathStyleHashRoutes = new Set(['/admin/stats'])

// Some in-app browsers turn a hash deep link such as /#/admin/stats into
// /admin/stats#/. Move the known route back into the hash before Vue Router
// reads it, preserving hash routing for hosts without SPA rewrites.
export function canonicalHashRoute(pathname: string, search: string, hash: string): string | null {
  if (hash !== '#/' || !pathStyleHashRoutes.has(pathname)) return null
  return `/#${pathname}${search}`
}
