import { describe, it, expect } from 'vitest'
import { splitAmount } from './split'

describe('splitAmount', () => {
  it('splits evenly when divisible', () => {
    expect(splitAmount(30, 3)).toEqual([10, 10, 10])
  })

  it('distributes the luna remainder to the first shares', () => {
    const shares = splitAmount(10, 3)
    expect(shares).toHaveLength(3)
    const totalLunas = shares.reduce((s, x) => s + Math.round(x * 1e5), 0)
    expect(totalLunas).toBe(1000000)
    expect(shares[0]).toBeGreaterThanOrEqual(shares[2])
  })

  it('handles degenerate inputs', () => {
    expect(splitAmount(0, 3)).toEqual([])
    expect(splitAmount(10, 0)).toEqual([])
    expect(splitAmount(10, 1)).toEqual([10])
  })
})
