import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'BucketSheet.vue'), 'utf-8')

function indexOf(marker: string): number {
  const i = source.indexOf(marker)
  expect(i, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('BucketSheet create + success clarity', () => {
  it('explains what a trip bucket is on the create form', () => {
    expect(source).toMatch(/Collect money for a shared trip/)
  })

  it('uses plain-language share instructions on the success screen', () => {
    expect(source).toMatch(/Share this QR or link/)
    expect(source).toMatch(/automatically added to this bucket/)
    expect(source).not.toMatch(/Share this code so contributions are tagged/)
  })

  it('makes the bucket name the success hero', () => {
    expect(source).toMatch(/class="ready-name"/)
    expect(source).toMatch(/createdBucket\.name/)
    expect(source).not.toMatch(/\{\{\s*createdBucket\.name\s*\}\} is ready/)
  })

  it('shows a compact progress card with a bar on the success screen', () => {
    expect(source).toMatch(/ready-progress/)
    expect(source).toMatch(/createdProgressLabel|collected/)
    expect(source).toMatch(/ready-progress-bar/)
    expect(source).not.toMatch(/>Target</)
  })

  it('places Share link before the success QR for mobile-first sharing', () => {
    const successStart = indexOf('v-else-if="createdBucket"')
    const share = source.indexOf('ready-share', successStart)
    const qr = source.indexOf('<QrCode', successStart)
    expect(share).toBeGreaterThan(successStart)
    expect(qr).toBeGreaterThan(share)
  })

  it('celebrates successful creation with a subtle ready animation', () => {
    expect(source).toMatch(/ready-celebrate|ready-pop/)
    expect(source).toMatch(/@keyframes\s+ready-pop|animation:[^;]*ready-pop/)
  })

  it('labels success share as Share link and detail share as Share bucket', () => {
    expect(source).toMatch(/Share link/)
    expect(source).toMatch(/Share bucket/)
  })

  it('makes the NimConnect invite distinct and shows a contact count when available', () => {
    expect(source).toMatch(/Send to NimConnect contacts/)
    expect(source).toMatch(/inviteable\.length|contacts/)
  })
})

describe('BucketSheet detail dashboard hierarchy', () => {
  it('makes the bucket name the prominent sheet title with Shared Trip as metadata', () => {
    expect(source).toMatch(/prominent-title|prominentTitle|sheetTitleProminent/)
    expect(source).toMatch(/props\.bucket\.name/)
    expect(source).toMatch(/Shared Trip/)
    expect(source).not.toMatch(/class="detail-name"/)
  })

  it('merges collected progress into one block with labels and a bar', () => {
    expect(source).toMatch(/Collected/)
    expect(source).toMatch(/detail-hero/)
    expect(source).toMatch(/detail-progress-bar/)
    expect(source).toMatch(/progress-meta/)
    expect(source).toMatch(/Math\.round\(progress\)/)
    expect(source).not.toMatch(/detail-goal/)
  })

  it('makes Share bucket the primary detail action and Show QR secondary', () => {
    expect(source).toMatch(/detailShareLabel|Share bucket/)
    expect(source).toMatch(/primary detail-share/)
    const detailStart = indexOf('v-else-if="bucket"')
    const shareBtn = source.indexOf('detail-share', detailStart)
    const showQr = source.indexOf('Show QR', detailStart)
    expect(shareBtn).toBeGreaterThan(detailStart)
    expect(showQr).toBeGreaterThan(shareBtn)
  })

  it('presents invite contacts as its own card without per-row Send buttons', () => {
    expect(source).toMatch(/Invite NimConnect contacts/)
    expect(source).toMatch(/invite-card|detail-card/)
    expect(source).toMatch(/Send requests/)
    const inviteStart = indexOf('Invite NimConnect contacts')
    const inviteEnd = source.indexOf('Recent contributions', inviteStart)
    const inviteBlock = source.slice(inviteStart, inviteEnd)
    expect(inviteBlock).not.toMatch(/class="send-one"/)
    expect(inviteBlock).toMatch(/soft-check/)
    expect(inviteBlock).toMatch(/:size="44"/)
  })

  it('shows a confirmation after sending NimConnect contact requests', () => {
    expect(source).toMatch(/Requests sent to/)
    expect(source).toMatch(/inviteSentNotice/)
  })

  it('groups management into Bucket settings and hides manual add under Advanced', () => {
    expect(source).toMatch(/Bucket settings/)
    expect(source).toMatch(/>Advanced</)
    expect(source).toMatch(/Add manual contribution/)
    expect(source).toMatch(/settings-divider/)
  })

  it('styles Delete as filled dangerous text', () => {
    expect(source).toMatch(/settings-danger/)
    expect(source).toMatch(/Delete bucket/)
    expect(source).toMatch(/\.settings-danger[\s\S]*?color:\s*var\(--nq-red\)/)
    expect(source).toMatch(/\.settings-danger[\s\S]*?background:\s*transparent/)
  })

  it('uses a warmer empty contributions state', () => {
    expect(source).toMatch(/No contributions yet/)
    expect(source).toMatch(/Share your bucket with friends to start collecting toward your goal/)
  })
})
