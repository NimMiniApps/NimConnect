import { ValidationUtils } from '@nimiq/utils/validation-utils'
import {
  createNimiqRequestLink,
  Currency,
  NimiqRequestLinkType,
  parseRequestLink,
} from '@nimiq/utils/request-link-encoding'
import { parseProfileShare, type SharedProfile } from './profile-share'

export interface ParsedPaymentRequest {
  recipient: string
  amountNim?: number
  message?: string
  label?: string
}

/** Public app origin for share links (runtime when in browser). */
export function appOrigin(): string {
  if (typeof window !== 'undefined') {
    const base = import.meta.env.BASE_URL ?? '/'
    const origin = `${window.location.origin}${base}`.replace(/\/+$/, '')
    return origin || window.location.origin
  }
  const domain = import.meta.env.VITE_NIMPAY_MINIAPP_DOMAIN ?? 'nimconnect.nimiqminiapps.com'
  return `https://${domain}`
}

/** HTTPS deep link that opens NimConnect on the add-contact form. */
export function makeAppAddLink(address: string): string {
  const normalized = ValidationUtils.isValidAddress(address)
    ? ValidationUtils.normalizeAddress(address)
    : address.trim()
  return `${appOrigin()}#/add?address=${encodeURIComponent(normalized)}`
}

function parseAppAddLink(text: string): ParsedPaymentRequest | null {
  const hashMatch = text.match(/#\/?add(?:\?|.*?&)address=([^&#]+)/i)
  if (hashMatch) {
    const addr = decodeURIComponent(hashMatch[1])
    if (ValidationUtils.isValidAddress(addr)) {
      return { recipient: ValidationUtils.normalizeAddress(addr) }
    }
  }
  try {
    const url = new URL(text)
    const fromHash = url.hash.match(/#\/?add(?:\?|.*?&)address=([^&#]+)/i)
    if (fromHash) {
      const addr = decodeURIComponent(fromHash[1])
      if (ValidationUtils.isValidAddress(addr)) {
        return { recipient: ValidationUtils.normalizeAddress(addr) }
      }
    }
  } catch {
    // not a URL
  }
  return null
}

/** Parse a Nimiq address or payment request link (nimiq: URI, wallet safe link, etc.). */
export function parsePaymentRequest(text: string): ParsedPaymentRequest | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const appLink = parseAppAddLink(trimmed)
  if (appLink) return appLink

  if (ValidationUtils.isValidAddress(trimmed)) {
    return { recipient: ValidationUtils.normalizeAddress(trimmed) }
  }

  const parsed = parseRequestLink(trimmed, { currencies: [Currency.NIM] })
  if (!parsed || parsed.currency !== Currency.NIM || !parsed.recipient) return null

  return {
    recipient: parsed.recipient,
    ...(parsed.amount != null ? { amountNim: parsed.amount / 1e5 } : {}),
    ...(parsed.message ? { message: parsed.message } : {}),
    ...(parsed.label ? { label: parsed.label } : {}),
  }
}

export type ScanRequestType = 'split' | 'invoice' | 'request' | 'profile'

export interface ScanIntent extends ParsedPaymentRequest {
  requestType: ScanRequestType
  hasAmount: boolean
  sharedProfile?: SharedProfile
}

/** Classify scanned QR / pasted text for pay vs profile actions. */
export function classifyScan(text: string): ScanIntent | null {
  const shared = parseProfileShare(text)
  if (shared) {
    return {
      recipient: shared.address,
      requestType: 'profile',
      hasAmount: false,
      sharedProfile: shared,
    }
  }

  const parsed = parsePaymentRequest(text)
  if (!parsed) return null

  const message = parsed.message ?? ''
  const hasAmount = parsed.amountNim != null && parsed.amountNim > 0
  let requestType: ScanRequestType = 'profile'

  if (hasAmount || message.trim()) {
    if (/^split/i.test(message)) requestType = 'split'
    else if (/invoice/i.test(message)) requestType = 'invoice'
    else requestType = 'request'
  }

  return { ...parsed, requestType, hasAmount }
}

export function nimToLunas(nim: number): number {
  return Math.round(nim * 1e5)
}

export function makeRequestLink(address: string, amountNim?: number, message?: string): string {
  return createNimiqRequestLink(address, {
    type: NimiqRequestLinkType.URI,
    ...(amountNim ? { amount: nimToLunas(amountNim) } : {}),
    ...(message?.trim() ? { message: message.trim() } : {}),
  })
}

export function shortAddress(address: string): string {
  const parts = address.split(' ')
  if (parts.length < 9) return address
  return `${parts[0]} ${parts[1]}…${parts[8]}`
}

export function transactionExplorerUrl(hash: string): string {
  return `https://nimiqscan.com/transaction/${encodeURIComponent(hash)}`
}
