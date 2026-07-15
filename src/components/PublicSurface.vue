<script setup lang="ts">
withDefaults(defineProps<{
  context: 'Public profile' | 'Shared profile' | 'Payment request' | 'NimConnect'
  footerVerb?: string
}>(), {
  footerVerb: 'Shared',
})
</script>

<template>
  <main class="public-surface" :data-public-context="context">
    <div class="public-surface__canvas">
      <header class="public-surface__masthead">
        <span class="public-surface__brand">NimConnect</span>
        <span class="public-surface__context">{{ context }}</span>
      </header>

      <section class="public-surface__identity" data-public-identity>
        <slot name="identity" />
      </section>

      <section class="public-surface__panel" data-public-panel>
        <slot name="panel" />
      </section>

      <div class="public-surface__actions">
        <div class="public-surface__primary" data-public-primary>
          <slot name="primary" />
        </div>
        <div class="public-surface__secondary" data-public-secondary>
          <slot name="secondary" />
        </div>
      </div>

      <footer class="public-surface__footer">{{ footerVerb }} via NimConnect</footer>
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
  text-align: center;
}

.public-surface__panel {
  background: #ffffff;
  border: 1px solid #dce7ff;
  border-radius: 1.25rem;
  box-shadow: 0 1rem 2.5rem rgb(31 35 72 / 0.1);
  padding: clamp(1rem, 3vw, 1.5rem);
}

.public-surface__actions {
  display: grid;
  gap: 0.75rem;
}

.public-surface__primary,
.public-surface__secondary {
  display: grid;
  gap: 0.5rem;
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
