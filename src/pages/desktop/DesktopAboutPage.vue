<script setup lang="ts">
import { NIMPAY_OPEN_URL } from '../../config/host-app'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

const heroPoints = [
  'Permanent @handles.',
  'Public profiles.',
  'Payment pages.',
  'One identity across every Mini App.',
]

const features = [
  {
    title: 'Identity',
    items: [
      'Permanent @handle',
      'Public profile',
      'Verified identity',
      'Control what is public',
    ],
  },
  {
    title: 'Payments',
    items: [
      'Public payment page',
      'QR code',
      'Share links',
      'Wallet identity',
    ],
  },
  {
    title: 'Privacy',
    items: [
      'Public/private fields',
      'Connected wallet ownership',
      'No private key custody',
      'You control your data',
    ],
  },
]

const ecosystem = [
  'Nimiq Pay',
  'Mini Apps',
  'Public Profiles',
  'Payment Pages',
]

const developerCapabilities = [
  {
    title: 'Resolve @handles',
    body: 'Convert a handle into a verified wallet address.',
  },
  {
    title: 'Public profiles',
    body: 'Open rich public identity pages directly from your app.',
  },
  {
    title: 'Payment pages',
    body: 'Deep-link users to a public payment page without building your own identity layer.',
  },
  {
    title: 'Simple integration',
    body: 'REST API, documented endpoints, open-source @nimconnect/profile-client.',
  },
]

const developerLinks = [
  {
    label: 'API Documentation',
    href: 'https://github.com/NimMiniApps/NimConnect/tree/main/docs/api',
  },
  {
    label: 'Integration Guide',
    href: 'https://www.npmjs.com/package/@nimconnect/profile-client',
  },
  {
    label: 'GitHub Repository',
    href: 'https://github.com/NimMiniApps/NimConnect',
  },
]
</script>

<template>
  <div class="desktop-about" data-desktop-about>
    <section class="desktop-about__hero" aria-labelledby="desktop-about-headline">
      <p class="desktop-about__brand">
        <img class="desktop-about__brand-icon" :src="brandIconUrl" alt="" width="40" height="40" />
        <span>NimConnect</span>
      </p>
      <h1 id="desktop-about-headline" class="desktop-about__headline">
        The identity portal for the Nimiq ecosystem.
      </h1>
      <ul class="desktop-about__hero-points">
        <li v-for="point in heroPoints" :key="point">{{ point }}</li>
      </ul>
      <a class="nq-button" :href="NIMPAY_OPEN_URL">Open in Nimiq Pay</a>
    </section>

    <section class="desktop-about__features" aria-label="What NimConnect provides">
      <article
        v-for="feature in features"
        :key="feature.title"
        class="desktop-about__card"
      >
        <h2>{{ feature.title }}</h2>
        <ul>
          <li v-for="item in feature.items" :key="item">
            <span aria-hidden="true">•</span>
            {{ item }}
          </li>
        </ul>
      </article>
    </section>

    <section class="desktop-about__ecosystem" aria-labelledby="desktop-about-ecosystem">
      <h2 id="desktop-about-ecosystem">Works with</h2>
      <ul class="desktop-about__pills">
        <li v-for="item in ecosystem" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section
      class="desktop-about__developers"
      data-desktop-about-developers
      aria-labelledby="desktop-about-developers"
    >
      <div class="desktop-about__developers-intro">
        <h2 id="desktop-about-developers">For Mini App Developers</h2>
        <p>
          NimConnect provides a simple public identity layer that any Mini App can integrate.
          Resolve @handles, link to public profiles, and direct users to verified payment pages.
        </p>
      </div>

      <article class="desktop-about__card desktop-about__card--developers">
        <ul class="desktop-about__capability-list">
          <li v-for="item in developerCapabilities" :key="item.title">
            <span class="desktop-about__capability-title">
              <span aria-hidden="true">•</span>
              {{ item.title }}
            </span>
            <span class="desktop-about__capability-body">{{ item.body }}</span>
          </li>
        </ul>
      </article>

      <div class="desktop-about__dev-links">
        <a
          v-for="link in developerLinks"
          :key="link.label"
          class="desktop-about__dev-link"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ link.label }}
        </a>
      </div>

      <p class="desktop-about__dev-note">
        Built for the Nimiq Mini Apps ecosystem. NimConnect is designed to become a reusable
        identity layer that every Mini App can integrate.
      </p>
    </section>

    <section class="desktop-about__close" aria-labelledby="desktop-about-close">
      <h2 id="desktop-about-close">Built for the Nimiq Mini Apps ecosystem.</h2>
      <p>
        Desktop is your identity manager.
        Your everyday payments stay inside Nimiq Pay.
      </p>
    </section>
  </div>
