import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import QrCode from './QrCode.vue'
import qrCodeSource from './QrCode.vue?raw'

describe('QrCode', () => {
  it('renders with the requested intrinsic size', async () => {
    const wrapper = mount(QrCode, { props: { text: 'nimiq:NQ00', size: 260 } })
    await vi.waitUntil(() => wrapper.find('img.qr').exists())
    const img = wrapper.find('img.qr')
    expect(img.attributes('width')).toBe('260')
    expect(img.attributes('height')).toBe('260')
  })

  it('scales down responsively instead of overflowing narrow containers', () => {
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?max-width:\s*100%;/)
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?height:\s*auto;/)
  })

  it('keeps a white background from a real token, regardless of theme', () => {
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?background:\s*var\(--nimiq-white\);/)
    expect(qrCodeSource).not.toMatch(/background:\s*#fff/)
  })
})
