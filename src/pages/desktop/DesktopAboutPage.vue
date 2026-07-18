<script setup lang="ts">
import { NIMPAY_OPEN_URL } from '../../config/host-app'
</script>

<template>
  <section class="desktop-about">
    <p class="desktop-about__brand">NimConnect</p>
    <h1 class="desktop-about__headline">The identity portal for the Nimiq ecosystem.</h1>

    <p class="desktop-about__body">
      NimConnect gives you a permanent @handle, a public profile, and a payment page —
      one identity that works across the Nimiq ecosystem. This desktop site is where you
      set up and manage that identity.
    </p>
    <p class="desktop-about__body">
      Everyday payments — sending, receiving, and your contacts — stay in
      <strong>Nimiq Pay</strong> on your phone.
    </p>

    <a class="nq-button" :href="NIMPAY_OPEN_URL">Open in Nimiq Pay</a>
  </section>
</template>

<style scoped>
.desktop-about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 640px;
  margin: 0 auto;
  padding: 64px 16px 32px;
  text-align: center;
}
.desktop-about__brand {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}
.desktop-about__headline {
  margin: 0;
  font-size: 40px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--text);
}
.desktop-about__body {
  margin: 0;
  max-width: 34rem;
  font-size: 17px;
  line-height: 1.55;
  color: var(--text-2);
}
.desktop-about__body strong {
  color: var(--text);
  font-weight: 800;
}
.desktop-about .nq-button {
  margin-top: 8px;
}
</style>
