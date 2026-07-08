import { describe, it, expect } from 'vitest'
import { makeRequestLink, shortAddress, nimToLunas, transactionExplorerUrl } from './links'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('links', () => {
  it('creates a nimiq: request link without amount', () => {
    const link = makeRequestLink(A)
    expect(link.startsWith('nimiq:')).toBe(true)
    expect(link.toUpperCase()).toContain('NQ07')
  })

  it('creates a request link carrying the amount', () => {
    const withAmount = makeRequestLink(A, 1.5)
    expect(withAmount).toContain('amount=1.5')
  })

  it('converts NIM to lunas', () => {
    expect(nimToLunas(1)).toBe(100000)
    expect(nimToLunas(0.00001)).toBe(1)
    expect(nimToLunas(1.234567)).toBe(123457)
  })

  it('shortens addresses for display', () => {
    expect(shortAddress(A)).toBe('NQ07 0000…0000')
    expect(shortAddress('')).toBe('')
  })

  it('builds NimiqScan transaction links', () => {
    expect(transactionExplorerUrl('7d0928')).toBe('https://nimiqscan.com/transaction/7d0928')
  })
})
