import publicPayLandingSource from './PublicPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicPayLanding sizing and button classes', () => {
  it('uses the 80px avatar and 180px QR code sizes', () => {
    expect(publicPayLandingSource).toMatch(/<Identicon :address="payment.recipient" :size="80"/)
    expect(publicPayLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="180"/)
  })

  it('uses the shared .nq-button class on its filled actions', () => {
    expect(publicPayLandingSource).toContain('class="nq-button"')
    expect(publicPayLandingSource).toContain('class="nq-button light-blue"')
  })
})
