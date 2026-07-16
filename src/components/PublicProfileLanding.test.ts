import publicProfileLandingSource from './PublicProfileLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicProfileLanding sizing and button classes', () => {
  it('uses the 80px avatar and 180px QR code sizes', () => {
    expect(publicProfileLandingSource).toMatch(/<Identicon :address="profile.address" :size="80"/)
    expect(publicProfileLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="180"/)
  })

  it('uses the shared .nq-button class on its filled actions but keeps the outline variant for Add to NimConnect', () => {
    expect(publicProfileLandingSource).toContain('class="nq-button"')
    expect(publicProfileLandingSource).toContain('class="nq-button light-blue"')
    expect(publicProfileLandingSource).toContain('class="public-action--outline"')
  })
})
