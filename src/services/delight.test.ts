import { beforeEach, describe, expect, it, vi } from 'vitest'
import { delightOnce, celebrateOnce } from './delight'

describe('delight once flags', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns true only the first time a key is used', () => {
    expect(delightOnce('first-split')).toBe(true)
    expect(delightOnce('first-split')).toBe(false)
    expect(delightOnce('first-public-profile')).toBe(true)
  })

  it('celebrateOnce skips after the first call', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMedia)
    celebrateOnce('first-bucket-complete')
    celebrateOnce('first-bucket-complete')
    expect(localStorage.getItem('nimconnect:delight:first-bucket-complete')).toBe('1')
    vi.unstubAllGlobals()
  })
})
