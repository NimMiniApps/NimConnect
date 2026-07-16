import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PublicSurface from './PublicSurface.vue'
import publicSurfaceSource from './PublicSurface.vue?raw'

describe('PublicSurface', () => {
  it('renders the public profile shell slots and default trust footer', () => {
    const wrapper = mount(PublicSurface, {
      props: { context: 'Public profile' },
      slots: {
        identity: 'Alice',
        panel: 'Send NIM',
        primary: 'Pay',
        secondary: 'Add',
        tertiary: 'Stores',
      },
    })

    expect(wrapper.get('.public-surface__context').attributes('data-public-context')).toBe('Public profile')
    expect(wrapper.get('[data-public-identity]').text()).toContain('Alice')
    expect(wrapper.get('[data-public-panel]').text()).toContain('Send NIM')
    expect(wrapper.get('section.public-surface__actions').attributes('aria-label')).toBe('Public actions')
    expect(wrapper.get('[data-public-primary]').text()).toContain('Pay')
    expect(wrapper.get('[data-public-secondary]').text()).toContain('Add')
    expect(wrapper.get('[data-public-tertiary]').text()).toContain('Stores')
    expect(wrapper.get('.public-surface__footer').text()).toBe('Shared via NimConnect')
    expect(wrapper.get('.public-surface__footer strong').text()).toBe('NimConnect')
  })

  it('omits empty action regions', () => {
    const wrapper = mount(PublicSurface, {
      props: { context: 'NimConnect' },
    })

    expect(wrapper.find('.public-surface__actions').exists()).toBe(false)
  })

  it('no longer defines the removed --public-* custom properties, so app-wide dark mode applies', () => {
    expect(publicSurfaceSource).not.toMatch(/--public-ink:/)
    expect(publicSurfaceSource).not.toMatch(/--public-blue:/)
    expect(publicSurfaceSource).not.toMatch(/--public-gold:/)
    expect(publicSurfaceSource).not.toMatch(/--public-soft-blue:/)
  })

  it('keeps a visible focus-visible outline sourced from a token that passes 3:1 in both themes', () => {
    expect(publicSurfaceSource).toMatch(/:focus-visible\)[\s\S]*?outline:\s*3px solid var\(--nq-light-blue\);/)
  })

  it('gives its decorative canvas glow pointer-events: none and no transition or animation', () => {
    const canvasGlowBlock = publicSurfaceSource.match(/\.public-surface__canvas::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(canvasGlowBlock).toMatch(/pointer-events:\s*none;/)
    expect(canvasGlowBlock).not.toMatch(/transition|animation/)
  })

  it('no longer duplicates filled-button styling — that now lives only in .nq-button', () => {
    expect(publicSurfaceSource).not.toMatch(/__primary :slotted\(a\)[\s\S]*?background:\s*var\(--nimiq-gold/)
  })

  it('gives a browser continuation control a 44px minimum target', () => {
    expect(publicSurfaceSource).toMatch(/\.public-surface__footer :slotted\(button\)\s*\{[\s\S]*?min-height:\s*2\.75rem;/)
  })
})
