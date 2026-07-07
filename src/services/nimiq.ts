import { ref } from 'vue'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { nimToLunas } from './links'

let providerPromise: Promise<NimiqProvider | null> | null = null
let addressPromise: Promise<string | null> | null = null

/** Reactive status for UI — 'connecting' while awaiting Nimiq Pay approval. */
export const walletStatus = ref<'idle' | 'connecting' | 'ready' | 'unavailable'>('idle')

export function resetWalletConnection() {
  addressPromise = null
  walletStatus.value = 'idle'
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
  if (typeof window !== 'undefined' && window.nimiq) {
    return Promise.resolve(window.nimiq)
  }
  providerPromise ??= init({ timeout: 10_000 }).catch(() => null)
  return providerPromise
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
        walletStatus.value = 'unavailable'
        return null
      }
      const result = await withTimeout(provider.listAccounts(), 120_000)
      const accounts = parseAccounts(result)
      if (!accounts.length) {
        walletStatus.value = 'unavailable'
        return null
      }
      walletStatus.value = 'ready'
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

/** Max payload of a basic transaction's data field. */
export const MESSAGE_MAX_BYTES = 64

export function messageBytes(message: string): number {
  return new TextEncoder().encode(message).length
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
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
