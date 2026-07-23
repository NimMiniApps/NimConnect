import publicProfileLandingSource from './PublicProfileLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicProfileLanding sizing and button classes', () => {
  it('uses the 96px avatar and 200px QR code sizes', () => {
    expect(publicProfileLandingSource).toMatch(/<Identicon :address="profile.address" :size="96"/)
    expect(publicProfileLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="200"/)
  })

  it('wraps pay content in panel__pay-row', () => {
    expect(publicProfileLandingSource).toMatch(/class="panel__pay-row"/)
    expect(publicProfileLandingSource).toMatch(/class="panel__pay-meta"/)
  })

  it('keeps template/source strings free of em/en dashes', () => {
    expect(publicProfileLandingSource).not.toMatch(/[—–]/)
  })

  it('uses the shared .nq-button class on its filled actions but keeps the outline variant for Add to NimConnect', () => {
    expect(publicProfileLandingSource).toContain('class="nq-button"')
    expect(publicProfileLandingSource).toContain('class="nq-button light-blue"')
    expect(publicProfileLandingSource).toContain('class="public-action--outline"')
  })
})
