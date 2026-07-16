import publicPayLandingSource from './PublicPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicPayLanding sizing and button classes', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicPayLandingSource).toMatch(/<Identicon :address="payment.recipient" :size="96"/)
    expect(publicPayLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })

  it('uses the shared .nq-button class on its filled actions', () => {
    expect(publicPayLandingSource).toContain('class="nq-button"')
    expect(publicPayLandingSource).toContain('class="nq-button light-blue"')
  })
})
