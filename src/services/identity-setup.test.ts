import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentitySetupState,
  clearCelebration,
  identitySetupVisible,
  markPublicProfileShared,
  markHandleClaimedCelebration,
  snoozeIdentitySetup,
  isSnoozed,
  cancelSnooze,
  resolveIdentitySetup,
  noteIdentitySetupProgress,
  SNOOZE_MS,
  type IdentitySetupInput,
} from './identity-setup'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

const base = (over: Partial<IdentitySetupInput> = {}): IdentitySetupInput => ({
  handlesEnabled: true,
  handle: null,
  profileFilled: false,
  backupDone: false,
  contactCount: 0,
  ...over,
})

describe('identity-setup', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearIdentitySetupState()
  })

  it('orders steps claim-handle, fill-profile, setup-backup, share-profile, first-contact', () => {
    const r = resolveIdentitySetup(base())
    expect(r.steps.map(s => s.id)).toEqual([
      'claim-handle', 'fill-profile', 'setup-backup', 'share-profile', 'first-contact',
    ])
    expect(r.nextStep).toBe('claim-handle')
    expect(r.complete).toBe(false)
  })

  it('treats empty or whitespace handle as unclaimed', () => {
    expect(resolveIdentitySetup(base({ handle: '' })).nextStep).toBe('claim-handle')
    expect(resolveIdentitySetup(base({ handle: '   ' })).nextStep).toBe('claim-handle')
  })

  it('omits claim-handle when handles are disabled', () => {
    const r = resolveIdentitySetup(base({ handlesEnabled: false }))
    expect(r.steps.map(s => s.id)).toEqual(['fill-profile', 'setup-backup', 'share-profile', 'first-contact'])
    expect(r.nextStep).toBe('fill-profile')
  })

  it('walks the remaining steps in order as each predicate flips true', () => {
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).nextStep).toBe('fill-profile')
    expect(resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true })).nextStep).toBe('setup-backup')
    expect(
      resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true })).nextStep,
    ).toBe('share-profile')
    expect(
      resolveIdentitySetup(
        base({ handle: 'chuck', profileFilled: true, backupDone: true, contactCount: 1 }),
      ).nextStep,
    ).toBe('share-profile') // share-profile still not done — separate signal
  })

  it('never shows when already complete', () => {
    markPublicProfileShared()
    const r = resolveIdentitySetup(
      base({ handle: 'chuck', profileFilled: true, backupDone: true, contactCount: 2 }),
    )
    expect(r.complete).toBe(true)
    expect(identitySetupVisible(r)).toBe(false)
  })

  it('snoozes for 24h and cancels when progress happens', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(isSnoozed(t0 + SNOOZE_MS + 1)).toBe(false)
    snoozeIdentitySetup(t0)
    cancelSnooze()
    expect(isSnoozed(t0 + 1000)).toBe(false)
    snoozeIdentitySetup(t0)
    noteIdentitySetupProgress()
    expect(isSnoozed(t0 + 1000)).toBe(false)
  })

  it('celebration phase claimed clears after share', () => {
    markHandleClaimedCelebration('chuck')
    let r = resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
    markPublicProfileShared()
    r = resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true }))
    expect(r.celebration).toBeNull()
    expect(r.nextStep).toBe('first-contact')
    expect(r.steps.find(s => s.id === 'share-profile')!.done).toBe(true)
  })

  it('clearCelebration drops celebration without marking the profile shared', () => {
    markHandleClaimedCelebration('chuck')
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).celebration).toBe('claimed')
    clearCelebration()
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBeNull()
    expect(r.steps.find(s => s.id === 'share-profile')!.done).toBe(false)
  })

  it('normalizes celebration handle to trimmed lowercase', () => {
    markHandleClaimedCelebration('  Chuck  ')
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
  })

  it('suppresses celebration when handle is missing', () => {
    markHandleClaimedCelebration('chuck')
    const r = resolveIdentitySetup(base({ handle: null }))
    expect(r.celebration).toBeNull()
    expect(r.celebrationHandle).toBeNull()
  })

  it('celebration claimed overrides active snooze', () => {
    const t0 = 1_000_000
    markHandleClaimedCelebration('chuck')
    snoozeIdentitySetup(t0)
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(identitySetupVisible(r, t0 + 1000)).toBe(true)
  })

  it('hides when incomplete, snoozed, and not celebrating', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    const r = resolveIdentitySetup(base())
    expect(identitySetupVisible(r, t0 + 1000)).toBe(false)
  })

  it('shows when incomplete and not snoozed', () => {
    const r = resolveIdentitySetup(base())
    expect(identitySetupVisible(r, 1_000_000)).toBe(true)
  })
})
