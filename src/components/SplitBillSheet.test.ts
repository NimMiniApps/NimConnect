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

  it('shows a people-first empty state instead of the form when there are no contacts', () => {
    const template = source.slice(source.indexOf('<template>'))
    expect(template).toMatch(/Split bills with people, not wallet addresses\./)
    expect(template).toMatch(/Add your first contact to start splitting expenses\./)
    expect(template).toMatch(/splittable\.length === 0/)
    expect(source).toMatch(/function goAddContact/)
    expect(source).toMatch(/router\.push\('\/add'\)/)
    // No @handle tip inside Split's empty state
    const emptyStateBlock = template.slice(
      template.indexOf('split-empty'),
      template.indexOf('</div>', template.indexOf('split-empty')),
    )
    expect(emptyStateBlock).not.toMatch(/@handle/i)
  })

  it('hides the form fields when the empty state is shown', () => {
    const template = source.slice(source.indexOf('<template>'))
    const emptyStateIdx = template.indexOf('split-empty')
    const formIdx = template.indexOf('What was it for?')
    expect(emptyStateIdx).toBeGreaterThan(-1)
    expect(emptyStateIdx).toBeLessThan(formIdx)
    // The empty state and the form are mutually exclusive branches (v-else-if / v-else of the same chain)
    expect(template.slice(0, formIdx)).toMatch(/v-else-if="store\.loaded && splittable\.length === 0"/)
    expect(template.slice(0, formIdx)).toMatch(/<template v-else>/)
  })
})
