import { createNimiqRequestLink, NimiqRequestLinkType } from '@nimiq/utils/request-link-encoding'

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
