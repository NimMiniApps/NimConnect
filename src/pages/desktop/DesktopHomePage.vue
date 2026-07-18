<script setup lang="ts">
import Identicon from '../../components/Identicon.vue'
import QrCode from '../../components/QrCode.vue'
import { NIMPAY_OPEN_URL } from '../../config/host-app'
import { makeRequestLink } from '../../services/links'

/**
 * Fictional product mockup — communicates "this is what YOUR identity
 * could look like," not a real person's profile.
 */
const DEMO = {
  handle: 'alex',
  name: 'Alex Morgan',
  bio: 'Tell people who you are.',
  tags: ['developer', 'opensource', 'nimiq'],
  /** Valid address so the identicon renders; UI shows a truncated form. */
  address: 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF',
  addressShort: 'NQ26…9YDF',
  /** Pretty share path — product mockup, not a live route. */
  sharePath: '/@alex',
}

const demoPayUri = makeRequestLink(DEMO.address)

const benefits = [
  'Permanent @handle',
  'Public profile',
  'Payment page',
  'Works across Mini Apps',
  'Privacy-first',
]

const reasons = [
  { icon: 'people', text: 'People remember people—not wallet addresses.' },
  { icon: 'globe', text: 'One public identity for every Mini App.' },
  { icon: 'link', text: 'Share one profile instead of copying addresses.' },
  { icon: 'tag', text: 'Claim a permanent @handle that belongs to you.' },
]

const ecosystemSteps = [
  '@handle',
  'Wallet address',
  'Public identity',
  'Every Mini App',
]
</script>

