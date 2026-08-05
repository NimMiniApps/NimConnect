import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'App.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('App bottom nav viewport pinning', () => {
  it('pins the flex shell to the visible WebView height and keeps a safe-area floor', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf-8')
    expect(main).toMatch(/function syncAppHeight/)
    expect(main).toMatch(/visualViewport/)
    expect(main).toMatch(/--app-height/)
    const appRule = source.match(/\.app\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(appRule).toMatch(/display:\s*flex/)
    expect(appRule).toMatch(/flex-direction:\s*column/)
    expect(appRule).toMatch(/overflow:\s*hidden/)
    expect(appRule).toMatch(/height:\s*var\(--app-height/)
    expect(appRule).toMatch(/--nav-safe-bottom:\s*max\(12px,\s*env\(safe-area-inset-bottom/)
  })

  it('scrolls .app-main and keeps the bottom nav as an in-flow flex sibling with a dedicated icon row', () => {
    expect(source).toMatch(/\.app-main\s*\{[\s\S]*?overflow-y:\s*auto/)
    expect(source).toMatch(/\.app-main\s*\{[\s\S]*?flex:\s*1/)
    expect(source).toMatch(/\.bottom-nav\s*\{[\s\S]*?flex:\s*0 0 auto/)
    expect(source).toMatch(/\.bottom-nav\s*\{[\s\S]*?padding-bottom:\s*var\(--nav-safe-bottom\)/)
    expect(source).toMatch(/\.bottom-nav__row\s*\{[\s\S]*?height:\s*var\(--nav-h\)/)
    expect(source).not.toMatch(/\.bottom-nav\s*\{[\s\S]*?position:\s*fixed/)
    expect(source).toContain('class="bottom-nav__row"')
    expect(indexOf('class="app-main"')).toBeLessThan(indexOf('class="bottom-nav"'))
  })
})

describe('App desktop portal gate', () => {
  it('renders DesktopShell for desktop portal routes before the Nimiq Pay handoff', () => {
    expect(source).toMatch(/<DesktopShell/)
    expect(source).toContain('desktopPortalRoute')
    expect(indexOf('<DesktopShell')).toBeLessThan(indexOf('<OpenInNimiqPayLanding'))
  })

  it('does not force the mobile handoff for desktop at all — it is gated by desktopBrowser', () => {
    const desktopShellBlock = source.slice(indexOf('<DesktopShell'), indexOf('<OpenInNimiqPayLanding'))
    expect(desktopShellBlock).toMatch(/desktopBrowser/)
    expect(desktopShellBlock).toMatch(/isDesktopPortalPath|desktopPortalRoute/)
  })

  it('keeps the public /u/ profile branch rendering before the desktop shell branch', () => {
    expect(indexOf('publicProfileRoute')).toBeLessThan(indexOf('<DesktopShell'))
  })

  it('redirects desktop browsers off allowlisted routes back to /', () => {
    expect(source).toMatch(/isDesktopPortalPath\(path\)/)
    expect(source).toMatch(/router\.replace\('\/'\)/)
  })
})

describe('App create-profile handoff', () => {
  it('preserves claim intent when a browser hands the route to Nimiq Pay', () => {
    expect(source).toMatch(/NIMPAY_CREATE_PROFILE_URL/)
    expect(source).toMatch(/query\.sheet === 'claim'/)
    expect(source).toMatch(/handoffOpenUrl/)
  })
})

describe('App onboarding wizard wiring', () => {
  it('mounts OnboardingWizard and marks it shown on first run', () => {
    expect(source).toMatch(/OnboardingWizard/)
    expect(source).toMatch(/onboardingWizardOpen/)
    expect(source).toMatch(/onboardingWizardShown/)
    expect(source).toMatch(/markOnboardingWizardShown/)
    expect(source).toMatch(/maybeShowOnboardingWizard/)
    expect(source).not.toMatch(/<OnboardingSheet/)
    expect(source).not.toMatch(/<BackupOnboardingSheet/)
    expect(source).not.toMatch(/needsOnboarding/)
    expect(source).not.toMatch(/needsBackupOnboarding/)
  })
})
