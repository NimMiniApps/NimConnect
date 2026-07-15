<script setup lang="ts">
import {
  NIMPAY_APP_STORE_URL,
  NIMPAY_OPEN_URL,
  NIMPAY_PLAY_STORE_URL,
} from '../config/host-app'

const emit = defineEmits<{ continue: [] }>()
defineProps<{ allowBrowserContinue?: boolean }>()

const iconUrl = `${import.meta.env.BASE_URL}icon.svg`
</script>

<template>
  <div class="landing">
    <main class="hero">
      <img class="logo" :src="iconUrl" alt="" width="80" height="80" />
      <h1>NimConnect</h1>
      <p class="tagline">A relationship manager for your wallet.</p>
      <p class="body">
        <template v-if="allowBrowserContinue !== false">
          Send NIM, manage contacts, split bills, and track payments.
          NimConnect is built to run inside <strong>Nimiq Pay</strong> on your phone.
        </template>
        <template v-else>
          On desktop, NimConnect works best for <strong>payment request</strong> and
          <strong>profile share</strong> links — open one of those to pay or view a contact.
          For everything else, use <strong>Nimiq Pay</strong> on your phone.
        </template>
      </p>
    </main>

    <section class="actions" aria-label="Get Nimiq Pay">
      <a :href="NIMPAY_OPEN_URL" class="open-btn">Open in Nimiq Pay</a>

      <p class="store-label">Don't have Nimiq Pay yet?</p>
      <div class="stores">
        <a
          :href="NIMPAY_PLAY_STORE_URL"
          class="store-btn"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="store-icon" aria-hidden="true">▶</span>
          <span class="store-text">
            <small>Get it on</small>
            Google Play
          </span>
        </a>
        <a
          :href="NIMPAY_APP_STORE_URL"
          class="store-btn"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="store-icon store-icon-apple" aria-hidden="true"></span>
          <span class="store-text">
            <small>Download on the</small>
            App Store
          </span>
        </a>
      </div>
    </section>

    <button
      v-if="allowBrowserContinue !== false"
      type="button"
      class="browser-link"
      @click="emit('continue')"
    >
      Continue in browser (contacts &amp; backups only)
    </button>
  </div>
</template>

<style scoped>
.landing {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 32px;
}
.hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding-top: clamp(16px, 8vh, 48px);
}
.logo {
  border-radius: 22%;
  box-shadow: var(--nimiq-shadow-card);
  margin-bottom: 20px;
}
h1 {
  font-size: 28px;
  line-height: 1.15;
  margin: 0 0 8px;
  color: var(--text);
}
.tagline {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  opacity: 0.85;
}
.body {
  margin: 0;
  max-width: 340px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
}
.body strong { color: var(--nimiq-gold); font-weight: 800; }
.actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.open-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.store-label {
  margin: 4px 0 0;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
}
.stores {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.store-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 10px 16px;
  border-radius: var(--nimiq-radius-small);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--shadow);
}
.store-icon {
  width: 28px;
  font-size: 22px;
  line-height: 1;
  text-align: center;
  flex-shrink: 0;
}
.store-text {
  display: flex;
  flex-direction: column;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}
.store-icon-apple::before {
  content: '';
  display: block;
  width: 22px;
  height: 22px;
  margin: 0 auto;
  background: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z'/%3E%3C/svg%3E") center / contain no-repeat;
}
.store-text small {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.browser-link {
  margin-top: auto;
  padding: 12px;
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--nq-light-blue);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (min-width: 400px) {
  .stores {
    flex-direction: row;
  }
  .store-btn {
    flex: 1;
  }
}
</style>
