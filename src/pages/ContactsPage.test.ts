import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, './ContactsPage.vue'), 'utf8')

describe('ContactsPage', () => {
  it('uses adaptive Favorites → Recently active → Everyone buckets without duplicates', () => {
    const favorites = source.indexOf('⭐ Favorites')
    const recent = source.indexOf('🕒 Recently active')
    const everyone = source.indexOf('👥 Everyone')
    expect(favorites).toBeGreaterThan(-1)
    expect(recent).toBeGreaterThan(favorites)
    expect(everyone).toBeGreaterThan(recent)
    expect(source).toMatch(/!favoriteIds\.has/)
    expect(source).toMatch(/!recentIds\.has/)
  })

  it('uses relationship-oriented empty copy and a richer search placeholder', () => {
    expect(source).toMatch(/Save people you pay often to make future payments easier/)
    expect(source).toMatch(/Search people, @handles, notes or tags/)
    expect(source).toMatch(/>Add contact</)
  })
})
