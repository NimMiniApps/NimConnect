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
})
