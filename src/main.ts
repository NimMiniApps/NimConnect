import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'

/** Visible WebView height for the mobile shell — CSS svh/dvh is unreliable in iOS in-app browsers. */
function syncAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`)
}
syncAppHeight()
window.visualViewport?.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('scroll', syncAppHeight)
window.addEventListener('resize', syncAppHeight)

createApp(App).use(createPinia()).use(router).mount('#app')
