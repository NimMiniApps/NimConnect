import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopIdentityPage from './DesktopIdentityPage.vue'

const mocks = vi.hoisted(() => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
  getDesktopHubAddress: vi.fn(),
  setDesktopHubAddress: vi.fn(),
  clearDesktopHubAddress: vi.fn(),
  findMyHandle: vi.fn(),
  fetchPublicProfile: vi.fn(),
  checkHandle: vi.fn(),
  claimHandleViaHub: vi.fn(),
  syncPublicProfile: vi.fn(),
  saveMyHandle: vi.fn(),
}))

vi.mock('../../services/hub', () => ({
  chooseHubAddress: mocks.chooseHubAddress,
  hubSignMessage: mocks.hubSignMessage,
}))

vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: mocks.getDesktopHubAddress,
  setDesktopHubAddress: mocks.setDesktopHubAddress,
  clearDesktopHubAddress: mocks.clearDesktopHubAddress,
}))

vi.mock('../../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/handles')>()
  return {
    ...actual,
    findMyHandle: mocks.findMyHandle,
    fetchPublicProfile: mocks.fetchPublicProfile,
    checkHandle: mocks.checkHandle,
    claimHandleViaHub: mocks.claimHandleViaHub,
    syncPublicProfile: mocks.syncPublicProfile,
    saveMyHandle: mocks.saveMyHandle,
  }
})

