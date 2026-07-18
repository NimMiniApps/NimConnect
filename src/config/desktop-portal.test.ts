import { describe, expect, it } from 'vitest'
import { DESKTOP_PORTAL_ROUTES, isDesktopPortalPath } from './desktop-portal'

describe('isDesktopPortalPath', () => {
  it('allows the desktop portal routes', () => {
    for (const path of DESKTOP_PORTAL_ROUTES) {
      expect(isDesktopPortalPath(path)).toBe(true)
    }
  })

  it('allows any /u/:handle public profile path', () => {
    expect(isDesktopPortalPath('/u/x')).toBe(true)
    expect(isDesktopPortalPath('/u/ada')).toBe(true)
  })

  it('rejects Mini App relationship surfaces', () => {
    expect(isDesktopPortalPath('/contacts')).toBe(false)
    expect(isDesktopPortalPath('/settings')).toBe(false)
    expect(isDesktopPortalPath('/insights')).toBe(false)
  })
})