</template>

<style scoped>
.desktop-about {
  display: flex;
  flex-direction: column;
  gap: 40px;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 0 16px;
}

.desktop-about__hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  max-width: 40rem;
}

.desktop-about__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}
.desktop-about__brand-icon {
  width: 40px;
  height: 40px;
  border-radius: 22%;
  flex: 0 0 auto;
}

.desktop-about__headline {
  margin: 0;
  font-size: clamp(2rem, 4vw, 2.75rem);
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: var(--text);
}

.desktop-about__hero-points {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-about__hero-points li {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.45;
  color: var(--text-2);
}

.desktop-about__hero .nq-button {
  margin-top: 4px;
  text-decoration: none;
}

.desktop-about__features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.desktop-about__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px;
  text-align: left;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card) 96%, var(--nq-gold)),
      var(--card)
    );
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.desktop-about__card h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text);
}

.desktop-about__card ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-about__card li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text);
}

.desktop-about__card li span {
  color: var(--nq-gold-dark);
  font-weight: 800;
}

.desktop-about__ecosystem {
  display: grid;
  gap: 14px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--card) 88%, transparent);
  box-shadow: var(--shadow);
}

.desktop-about__ecosystem h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text);
}

.desktop-about__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-about__pills li {
  display: inline-flex;
  align-items: center;
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

.desktop-about__pills li:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--nq-gold-dark) 45%, var(--border));
  box-shadow: 0 6px 16px color-mix(in srgb, var(--text) 8%, transparent);
}

.desktop-about__developers {
  display: grid;
  gap: 18px;
}

.desktop-about__developers-intro {
  display: grid;
  gap: 10px;
  max-width: 40rem;
}

.desktop-about__developers-intro h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--text);
}

.desktop-about__developers-intro p {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--text-2);
}

.desktop-about__card--developers {
  max-width: 100%;
}

.desktop-about__capability-list {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-about__capability-list li {
  display: grid;
  gap: 4px;
}

.desktop-about__capability-title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.desktop-about__capability-title span[aria-hidden] {
  color: var(--nq-gold-dark);
}

.desktop-about__capability-body {
  padding-left: 1.1rem;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text-2);
}

.desktop-about__dev-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.desktop-about__dev-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid color-mix(in srgb, var(--nq-light-blue) 40%, var(--border));
  border-radius: var(--nimiq-radius-pill);
  background: color-mix(in srgb, var(--nq-light-blue) 10%, var(--card));
  color: var(--nq-light-blue);
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    background var(--attr-duration) var(--nimiq-ease);
}

.desktop-about__dev-link:hover {
  transform: translateY(-1px);
  border-color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 16%, var(--card));
}

.desktop-about__dev-note {
  margin: 0;
  padding: 16px 18px;
  border-left: 3px solid var(--nq-gold-dark);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: color-mix(in srgb, var(--nq-gold) 8%, var(--card));
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text);
}

.desktop-about__close {
  display: grid;
  gap: 10px;
  max-width: 36rem;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card) 96%, var(--nq-light-blue)),
      var(--card)
    );
  box-shadow: var(--shadow);
}

.desktop-about__close h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  line-height: 1.3;
  color: var(--text);
}

.desktop-about__close p {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--text-2);
}

@media (max-width: 800px) {
  .desktop-about__features {
    grid-template-columns: 1fr;
  }
}
</style>
