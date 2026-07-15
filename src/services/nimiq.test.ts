import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectWallet,
  maxSendableNim,
  peekWalletAccounts,
  resetWalletConnection,
  spendAddress,
  walletAddresses,
  walletOwnsSelf,
} from './nimiq'
import { incomingAddress } from './prefs'

const OLD_ACCOUNT = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const NEW_ACCOUNT = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const INCOMING = 'NQ11 1111 1111 1111 1111 1111 1111 1111 1111'
const OUTGOING = 'NQ22 2222 2222 2222 2222 2222 2222 2222 2222'

describe('wallet connection', () => {
  let activeAccount = OLD_ACCOUNT
  let cachedAccount: string[] | undefined
  const disconnect = vi.fn(() => { cachedAccount = undefined })
  const listAccounts = vi.fn(() => Promise.resolve(cachedAccount ??= [activeAccount]))

  beforeEach(() => {
    activeAccount = OLD_ACCOUNT
    cachedAccount = undefined
    disconnect.mockClear()
    listAccounts.mockClear()
    vi.stubGlobal('window', { nimiq: { listAccounts, disconnect } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { data: [] } }),
    }))
    resetWalletConnection()
    disconnect.mockClear()
    incomingAddress.value = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetWalletConnection()
    incomingAddress.value = ''
  })

  it('uses the newly selected Nimiq Pay account after a local reset', async () => {
    await expect(connectWallet()).resolves.toBe(OLD_ACCOUNT)

    resetWalletConnection()
    activeAccount = NEW_ACCOUNT

    await expect(connectWallet()).resolves.toBe(NEW_ACCOUNT)
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('uses the first Nimiq Pay account as the top-up address', async () => {
    listAccounts.mockResolvedValueOnce([NEW_ACCOUNT, OLD_ACCOUNT])

    await expect(connectWallet()).resolves.toBe(NEW_ACCOUNT)

    expect(incomingAddress.value).toBe(NEW_ACCOUNT)
  })
})

describe('spending balance helpers', () => {
  beforeEach(() => {
    resetWalletConnection()
    walletAddresses.value = []
  })

  afterEach(() => {
    resetWalletConnection()
  })

  it('uses the second Nimiq Pay account for sends when paired', () => {
    walletAddresses.value = [INCOMING, OUTGOING]
    expect(spendAddress(INCOMING)).toBe(OUTGOING)
  })

  it('uses the only listed account when Nimiq Pay exposes one wallet', () => {
    walletAddresses.value = [OLD_ACCOUNT]
    expect(spendAddress(OLD_ACCOUNT)).toBe(OLD_ACCOUNT)
  })

  it('reserves a small fee when computing max sendable amount', () => {
    expect(maxSendableNim(1)).toBe(0.99)
    expect(maxSendableNim(0.005)).toBe(0)
  })
})

describe('wallet account ownership', () => {
  it('matches when the self address is one of the connected Nimiq Pay accounts', () => {
    expect(walletOwnsSelf(INCOMING, [INCOMING, OUTGOING])).toBe(true)
    expect(walletOwnsSelf(OUTGOING, [INCOMING, OUTGOING])).toBe(true)
  })

  it('does not match when Nimiq Pay switched to a different wallet', () => {
    expect(walletOwnsSelf(OLD_ACCOUNT, [NEW_ACCOUNT])).toBe(false)
  })

  it('peekWalletAccounts reads the current provider list', async () => {
    const listAccounts = vi.fn().mockResolvedValue([NEW_ACCOUNT, OLD_ACCOUNT])
    vi.stubGlobal('window', { nimiq: { listAccounts, disconnect: vi.fn() } })
    resetWalletConnection()
    await expect(peekWalletAccounts()).resolves.toEqual([NEW_ACCOUNT, OLD_ACCOUNT])
    vi.unstubAllGlobals()
  })
})
