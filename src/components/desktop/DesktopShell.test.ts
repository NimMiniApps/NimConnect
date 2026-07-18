import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'
import DesktopShell from './DesktopShell.vue'
import {
  NIMPAY_APP_STORE_URL,
  NIMPAY_PLAY_STORE_URL,
} from '../../config/host-app'
import {
  clearDesktopHubAddress,
  setDesktopHubAddress,
} from '../../services/desktop-session'

function makeRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/lookup', component: { template: '<div>lookup</div>' } },
      { path: '/me', component: { template: '<div>me</div>' } },
      { path: '/about', component: { template: '<div>about</div>' } },
    ],
  })
}

const stubs = {
  Identicon: { props: ['address'], template: '<div data-identicon />' },
}

describe('DesktopShell', () => {
  beforeEach(() => {
    clearDesktopHubAddress()
  })

  it('shows Home, Lookup, About and a Connect CTA when disconnected', async () => {
    const router = makeRouter()
    router.push('/lookup')
    await router.isReady()
    const wrapper = mount(DesktopShell, { global: { plugins: [router], stubs } })

    expect(wrapper.find('[data-desktop-shell]').exists()).toBe(true)
    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).toContain('Lookup')
    expect(wrapper.text()).toContain('About')
    expect(wrapper.text()).not.toContain('My Identity')
    expect(wrapper.find('[data-desktop-connect]').exists()).toBe(true)
    expect(wrapper.find('[data-desktop-connect]').text()).toBe('Connect')
    expect(wrapper.find('[data-desktop-avatar]').exists()).toBe(false)
    expect(wrapper.text()).toContain('lookup')
  })

  it('shows My Identity and avatar when a Hub address is connected', async () => {
    setDesktopHubAddress('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    const router = makeRouter()
    router.push('/')
    await router.isReady()
    const wrapper = mount(DesktopShell, { global: { plugins: [router], stubs } })

    expect(wrapper.text()).toContain('My Identity')
    expect(wrapper.find('[data-desktop-connect]').exists()).toBe(false)
    expect(wrapper.find('[data-desktop-avatar]').exists()).toBe(true)
    expect(wrapper.find('[data-identicon]').exists()).toBe(true)
  })

  it('includes a lightweight product footer with Nimiq Pay store links', async () => {
    const router = makeRouter()
    router.push('/')
    await router.isReady()
    const wrapper = mount(DesktopShell, { global: { plugins: [router], stubs } })

    expect(wrapper.find('[data-desktop-stores]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Don't have Nimiq Pay yet?")
    expect(wrapper.find(`a[href="${NIMPAY_PLAY_STORE_URL}"]`).exists()).toBe(true)
    expect(wrapper.find(`a[href="${NIMPAY_APP_STORE_URL}"]`).exists()).toBe(true)
    expect(wrapper.text()).toContain('Documentation')
    expect(wrapper.text()).toContain('API')
    expect(wrapper.text()).toContain('GitHub')
    expect(wrapper.text()).toContain('Privacy')
    expect(wrapper.text()).toContain('Terms')
    expect(wrapper.text()).toContain('Status')
    expect(wrapper.text()).toContain('Nimiq')
    expect(wrapper.text()).toContain('Mini Apps')
    expect(wrapper.text()).toContain('© NimConnect')
    expect(wrapper.text()).toContain('Built for the Nimiq ecosystem.')
  })
})