<template>
  <div class="desktop-home" data-desktop-home>
    <section class="desktop-home__hero" aria-labelledby="desktop-home-headline">
      <p class="desktop-home__brand">NimConnect</p>

      <div class="desktop-home__hero-grid">
        <div class="desktop-home__copy">
          <h1 id="desktop-home-headline" class="desktop-home__headline">
            Claim your Nimiq identity.
          </h1>
          <p class="desktop-home__subtext">
            Claim your identity on desktop. Use it everywhere in Nimiq Pay.
          </p>

          <div class="desktop-home__actions">
            <router-link to="/me" class="nq-button">Claim your @handle</router-link>
            <a class="nq-button light-blue" :href="NIMPAY_OPEN_URL">Continue in Nimiq Pay</a>
          </div>

          <p class="desktop-home__lookup-hint">
            Already have a handle?
            <router-link to="/lookup" class="desktop-home__lookup-cta">
              <span aria-hidden="true">→</span>
              Look up a public profile
            </router-link>
          </p>

          <ul class="desktop-home__benefits" aria-label="What you get with NimConnect">
            <li v-for="benefit in benefits" :key="benefit">
              <span class="desktop-home__benefit-mark" aria-hidden="true">✓</span>
              {{ benefit }}
            </li>
          </ul>

          <section class="desktop-home__why" aria-labelledby="desktop-home-why">
            <h2 id="desktop-home-why">Why NimConnect?</h2>
            <ul>
              <li v-for="reason in reasons" :key="reason.text">
                <span
                  class="desktop-home__why-icon"
                  :class="`desktop-home__why-icon--${reason.icon}`"
                  aria-hidden="true"
                />
                <span>{{ reason.text }}</span>
              </li>
            </ul>
          </section>
        </div>

        <aside class="desktop-home__preview" aria-label="From wallet address to public identity">
          <div class="desktop-home__transform" data-identity-transform>
            <div class="desktop-home__transform-panel">
              <div class="desktop-home__before">
                <p class="desktop-home__transform-label">Wallet address</p>
                <p class="desktop-home__before-address">{{ DEMO.addressShort }}</p>
              </div>

              <div class="desktop-home__transform-stem" aria-hidden="true">
                <span class="desktop-home__transform-rail" />
                <span class="desktop-home__transform-arrow">▼</span>
              </div>

              <p class="desktop-home__claim-step">
                Claim <span>@{{ DEMO.handle }}</span>
              </p>

              <div class="desktop-home__transform-stem" aria-hidden="true">
                <span class="desktop-home__transform-rail" />
                <span class="desktop-home__transform-arrow">▼</span>
              </div>

              <div class="desktop-home__preview-card">
                <p class="desktop-home__transform-label desktop-home__transform-label--in-card">
                  Public identity
                </p>
                <div class="desktop-home__preview-top">
                  <div class="desktop-home__avatar-wrap">
                    <Identicon :address="DEMO.address" :size="76" />
                  </div>
                  <div class="desktop-home__preview-id">
                    <p class="desktop-home__preview-handle">@{{ DEMO.handle }}</p>
                    <p class="desktop-home__preview-badge">
                      <span class="desktop-home__verified-dot" aria-hidden="true" />
                      Verified on-chain
                    </p>
                  </div>
                </div>
                <h2 class="desktop-home__preview-name">{{ DEMO.name }}</h2>
                <p class="desktop-home__preview-bio">{{ DEMO.bio }}</p>
                <p class="desktop-home__preview-url">{{ DEMO.sharePath }}</p>
                <ul class="desktop-home__preview-links">
                  <li>Website</li>
                  <li>GitHub</li>
                  <li>Share</li>
                </ul>
                <ul class="desktop-home__preview-tags">
                  <li v-for="tag in DEMO.tags" :key="tag">{{ tag }}</li>
                </ul>
                <div class="desktop-home__preview-qr">
                  <div class="desktop-home__qr-frame">
                    <QrCode :text="demoPayUri" :size="154" />
                  </div>
                  <p>Scan to pay</p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>

    <section class="desktop-home__flow" aria-labelledby="desktop-home-flow">
      <h2 id="desktop-home-flow">Identity for the whole ecosystem</h2>
      <ol>
        <li v-for="(step, index) in ecosystemSteps" :key="step">
          <span class="desktop-home__flow-step">{{ step }}</span>
          <span
            v-if="index < ecosystemSteps.length - 1"
            class="desktop-home__flow-arrow"
            aria-hidden="true"
          >→</span>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.desktop-home {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.desktop-home__hero {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.desktop-home__brand {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}

.desktop-home__hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr);
  gap: 40px 40px;
  align-items: start;
}

.desktop-home__copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  text-align: left;
  min-width: 0;
}

.desktop-home__headline {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(2.35rem, 3.6vw, 3.1rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.02em;
  color: var(--text);
}

.desktop-home__subtext {
  margin: 0;
  max-width: 26rem;
  font-size: 18px;
  line-height: 1.6;
  color: var(--text-2);
}

.desktop-home__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}

.desktop-home__actions .nq-button {
  text-decoration: none;
}

.desktop-home__lookup-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}

.desktop-home__lookup-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid color-mix(in srgb, var(--nq-gold-dark) 35%, var(--border));
  background: color-mix(in srgb, var(--nq-gold) 10%, var(--card));
  color: var(--nq-gold-dark);
  font-weight: 800;
  text-decoration: none;
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    background var(--attr-duration) var(--nimiq-ease);
}

.desktop-home__lookup-cta:hover {
  transform: translateY(-1px);
  border-color: var(--nq-gold-dark);
  background: color-mix(in srgb, var(--nq-gold) 18%, var(--card));
}

.desktop-home__benefits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.desktop-home__benefits li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--card);
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease);
}

.desktop-home__benefits li:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nq-gold-dark) 45%, var(--border));
  box-shadow: 0 6px 16px color-mix(in srgb, var(--text) 8%, transparent);
}

.desktop-home__benefit-mark {
  color: var(--nimiq-green);
  font-size: 12px;
}

.desktop-home__preview {
  min-width: 0;
  width: 100%;
}

.desktop-home__transform {
  position: relative;
  width: 100%;
}

