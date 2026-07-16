import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('feel polish wiring', () => {
  it('celebrates handle claim, first public profile, bucket complete, and first split', () => {
    expect(read('components/ClaimHandleSheet.vue')).toMatch(/celebrate\(/)
    expect(read('pages/ProfileFormPage.vue')).toMatch(/first-public-profile/)
    expect(read('components/BucketSheet.vue')).toMatch(/first-bucket-complete/)
    expect(read('components/SplitBillSheet.vue')).toMatch(/first-split/)
  })

  it('animates split amounts and favorite stars', () => {
    expect(read('components/SplitBillSheet.vue')).toMatch(/amount-pop/)
    expect(read('components/ProfileView.vue')).toMatch(/star-pop|onFavoriteToggle/)
    expect(read('components/ProfileRow.vue')).toMatch(/star-pop/)
  })

  it('uses skeletons for home and profile loading', () => {
    expect(read('pages/HomePage.vue')).toMatch(/incoming-skeleton|skeleton-row/)
    expect(read('assets/main.css')).toMatch(/skeleton-shimmer/)
    expect(read('components/ProfileView.vue')).toMatch(/activity-skeleton/)
  })
})
