import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IdentitySetupCard from './IdentitySetupCard.vue'
import identitySetupCardSource from './IdentitySetupCard.vue?raw'
import type { IdentitySetupResult, IdentitySetupStep } from '../services/identity-setup'

function step(id: IdentitySetupStep['id'], label: string, done: boolean): IdentitySetupStep {
  return { id, label, done }
}

function result(over: Partial<IdentitySetupResult> = {}): IdentitySetupResult {
  return {
    steps: [
      step('claim-handle', 'Claim your @handle', false),
      step('first-contact', 'Connect with your first contact', false),
      step('share-profile', 'Share your public profile', false),
    ],
    nextStep: 'claim-handle',
    complete: false,
    celebration: null,
    celebrationHandle: null,
    ...over,
  }
}

describe('IdentitySetupCard', () => {
  it('titles the default state as building an identity', () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result() } })
    expect(wrapper.find('h2, h3').text()).toBe('Build your Nimiq identity')
  })

  it('titles the celebration state with the claimed handle', () => {
    const wrapper = mount(IdentitySetupCard, {
      props: { result: result({ celebration: 'claimed', celebrationHandle: 'chuck' }) },
    })
    expect(wrapper.find('h2, h3').text()).toBe("You're now @chuck")
  })

  it('shows publicUrl under the title only while celebrating', () => {
    const celebrating = mount(IdentitySetupCard, {
      props: {
        result: result({ celebration: 'claimed', celebrationHandle: 'chuck' }),
        publicUrl: 'https://nimconnect.app/@chuck',
      },
    })
    expect(celebrating.text()).toContain('https://nimconnect.app/@chuck')

    const notCelebrating = mount(IdentitySetupCard, {
      props: { result: result(), publicUrl: 'https://nimconnect.app/@chuck' },
    })
    expect(notCelebrating.text()).not.toContain('https://nimconnect.app/@chuck')
  })

  it('renders the checklist with done/undone marks and step labels', () => {
    const wrapper = mount(IdentitySetupCard, {
      props: {
        result: result({
          steps: [
            step('claim-handle', 'Claim your @handle', true),
            step('first-contact', 'Connect with your first contact', false),
            step('share-profile', 'Share your public profile', false),
          ],
          nextStep: 'first-contact',
        }),
      },
    })
    const items = wrapper.findAll('li')
    expect(items).toHaveLength(3)
    expect(items[0]!.text()).toContain('✓')
    expect(items[0]!.text()).toContain('Claim your @handle')
    expect(items[1]!.text()).toContain('□')
    expect(items[1]!.text()).toContain('Connect with your first contact')
  })

  it('primary CTA claims the handle when that is next', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'claim-handle' }) } })
    const primary = wrapper.get('[data-primary]')
    expect(primary.text()).toBe('Claim your @handle')
    await primary.trigger('click')
    expect(wrapper.emitted('claim')).toHaveLength(1)
  })

  it('primary CTA adds a contact when that is next', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'first-contact' }) } })
    const primary = wrapper.get('[data-primary]')
    expect(primary.text()).toBe('Add your first contact')
    await primary.trigger('click')
    expect(wrapper.emitted('add-contact')).toHaveLength(1)
  })

  it('primary CTA shares the profile when that is next', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'share-profile' }) } })
    const primary = wrapper.get('[data-primary]')
    expect(primary.text()).toBe('Share your public profile')
    await primary.trigger('click')
    expect(wrapper.emitted('share')).toHaveLength(1)
  })

  it('primary CTA shares the profile while celebrating, regardless of nextStep', async () => {
    const wrapper = mount(IdentitySetupCard, {
      props: { result: result({ celebration: 'claimed', celebrationHandle: 'chuck', nextStep: 'first-contact' }) },
    })
    const primary = wrapper.get('[data-primary]')
    expect(primary.text()).toBe('Share your public profile')
    await primary.trigger('click')
    expect(wrapper.emitted('share')).toHaveLength(1)
  })

  it('secondary CTA offers Learn more when claim-handle is next', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'claim-handle' }) } })
    const secondary = wrapper.get('[data-secondary]')
    expect(secondary.text()).toBe('Learn more')
    await secondary.trigger('click')
    expect(wrapper.emitted('learn-more')).toHaveLength(1)
  })

  it('secondary CTA offers Add your first contact while celebrating', async () => {
    const wrapper = mount(IdentitySetupCard, {
      props: { result: result({ celebration: 'claimed', celebrationHandle: 'chuck' }) },
    })
    const secondary = wrapper.get('[data-secondary]')
    expect(secondary.text()).toBe('Add your first contact')
    await secondary.trigger('click')
    expect(wrapper.emitted('add-contact')).toHaveLength(1)
  })

  it('secondary CTA offers Share your public profile when first-contact is next', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'first-contact' }) } })
    const secondary = wrapper.get('[data-secondary]')
    expect(secondary.text()).toBe('Share your public profile')
    await secondary.trigger('click')
    expect(wrapper.emitted('share')).toHaveLength(1)
  })

  it('has no secondary CTA when share-profile is next and not celebrating', () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result({ nextStep: 'share-profile' }) } })
    expect(wrapper.find('[data-secondary]').exists()).toBe(false)
  })

  it('emits dismiss from a subtle dismiss control', async () => {
    const wrapper = mount(IdentitySetupCard, { props: { result: result() } })
    const dismiss = wrapper.get('[aria-label="Dismiss"]')
    await dismiss.trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('reuses the Home panel visual language instead of a new design system', () => {
    expect(identitySetupCardSource).toMatch(/class="[^"]*home-panel/)
    expect(identitySetupCardSource).toMatch(/var\(--text\)/)
    expect(identitySetupCardSource).toMatch(/var\(--nimiq-gold-bg\)|var\(--nq-/)
  })
})
