import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'SettingsPage.vue'), 'utf-8')

describe('SettingsPage polish', () => {
  it('uses preferred currency wording and incoming copy/QR actions', () => {
    expect(source).toMatch(/Preferred currency/)
    expect(source).not.toMatch(/Enter amounts in/)
    expect(source).toMatch(/Copy/)
    expect(source).toMatch(/Show QR/)
    expect(source).toMatch(/copyIncomingAddress/)
  })

  it('groups cloud vs local backup and shows a status card', () => {
    expect(source).toMatch(/Cloud backup/)
    expect(source).toMatch(/Local backup/)
    expect(source).toMatch(/status-badge/)
    expect(source).toMatch(/Not enabled/)
    expect(source).not.toMatch(/'Off'/)
    expect(source).toMatch(/Last backup/)
  })

  it('surfaces privacy reassurance and renames erase data', () => {
    expect(source).toMatch(/🛡 Privacy/)
    expect(source).toMatch(/Contacts stay on this device/)
    expect(source).toMatch(/Notes are never public/)
    expect(source).toMatch(/Erase local data/)
    expect(source).toMatch(/Public profiles and blockchain data are not affected/)
    expect(source).not.toMatch(/Reset app/)
  })

  it('exposes license, version, build date, and git commit', () => {
    expect(source).toMatch(/MIT/)
    expect(source).toMatch(/__APP_VERSION__/)
    expect(source).toMatch(/__BUILD_DATE__/)
    expect(source).toMatch(/__GIT_COMMIT__/)
  })
})
