<script setup lang="ts">
import { computed, useSlots } from 'vue'

withDefaults(defineProps<{
  context: 'Public profile' | 'Shared profile' | 'Payment request' | 'NimConnect'
  footerVerb?: 'Shared' | 'Sent'
}>(), {
  footerVerb: 'Shared',
})

const slots = useSlots()
const hasPrimary = computed(() => Boolean(slots.primary))
const hasSecondary = computed(() => Boolean(slots.secondary))
const hasTertiary = computed(() => Boolean(slots.tertiary))
const hasActions = computed(() => hasPrimary.value || hasSecondary.value || hasTertiary.value)
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
  --public-ink: #1f2348;
  --public-blue: #2252c7;
  --public-soft-blue: #eef4ff;
  --public-gold: #f4c547;
  align-items: stretch;
  background: var(--public-ink);
  color: var(--public-ink);
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.public-surface__canvas {
  animation: public-surface-enter 180ms ease-out both;
  background: linear-gradient(160deg, #ffffff 0%, var(--public-soft-blue) 100%);
  border-radius: 1.5rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 42rem;
  min-height: calc(100dvh - 2.5rem);
  padding: clamp(1.25rem, 4vw, 2.5rem);
  width: 100%;
}

.public-surface__masthead,
.public-surface__footer {
  align-items: center;
  color: #59627d;
  display: flex;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  justify-content: space-between;
}

.public-surface__brand {
  color: var(--public-ink);
  font-size: 1rem;
}

.public-surface__identity {
  display: grid;
  gap: 0.625rem;
  justify-items: center;
  text-align: center;
}

.public-surface__panel {
  background: #ffffff;
  border: 1px solid #dce7ff;
  border-radius: 1.25rem;
  box-shadow: 0 1rem 2.5rem rgb(31 35 72 / 0.1);
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

.public-surface__primary :slotted(a),
.public-surface__primary :slotted(button),
.public-surface__secondary :slotted(a),
.public-surface__secondary :slotted(button) {
  align-items: center;
  border-radius: 0.875rem;
  box-sizing: border-box;
  display: inline-flex;
  font: inherit;
  font-weight: 800;
  justify-content: center;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  text-decoration: none;
}

.public-surface__primary :slotted(a),
.public-surface__primary :slotted(button) {
  background: var(--public-gold);
  border: 1px solid var(--public-gold);
  color: var(--public-ink);
}

.public-surface__secondary :slotted(a),
.public-surface__secondary :slotted(button) {
  background: var(--public-blue);
  border: 1px solid var(--public-blue);
  color: #ffffff;
}

.public-surface__secondary :slotted(.public-action--outline),
.public-surface__secondary :slotted([data-public-action='outline']) {
  background: transparent;
  border-color: #bdc9e5;
  color: var(--public-ink);
}

.public-surface__tertiary {
  border-top: 1px solid #dce7ff;
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
  color: var(--nq-light-blue);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
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
  outline: 3px solid var(--public-gold);
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
