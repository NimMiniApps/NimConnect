import openInNimiqPayLandingSource from './OpenInNimiqPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('OpenInNimiqPayLanding sizing, button classes, and token migration', () => {
  it('uses the 80px logo size', () => {
    expect(openInNimiqPayLandingSource).toMatch(/<img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" \/>/)
  })

  it('links the brand mark back to the homepage', () => {
    expect(openInNimiqPayLandingSource).toMatch(/class="handoff__brand-link"[^>]*href="#\/"/)
  })

  it('keeps the identity hero as NimConnect mark + people-first headline', () => {
    expect(openInNimiqPayLandingSource).toMatch(/People, not wallet addresses\./)
    expect(openInNimiqPayLandingSource).toMatch(/handoff__logo/)
  })

  it('does not invent a panel__pay-row QR layout on the handoff band', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/panel__pay-row/)
    expect(openInNimiqPayLandingSource).not.toMatch(/panel__pay-meta/)
  })

  it('keeps template/source strings free of em/en dashes', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/[—–]/)
  })

  it('aligns nested panel chrome with soft-band language (no heavy card shadow)', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/box-shadow:\s*var\(--shadow\)/)
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-/)
  })

  it('gives the Open in Nimiq Pay CTA and the toned-down lookup submit the shared .nq-button classes', () => {
    expect(openInNimiqPayLandingSource).toContain('class="nq-button"')
    expect(openInNimiqPayLandingSource).toContain('class="nq-button light-blue"')
  })

  it('no longer references the removed --public-* custom properties', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-ink/)
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-blue/)
  })
})
