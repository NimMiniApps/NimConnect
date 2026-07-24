<script setup lang="ts">
import { computed } from 'vue'
import Identicon from '../Identicon.vue'
import PublicStoreLinks from '../PublicStoreLinks.vue'
import { desktopHubAddress } from '../../services/desktop-session'
import { shortAddress } from '../../services/links'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`
const connected = computed(() => !!desktopHubAddress.value)
const addressLabel = computed(() =>
  desktopHubAddress.value ? shortAddress(desktopHubAddress.value) : '',
)
</script>

<template>
  <div class="desktop-shell" data-desktop-shell>
    <header class="desktop-shell__nav">
      <router-link to="/" class="desktop-shell__brand" aria-label="NimConnect home">
        <img class="desktop-shell__brand-icon" :src="brandIconUrl" alt="" width="32" height="32" />
        <span>NimConnect</span>
      </router-link>
      <nav class="desktop-shell__links" aria-label="Desktop">
        <router-link to="/" class="desktop-shell__link">Home</router-link>
        <router-link to="/lookup" class="desktop-shell__link">Lookup</router-link>
        <router-link
          v-if="connected"
          to="/me"
          class="desktop-shell__link"
        >
          My Identity
        </router-link>
        <router-link to="/about" class="desktop-shell__link">About</router-link>
        <router-link
          v-if="!connected"
          to="/me"
          class="nq-button desktop-shell__connect"
          data-desktop-connect
        >
          Connect
        </router-link>
        <router-link
          v-else
          to="/me"
          class="desktop-shell__avatar"
          data-desktop-avatar
          :title="addressLabel"
          :aria-label="`My Identity · ${addressLabel}`"
        >
          <Identicon :address="desktopHubAddress!" :size="32" />
        </router-link>
      </nav>
    </header>
    <main class="desktop-shell__main">
      <router-view />
    </main>
    <footer class="desktop-shell__footer">
      <div class="desktop-shell__stores" data-desktop-stores>
        <PublicStoreLinks />
      </div>
      <nav class="desktop-shell__footer-links" aria-label="Footer">
        <a href="https://github.com/NimMiniApps/NimConnect#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
        <a href="https://github.com/NimMiniApps/NimConnect/tree/main/docs/api" target="_blank" rel="noopener noreferrer">API</a>
        <a href="https://github.com/NimMiniApps/NimConnect" target="_blank" rel="noopener noreferrer">GitHub</a>
        <router-link to="/about">Privacy</router-link>
        <a href="https://github.com/NimMiniApps/NimConnect/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">Terms</a>
        <a href="https://github.com/NimMiniApps/NimConnect/actions" target="_blank" rel="noopener noreferrer">Status</a>
        <a href="https://www.nimiq.com" target="_blank" rel="noopener noreferrer">Nimiq</a>
        <a href="https://www.nimiqminiapps.com" target="_blank" rel="noopener noreferrer">Mini Apps</a>
      </nav>
      <p class="desktop-shell__footer-meta">
        <span>© NimConnect</span>
        <span>Built for the Nimiq ecosystem.</span>
      </p>
    </footer>
  </div>
</template>

<style scoped>
.desktop-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(233, 178, 19, 0.08), transparent 55%),
    radial-gradient(90% 70% at 0% 100%, rgba(5, 130, 202, 0.08), transparent 50%),
    var(--bg);
  color: var(--text);
}
.desktop-shell__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 18px 40px;
  background: color-mix(in srgb, var(--card) 92%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(10px);
}
.desktop-shell__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.01em;
}
.desktop-shell__brand-icon {
  width: 32px;
  height: 32px;
  border-radius: 22%;
  flex: 0 0 auto;
}
.desktop-shell__links {
  display: flex;
  align-items: center;
  gap: 24px;
}
.desktop-shell__link {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  transition: color var(--attr-duration) var(--nimiq-ease);
}
.desktop-shell__link:hover,
.desktop-shell__link.router-link-active {
  color: var(--nq-gold-dark);
}
.desktop-shell__connect {
  min-height: 40px;
  padding: 0 18px;
  font-size: 14px;
  text-decoration: none;
}
.desktop-shell__avatar {
  display: inline-flex;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 0 0 2px var(--border);
  transition: box-shadow var(--attr-duration) var(--nimiq-ease), transform var(--attr-duration) var(--nimiq-ease);
}
.desktop-shell__avatar:hover {
  box-shadow: 0 0 0 2px var(--nq-gold-dark);
  transform: translateY(-1px);
}
.desktop-shell__main {
  flex: 1;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 40px 40px 64px;
}
.desktop-shell__footer {
  display: grid;
  gap: 16px;
  padding: 24px 40px 32px;
  border-top: 1px solid var(--border);
}
.desktop-shell__stores {
  display: flex;
  justify-content: center;
}
.desktop-shell__footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 20px;
  max-width: 1120px;
  margin: 0 auto;
}
.desktop-shell__footer-links a {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
  text-decoration: none;
}
.desktop-shell__footer-links a:hover {
  color: var(--nq-gold-dark);
}
.desktop-shell__footer-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 16px;
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

@media (max-width: 720px) {
  .desktop-shell__nav,
  .desktop-shell__main,
  .desktop-shell__footer {
    padding-left: 20px;
    padding-right: 20px;
  }
  .desktop-shell__links {
    gap: 14px;
  }
  .desktop-shell__link {
    font-size: 14px;
  }
}
</style>
