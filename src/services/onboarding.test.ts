import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Profile } from '../types/profile'
import {
  needsOnboarding,
  needsBackupOnboarding,
  markOnboardingDone,
  markBackupOnboardingDone,
  clearOnboardingDone,
  clearBackupOnboardingDone,
  onboardingDone,
  backupOnboardingDone,
  onboardingWizardShown,
  markOnboardingWizardShown,
  hasFilledProfile,
} from './onboarding'

const self = (name: string): Profile => ({
  id: '1',
  address: 'NQ00 TEST',
  name,
  type: 'person',
  isSelf: true,
  notes: '',
  tags: [],
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
})

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('onboarding', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearOnboardingDone()
    clearBackupOnboardingDone()
  })

  it('needs onboarding for stub profile', () => {
    expect(needsOnboarding(self('Me'))).toBe(true)
  })

  it('skips when profile has a real name', () => {
    expect(needsOnboarding(self('Alice'))).toBe(false)
  })

  it('skips when onboarding was completed or skipped', () => {
    markOnboardingDone()
    expect(onboardingDone()).toBe(true)
    expect(needsOnboarding(self('Me'))).toBe(false)
  })

  it('skips without a self profile', () => {
    expect(needsOnboarding(null)).toBe(false)
  })

  it('needs backup onboarding by default', () => {
    expect(needsBackupOnboarding()).toBe(true)
  })

  it('skips backup onboarding when dismissed', () => {
    markBackupOnboardingDone()
    expect(backupOnboardingDone()).toBe(true)
    expect(needsBackupOnboarding()).toBe(false)
  })

  it('wizard-shown flag defaults false and can be marked', () => {
    expect(onboardingWizardShown()).toBe(false)
    markOnboardingWizardShown()
    expect(onboardingWizardShown()).toBe(true)
  })

  it('hasFilledProfile is false for the stub name, missing profile, or blank name', () => {
    expect(hasFilledProfile(self('Me'))).toBe(false)
    expect(hasFilledProfile(null)).toBe(false)
    expect(hasFilledProfile(self(''))).toBe(false)
  })

  it('hasFilledProfile is true for a real name, independent of markOnboardingDone (legacy-user case)', () => {
    // No markOnboardingDone() call here on purpose — this is the exact legacy scenario:
    // a profile that already has a real name but never triggered the old dismissal flag.
    expect(onboardingDone()).toBe(false)
    expect(hasFilledProfile(self('Alice'))).toBe(true)
  })
})
