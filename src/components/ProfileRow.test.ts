import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, './ProfileRow.vue'), 'utf8')

describe('ProfileRow', () => {
  it('shows identity and activity as separate relationship signals', () => {
    expect(source).toMatch(/identityLine/)
    expect(source).toMatch(/activityLine/)
    expect(source).toMatch(/Last activity/)
    expect(source).toMatch(/@\$\{p\.handle\}/)
    expect(source).toMatch(/shortAddress\(p\.address\)/)
  })

  it('toggles favorites from an icon-only trailing star without opening the contact', () => {
    expect(source).toMatch(/toggleFavorite/)
    expect(source).toMatch(/Added to Favorites/)
    expect(source).toMatch(/fav-btn/)
    expect(source).toMatch(/☆/)
    expect(source).toMatch(/★/)
    expect(source).not.toMatch(/fav-label/)
    expect(source).toMatch(/stopPropagation/)
  })
})
