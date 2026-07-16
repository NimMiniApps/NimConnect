import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'CurrencyAmountInput.vue'), 'utf-8')

describe('CurrencyAmountInput polish', () => {
  it('keeps the live conversion quieter than the primary amount', () => {
    expect(source).toMatch(/\.approx\s*\{[^}]*font-size:\s*1[12]px/)
    expect(source).toMatch(/\.approx\s*\{[^}]*color:\s*var\(--text-2\)/)
    expect(source).not.toMatch(/\.approx\s*\{[^}]*color:\s*var\(--nq-green\)/)
  })

  it('persists the last selected currency to preferredCurrency', () => {
    expect(source).toMatch(/preferredCurrency\.value\s*=\s*currency\.value|watch\(\s*currency/)
  })
})
