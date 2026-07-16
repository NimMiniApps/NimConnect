import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'ProfileView.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('ProfileView relationship-first contact page', () => {
  it('makes the name the strongest hero element before the address', () => {
    expect(indexOf('class="name"')).toBeLessThan(indexOf('class="address"'))
    expect(source).toMatch(/font-size:\s*28px/)
    expect(source).toMatch(/abbreviatedAddress|shortAddress/)
  })

  it('surfaces relationship identity chips and a prominent favorite state', () => {
    expect(source).toMatch(/Favorite/)
    expect(source).toMatch(/favorite-btn\.on/)
    expect(source).toMatch(/nimiq-gold-bg/)
    expect(source).toMatch(/identity-chip/)
    expect(source).toMatch(/relationshipHeadline|You paid them/)
  })

  it('surfaces a verified @handle under the name when available', () => {
    expect(source).toMatch(/contactHandle/)
    expect(source).toMatch(/Verified public profile/)
    expect(source).toMatch(/handleForAddress/)
  })

  it('shows verified + public profile live under the owner handle', () => {
    expect(source).toMatch(/owner-identity/)
    expect(source).toMatch(/✓ Verified/)
    expect(source).toMatch(/Public profile live/)
    expect(indexOf('owner-handle')).toBeLessThan(indexOf('Public profile live'))
  })

  it('emphasizes Send and Request over secondary actions', () => {
    expect(indexOf('primary-actions')).toBeLessThan(indexOf('secondary-actions'))
    expect(source).toMatch(/primary-action send/)
    expect(source).toMatch(/primary-action request/)
    expect(source).toMatch(/Split bill/)
  })

  it('previews recent activity with personal language and an empty state', () => {
    expect(source).toMatch(/Recent activity/)
    expect(source).toMatch(/You paid/)
    expect(source).toMatch(/They paid you/)
    expect(source).toMatch(/No payments yet/)
    expect(source).toMatch(/recentActivity/)
  })

  it('renders contact history as relationship payment cards, not a tx log', () => {
    expect(source).toMatch(/history-card/)
    expect(source).toMatch(/historyGroups/)
    expect(source).toMatch(/\bDetails\b/)
    expect(source).toMatch(/Transaction hash/)
    expect(source).toMatch(/Explorer ↗/)
    expect(source).toMatch(/Your payment history with/)
    expect(source).toMatch(/🏖 .* contribution/)
    expect(source).not.toMatch(/h\.incoming \? '\+' : '−'/)
    expect(source).not.toMatch(/class="history-explorer"[\s\S]*↗[\s\S]*Technical details/)
  })

  it('tucks Edit/Delete into Manage contact instead of competing with Send', () => {
    expect(source).toMatch(/Manage contact/)
    expect(source).toMatch(/manage-toggle/)
    expect(source).not.toMatch(/class="manage">\s*<button[^>]*>Edit<\/button>\s*<button[^>]*>Delete<\/button>/)
  })

  it('gives the relationship summary breathing room and explicit net copy', () => {
    expect(source).toMatch(/class="card relationship"/)
    expect(source).toMatch(/rel-block/)
    expect(source).toMatch(/You've sent more than you've received/)
    expect(source).toMatch(/You've received more than you've sent/)
  })
})
