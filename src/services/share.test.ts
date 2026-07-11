import { describe, it, expect, vi, afterEach } from 'vitest'
import { shareOrCopy, canShare } from './share'

afterEach(() => vi.unstubAllGlobals())

describe('shareOrCopy', () => {
  it('uses navigator.share url field for HTTPS links', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    expect(await shareOrCopy('https://nimpay.app/miniapps/open/example.com#/pay?r=x', 'Payment request')).toBe('shared')
    expect(share).toHaveBeenCalledWith({
      title: 'Payment request',
      url: 'https://nimpay.app/miniapps/open/example.com#/pay?r=x',
    })
  })

  it('uses navigator.share when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    expect(canShare()).toBe(true)
    expect(await shareOrCopy('nimiq:NQ07...', 'Payment request')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'Payment request', text: 'nimiq:NQ07...' })
  })

  it('treats a dismissed share sheet as done', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' })),
      clipboard: { writeText },
    })
    expect(await shareOrCopy('link')).toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when share is missing or fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await shareOrCopy('link')).toBe('copied')

    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new TypeError('unsupported')),
      clipboard: { writeText },
    })
    expect(await shareOrCopy('link')).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('copies via execCommand when navigator.clipboard is missing (plain HTTP)', async () => {
    const ta = { value: '', style: {}, select: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(ta),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn().mockReturnValue(true),
    })
    expect(await shareOrCopy('nimiq:NQ07...')).toBe('copied')
    expect(ta.value).toBe('nimiq:NQ07...')
    expect(ta.remove).toHaveBeenCalled()
  })
})
