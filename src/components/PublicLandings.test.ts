import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PublicPayLanding from './PublicPayLanding.vue'
import PublicProfileLanding from './PublicProfileLanding.vue'

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const stubs = {
  QrCode: { template: '<div data-qr-code />' },
  Identicon: { template: '<div data-identicon />' },
}

describe('public landings', () => {
  it('places a shared profile in the common public surface without chain verification', () => {
    const wrapper = mount(PublicProfileLanding, {
      props: {
        profile: {
          v: 1,
          address,
          name: 'Ada Lovelace',
          type: 'person',
          bio: 'Computing pioneer',
          tags: ['Friends'],
        },
      },
      global: { stubs },
    })

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('Shared profile')
    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('Add to NimConnect')
    expect(wrapper.text()).not.toMatch(/chain verification|on-chain verified/i)
  })

  it('places a payment request in the common public surface with its payment actions', () => {
    const wrapper = mount(PublicPayLanding, {
      props: {
        payment: {
          recipient: address,
          amountNim: 12.5,
          message: 'Dinner split',
          label: 'Ada Lovelace',
        },
      },
      global: { stubs },
    })

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('Payment request')
    expect(wrapper.text()).toContain('12.5 NIM')
    expect(wrapper.text()).toContain('Dinner split')
    expect(wrapper.text()).toContain('Pay with Nimiq Pay')
    expect(wrapper.text()).toContain('Pay with Nimiq Wallet')
  })
})