.desktop-home__transform::before {
  content: '';
  position: absolute;
  inset: -8% -6% -4%;
  border-radius: 32px;
  background:
    radial-gradient(
      70% 55% at 50% 42%,
      color-mix(in srgb, var(--nq-gold) 22%, transparent),
      transparent 72%
    );
  pointer-events: none;
  z-index: 0;
}

.desktop-home__transform-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 85%, var(--nq-gold-dark));
  border-radius: 22px;
  background: color-mix(in srgb, var(--card) 94%, transparent);
  box-shadow:
    0 18px 48px color-mix(in srgb, var(--text) 12%, transparent),
    0 0 0 1px color-mix(in srgb, var(--nq-gold) 8%, transparent);
}

.desktop-home__before {
  display: grid;
  gap: 6px;
  padding: 14px 20px 12px;
  background: color-mix(in srgb, var(--card) 80%, transparent);
  text-align: left;
}

.desktop-home__transform-label {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.desktop-home__transform-label--in-card {
  margin-bottom: 2px;
}

.desktop-home__before-address {
  margin: 0;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-family: var(--nimiq-font-family-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
}

.desktop-home__transform-stem {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 4px 0;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg) 35%, var(--card)),
      color-mix(in srgb, var(--bg) 20%, var(--card))
    );
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.desktop-home__transform-rail {
  width: 2px;
  height: 8px;
  border-radius: 2px;
  background: var(--nq-gold-dark);
}

.desktop-home__transform-arrow {
  color: var(--nq-gold-dark);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.desktop-home__claim-step {
  margin: 0;
  padding: 14px 20px;
  text-align: center;
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
  background:
    radial-gradient(120% 160% at 50% 0%, color-mix(in srgb, var(--nq-gold) 30%, transparent), transparent 65%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--nq-gold) 16%, var(--card)),
      color-mix(in srgb, var(--card) 96%, transparent)
    );
  animation: desktop-home-claim-pulse 2.8s var(--nimiq-ease) infinite;
}

.desktop-home__claim-step span {
  color: var(--nq-gold-dark);
}

@keyframes desktop-home-claim-pulse {
  0%,
  100% {
    background-color: transparent;
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.06);
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-home__claim-step {
    animation: none;
  }
}

.desktop-home__preview-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 22px 18px;
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--nq-gold-dark) 28%, var(--border));
  border-radius: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, var(--nq-gold)) 0%, var(--card) 48%);
  text-align: left;
}

.desktop-home__preview-top {
  display: flex;
  align-items: center;
  gap: 14px;
}

.desktop-home__avatar-wrap {
  position: relative;
  border-radius: 50%;
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--nimiq-green) 55%, transparent),
    0 0 18px color-mix(in srgb, var(--nimiq-green) 28%, transparent);
}

.desktop-home__preview-handle {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--nq-gold-dark);
}

.desktop-home__preview-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 6px 0 0;
  padding: 3px 9px 3px 7px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid color-mix(in srgb, var(--nimiq-green) 40%, var(--border));
  background: color-mix(in srgb, var(--nimiq-green) 12%, var(--card));
  font-size: 12px;
  font-weight: 800;
  color: var(--nimiq-green);
}

.desktop-home__verified-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nimiq-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nimiq-green) 28%, transparent);
}

.desktop-home__preview-name {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.desktop-home__preview-bio {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: var(--text-2);
}

.desktop-home__preview-url {
  margin: 0;
  font-family: var(--nimiq-font-family-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--nq-gold-dark);
  letter-spacing: 0.01em;
}

.desktop-home__preview-links,
.desktop-home__preview-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-home__preview-links li,
.desktop-home__preview-tags li {
  padding: 6px 10px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 65%, var(--card));
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease);
}

.desktop-home__preview-links li:hover,
.desktop-home__preview-tags li:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nq-gold-dark) 40%, var(--border));
  box-shadow: 0 6px 14px color-mix(in srgb, var(--text) 8%, transparent);
}

