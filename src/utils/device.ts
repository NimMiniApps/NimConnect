/** True on typical desktop/laptop browsers (fine pointer + hover). */
export function isDesktopBrowser(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
