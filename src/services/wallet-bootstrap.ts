import { ValidationUtils } from '@nimiq/utils/validation-utils'
import {
  connectWallet,
  insideNimiqPay,
  peekWalletAccounts,
  resetWalletConnection,
  walletAddresses,
  walletOwnsSelf,
} from './nimiq'
import { incomingAddress } from './prefs'
import { useProfilesStore } from '../stores/profiles'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

let bootstrapPromise: Promise<void> | null = null

/** Single wallet bootstrap for the whole app — connect + ensureSelf profile. */
export function bootstrapWallet(): Promise<void> {
  bootstrapPromise ??= doBootstrap().finally(() => { bootstrapPromise = null })
  return bootstrapPromise
}

async function doBootstrap() {
  const store = useProfilesStore()
  await store.load()
  const priorSelf = store.self?.address ?? null
  try {
    if (priorSelf && insideNimiqPay.value) {
      const accounts = await peekWalletAccounts()
      if (accounts.length && !walletOwnsSelf(priorSelf, accounts)) {
        resetWalletConnection()
      }
    }
    const address = await connectWallet()
    if (!address) return
    if (priorSelf && !walletOwnsSelf(priorSelf, walletAddresses.value)) {
      await store.switchSelf(address)
      syncIncomingAddressPref()
    } else {
      await store.ensureSelf(address)
    }
  } catch {
    // Declined or invalid — offline mode still works
  }
}

function syncIncomingAddressPref() {
  const manual = incomingAddress.value.trim()
  if (!manual || !ValidationUtils.isValidAddress(manual)) return
  const norm = ValidationUtils.normalizeAddress(manual)
  if (!walletAddresses.value.some(a => compact(a) === compact(norm))) {
    incomingAddress.value = walletAddresses.value[0] ?? ''
  }
}

/**
 * Re-check Nimiq Pay's active account against the stored self profile.
 * Returns true when the wallet user changed and the app re-synced.
 */
export async function reconcileWalletSession(): Promise<boolean> {
  if (!insideNimiqPay.value) return false
  const store = useProfilesStore()
  await store.load()
  const self = store.self?.address
  if (!self) {
    await bootstrapWallet()
    return false
  }
  const accounts = await peekWalletAccounts()
  if (!accounts.length || walletOwnsSelf(self, accounts)) return false

  resetBootstrap()
  await bootstrapWallet()
  syncIncomingAddressPref()
  return true
}

export function resetBootstrap() {
  resetWalletConnection()
  bootstrapPromise = null
}

export async function retryWalletBootstrap(): Promise<void> {
  resetBootstrap()
  await bootstrapWallet()
}
