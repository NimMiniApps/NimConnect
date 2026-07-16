import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'ProfileFormPage.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('ProfileFormPage public-identity polish', () => {
  it('uses a warmer public-identity intro', () => {
    expect(source).toMatch(/Public Identity/)
    expect(source).toMatch(/never leave your device/)
    expect(source).not.toMatch(/Checked fields appear on your/)
  })

  it('puts tappable visibility chips in the field header', () => {
    expect(source).toMatch(/visibility-toggle/)
    expect(source).toMatch(/🌍 Public/)
    expect(source).toMatch(/🔒 Private/)
    expect(source).toMatch(/aria-pressed/)
    expect(source).toMatch(/Tap to make private/)
    expect(source).not.toMatch(/Show on public page/)
  })

  it('edits website and GitHub inline on the own profile', () => {
    expect(source).toMatch(/v-if="isSelf"/)
    expect(indexOf('v-model="website"')).toBeGreaterThan(0)
    expect(source).toMatch(/No public tags yet/)
    expect(source).toMatch(/Add tag/)
  })

  it('treats the card as your public profile with live fade and status chips', () => {
    expect(source).toMatch(/Your public profile/)
    expect(source).toMatch(/Open live →/)
    expect(source).not.toMatch(/Preview public profile/)
    expect(source).not.toMatch(/View live →/)
    expect(source).toMatch(/✓ Verified/)
    expect(source).toMatch(/preview-fade/)
    expect(source).toMatch(/Visible at/)
    expect(source).toMatch(/Last updated/)
    expect(source).toMatch(/livePreview/)
  })

  it('disables save until dirty and remembers extra-details collapse', () => {
    expect(source).toMatch(/Saved ✓/)
    expect(source).toMatch(/Changes saved ✓/)
    expect(source).toMatch(/isDirty/)
    expect(source).toMatch(/SHOW_MORE_KEY|profile-form-show-more/)
    expect(source).toMatch(/writeShowMorePref|readShowMorePref/)
    expect(source).toMatch(/position:\s*fixed/)
  })
})
