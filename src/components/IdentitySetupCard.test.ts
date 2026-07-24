import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IdentitySetupCard from './IdentitySetupCard.vue'
import identitySetupCardSource from './IdentitySetupCard.vue?raw'

describe('IdentitySetupCard resume banner', () => {
  it('shows a default label when none is given', () => {
    const wrapper = mount(IdentitySetupCard)
    expect(wrapper.text()).toContain('Finish setting up')
  })

  it('shows a custom label when given', () => {
    const wrapper = mount(IdentitySetupCard, { props: { label: 'Back up your wallet next.' } })
    expect(wrapper.text()).toContain('Back up your wallet next.')
  })

  it('emits resume from the CTA', async () => {
    const wrapper = mount(IdentitySetupCard)
    await wrapper.get('.resume-cta').trigger('click')
    expect(wrapper.emitted('resume')).toHaveLength(1)
  })

  it('emits dismiss from the subtle dismiss control', async () => {
    const wrapper = mount(IdentitySetupCard)
    await wrapper.get('[aria-label="Dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('reuses the Home panel visual language instead of a new design system', () => {
    expect(identitySetupCardSource).toMatch(/class="[^"]*home-panel/)
    expect(identitySetupCardSource).toMatch(/var\(--text\)/)
    expect(identitySetupCardSource).toMatch(/var\(--nimiq-gold-bg\)|var\(--nq-/)
  })
})
