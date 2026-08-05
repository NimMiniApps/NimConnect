import { beforeEach, describe, expect, it } from 'vitest'
import { router } from './router'

describe('create-profile route', () => {
  beforeEach(async () => {
    await router.replace('/')
  })

  it('forwards to the existing profile claim flow', async () => {
    await router.push('/create-profile')

    expect(router.currentRoute.value.fullPath).toBe('/me?sheet=claim')
  })
})
