<script setup lang="ts">
import { NIMPAY_OPEN_URL } from '../../config/host-app'

const benefits = [
  'Permanent @handle',
  'Public payment page',
  'Developer profile',
  'Works across Mini Apps',
  'Privacy-first',
]
</script>

<template>
  <section class="desktop-home" data-desktop-home>
    <p class="desktop-home__brand">NimConnect</p>
    <h1 class="desktop-home__headline">Claim your Nimiq identity.</h1>
    <p class="desktop-home__subtext">
      Create a permanent @handle, public profile and payment page that works across the Nimiq ecosystem.
    </p>

    <div class="desktop-home__actions">
      <router-link to="/me" class="nq-button">Authorize identity</router-link>
      <a class="desktop-home__secondary" :href="NIMPAY_OPEN_URL">Open in Nimiq Pay</a>
    </div>

    <ul class="desktop-home__benefits" aria-label="What you get with NimConnect">
      <li v-for="benefit in benefits" :key="benefit">{{ benefit }}</li>
    </ul>
  </section>
</template>

<style scoped>
.desktop-home {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 640px;
  margin: 0 auto;
  padding: 64px 16px 32px;
  text-align: center;
}
.desktop-home__brand {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}
.desktop-home__headline {
  margin: 0;
  font-size: 44px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--text);
}
.desktop-home__subtext {
  margin: 0;
  max-width: 30rem;
  font-size: 17px;
  line-height: 1.5;
  color: var(--text-2);
}
.desktop-home__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}
.desktop-home__secondary {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-2);
  text-decoration: none;
  padding: 0 8px;
  transition: color var(--attr-duration) var(--nimiq-ease);
}
.desktop-home__secondary:hover {
  color: var(--nq-gold-dark);
}
.desktop-home__benefits {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px 0;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}
.desktop-home__benefits li {
  padding: 0 14px;
  border-left: 1px solid var(--border);
}
.desktop-home__benefits li:first-child {
  border-left: none;
}
</style>
