import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'HomePage.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('HomePage people-first hierarchy', () => {
  it('labels the contact row People, not Quick send', () => {
    expect(source).toMatch(/>People</)
    expect(source).not.toMatch(/Quick send/)
  })

  it('places People before Requests waiting', () => {
    expect(indexOf('>Requests waiting<')).toBeGreaterThan(indexOf('>People<'))
  })

  it('places People before the activity toast so relationships lead', () => {
    expect(indexOf('activity-banner')).toBeGreaterThan(indexOf('>People<'))
  })

  it('places Recent payments before Open invoices and Shared trips', () => {
    const recent = indexOf('>Recent payments<')
    expect(recent).toBeLessThan(indexOf('>Open invoices<'))
    expect(recent).toBeLessThan(indexOf('>Shared trips<'))
  })

  it('uses ~66px avatars in the People row', () => {
    expect(source).toMatch(/Identicon[^>]*:size="6[4-8]"/)
  })

  it('auto-dismisses the activity toast after a few seconds', () => {
    expect(source).toMatch(/BANNER_AUTO_DISMISS_MS\s*=\s*[3-9]\d{3}/)
    expect(source).toMatch(/setTimeout\(\s*\(\)\s*=>\s*dismissBanner\(\)/)
  })

  it('uses a compact icon refresh control instead of a labeled Refresh button', () => {
    expect(source).toMatch(/aria-label="Refresh"/)
    expect(source).not.toMatch(/>Refresh</)
  })

  it('labels the external explorer action as View with an outbound cue', () => {
    expect(source).toMatch(/View\s*↗/)
    expect(source).not.toMatch(/>\s*Explorer\s*</)
  })

  it('wraps major sections in home-panel cards', () => {
    expect(source).toMatch(/class="[^"]*home-panel/)
    expect((source.match(/home-panel/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})

describe('HomePage identity setup guidance', () => {
  it('imports and renders IdentitySetupCard under the header', () => {
    expect(source).toMatch(/import IdentitySetupCard from '..\/components\/IdentitySetupCard\.vue'/)
    expect(indexOf('<IdentitySetupCard')).toBeGreaterThan(indexOf('</header>'))
  })

  it('wires IdentitySetupCard events to identity-setup actions', () => {
    expect(source).toMatch(/:result="identitySetup"/)
    expect(source).toMatch(/:public-url="identityPublicUrl"/)
    expect(source).toMatch(/@claim="claimIdentity"/)
    expect(source).toMatch(/@add-contact="addContactFromIdentity"/)
    expect(source).toMatch(/@share="shareIdentityProfile"/)
    expect(source).toMatch(/@learn-more="toggleLearnMore"/)
    expect(source).toMatch(/@dismiss="dismissIdentitySetup"/)
  })

  it('resolves identity setup from handles, self handle, and contact count', () => {
    expect(source).toMatch(/resolveIdentitySetup\(\{/)
    expect(source).toMatch(/handlesEnabled:\s*handlesEnabled\(\)/)
    expect(source).toMatch(/handle:\s*selfHandle\.value/)
    expect(source).toMatch(/contactCount:\s*profilesStore\.contacts\.length/)
  })

  it('claims a handle by opening the claim sheet on the profile page', () => {
    expect(source).toMatch(/function claimIdentity\(\)\s*\{\s*router\.push\(\{\s*path:\s*'\/me',\s*query:\s*\{\s*sheet:\s*'claim'\s*\}\s*\}\)/)
  })

  it('notes identity-setup progress when the first contact appears or a handle is claimed', () => {
    expect(source).toMatch(/noteIdentitySetupProgress\(\)/)
    expect((source.match(/noteIdentitySetupProgress\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('hides the welcome empty state while the identity setup card is guiding the user', () => {
    expect(source).toMatch(/v-if="freshUser && !identityCardVisible"/)
  })

  it('offers a claim-first empty state before a handle exists, with no Share profile CTA', () => {
    const block = source.match(/<template v-if="!selfHandle">([\s\S]*?)<\/template>/)
    expect(block, 'expected a !selfHandle branch in the empty-state CTAs').toBeTruthy()
    const noHandleCtas = block![1]!
    expect(noHandleCtas).toMatch(/Claim @handle/)
    expect(noHandleCtas).toMatch(/Add contact/)
    expect(noHandleCtas).not.toMatch(/Share profile/i)
  })

  it('offers Add contact primary and Share public profile secondary once a handle exists', () => {
    const block = source.match(/<template v-else>([\s\S]*?)<\/template>/)
    expect(block, 'expected a v-else branch in the empty-state CTAs').toBeTruthy()
    const hasHandleCtas = block![1]!
    expect(hasHandleCtas).toMatch(/primary-action[\s\S]*?Add contact/)
    expect(hasHandleCtas).toMatch(/Share public profile/)
  })
})
