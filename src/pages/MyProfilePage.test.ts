import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'MyProfilePage.vue'), 'utf-8')
const appSource = readFileSync(join(__dirname, '../App.vue'), 'utf-8')
const profileViewSource = readFileSync(join(__dirname, '../components/ProfileView.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('MyProfilePage identity-first redesign', () => {
  it('labels the hero as a public profile others can see', () => {
    expect(source).toMatch(/🌍/)
    expect(source).toMatch(/Public profile/)
    expect(source).toMatch(/This is what other people see/)
    expect(indexOf('public-profile-heading')).toBeLessThan(indexOf('<ProfileView'))
  })

  it('makes the QR section action-oriented', () => {
    expect(source).toMatch(/Share your public profile/)
    expect(source).toMatch(/Copy link/)
    expect(source).toMatch(/Open profile/)
    expect(source).not.toMatch(/Anyone can scan/)
  })

  it('renames edit to Edit public profile', () => {
    expect(profileViewSource).toMatch(/Edit public profile/)
    expect(profileViewSource).not.toMatch(/>\s*Edit profile\s*</)
  })

  it('surfaces prioritized quick stats, identity chips, and recent activity icons', () => {
    expect(indexOf("'Contacts'")).toBeLessThan(indexOf("'Buckets'"))
    expect(indexOf("'Buckets'")).toBeLessThan(indexOf("'Payment pages'"))
    expect(source).not.toMatch(/Handles claimed/)
    expect(source).toMatch(/status-chip/)
    expect(source).toMatch(/chip-green/)
    expect(source).toMatch(/chip-blue/)
    expect(source).toMatch(/chip-amber/)
    expect(source).toMatch(/My identity/)
    expect(source).toMatch(/Recently/)
    expect(source).toMatch(/recent-icon/)
    expect(source).toMatch(/💰/)
  })

  it('offers view public profile and fullscreen QR', () => {
    expect(source).toMatch(/View public profile/)
    expect(source).not.toMatch(/Preview public profile/)
    expect(source).toMatch(/qrFullscreen/)
    expect(source).toMatch(/Enlarge QR code/)
  })
})

describe('bottom nav', () => {
  it('does not surface Insights in the bar', () => {
    expect(appSource).not.toMatch(/to="\/insights"/)
    expect(appSource).not.toMatch(/>Insights</)
  })
})
