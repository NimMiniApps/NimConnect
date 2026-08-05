import { describe, expect, it } from 'vitest'
import {
  CREATE_PROFILE_URL,
  NIMPAY_CREATE_PROFILE_URL,
  NIMPAY_OPEN_URL,
} from './host-app'

describe('create-profile links', () => {
  it('exposes the canonical browser create-profile URL', () => {
    expect(CREATE_PROFILE_URL).toBe(
      'https://nimconnect.nimiqminiapps.com/#/create-profile',
    )
  })

  it('exposes the canonical Nimiq Pay create-profile URL', () => {
    expect(NIMPAY_CREATE_PROFILE_URL).toBe(`${NIMPAY_OPEN_URL}#/create-profile`)
  })
})
