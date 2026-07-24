import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'App.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

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
