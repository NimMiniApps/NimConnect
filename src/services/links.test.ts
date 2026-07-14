import { describe, it, expect } from 'vitest'
import {
  makeRequestLink,
  makePaymentShareLink,
  makeNimiqPayDeepLink,
  makeAppAddLink,
  parsePaymentRequest,
  parsePaymentShareLink,
  classifyScan,
  shortAddress,
  nimToLunas,
  transactionExplorerUrl,
} from './links'
import { makeProfileShareLink } from './profile-share'
import type { Profile } from '../types/profile'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('links', () => {
  it('creates payment share links on the NimConnect origin', () => {
    const link = makePaymentShareLink(A, 5, 'Split: dinner')
    expect(link).toMatch(/^https:\/\/nimconnect\.nimiqminiapps\.com\/?#\/pay\?r=/)
    const parsed = parsePaymentRequest(link)
    expect(parsed?.recipient).toBe(A)
    expect(parsed?.amountNim).toBe(5)
    expect(parsed?.message).toBe('Split: dinner')
  })

  it('creates Nimiq Pay deep links for the public pay page', () => {
    const link = makeNimiqPayDeepLink(A, 5, 'Split: dinner')
    expect(link).toMatch(/^https:\/\/nimpay\.app\/miniapps\/open\//)
    const parsed = parsePaymentRequest(link)
    expect(parsed?.recipient).toBe(A)
    expect(parsed?.amountNim).toBe(5)
  })

  it('parses payment share links from pasted URLs', () => {
    const link = makePaymentShareLink(A, 2, 'Invoice')
    expect(parsePaymentShareLink(link)?.amountNim).toBe(2)
    const intent = classifyScan(link)
    expect(intent?.requestType).toBe('invoice')
    expect(intent?.hasAmount).toBe(true)
  })

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

  it('parses payment request links with amount and message', () => {
    const link = makeRequestLink(A, 12.5, 'Logo design')
    const parsed = parsePaymentRequest(link)
    expect(parsed?.recipient).toBe(A)
    expect(parsed?.amountNim).toBe(12.5)
    expect(parsed?.message).toBe('Logo design')
  })

  it('parses bare addresses', () => {
    expect(parsePaymentRequest(A)?.recipient).toBe(A)
  })

  it('creates and parses NimConnect add-contact deep links', () => {
    const link = makeAppAddLink(A)
    expect(link).toContain('#/add?address=')
    expect(parsePaymentRequest(link)?.recipient).toBe(A)
    expect(classifyScan(link)?.requestType).toBe('profile')
  })

  it('classifies full profile share links', () => {
    const profile: Profile = {
      id: 'x',
      address: A,
      name: 'Bob',
      type: 'merchant',
      isSelf: false,
      notes: '',
      tags: ['shop'],
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
      bio: 'Open daily',
    }
    const intent = classifyScan(makeProfileShareLink(profile))
    expect(intent?.requestType).toBe('profile')
    expect(intent?.sharedProfile?.name).toBe('Bob')
    expect(intent?.sharedProfile?.bio).toBe('Open daily')
  })

  it('returns null for unrelated QR content', () => {
    expect(parsePaymentRequest('https://example.com')).toBeNull()
  })

  it('classifies split and invoice request links', () => {
    const split = classifyScan(makeRequestLink(A, 4, 'Split: Dinner to Alice'))
    expect(split?.requestType).toBe('split')
    expect(split?.hasAmount).toBe(true)

    const invoice = classifyScan(makeRequestLink(A, 10, 'Logo design Invoice'))
    expect(invoice?.requestType).toBe('invoice')

    const profile = classifyScan(A)
    expect(profile?.requestType).toBe('profile')
    expect(profile?.hasAmount).toBe(false)
  })
})

describe('bucket scan classification', () => {
  it('classifies a bucket payment link by its 🪣 message prefix', () => {
    const link = makeRequestLink('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF', undefined, '🪣 Barcelona #a1b2c3d4')
    const intent = classifyScan(link)
    expect(intent?.requestType).toBe('bucket')
    expect(intent?.hasAmount).toBe(false)
    expect(intent?.message).toBe('🪣 Barcelona #a1b2c3d4')
  })
})
