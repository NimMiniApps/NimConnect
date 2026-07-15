import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PublicStoreLinks from './PublicStoreLinks.vue'
import publicStoreLinksSource from './PublicStoreLinks.vue?raw'

describe('PublicStoreLinks', () => {
  it('renders the official Nimiq Pay store links as external destinations', () => {
    const wrapper = mount(PublicStoreLinks)

    expect(wrapper.get('a[href="https://play.google.com/store/apps/details?id=com.nimiq.pay"]')).toBeTruthy()
    expect(wrapper.get('a[href="https://apps.apple.com/app/nimiq-pay/id6471844738"]')).toBeTruthy()
    for (const link of wrapper.findAll('a')) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    }
  })

  it('gives compact store links a 44px minimum target', () => {
    expect(publicStoreLinksSource).toMatch(/\.public-store-links a\s*\{[\s\S]*?min-height:\s*2\.75rem;/)
  })
})
