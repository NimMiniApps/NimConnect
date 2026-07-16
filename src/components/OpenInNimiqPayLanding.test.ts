import openInNimiqPayLandingSource from './OpenInNimiqPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('OpenInNimiqPayLanding sizing, button classes, and token migration', () => {
  it('uses the 80px logo size', () => {
    expect(openInNimiqPayLandingSource).toMatch(/<img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" \/>/)
  })

  it('links the brand mark back to the homepage', () => {
    expect(openInNimiqPayLandingSource).toMatch(/class="handoff__brand-link"[^>]*href="#\/"/)
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