const stubs = {
  QrCode: { template: '<div data-qr-code />' },
  Identicon: { template: '<div data-identicon />' },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

const claim = {
  handle: 'ada',
  address,
  tx_hash: 'tx-hash',
  block_height: 100,
  tx_index: 0,
}

async function mountPage() {
  const wrapper = mount(DesktopIdentityPage, { global: { stubs } })
  await flushPromises()
  return wrapper
}

describe('DesktopIdentityPage', () => {
  beforeEach(() => {
    mocks.chooseHubAddress.mockReset()
    mocks.hubSignMessage.mockReset()
    mocks.getDesktopHubAddress.mockReset().mockReturnValue(null)
    mocks.setDesktopHubAddress.mockReset()
    mocks.clearDesktopHubAddress.mockReset()
    mocks.findMyHandle.mockReset()
    mocks.fetchPublicProfile.mockReset().mockResolvedValue(null)
    mocks.checkHandle.mockReset()
    mocks.claimHandleViaHub.mockReset()
    mocks.syncPublicProfile.mockReset()
    mocks.saveMyHandle.mockReset()
  })

  it('shows the authorize CTA when disconnected', async () => {
    const wrapper = await mountPage()

    const cta = wrapper.find('[data-desktop-identity-connect] button')
    expect(cta.exists()).toBe(true)
    expect(cta.text()).toBe('Authorize identity')
    expect(wrapper.find('[data-desktop-identity-claim]').exists()).toBe(false)
  })

  it('authorizing connects via the Hub and shows the claim form when no claim exists', async () => {
    mocks.chooseHubAddress.mockResolvedValue(address)
    mocks.findMyHandle.mockResolvedValue(null)
    const wrapper = await mountPage()

    await wrapper.find('[data-desktop-identity-connect] button').trigger('click')
    await flushPromises()

    expect(mocks.setDesktopHubAddress).toHaveBeenCalledWith(address)
    expect(mocks.findMyHandle).toHaveBeenCalledWith([address])
    expect(wrapper.find('[data-desktop-identity-claim]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Claim your identity')
  })

  it('recovers an existing claim instead of showing the claim form', async () => {
    mocks.getDesktopHubAddress.mockReturnValue(address)
    mocks.findMyHandle.mockResolvedValue(claim)
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: { display_name: 'Ada Lovelace', bio: 'Computing pioneer' },
    })

    const wrapper = await mountPage()

    expect(mocks.findMyHandle).toHaveBeenCalledWith([address])
    expect(wrapper.find('[data-desktop-identity-claim]').exists()).toBe(false)
    expect(wrapper.find('[data-desktop-identity-edit]').exists()).toBe(true)
    expect(wrapper.find('[data-desktop-identity-preview]').exists()).toBe(true)
    expect((wrapper.find('input[placeholder="Ada"]').element as HTMLInputElement).value).toBe('Ada Lovelace')
    expect(wrapper.text()).toContain('@ada')
    expect(wrapper.text()).toContain('Ada Lovelace')
  })

  it('toggling a visibility switch updates the live preview', async () => {
    mocks.getDesktopHubAddress.mockReturnValue(address)
    mocks.findMyHandle.mockResolvedValue(claim)
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: { display_name: 'Ada Lovelace' },
    })

    const wrapper = await mountPage()

    // Bio was never published, so it starts private even once typed.
    await wrapper.get('textarea[placeholder="A line about you…"]').setValue('Computing pioneer')
    expect(wrapper.find('.desktop-identity__preview-bio').exists()).toBe(false)

    const bioField = wrapper.get('textarea[placeholder="A line about you…"]').element
      .closest('.desktop-identity__field')!
    const bioToggle = bioField.querySelector('.desktop-identity__visibility.is-private')
    expect(bioToggle).toBeTruthy()
    await (bioToggle as HTMLElement).click()
    await flushPromises()

    expect(wrapper.find('.desktop-identity__preview-bio').text()).toBe('Computing pioneer')
  })

  it('publishes via syncPublicProfile using a Hub-backed signer', async () => {
    mocks.getDesktopHubAddress.mockReturnValue(address)
    mocks.findMyHandle.mockResolvedValue(claim)
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: { display_name: 'Ada Lovelace' },
    })
    mocks.syncPublicProfile.mockResolvedValue('published')
    mocks.hubSignMessage.mockResolvedValue({ publicKey: 'pk', signature: 'sig' })

    const wrapper = await mountPage()

    await wrapper.find('[data-desktop-identity-edit]').trigger('submit')
    await flushPromises()

    expect(mocks.syncPublicProfile).toHaveBeenCalledTimes(1)
    const [profileArg, shareArg, walletsArg, signArg] = mocks.syncPublicProfile.mock.calls[0]
    expect(profileArg.address).toBe(address)
    expect(profileArg.name).toBe('Ada Lovelace')
    expect(shareArg.name).toBe(true)
    expect(walletsArg).toEqual([address])

    await signArg('a message')
    expect(mocks.hubSignMessage).toHaveBeenCalledWith('a message', address)

    expect(wrapper.text()).toContain('Public profile published')
  })

  it('claims a handle via the Hub and reveals the edit form', async () => {
    mocks.getDesktopHubAddress.mockReturnValue(address)
    mocks.findMyHandle.mockResolvedValue(null)
    mocks.checkHandle.mockResolvedValue({ available: true })
    mocks.claimHandleViaHub.mockResolvedValue({ status: 'indexed', txHash: 'tx', claim })

    const wrapper = await mountPage()

    await wrapper.get('[data-desktop-identity-claim] input').setValue('ada')
    await vi.waitFor(() => expect(mocks.checkHandle).toHaveBeenCalledWith('ada'), { timeout: 1000 })
    await flushPromises()

    await wrapper.get('[data-desktop-identity-claim] button.nq-button').trigger('click')
    await flushPromises()

    expect(mocks.claimHandleViaHub).toHaveBeenCalledWith('ada', address)
    expect(wrapper.find('[data-desktop-identity-claim]').exists()).toBe(false)
    expect(wrapper.find('[data-desktop-identity-edit]').exists()).toBe(true)
  })

  it('maps a Hub failure to an install/open hint', async () => {
    mocks.chooseHubAddress.mockRejectedValue(new Error('no provider'))
    const wrapper = await mountPage()

    await wrapper.find('[data-desktop-identity-connect] button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Install or open a Nimiq Hub compatible wallet')
  })

  it('maps a Hub popup cancel to a quieter message', async () => {
    mocks.chooseHubAddress.mockRejectedValue(new Error('Request was CANCELED'))
    const wrapper = await mountPage()

    await wrapper.find('[data-desktop-identity-connect] button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Canceled — no changes were made.')
  })

  it('disconnecting clears the session and returns to the authorize CTA', async () => {
    mocks.getDesktopHubAddress.mockReturnValue(address)
    mocks.findMyHandle.mockResolvedValue(claim)
    mocks.fetchPublicProfile.mockResolvedValue(null)

    const wrapper = await mountPage()
    expect(wrapper.find('[data-desktop-identity-edit]').exists()).toBe(true)

    await wrapper.findAll('button').find(b => b.text() === 'Disconnect')!.trigger('click')
    await flushPromises()

    expect(mocks.clearDesktopHubAddress).toHaveBeenCalled()
    expect(wrapper.find('[data-desktop-identity-connect]').exists()).toBe(true)
  })
})
