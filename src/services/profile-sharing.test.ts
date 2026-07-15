import { describe, expect, it } from 'vitest'
import { profileShareActions } from './profile-sharing'

describe('profileShareActions', () => {
  it('keeps the public-page action out until a claimed URL exists', () => {
    expect(profileShareActions('https://nimconnect.app/add?profile=x')).toEqual([
      { kind: 'profile', link: 'https://nimconnect.app/add?profile=x', title: 'NimConnect profile', label: 'Share profile link' },
    ])
  })

  it('offers the claimed public page alongside the profile link', () => {
    const actions = profileShareActions('https://nimconnect.app/add?profile=x', 'https://nimconnect.app/@alice?tx=abc')
    expect(actions).toHaveLength(2)
    expect(actions[1]).toMatchObject({ kind: 'public', link: 'https://nimconnect.app/@alice?tx=abc', label: 'Share public page' })
  })
})
