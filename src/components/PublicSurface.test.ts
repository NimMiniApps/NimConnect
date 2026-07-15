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

  it('keeps public semantic tokens readable on its light canvas when the system prefers dark mode', () => {
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--text:\s*#1f2348;/)
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--text-2:\s*#59627d;/)
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--border:\s*#dce7ff;/)
  })

  it('gives a browser continuation control a 44px minimum target', () => {
    expect(publicSurfaceSource).toMatch(/\.public-surface__footer :slotted\(button\)\s*\{[\s\S]*?min-height:\s*2\.75rem;/)
  })
})
