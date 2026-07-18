import { beforeEach, describe, expect, it, vi } from 'vitest'

const chooseAddress = vi.fn()
const checkout = vi.fn()
const signMessage = vi.fn()

vi.mock('@nimiq/hub-api', () => ({
  default: vi.fn().mockImplementation(() => ({ chooseAddress, checkout, signMessage })),
}))

describe('hub service', () => {
  beforeEach(() => {
    vi.resetModules()
    chooseAddress.mockReset()
    checkout.mockReset()
    signMessage.mockReset()
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
})
