import { ref } from 'vue'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { nimToLunas } from './links'
import { discoverPairedAddresses, expandMyAddresses } from './history'
import { incomingAddress } from './prefs'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

let providerPromise: Promise<NimiqProvider | null> | null = null
let addressPromise: Promise<string | null> | null = null
let hostDetectPromise: Promise<boolean> | null = null

/** Sync peek — provider may arrive shortly after page load inside Nimiq Pay. */
export function isInsideNimiqPaySync(): boolean {
  return typeof window !== 'undefined' && (window.nimiqPay != null || window.nimiq != null)
}

/** Reactive — updated once host detection finishes. */
export const insideNimiqPay = ref(isInsideNimiqPaySync())

/** Reactive status for UI — 'connecting' while awaiting Nimiq Pay approval. */
export const walletStatus = ref<'idle' | 'connecting' | 'ready' | 'unavailable'>(
  insideNimiqPay.value ? 'idle' : 'unavailable',
)

/** All wallet addresses (Nimiq Pay exposes separate incoming + outgoing addresses). */
export const walletAddresses = ref<string[]>([])

let enrichPromise: Promise<void> | null = null

export function resetWalletConnection() {
  addressPromise = null
  enrichPromise = null
  walletAddresses.value = []
  walletStatus.value = insideNimiqPay.value ? 'idle' : 'unavailable'
}

function waitForProvider(timeout = 10_000): Promise<NimiqProvider | null> {
  if (typeof window !== 'undefined' && window.nimiq) {
    return Promise.resolve(window.nimiq)
  }
  providerPromise ??= init({ timeout }).catch(() => null)
  return providerPromise
}

/**
 * Wait for Nimiq Pay to inject `window.nimiq` (polls via SDK init).
 * Resolves once — safe to call from App.vue on mount.
 */
export function detectHostApp(): Promise<boolean> {
  hostDetectPromise ??= (async () => {
    if (isInsideNimiqPaySync()) {
      insideNimiqPay.value = true
      walletStatus.value = 'idle'
      return true
    }
    // Outside Nimiq Pay: show the landing page immediately instead of waiting
    // up to 5s for a provider that will never arrive.
    insideNimiqPay.value = false
    walletStatus.value = 'unavailable'
    // Nimiq Pay may inject the provider shortly after load — upgrade in the background.
    void waitForProvider(5_000).then(provider => {
      if (!provider) return
      insideNimiqPay.value = true
      walletStatus.value = 'idle'
    })
    return false
  })()
  return hostDetectPromise
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('wallet-timeout')), ms),
    ),
  ])
}

/** Resolves the provider once; null when running outside Nimiq Pay. */
export function getProvider(): Promise<NimiqProvider | null> {
  return waitForProvider()
}

function isErrorResponse(r: unknown): r is { error: { type: string; message: string } } {
  return typeof r === 'object' && r !== null && 'error' in r
}

function parseAccounts(result: unknown): string[] {
  if (isErrorResponse(result)) return []
  if (Array.isArray(result)) return result.filter((a): a is string => typeof a === 'string')
  return []
}

/**
 * Request the user's Nimiq address once per session.
 * Deduplicates concurrent calls so Nimiq Pay only shows one Connect dialog.
 */
export function connectWallet(): Promise<string | null> {
  addressPromise ??= (async () => {
    walletStatus.value = 'connecting'
    try {
      const provider = await getProvider()
      if (!provider) {
        insideNimiqPay.value = false
        walletStatus.value = 'unavailable'
        return null
      }
      insideNimiqPay.value = true
      const result = await withTimeout(provider.listAccounts(), 120_000)
      const accounts = parseAccounts(result)
      if (!accounts.length) {
        walletStatus.value = 'unavailable'
        return null
      }
      walletStatus.value = 'ready'
      walletAddresses.value = accounts
      enrichPromise = enrichWalletAddresses(accounts[0])
      await enrichPromise
      return accounts[0]
    } catch {
      walletStatus.value = 'unavailable'
      return null
    }
  })()
  return addressPromise
}

export async function getMyAddress(): Promise<string | null> {
  return connectWallet()
}

/**
 * Every address that is "me": Nimiq Pay's separate incoming + outgoing wallet
 * accounts, the self profile address, and the manually configured incoming address.
 */
export function myAddresses(selfAddress?: string | null): string[] {
  const set = new Set(walletAddresses.value)
  if (selfAddress) set.add(selfAddress)
  const manual = incomingAddress.value.trim()
  if (manual && ValidationUtils.isValidAddress(manual)) set.add(ValidationUtils.normalizeAddress(manual))
  return [...set]
}

/** All of my addresses, awaiting wallet enrichment and on-chain pair discovery. */
export async function resolveMyAddresses(selfAddress?: string | null): Promise<string[]> {
  if (enrichPromise) await enrichPromise.catch(() => {})
  return expandMyAddresses(myAddresses(selfAddress))
}

/** Address to show on payment request links — external funds land on the incoming account. */
export function receiveAddress(selfAddress?: string | null): string | null {
  const manual = incomingAddress.value.trim()
  if (manual && ValidationUtils.isValidAddress(manual)) {
    return ValidationUtils.normalizeAddress(manual)
  }
  const accounts = myAddresses(selfAddress)
  if (selfAddress && accounts.length > 1) {
    const self = compact(selfAddress)
    const other = accounts.find(a => compact(a) !== self)
    if (other) return other
  }
  return selfAddress ?? accounts[0] ?? null
}

async function enrichWalletAddresses(primary: string) {
  try {
    const paired = await discoverPairedAddresses([primary, ...walletAddresses.value])
    if (!paired.length) return
    const set = new Set(walletAddresses.value)
    for (const addr of paired) set.add(addr)
    walletAddresses.value = [...set]
    if (!incomingAddress.value.trim()) {
      const incoming = paired.find(a => compact(a) !== compact(primary)) ?? paired[0]
      incomingAddress.value = incoming
    }
  } catch {
    // best-effort — manual incoming address in Settings still works
  }
}

/** Max payload of a basic transaction's data field. */
export const MESSAGE_MAX_BYTES = 64

export function messageBytes(message: string): number {
  return new TextEncoder().encode(message).length
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function signChallenge(message: string): Promise<{ publicKey: string; signature: string }> {
  const provider = await getProvider()
  if (!provider) throw new Error('Not running inside Nimiq Pay')
  const result = await provider.sign(message)
  if (isErrorResponse(result)) throw new Error(result.error.message)
  return { publicKey: result.publicKey, signature: result.signature }
}

export async function sendNim(recipient: string, amountNim: number, message?: string): Promise<string> {
  const provider = await getProvider()
  if (!provider) throw new Error('Not running inside Nimiq Pay')
  const value = nimToLunas(amountNim)
  const msg = message?.trim()
  const result = msg
    ? await provider.sendBasicTransactionWithData({
        recipient,
        value,
        data: toHex(new TextEncoder().encode(msg)),
      })
    : await provider.sendBasicTransaction({ recipient, value })
  if (isErrorResponse(result)) throw new Error(result.error.message)
  return result
}
