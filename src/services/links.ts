import { ValidationUtils } from '@nimiq/utils/validation-utils'
import {
  createNimiqRequestLink,
  Currency,
  NimiqRequestLinkType,
  parseRequestLink,
} from '@nimiq/utils/request-link-encoding'

export interface ParsedPaymentRequest {
  recipient: string
  amountNim?: number
  message?: string
  label?: string
}

/** Parse a Nimiq address or payment request link (nimiq: URI, wallet safe link, etc.). */
export function parsePaymentRequest(text: string): ParsedPaymentRequest | null {
  const trimmed = text.trim()
  if (!trimmed) return null

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
}

/** Classify scanned QR / pasted text for pay vs profile actions. */
export function classifyScan(text: string): ScanIntent | null {
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
