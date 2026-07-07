import { useProfilesStore } from '../stores/profiles'

const DAY = 86_400_000

/** Realistic demo contacts; addresses are checksum-valid but unowned. */
const SAMPLES = [
  { address: 'NQ22 5VGT NCG9 BQFY 41JM 2169 UFC2 AFNN KE98', name: 'Alice Weber', type: 'person', tags: ['family'], notes: 'Sister — pays back lunch in NIM.', favorite: true, daysAgo: 1 },
  { address: 'NQ86 XG1S V6JQ T9QU BQB4 7L8X XYPY C1G4 770B', name: "Bruno's Coffee", type: 'merchant', tags: ['coffee', 'merchant'], notes: 'Flat white, pays with QR at the counter.', favorite: true, daysAgo: 2 },
  { address: 'NQ59 CLHJ TRP5 94NY TLC8 6VTH 3LF1 PERQ NEN4', name: 'Carlos Dev', type: 'person', tags: ['work', 'developer'], notes: 'Met at the Nimiq meetup in Costa Rica.', favorite: false, daysAgo: 6 },
  { address: 'NQ74 T5FY MJV4 MR8S PBFC 3T1Q P2FS 6GMB 36XQ', name: 'Book Club Fund', type: 'other', tags: ['friends'], notes: 'Shared pot for the monthly book order.', favorite: false },
  { address: 'NQ46 FKVH YLCB DQY3 3HVE UB2D FVL5 VV44 4A3T', name: 'Grün Charity', type: 'business', tags: ['charity'], notes: 'Monthly donation on the 1st.', favorite: false },
  { address: 'NQ34 GHGD K485 JVVS QXD5 1D45 HBD9 BQEM 55XL', name: 'Maya Ortiz', type: 'person', tags: ['friends'], notes: 'Splits the padel court fee.', favorite: false, daysAgo: 12 },
] as const

/** Adds the sample contacts, skipping any address that already exists. */
export async function loadSampleContacts(): Promise<number> {
  const store = useProfilesStore()
  let added = 0
  for (const s of SAMPLES) {
    try {
      const p = await store.add({
        address: s.address,
        name: s.name,
        type: s.type,
        tags: [...s.tags],
        notes: s.notes,
        favorite: s.favorite,
      })
      if ('daysAgo' in s && s.daysAgo !== undefined) {
        await store.update(p.id, { lastInteractionAt: Date.now() - s.daysAgo * DAY })
      }
      added++
    } catch {
      // duplicate — already seeded
    }
  }
  return added
}
