<script setup lang="ts">
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

defineProps<{ detailed?: boolean }>()
</script>

<template>
  <div class="public-store-links" :class="{ 'public-store-links--detailed': detailed }">
    <p>Don't have Nimiq Pay yet?</p>
    <div class="public-store-links__badges">
      <a
        class="public-store-links__badge"
        :href="NIMPAY_PLAY_STORE_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="public-store-links__store-icon" aria-hidden="true">▶</span>
        <span class="public-store-links__store-text">
          <small>Get it on</small>
          Google Play
        </span>
      </a>
      <a
        class="public-store-links__badge"
        :href="NIMPAY_APP_STORE_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span
          class="public-store-links__store-icon public-store-links__store-icon--apple"
          aria-hidden="true"
        />
        <span class="public-store-links__store-text">
          <small>Download on the</small>
          App Store
        </span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.public-store-links {
  display: grid;
  gap: 0.75rem;
  justify-items: center;
}

.public-store-links p {
  margin: 0;
  color: var(--text-2);
  font-size: 0.875rem;
  font-weight: 700;
}

.public-store-links__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}

.public-store-links__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.25rem;
  min-width: 11.5rem;
  padding: 0.625rem 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 55%, var(--text-2));
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--card) 82%, var(--text) 6%);
  color: var(--text);
  text-decoration: none;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--text) 8%, transparent);
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    background var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease);
}

.public-store-links__badge:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nq-gold-dark) 45%, var(--border));
  background: color-mix(in srgb, var(--card) 70%, var(--text) 10%);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--text) 12%, transparent);
}

.public-store-links__store-icon {
  flex-shrink: 0;
  width: 1.5rem;
  font-size: 1.25rem;
  line-height: 1;
  text-align: center;
}

.public-store-links__store-icon--apple {
  font-size: 0;
}

.public-store-links__store-icon--apple::before {
  content: '';
  display: block;
  width: 1.375rem;
  height: 1.375rem;
  margin: 0 auto;
  background: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z'/%3E%3C/svg%3E") center / contain no-repeat;
}

.public-store-links__store-text {
  display: grid;
  gap: 1px;
  font-size: 1rem;
  font-weight: 800;
  line-height: 1.15;
  text-align: left;
}

.public-store-links__store-text small {
  color: var(--text-2);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.public-store-links--detailed .public-store-links__badge {
  flex: 1;
  min-width: 12rem;
}

@media (min-width: 25rem) {
  .public-store-links--detailed .public-store-links__badges {
    flex-wrap: nowrap;
    width: min(100%, 28rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .public-store-links__badge {
    transition: none;
  }
}
</style>
