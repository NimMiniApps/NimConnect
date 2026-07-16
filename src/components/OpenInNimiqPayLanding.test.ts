import openInNimiqPayLandingSource from './OpenInNimiqPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('OpenInNimiqPayLanding sizing, button classes, and token migration', () => {
  it('uses the larger 96px logo size', () => {
    expect(openInNimiqPayLandingSource).toMatch(/<img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" \/>/)
  })

  it('gives both the primary action and the lookup submit button the shared .nq-button class', () => {
    expect(openInNimiqPayLandingSource.match(/class="nq-button"/g)?.length).toBe(2)
  })

  it('no longer references the removed --public-* custom properties', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-ink/)
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-blue/)
  })
})
