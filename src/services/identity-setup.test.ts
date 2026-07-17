import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentitySetupState,
  identitySetupVisible,
  markPublicProfileShared,
  markHandleClaimedCelebration,
  snoozeIdentitySetup,
  isSnoozed,
  cancelSnooze,
  resolveIdentitySetup,
  noteIdentitySetupProgress,
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
  contactCount: 0,
  ...over,
})

describe('identity-setup', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearIdentitySetupState()
  })

  it('prioritizes claim handle when missing', () => {
    const r = resolveIdentitySetup(base())
    expect(r.complete).toBe(false)
    expect(r.nextStep).toBe('claim-handle')
    expect(r.steps.map(s => s.id)).toEqual(['claim-handle', 'first-contact', 'share-profile'])
    expect(r.steps[0]!.done).toBe(false)
  })

  it('treats empty or whitespace handle as unclaimed', () => {
    expect(resolveIdentitySetup(base({ handle: '' })).nextStep).toBe('claim-handle')
    expect(resolveIdentitySetup(base({ handle: '   ' })).nextStep).toBe('claim-handle')
  })

  it('starts at first contact when handles disabled', () => {
    const r = resolveIdentitySetup(base({ handlesEnabled: false }))
    expect(r.steps.map(s => s.id)).toEqual(['first-contact', 'share-profile'])
    expect(r.nextStep).toBe('first-contact')
  })

  it('after handle, next is first contact then share', () => {
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).nextStep).toBe('first-contact')
    expect(resolveIdentitySetup(base({ handle: 'chuck', contactCount: 1 })).nextStep).toBe('share-profile')
  })

  it('never shows when already complete', () => {
    markPublicProfileShared()
    const r = resolveIdentitySetup(base({ handle: 'chuck', contactCount: 2 }))
    expect(r.complete).toBe(true)
    expect(identitySetupVisible(r)).toBe(false)
  })

  it('snoozes for 24h and cancels when progress happens', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(isSnoozed(t0 + 24 * 60 * 60 * 1000 + 1)).toBe(false)
    snoozeIdentitySetup(t0)
    cancelSnooze()
    expect(isSnoozed(t0 + 1000)).toBe(false)
    snoozeIdentitySetup(t0)
    noteIdentitySetupProgress()
    expect(isSnoozed(t0 + 1000)).toBe(false)
  })

  it('celebration phase claimed clears after share', () => {
    markHandleClaimedCelebration('chuck')
    let r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
    markPublicProfileShared()
    r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBeNull()
    expect(r.nextStep).toBe('first-contact')
    expect(r.steps.find(s => s.id === 'share-profile')!.done).toBe(true)
  })

  it('normalizes celebration handle to trimmed lowercase', () => {
    markHandleClaimedCelebration('  Chuck  ')
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
  })
})
