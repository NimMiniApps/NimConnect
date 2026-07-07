import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { nimToLunas } from './links'

let providerPromise: Promise<NimiqProvider | null> | null = null

/** Resolves the provider once; null when running outside Nimiq Pay. */
export function getProvider(): Promise<NimiqProvider | null> {
  providerPromise ??= init({ timeout: 3000 }).catch(() => null)
  return providerPromise
}

function isErrorResponse(r: unknown): r is { error: { type: string; message: string } } {
  return typeof r === 'object' && r !== null && 'error' in r
}

export async function getMyAddress(): Promise<string | null> {
  const provider = await getProvider()
  if (!provider) return null
  const accounts = await provider.listAccounts()
  if (isErrorResponse(accounts) || !accounts.length) return null
  return accounts[0]
}

export async function sendNim(recipient: string, amountNim: number): Promise<string> {
  const provider = await getProvider()
  if (!provider) throw new Error('Not running inside Nimiq Pay')
  const result = await provider.sendBasicTransaction({ recipient, value: nimToLunas(amountNim) })
  if (isErrorResponse(result)) throw new Error(result.error.message)
  return result
}
