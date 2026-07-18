import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDesktopHubAddress,
  getDesktopHubAddress,
  setDesktopHubAddress,
} from './desktop-session'

describe('desktop-session', () => {
  beforeEach(() => {
    clearDesktopHubAddress()
  })

  it('stores and clears a single connected Hub address', () => {
    expect(getDesktopHubAddress()).toBeNull()
    setDesktopHubAddress('NQ01 TEST ADDRESS HERE XXXX')
    expect(getDesktopHubAddress()).toBe('NQ01 TEST ADDRESS HERE XXXX')
    clearDesktopHubAddress()
    expect(getDesktopHubAddress()).toBeNull()
  })
})
