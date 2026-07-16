import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(resolve(import.meta.dirname, './ScanSheet.vue'), 'utf8')
const scanner = readFileSync(resolve(import.meta.dirname, './QrScanner.vue'), 'utf8')
const actionSheet = readFileSync(resolve(import.meta.dirname, './ActionSheet.vue'), 'utf8')

describe('ScanSheet', () => {
  it('explains the page and supports instant paste recognition', () => {
    expect(sheet).toMatch(/Open payment links, public profiles, invoices and more/)
    expect(sheet).toMatch(/Paste a payment link, @handle or Nimiq address/)
    expect(sheet).toMatch(/looksReadyToResolve/)
    expect(sheet).toMatch(/Recognizing/)
    expect(sheet).toMatch(/'Open'/)
  })

  it('orders support chips by what people open, with icons', () => {
    const payment = sheet.indexOf('Payment requests')
    const qr = sheet.indexOf('QR codes')
    const handles = sheet.indexOf('@handles')
    expect(payment).toBeGreaterThan(-1)
    expect(qr).toBeGreaterThan(payment)
    expect(handles).toBeGreaterThan(qr)
    expect(sheet).toMatch(/💰/)
    expect(sheet).toMatch(/👤/)
  })
})

describe('QrScanner', () => {
  it('keeps a living frame and a subtle QR mark when the camera is unavailable', () => {
    expect(scanner).toMatch(/Camera unavailable/)
    expect(scanner).toMatch(/requires HTTPS/)
    expect(scanner).toMatch(/scan-line/)
    expect(scanner).toMatch(/qr-mark/)
    expect(scanner).not.toMatch(/emit\('error'/)
  })
})

describe('ActionSheet', () => {
  it('supports an optional subtitle under the title', () => {
    expect(actionSheet).toMatch(/subtitle\?:/)
    expect(actionSheet).toMatch(/sheet-subtitle/)
  })
})
