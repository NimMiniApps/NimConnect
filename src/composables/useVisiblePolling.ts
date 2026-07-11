import { onMounted, onUnmounted } from 'vue'

/**
 * Run `callback` on a fixed interval while the document is visible.
 * Pauses when hidden; runs once immediately when the tab returns to foreground.
 */
export function useVisiblePolling(callback: () => void | Promise<void>, intervalMs: number) {
  if (typeof document === 'undefined') return

  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function tick() {
    void callback()
  }

  function start() {
    stop()
    timer = setInterval(tick, intervalMs)
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      tick()
      start()
    } else {
      stop()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') start()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })
}
