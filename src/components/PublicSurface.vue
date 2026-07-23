<script setup lang="ts">
import { computed, useSlots } from 'vue'

const props = withDefaults(defineProps<{
  context: 'Public profile' | 'Shared profile' | 'Payment request' | 'NimConnect'
  footerVerb?: 'Shared' | 'Sent'
  actionsEnabled?: boolean
}>(), {
  footerVerb: 'Shared',
  actionsEnabled: true,
})

const slots = useSlots()
const hasPrimary = computed(() => Boolean(slots.primary))
const hasSecondary = computed(() => Boolean(slots.secondary))
const hasTertiary = computed(() => Boolean(slots.tertiary))
const hasActions = computed(() =>
  props.actionsEnabled && (hasPrimary.value || hasSecondary.value || hasTertiary.value))
</script>

<template>
  <main class="public-surface">
    <div class="public-surface__canvas">
      <header class="public-surface__masthead">
        <a class="public-surface__brand" href="#/" aria-label="NimConnect home">NimConnect</a>
        <span class="public-surface__context" :data-public-context="context">{{ context }}</span>
      </header>

      <section class="public-surface__identity" data-public-identity>
        <slot name="identity" />
      </section>

      <section class="public-surface__panel" data-public-panel>
        <slot name="panel" />
      </section>

      <section v-if="hasActions" class="public-surface__actions" aria-label="Public actions">
        <div v-if="hasPrimary" class="public-surface__primary" data-public-primary>
          <slot name="primary" />
        </div>
        <div v-if="hasSecondary" class="public-surface__secondary" data-public-secondary>
          <slot name="secondary" />
        </div>
        <div v-if="hasTertiary" class="public-surface__tertiary" data-public-tertiary>
          <slot name="tertiary" />
        </div>
      </section>

      <footer class="public-surface__footer">
        <slot name="footer">{{ footerVerb }} via <strong>NimConnect</strong></slot>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.public-surface {
  align-items: stretch;
  /* Blue gradient frame stays distinct from the canvas in both themes. */
  background: var(--nimiq-blue-bg);
  color: var(--text);
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
}

.public-surface__canvas {
  animation: public-surface-enter 180ms ease-out both;
  /* Page --bg (not --card) so the panel can sit clearly above it. */
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 1.25rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  isolation: isolate;
  max-width: 26rem;
  min-height: calc(100dvh - 2rem);
  overflow: hidden;
  padding: clamp(1rem, 3vw, 1.5rem);
  position: relative;
  width: 100%;
}

.public-surface__canvas::before {
  background: var(--nimiq-blue-bg);
  content: '';
  inset: -20%;
  opacity: 0.08;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.public-surface__masthead,
.public-surface__identity,
.public-surface__panel,
.public-surface__actions,
.public-surface__footer {
  position: relative;
  z-index: 1;
}

.public-surface__masthead,
.public-surface__footer {
  align-items: center;
  color: var(--text-2);
  display: flex;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  justify-content: space-between;
}

.public-surface__brand {
  color: var(--text);
  font-size: 0.875rem;
  opacity: 0.55;
  text-decoration: none;
}

.public-surface__brand:hover {
  opacity: 0.8;
}

.public-surface__context {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  border-radius: var(--nimiq-radius-pill);
  color: var(--text-2);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.25rem 0.625rem;
  text-transform: uppercase;
}

.public-surface__identity {
  display: grid;
  gap: 0.625rem;
  justify-items: center;
  margin-bottom: 2rem;
  text-align: center;
}

/* Soft pay band — tinted card / hairline only; no competing multi-layer shadow. */
.public-surface__panel {
  background: color-mix(in srgb, var(--card) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 1rem;
  display: grid;
  gap: 0.5rem;
  justify-items: center;
  padding: 0.625rem 0.875rem;
  text-align: center;
  width: 100%;
}

.public-surface__panel :slotted(p) { margin: 0; }
.public-surface__panel :slotted(span) { color: var(--text-2); font-size: 0.8125rem; }

.public-surface__actions {
  display: grid;
  gap: 0.875rem;
}

.public-surface__primary,
.public-surface__secondary,
.public-surface__tertiary {
  display: grid;
  gap: 0.75rem;
}

.public-surface__primary :deep(.nq-button) {
  min-height: 3.5rem;
}

.public-surface__primary:empty,
.public-surface__secondary:empty,
.public-surface__tertiary:empty { display: none; }

.public-surface__secondary :slotted(.public-action--outline),
.public-surface__secondary :slotted([data-public-action='outline']) {
  align-items: center;
  background: color-mix(in srgb, var(--card) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 28%, transparent);
  border-radius: 0.875rem;
  box-sizing: border-box;
  color: var(--text);
  display: inline-flex;
  font-weight: 800;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.625rem 1rem;
  text-decoration: none;
  transition:
    border-color 180ms var(--nimiq-ease),
    transform 180ms var(--nimiq-ease);
}

.public-surface__secondary :slotted(.public-action--outline:hover),
.public-surface__secondary :slotted([data-public-action='outline']:hover) {
  border-color: color-mix(in srgb, var(--text) 42%, transparent);
  transform: translateY(-2px);
}

.public-surface__tertiary {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

.public-surface__footer {
  color: var(--text-2);
  display: grid;
  gap: 0.25rem;
  justify-items: center;
  text-align: center;
}

.public-surface__footer :slotted(p) { font-size: 0.8125rem; margin: 0; }

.public-surface__footer :slotted(button) {
  background: none;
  border: 0;
  color: var(--nimiq-light-blue);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 2.75rem;
  padding: 0.5rem;
  text-decoration: underline;
  text-underline-offset: 0.1875rem;
}

.public-surface__footer {
  justify-content: center;
  margin-top: auto;
  padding-top: 0.75rem;
}

.public-surface :deep(a:focus-visible),
.public-surface :deep(button:focus-visible),
.public-surface :deep(input:focus-visible),
.public-surface :deep(textarea:focus-visible),
.public-surface :deep(select:focus-visible) {
  outline: 3px solid var(--nq-light-blue);
  outline-offset: 3px;
}

@keyframes public-surface-enter {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .public-surface__canvas {
    animation: none;
  }
}

@media (min-width: 48rem) {
  .public-surface {
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
    padding-top: max(1.5rem, env(safe-area-inset-top));
  }

  .public-surface__canvas {
    max-width: 34rem;
    min-height: min(40rem, calc(100dvh - 3rem));
  }

  /* Desktop-light: 2-col only when consumers wrap QR + meta in .panel__pay-row. */
  .public-surface__panel :deep(.panel__pay-row) {
    align-items: center;
    column-gap: 1.25rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: stretch;
    text-align: left;
    width: 100%;
  }
}
</style>
