import publicProfileLandingSource from './PublicProfileLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicProfileLanding sizing and button classes', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicProfileLandingSource).toMatch(/<Identicon :address="profile.address" :size="96"/)
    expect(publicProfileLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })

  it('uses the shared .nq-button class on its filled actions but keeps the outline variant for Add to NimConnect', () => {
    expect(publicProfileLandingSource).toContain('class="nq-button"')
    expect(publicProfileLandingSource).toContain('class="nq-button light-blue"')
    expect(publicProfileLandingSource).toContain('class="public-action--outline"')
  })
})
