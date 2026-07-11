/** Native share sheet (WhatsApp, Telegram, …) with clipboard fallback. */

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/**
 * Share via the system sheet when available, otherwise copy to the clipboard.
 * Links are sent as `text` — share targets reject non-http URLs like `nimiq:`.
 * Returns 'shared' | 'copied' so callers can show the right feedback.
 */
function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}

export async function shareOrCopy(text: string, title?: string): Promise<'shared' | 'copied'> {
  if (canShare()) {
    try {
      const trimmed = text.trim()
      await navigator.share({
        ...(title ? { title } : {}),
        ...(isHttpUrl(trimmed) ? { url: trimmed } : { text: trimmed }),
      })
      return 'shared'
    } catch (e) {
      // User closed the sheet — done, don't copy on top of it
      if ((e as Error).name === 'AbortError') return 'shared'
      // Anything else (unsupported data, permission): fall through to copy
    }
  }
  await copyText(text)
  return 'copied'
}

/** navigator.clipboard is secure-context-only — fall back to execCommand on plain HTTP. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy-failed')
  } finally {
    ta.remove()
  }
}
