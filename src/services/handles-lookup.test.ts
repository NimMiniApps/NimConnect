import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { describe, expect, it } from 'vitest'
import { parsePublicLookupQuery } from './handles'

describe('parsePublicLookupQuery', () => {
  it('accepts bare and @-prefixed handles', () => {
    expect(parsePublicLookupQuery('ada')).toEqual({ kind: 'handle', handle: 'ada' })
    expect(parsePublicLookupQuery('@Ada')).toEqual({ kind: 'handle', handle: 'ada' })
  })

  it('accepts spaced Nimiq addresses', () => {
    const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
    expect(parsePublicLookupQuery(address)).toEqual({
      kind: 'address',
      address: ValidationUtils.normalizeAddress(address),
    })
  })

  it('rejects empty and garbage input', () => {
    expect(parsePublicLookupQuery('')).toEqual({ kind: 'invalid' })
    expect(parsePublicLookupQuery('nope!')).toEqual({ kind: 'invalid' })
    expect(parsePublicLookupQuery('ab')).toEqual({ kind: 'invalid' })
  })
})
