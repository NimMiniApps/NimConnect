import { beforeEach, describe, expect, it, vi } from 'vitest'

const chooseAddress = vi.fn()
const checkout = vi.fn()
const signMessage = vi.fn()
const signTransaction = vi.fn()

vi.mock('@nimiq/hub-api', () => ({
  default: vi.fn().mockImplementation(() => ({ chooseAddress, checkout, signMessage, signTransaction })),
}))

describe('hub service', () => {
  beforeEach(() => {
    vi.resetModules()
    chooseAddress.mockReset()
    checkout.mockReset()
    signMessage.mockReset()
    signTransaction.mockReset()
  })

  it('chooseHubAddress returns the selected address', async () => {
    chooseAddress.mockResolvedValue({ address: 'NQ01 TEST', label: 'Main' })
    const { chooseHubAddress } = await import('./hub')
    await expect(chooseHubAddress()).resolves.toBe('NQ01 TEST')
    expect(chooseAddress).toHaveBeenCalledWith({ appName: 'NimConnect' })
  })

  it('hubSignMessage returns hex publicKey and signature', async () => {
    signMessage.mockResolvedValue({
      signer: 'NQ01 TEST',
      signerPublicKey: new Uint8Array([1, 2]),
      signature: new Uint8Array([3, 4]),
    })
    const { hubSignMessage } = await import('./hub')
    await expect(hubSignMessage('hello', 'NQ01 TEST')).resolves.toEqual({
      publicKey: '0102',
      signature: '0304',
    })
  })

  it('hubCheckoutClaim sends raw binary extraData and value 0', async () => {
    checkout.mockResolvedValue({ hash: 'abcd' })
    const { hubCheckoutClaim } = await import('./hub')
    const extraData = new Uint8Array([0x4e, 0x46, 0x01, 0x01, 0x61])
    await expect(
      hubCheckoutClaim({
        recipient: 'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y',
        extraData,
        sender: 'NQ01 TEST',
      }),
    ).resolves.toEqual({ txHash: 'abcd' })
    expect(checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'NimConnect',
        recipient: 'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y',
        value: 0,
        extraData,
        sender: 'NQ01 TEST',
      }),
    )
  })

  it('hubSignReleaseTransaction signs without broadcasting and returns raw hex + hash', async () => {
    signTransaction.mockResolvedValue({ serializedTx: 'deadbeef', hash: 'release-hash' })
    const { hubSignReleaseTransaction } = await import('./hub')

    await expect(hubSignReleaseTransaction('chuck', 'NQ01 TEST', 42)).resolves.toEqual({
      rawHex: 'deadbeef',
      hash: 'release-hash',
    })
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'NimConnect',
        sender: 'NQ01 TEST',
        value: 0,
        validityStartHeight: 42,
      }),
    )
  })

  it('hubSignClaimTransaction signs without broadcasting and returns raw hex + hash', async () => {
    signTransaction.mockResolvedValue({ serializedTx: 'cafebabe', hash: 'claim-hash' })
    const { hubSignClaimTransaction } = await import('./hub')

    await expect(hubSignClaimTransaction('chuck', 'NQ01 TEST', 42)).resolves.toEqual({
      rawHex: 'cafebabe',
      hash: 'claim-hash',
    })
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'NimConnect',
        sender: 'NQ01 TEST',
        value: 0,
        validityStartHeight: 42,
      }),
    )
  })

  it('hubCheckoutPayment sends text data and the given value', async () => {
    checkout.mockResolvedValue({ hash: 'pay-hash' })
    const { hubCheckoutPayment } = await import('./hub')
    await expect(
      hubCheckoutPayment({ recipient: 'NQ99 ESCROW', valueLuna: 1000, data: 'NME1:abc123', sender: 'NQ01 TEST' }),
    ).resolves.toEqual({ txHash: 'pay-hash' })
    expect(checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'NimConnect',
        recipient: 'NQ99 ESCROW',
        value: 1000,
        extraData: 'NME1:abc123',
        sender: 'NQ01 TEST',
      }),
    )
  })

  it('hubErrorMessage maps a cancellation to a quiet message and anything else to the install hint', async () => {
    const { hubErrorMessage } = await import('./hub')
    expect(hubErrorMessage(new Error('User canceled the request'))).toBe('Canceled — no changes were made.')
    expect(hubErrorMessage(new Error('popup blocked'))).toBe('Install or open a Nimiq Hub compatible wallet')
  })
})
