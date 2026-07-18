import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PublicStoreLinks from './PublicStoreLinks.vue'
import publicStoreLinksSource from './PublicStoreLinks.vue?raw'

describe('PublicStoreLinks', () => {
  it('renders the official Nimiq Pay store links as external destinations', () => {
    const wrapper = mount(PublicStoreLinks)

    expect(wrapper.get('a[href="https://play.google.com/store/apps/details?id=com.nimiq.pay"]')).toBeTruthy()
    expect(wrapper.get('a[href="https://apps.apple.com/app/nimiq-pay/id6471844738"]')).toBeTruthy()
    expect(wrapper.text()).toContain('Google Play')
    expect(wrapper.text()).toContain('App Store')
    for (const link of wrapper.findAll('a')) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    }
  })

  it('gives store badges a proper download CTA height', () => {
    expect(publicStoreLinksSource).toMatch(/\.public-store-links__badge\s*\{[\s\S]*?min-height:\s*3\.25rem;/)
  })
})

describe('PublicStoreLinks token migration', () => {
  it('uses a themed border token instead of a hardcoded light-only hex', () => {
    expect(publicStoreLinksSource).not.toMatch(/#bdc9e5/)
    expect(publicStoreLinksSource).toMatch(/border:\s*1px solid/)
    expect(publicStoreLinksSource).toMatch(/var\(--border\)/)
  })
})
