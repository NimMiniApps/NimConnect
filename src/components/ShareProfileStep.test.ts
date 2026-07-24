import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShareProfileStep from './ShareProfileStep.vue'
import * as shareService from '../services/share'

describe('ShareProfileStep', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', (() => {
      const data: Record<string, string> = {}
      return {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => { data[k] = v },
        removeItem: (k: string) => { delete data[k] },
      }
    })())
  })

  it('renders the public URL', () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    expect(wrapper.text()).toContain('https://nimconnect.app/@chuck')
  })

  it('shares and emits complete on success', async () => {
    vi.spyOn(shareService, 'shareOrCopy').mockResolvedValue('copied')
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    await wrapper.get('.primary').trigger('click')
    await Promise.resolve()
    expect(shareService.shareOrCopy).toHaveBeenCalledWith('https://nimconnect.app/@chuck', 'My NimConnect profile')
    expect(wrapper.emitted('complete')).toHaveLength(1)
  })

  it('emits defer on skip', async () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    await wrapper.get('.skip').trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
  })

  it('disables the share button without a public URL', () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: '' } })
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(true)
  })
})
