import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainCssSource = readFileSync(join(__dirname, 'main.css'), 'utf-8')

describe('.nq-button contrast fix', () => {
  it('uses dark ink text on the gold gradient (6.56-7.79:1, passes WCAG AA)', () => {
    expect(mainCssSource).toMatch(/\.nq-button\s*\{[\s\S]*?color:\s*var\(--nimiq-blue\);/)
  })

  it('uses the solid light-blue-darkened token, not the gradient, for the light-blue variant (5.06:1, passes)', () => {
    expect(mainCssSource).toMatch(/\.nq-button\.light-blue\s*\{\s*background:\s*var\(--nimiq-light-blue-darkened\);\s*color:\s*var\(--nimiq-white\);\s*\}/)
  })

  it('gives .nq-button a focus-visible outline using a token that passes 3:1 in both themes', () => {
    expect(mainCssSource).toMatch(/\.nq-button:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--nq-light-blue\);/)
  })

  it('gives .nq-button a hover state', () => {
    expect(mainCssSource).toMatch(/\.nq-button:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*var\(--nimiq-gold-bg-darkened\);/)
  })
})
