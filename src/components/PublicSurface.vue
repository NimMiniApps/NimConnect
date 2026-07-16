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
        <span class="public-surface__brand">NimConnect</span>
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
  background: var(--nimiq-blue);
  color: var(--text);
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.public-surface__canvas {
  animation: public-surface-enter 180ms ease-out both;
  background: linear-gradient(160deg, var(--card) 0%, var(--bg) 100%);
  border-radius: 1.5rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  isolation: isolate;
  max-width: 42rem;
  min-height: calc(100dvh - 2.5rem);
  overflow: hidden;
  padding: clamp(1.25rem, 4vw, 2.5rem);
  position: relative;
  width: 100%;
}

.public-surface__canvas::before {
  background: var(--nimiq-blue-bg);
  content: '';
  inset: -20%;
  opacity: 0.12;
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
  font-size: 1rem;
}

.public-surface__identity {
  display: grid;
  gap: 0.625rem;
  justify-items: center;
  text-align: center;
}

.public-surface__panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 1.25rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.75rem;
  justify-items: center;
  padding: clamp(1rem, 3vw, 1.5rem);
  text-align: center;
}

.public-surface__panel :slotted(p) { margin: 0; }
.public-surface__panel :slotted(span) { color: var(--text-2); font-size: 0.8125rem; }

.public-surface__actions {
  display: grid;
  gap: 0.75rem;
}

.public-surface__primary,
.public-surface__secondary,
.public-surface__tertiary {
  display: grid;
  gap: 0.5rem;
}

.public-surface__primary:empty,
.public-surface__secondary:empty,
.public-surface__tertiary:empty { display: none; }

.public-surface__secondary :slotted(.public-action--outline),
.public-surface__secondary :slotted([data-public-action='outline']) {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-sizing: border-box;
  color: var(--text);
  display: inline-flex;
  font-weight: 800;
  justify-content: center;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  text-decoration: none;
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
    padding-bottom: max(2rem, env(safe-area-inset-bottom));
    padding-top: max(2rem, env(safe-area-inset-top));
  }

  .public-surface__canvas {
    min-height: min(48rem, calc(100dvh - 4rem));
  }
}
</style>
