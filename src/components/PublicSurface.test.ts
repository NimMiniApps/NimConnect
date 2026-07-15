import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PublicSurface from './PublicSurface.vue'

describe('PublicSurface', () => {
  it('renders the public profile shell slots and default trust footer', () => {
    const wrapper = mount(PublicSurface, {
      props: { context: 'Public profile' },
      slots: {
        identity: 'Alice',
        panel: 'Send NIM',
        primary: 'Pay',
        secondary: 'Add',
      },
    })

    expect(wrapper.attributes('data-public-context')).toBe('Public profile')
    expect(wrapper.get('[data-public-identity]').text()).toContain('Alice')
    expect(wrapper.get('[data-public-panel]').text()).toContain('Send NIM')
    expect(wrapper.get('[data-public-primary]').text()).toContain('Pay')
    expect(wrapper.get('[data-public-secondary]').text()).toContain('Add')
    expect(wrapper.text()).toContain('Shared via NimConnect')
  })
})
