import { ref } from 'vue'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { nimToLunas } from './links'
import { expandMyAddresses } from './history'
import { incomingAddress } from './prefs'

const RPC_URL = 'https://rpc-mainnet.nimiqscan.com/'
const LUNAS_PER_NIM = 100_000
/** Reserve for network fee when filling "Max" — actual fee is usually lower. */
export const SEND_FEE_RESERVE_NIM = 0.01

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
  // NimiqProvider memoizes listAccounts(). Reset its cache as well as ours so
  // switching accounts in Nimiq Pay cannot keep the previous wallet's history.
  const injectedProvider = typeof window !== 'undefined' ? window.nimiq : undefined
  injectedProvider?.disconnect()
  const previousProviderPromise = providerPromise
  providerPromise = null
  void previousProviderPromise?.then(provider => {
    if (provider && provider !== injectedProvider) provider.disconnect()
  })
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

/** Fresh listAccounts() — bypasses the per-session connectWallet cache. */
export async function peekWalletAccounts(): Promise<string[]> {
  const provider = await getProvider()
  if (!provider) return []
  try {
    const result = await withTimeout(provider.listAccounts(), 30_000)
    return parseAccounts(result)
  } catch {
    return []
  }
}

/** True when Nimiq Pay's connected accounts include the stored self profile address. */
export function walletOwnsSelf(selfAddress: string, accounts: string[]): boolean {
  if (!accounts.length) return false
  const mine = new Set(accounts.map(compact))
  return mine.has(compact(selfAddress))
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
      // Nimiq Pay lists the account's top-up (receiving) address first.
      // Prefer it for payment requests unless the user explicitly configured
      // a different address in Settings.
      if (!incomingAddress.value.trim()) incomingAddress.value = accounts[0]
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

/** Nimiq Pay sends from the outgoing account when paired with a separate incoming one. */
export function spendAddress(selfAddress?: string | null): string | null {
  const accounts = walletAddresses.value
  if (accounts.length >= 2) return accounts[1]
  return accounts[0] ?? selfAddress ?? null
}

export function lunasToNim(lunas: number): number {
  return lunas / LUNAS_PER_NIM
}

export function formatNimAmount(nim: number): string {
  return nim.toLocaleString(undefined, { maximumFractionDigits: 5 })
}

/** Largest send amount that leaves room for the network fee. */
export function maxSendableNim(balanceNim: number): number {
  const max = balanceNim - SEND_FEE_RESERVE_NIM
  if (max <= 0) return 0
  return Math.floor(max * LUNAS_PER_NIM) / LUNAS_PER_NIM
}

interface ChainAccountBalance {
  balance?: number
}

async function fetchAccountBalanceLunas(address: string): Promise<number | null> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountByAddress',
      params: [address],
    }),
  })
  if (!res.ok) return null
  const body = await res.json()
  const acc = (body.result?.data ?? body.result) as ChainAccountBalance | null
  if (!acc || typeof acc.balance !== 'number') return null
  return acc.balance
}

/** On-chain balance of the Nimiq Pay spending account (NIM). */
export async function getSpendableBalanceNim(selfAddress?: string | null): Promise<number | null> {
  const addr = spendAddress(selfAddress)
  if (!addr) return null
  const lunas = await fetchAccountBalanceLunas(addr)
  return lunas == null ? null : lunasToNim(lunas)
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
  // The Mini App provider does not expose a top-up address. It cannot be
  // inferred safely from public transfers, so Settings is the explicit source
  // of truth when Nimiq Pay only exposes one wallet address.
  void primary
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
  if (!ValidationUtils.isValidAddress(recipient)) {
    throw new Error('Invalid recipient address')
  }
  const to = ValidationUtils.normalizeAddress(recipient)
  const value = nimToLunas(amountNim)
  const msg = message?.trim()
  if (msg && messageBytes(msg) > MESSAGE_MAX_BYTES) {
    throw new Error(`Message too long (${messageBytes(msg)} / ${MESSAGE_MAX_BYTES} bytes)`)
  }
  const dataHex = msg ? toHex(new TextEncoder().encode(msg)) : undefined
  const result = dataHex
    ? await provider.sendBasicTransactionWithData({ recipient: to, value, data: dataHex })
    : await provider.sendBasicTransaction({ recipient: to, value })
  if (isErrorResponse(result)) {
    // Surface the FULL SDK error plus the exact call we made — Pay's
    // one-line messages hide the real rejection reason.
    const debug = {
      call: dataHex ? 'sendBasicTransactionWithData' : 'sendBasicTransaction',
      recipient: to,
      value,
      dataHex,
      dataBytes: dataHex ? dataHex.length / 2 : 0,
      sdkError: result.error,
    }
    console.error('[nimconnect] sendNim rejected', debug)
    const err = new Error(result.error.message) as Error & { debug?: unknown }
    err.debug = debug
    throw err
  }
  return result
}
