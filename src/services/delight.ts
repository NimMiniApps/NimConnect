/** Tiny celebration bursts for milestone moments — no dependency, prefers-reduced-motion aware. */

const ONCE_PREFIX = 'nimconnect:delight:'

export type DelightOnceKey =
  | 'first-public-profile'
  | 'first-split'
  | 'first-bucket-complete'

export function delightOnce(key: DelightOnceKey): boolean {
  try {
    const storageKey = `${ONCE_PREFIX}${key}`
    if (globalThis.localStorage?.getItem(storageKey) === '1') return false
    globalThis.localStorage?.setItem(storageKey, '1')
    return true
  } catch {
    return true
  }
}

function prefersReducedMotion(): boolean {
  return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

const COLORS = ['#E9B213', '#0582CA', '#21BCA5', '#FC8702', '#1F2348', '#D94432']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  size: number
  spin: number
  rot: number
}

/** Fire a short confetti burst from the center (or optional origin). */
export function celebrate(origin?: { x: number; y: number }): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999'
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr)
    canvas.height = Math.floor(window.innerHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()

  const ox = origin?.x ?? window.innerWidth / 2
  const oy = origin?.y ?? window.innerHeight * 0.38
  const particles: Particle[] = Array.from({ length: 48 }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 8
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      life: 1,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      size: 4 + Math.random() * 5,
      spin: (Math.random() - 0.5) * 0.4,
      rot: Math.random() * Math.PI,
    }
  })

  let frame = 0
  const maxFrames = 70
  let raf = 0

  const tick = () => {
    frame += 1
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    for (const p of particles) {
      p.vy += 0.22
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.spin
      p.life = Math.max(0, 1 - frame / maxFrames)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65)
      ctx.restore()
    }
    if (frame < maxFrames) {
      raf = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(raf)
      canvas.remove()
      window.removeEventListener('resize', resize)
    }
  }

  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(tick)
}

/** Celebrate only the first time this milestone happens on this device. */
export function celebrateOnce(key: DelightOnceKey, origin?: { x: number; y: number }): void {
  if (delightOnce(key)) celebrate(origin)
}
