import { describe, expect, it } from 'vitest'
import { canonicalHashRoute } from './hash-routing'

describe('canonicalHashRoute', () => {
  it('moves a path-style admin stats link ahead of the hash route', () => {
    expect(canonicalHashRoute('/admin/stats', '', '#/')).toBe('/#/admin/stats')
  })

  it('leaves an already canonical admin stats hash route unchanged', () => {
    expect(canonicalHashRoute('/', '', '#/admin/stats')).toBeNull()
  })

  it('does not rewrite unknown path-style links', () => {
    expect(canonicalHashRoute('/unknown', '', '#/')).toBeNull()
  })
})
