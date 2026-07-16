import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'HomePage.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('HomePage people-first hierarchy', () => {
  it('labels the contact row People, not Quick send', () => {
    expect(source).toMatch(/>People</)
    expect(source).not.toMatch(/Quick send/)
  })

  it('places People before Requests waiting', () => {
    expect(indexOf('>Requests waiting<')).toBeGreaterThan(indexOf('>People<'))
  })

  it('places People before the activity toast so relationships lead', () => {
    expect(indexOf('activity-banner')).toBeGreaterThan(indexOf('>People<'))
  })

  it('places Recent payments before Open invoices and Shared trips', () => {
    const recent = indexOf('>Recent payments<')
    expect(recent).toBeLessThan(indexOf('>Open invoices<'))
    expect(recent).toBeLessThan(indexOf('>Shared trips<'))
  })

  it('uses ~66px avatars in the People row', () => {
    expect(source).toMatch(/Identicon[^>]*:size="6[4-8]"/)
  })

  it('auto-dismisses the activity toast after a few seconds', () => {
    expect(source).toMatch(/BANNER_AUTO_DISMISS_MS\s*=\s*[3-9]\d{3}/)
    expect(source).toMatch(/setTimeout\(\s*\(\)\s*=>\s*dismissBanner\(\)/)
  })

  it('uses a compact icon refresh control instead of a labeled Refresh button', () => {
    expect(source).toMatch(/aria-label="Refresh"/)
    expect(source).not.toMatch(/>Refresh</)
  })

  it('labels the external explorer action as View with an outbound cue', () => {
    expect(source).toMatch(/View\s*↗/)
    expect(source).not.toMatch(/>\s*Explorer\s*</)
  })

  it('wraps major sections in home-panel cards', () => {
    expect(source).toMatch(/class="[^"]*home-panel/)
    expect((source.match(/home-panel/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})
