const SHARED_KEY = 'nimconnect:identity-setup-shared'
const SNOOZE_UNTIL_KEY = 'nimconnect:identity-setup-snooze-until'
const CELEBRATION_KEY = 'nimconnect:identity-setup-celebration'
const CELEBRATION_HANDLE_KEY = 'nimconnect:identity-setup-celebration-handle'

export const SNOOZE_MS = 24 * 60 * 60 * 1000

export type IdentitySetupStepId = 'claim-handle' | 'first-contact' | 'share-profile'

export type IdentitySetupCelebration = 'claimed'

export interface IdentitySetupInput {
  handlesEnabled: boolean
  handle: string | null
  contactCount: number
}

function normalizeHandle(handle: string | null | undefined): string | null {
  return handle?.trim().toLowerCase() || null
}

export interface IdentitySetupStep {
  id: IdentitySetupStepId
  label: string
  done: boolean
}

export interface IdentitySetupResult {
  steps: IdentitySetupStep[]
  nextStep: IdentitySetupStepId | null
  complete: boolean
  celebration: IdentitySetupCelebration | null
  celebrationHandle: string | null
}

const STEP_LABELS: Record<IdentitySetupStepId, string> = {
  'claim-handle': 'Claim your @handle',
  'first-contact': 'Connect with your first contact',
  'share-profile': 'Share your public profile',
}

function publicProfileShared(): boolean {
  return globalThis.localStorage?.getItem(SHARED_KEY) === '1'
}

export function markPublicProfileShared(): void {
  try { globalThis.localStorage?.setItem(SHARED_KEY, '1') } catch { /* best-effort */ }
  cancelSnooze()
  clearCelebration()
}

export function markHandleClaimedCelebration(handle: string): void {
  const normalized = normalizeHandle(handle)
  if (!normalized) return
  try {
    globalThis.localStorage?.setItem(CELEBRATION_KEY, 'claimed')
    globalThis.localStorage?.setItem(CELEBRATION_HANDLE_KEY, normalized)
  } catch { /* best-effort */ }
  cancelSnooze()
}

/** Clears celebration without marking the public profile as shared. */
export function clearCelebration(): void {
  try {
    globalThis.localStorage?.removeItem(CELEBRATION_KEY)
    globalThis.localStorage?.removeItem(CELEBRATION_HANDLE_KEY)
  } catch { /* best-effort */ }
}

function currentCelebration(): { celebration: IdentitySetupCelebration | null, celebrationHandle: string | null } {
  const value = globalThis.localStorage?.getItem(CELEBRATION_KEY)
  if (value === 'claimed') {
    return { celebration: 'claimed', celebrationHandle: globalThis.localStorage?.getItem(CELEBRATION_HANDLE_KEY) ?? null }
  }
  return { celebration: null, celebrationHandle: null }
}

export function snoozeIdentitySetup(now: number): void {
  try { globalThis.localStorage?.setItem(SNOOZE_UNTIL_KEY, String(now + SNOOZE_MS)) } catch { /* best-effort */ }
}

export function cancelSnooze(): void {
  try { globalThis.localStorage?.removeItem(SNOOZE_UNTIL_KEY) } catch { /* best-effort */ }
}

export function isSnoozed(now: number): boolean {
  const raw = globalThis.localStorage?.getItem(SNOOZE_UNTIL_KEY)
  if (!raw) return false
  const until = Number(raw)
  if (!Number.isFinite(until)) return false
  return now < until
}

/** Cancels snooze when Home observes handle/contact progress. */
export function noteIdentitySetupProgress(): void {
  cancelSnooze()
}

export function clearIdentitySetupState(): void {
  try {
    globalThis.localStorage?.removeItem(SHARED_KEY)
    globalThis.localStorage?.removeItem(SNOOZE_UNTIL_KEY)
    globalThis.localStorage?.removeItem(CELEBRATION_KEY)
    globalThis.localStorage?.removeItem(CELEBRATION_HANDLE_KEY)
  } catch { /* best-effort */ }
}

export function resolveIdentitySetup(input: IdentitySetupInput): IdentitySetupResult {
  const handle = normalizeHandle(input.handle)
  const hasHandle = !!handle
  const steps: IdentitySetupStep[] = []

  if (input.handlesEnabled) {
    steps.push({ id: 'claim-handle', label: STEP_LABELS['claim-handle'], done: hasHandle })
  }
  steps.push({ id: 'first-contact', label: STEP_LABELS['first-contact'], done: input.contactCount > 0 })
  steps.push({ id: 'share-profile', label: STEP_LABELS['share-profile'], done: publicProfileShared() })

  const firstUndone = steps.find(s => !s.done)
  const nextStep = firstUndone ? firstUndone.id : null
  const complete = nextStep == null

  const stored = currentCelebration()
  const celebration = stored.celebration === 'claimed' && hasHandle ? 'claimed' : null
  const celebrationHandle = celebration ? stored.celebrationHandle : null

  return { steps, nextStep, complete, celebration, celebrationHandle }
}

export function identitySetupVisible(result: IdentitySetupResult, now: number = Date.now()): boolean {
  if (result.complete) return false
  if (result.celebration === 'claimed') return true
  if (isSnoozed(now)) return false
  return true
}
