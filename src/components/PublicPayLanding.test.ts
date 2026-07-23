import publicPayLandingSource from './PublicPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicPayLanding sizing and button classes', () => {
  it('uses the 96px avatar and 200px QR code sizes', () => {
    expect(publicPayLandingSource).toMatch(/<Identicon :address="payment.recipient" :size="96"/)
    expect(publicPayLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="200"/)
  })

  it('keeps amount and message above the pay-row', () => {
    expect(publicPayLandingSource).toMatch(
      /payment-panel__amount[\s\S]*?payment-panel__message[\s\S]*?class="panel__pay-row"/,
    )
  })

  it('wraps pay content in panel__pay-row', () => {
    expect(publicPayLandingSource).toMatch(/class="panel__pay-row"/)
    expect(publicPayLandingSource).toMatch(/class="panel__pay-meta"/)
  })

  it('defines base panel__pay-row CSS', () => {
    expect(publicPayLandingSource).toMatch(
      /\.panel__pay-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*0\.5rem;[\s\S]*?justify-items:\s*center;[\s\S]*?width:\s*100%;/,
    )
  })

  it('keeps template/source strings free of em/en dashes', () => {
    expect(publicPayLandingSource).not.toMatch(/[—–]/)
  })

  it('uses the shared .nq-button class on its filled actions', () => {
    expect(publicPayLandingSource).toContain('class="nq-button"')
    expect(publicPayLandingSource).toContain('class="nq-button light-blue"')
  })
})
