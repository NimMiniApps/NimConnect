import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'TipSheet.vue'), 'utf-8')

describe('TipSheet person-first tipping flow', () => {
  it('leads with the recipient identity before amount controls', () => {
    expect(source.indexOf('class="recipient"')).toBeLessThan(source.indexOf('class="presets"'))
    expect(source).toMatch(/Identicon/)
    expect(source).toMatch(/You're sending a tip/)
  })

  it('uses fiat-first tip presets with NIM equivalents', () => {
    expect(source).toMatch(/fiatToNim/)
    expect(source).toMatch(/preferredCurrency|tipCurrency/)
    expect(source).toMatch(/≈ .* NIM|preset-sub/)
    expect(source).not.toMatch(/const PRESETS = \[1, 5, 10, 25\]/)
  })

  it('makes the selected amount chip obviously selected', () => {
    expect(source).toMatch(/preset\.selected/)
    expect(source).toMatch(/nimiq-gold-bg/)
    expect(source).toMatch(/✓/)
  })

  it('offers a custom amount path', () => {
    expect(source).toMatch(/Custom…/)
    expect(source).toMatch(/customMode/)
    expect(source).toMatch(/CurrencyAmountInput/)
  })

  it('keeps the message optional with a soft placeholder', () => {
    expect(source).toMatch(/Say thanks/)
    expect(source).toMatch(/optional/)
    expect(source).not.toMatch(/message = ref\('Thanks!/)
  })

  it('uses a dynamic send CTA and a person-forward success state', () => {
    expect(source).toMatch(/Send \$\{.*fiatLabel|Send .* tip/)
    expect(source).toMatch(/Pick an amount/)
    expect(source).toMatch(/Continue/)
    expect(source).toMatch(/Tip sent/)
    expect(source).toMatch(/received your/)
  })
})