.desktop-home__preview-qr {
  display: grid;
  justify-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.desktop-home__qr-frame {
  padding: 8px;
  border-radius: 12px;
  background: var(--nimiq-white);
  transition:
    transform var(--movement-duration) var(--nimiq-ease),
    box-shadow var(--movement-duration) var(--nimiq-ease);
}

.desktop-home__qr-frame:hover {
  transform: translateY(-3px) scale(1.03);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--text) 16%, transparent);
}

.desktop-home__preview-qr p {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in srgb, var(--text-2) 72%, transparent);
}

.desktop-home__why {
  display: grid;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
  padding: 18px 18px;
  border: 1px solid color-mix(in srgb, var(--border) 90%, var(--text));
  border-radius: 16px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card) 96%, transparent),
      color-mix(in srgb, var(--card) 78%, transparent)
    );
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--nimiq-white) 4%, transparent);
}

.desktop-home__flow {
  display: grid;
  gap: 16px;
  max-width: 48rem;
  padding: 28px 28px;
  border: 1px solid color-mix(in srgb, var(--border) 90%, var(--text));
  border-radius: 18px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card) 96%, transparent),
      color-mix(in srgb, var(--card) 78%, transparent)
    );
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--nimiq-white) 4%, transparent);
}

.desktop-home__why h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.desktop-home__flow h2 {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.desktop-home__why ul {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-home__why li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-2);
  font-weight: 600;
  text-align: left;
}

.desktop-home__why-icon {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--nq-gold-dark) 30%, var(--border));
  background-color: color-mix(in srgb, var(--nq-gold) 12%, var(--card));
  background-position: center;
  background-size: 13px 13px;
  background-repeat: no-repeat;
}

.desktop-home__why-icon--people {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e5a212' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M22 21v-2a4 4 0 0 0-3-3.87'/%3E%3Cpath d='M16 3.13a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E");
}

.desktop-home__why-icon--globe {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e5a212' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M2 12h20'/%3E%3Cpath d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/%3E%3C/svg%3E");
}

.desktop-home__why-icon--link {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e5a212' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E");
}

.desktop-home__why-icon--tag {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e5a212' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41L12 2z'/%3E%3Ccircle cx='7.5' cy='7.5' r='1.5' fill='%23e5a212' stroke='none'/%3E%3C/svg%3E");
}

.desktop-home__flow ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-home__flow li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.desktop-home__flow-step {
  display: inline-flex;
  padding: 11px 15px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid var(--border);
  background: var(--card);
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent);
}

.desktop-home__flow-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--nq-gold-dark) 45%, var(--border));
  background: color-mix(in srgb, var(--nq-gold) 14%, var(--card));
  color: var(--nq-gold-dark);
  font-size: 13px;
  font-weight: 800;
}


@media (max-width: 900px) {
  .desktop-home__hero-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .desktop-home__brand,
  .desktop-home__copy {
    text-align: center;
  }

  .desktop-home__copy {
    align-items: center;
  }

  .desktop-home__headline {
    max-width: none;
  }

  .desktop-home__subtext {
    max-width: 32rem;
  }

  .desktop-home__actions,
  .desktop-home__benefits {
    justify-content: center;
  }

  .desktop-home__preview {
    max-width: 28rem;
    margin: 0 auto;
  }

  .desktop-home__flow ol {
    flex-direction: column;
    align-items: stretch;
  }

  .desktop-home__flow li {
    flex-direction: column;
    gap: 8px;
  }

  .desktop-home__flow-arrow {
    transform: rotate(90deg);
  }

  .desktop-home__why {
    text-align: left;
  }

  .desktop-home__flow {
    margin-inline: auto;
    text-align: center;
  }

  .desktop-home__flow-step {
    justify-content: center;
    width: 100%;
  }
}
</style>
