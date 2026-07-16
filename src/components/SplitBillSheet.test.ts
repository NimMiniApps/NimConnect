import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, './SplitBillSheet.vue'), 'utf8')

describe('SplitBillSheet', () => {
  it('puts the event before the amount and shows a live visual split', () => {
    const template = source.slice(source.indexOf('<template>'))
    const reason = template.indexOf('What was it for?')
    const total = template.indexOf('Total')
    expect(reason).toBeGreaterThan(-1)
    expect(reason).toBeLessThan(total)
    expect(source).toMatch(/breakdownRows/)
    expect(source).toMatch(/breakdown-amt/)
    expect(template).toMatch(/🍕/)
  })

  it('presents equal/custom split and fiat-first participant cards', () => {
    expect(source).toMatch(/splitMode/)
    expect(source).toMatch(/Equal/)
    expect(source).toMatch(/Custom/)
    expect(source).toMatch(/shareLabels/)
    expect(source).toMatch(/Include me/)
    expect(source).toMatch(/person-card/)
  })

  it('uses Contacts-style picker buckets and a dynamic CTA', () => {
    expect(source).toMatch(/⭐ Favorites/)
    expect(source).toMatch(/🕒 Recently active/)
    expect(source).toMatch(/👥 Everyone/)
    expect(source).toMatch(/Create \$\{n\} requests/)
    expect(source).toMatch(/Request \$\{share\} from/)
    expect(source).toMatch(/Add at least one contact to split this bill/)
    expect(source).toMatch(/will receive a payment request/)
    expect(source).toMatch(/You will owe/)
  })
})
