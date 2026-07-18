import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'
import DesktopShell from './DesktopShell.vue'

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

describe('DesktopShell', () => {
  it('shows the NimConnect brand and nav links, and renders the routed page', async () => {
    const router = makeRouter()
    router.push('/lookup')
    await router.isReady()
    const wrapper = mount(DesktopShell, { global: { plugins: [router] } })

    expect(wrapper.find('[data-desktop-shell]').exists()).toBe(true)
    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).toContain('Lookup')
    expect(wrapper.text()).toContain('My Identity')
    expect(wrapper.text()).toContain('About')
    expect(wrapper.text()).toContain('lookup')
  })
})
