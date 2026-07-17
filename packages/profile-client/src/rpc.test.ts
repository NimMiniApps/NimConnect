import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildHandleClaimPayload, HANDLE_REGISTRY_ADDRESS } from './claim'
import { fetchHandleRegistry, DEFAULT_RPC_URL } from './rpc'

afterEach(() => {
  vi.unstubAllGlobals()
})

function claimTxHex(handle: string): string {
  const { extraData } = buildHandleClaimPayload(handle)
  return Array.from(extraData, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

// Routes JSON-RPC POSTs by method name, envelope-wraps results like the real gateway does.
function mockRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string)
    const handler = handlers[method]
    const result = handler ? handler(params) : null
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: result, metadata: null } }) }
  })
}

describe('fetchHandleRegistry', () => {
  it('fetches the registry address history and resolves basic claims', async () => {
    const fetchMock = mockRpc({
      getTransactionsByAddress: ([address]) => {
        expect(address).toBe(HANDLE_REGISTRY_ADDRESS)
        return [
          { hash: 't1', sender: 'NQ11 OWNER', recipient: HANDLE_REGISTRY_ADDRESS, data: claimTxHex('chuck'), blockNumber: 5, transactionIndex: 0 },
        ]
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const registry = await fetchHandleRegistry({ rpcUrl: 'https://my-rpc.example' })
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
    expect(fetchMock).toHaveBeenCalledWith('https://my-rpc.example', expect.any(Object))
  })

  it('defaults to DEFAULT_RPC_URL and HANDLE_REGISTRY_ADDRESS', async () => {
    const fetchMock = mockRpc({ getTransactionsByAddress: () => [] })
    vi.stubGlobal('fetch', fetchMock)
    await fetchHandleRegistry()
    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_RPC_URL, expect.any(Object))
  })

  it('filters out outbound transactions from the registry address', async () => {
    const fetchMock = mockRpc({
      getTransactionsByAddress: () => [
        { hash: 't1', sender: HANDLE_REGISTRY_ADDRESS, recipient: 'NQ99 SOMEONE', data: claimTxHex('chuck'), blockNumber: 5, transactionIndex: 0 },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)
    const registry = await fetchHandleRegistry()
    expect(registry.size).toBe(0)
  })

  it('resolves HTLC-routed claims via a live account lookup', async () => {
    const fetchMock = mockRpc({
      getTransactionsByAddress: ([address]) =>
        address === HANDLE_REGISTRY_ADDRESS
          ? [
              {
                hash: 't1',
                sender: 'NQ03 HTLC 0000',
                recipient: HANDLE_REGISTRY_ADDRESS,
                data: claimTxHex('chuck'),
                blockNumber: 5,
                transactionIndex: 0,
                fromType: 2,
              },
            ]
          : [],
      getAccountByAddress: () => ({ type: 'htlc', sender: 'NQ23 REAL OWNER' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const registry = await fetchHandleRegistry()
    expect(registry.get('chuck')?.address).toBe('NQ23 REAL OWNER')
  })

  it('falls back to creation-tx data when the HTLC account has no sender field', async () => {
    // Same fixture as backend/handles_test.go's TestHTLCOwnerFromCreationData.
    const creationData =
      '91c5d65cbf079159b61d72bfca4ff1f5fd063227a70b9e44a448b5183ac4e186cd749d3d889fff840100000000000000000000000000000000000000'
    const fetchMock = mockRpc({
      getTransactionsByAddress: ([address]) =>
        address === HANDLE_REGISTRY_ADDRESS
          ? [
              {
                hash: 't1',
                sender: 'NQ03 HTLC 0000',
                recipient: HANDLE_REGISTRY_ADDRESS,
                data: claimTxHex('chuck'),
                blockNumber: 5,
                transactionIndex: 0,
                fromType: 2,
              },
            ]
          : [
              {
                hash: 'creation',
                sender: 'NQ99 FUNDER',
                recipient: 'NQ03 HTLC 0000',
                toType: 2,
                data: creationData,
                blockNumber: 1,
                transactionIndex: 0,
              },
            ],
      getAccountByAddress: () => ({ type: 'htlc', sender: '' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const registry = await fetchHandleRegistry()
    expect(registry.get('chuck')?.address).toBe('NQ34 J72V CP5Y 0X8M KDGV EAYU LKYH XPXG CCH7')
  })

  it('surfaces RPC errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'boom' } }) }),
    )
    await expect(fetchHandleRegistry()).rejects.toThrow(/boom/)
  })
})
