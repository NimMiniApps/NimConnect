import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { db } from '../db/db'
import type { ExportDocument, Profile, ProfileType } from '../types/profile'

export interface NewProfile {
  address: string
  name: string
  notes?: string
  tags?: string[]
  favorite?: boolean
  type?: ProfileType
}

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref<Profile[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    profiles.value = await db.profiles.toArray()
    loaded.value = true
  }

  function getById(id: string): Profile | undefined {
    return profiles.value.find(p => p.id === id)
  }

  function getByAddress(address: string): Profile | undefined {
    return profiles.value.find(p => p.address === address)
  }

  function normalize(address: string): string {
    if (!ValidationUtils.isValidAddress(address)) throw new Error('invalid-address')
    return ValidationUtils.normalizeAddress(address)
  }

  async function add(input: NewProfile): Promise<Profile> {
    const address = normalize(input.address)
    if (profiles.value.some(p => p.address === address)) throw new Error('duplicate-address')
    const now = Date.now()
    const profile: Profile = {
      id: crypto.randomUUID(),
      address,
      name: input.name.trim(),
      type: input.type ?? 'person',
      isSelf: false,
      notes: input.notes ?? '',
      tags: [...(input.tags ?? [])],
      favorite: input.favorite ?? false,
      createdAt: now,
      updatedAt: now,
    }
    await db.profiles.add(profile)
    profiles.value.push(profile)
    return profile
  }

  function plainProfile(p: Profile): Profile {
    return JSON.parse(JSON.stringify(p)) as Profile
  }

  async function update(id: string, patch: Partial<Profile>) {
    const existing = getById(id)
    if (!existing) return
    if (patch.address && patch.address !== existing.address) {
      const address = normalize(patch.address)
      if (profiles.value.some(p => p.address === address && p.id !== id)) throw new Error('duplicate-address')
      patch = { ...patch, address }
    }
    const updated: Profile = plainProfile({ ...existing, ...patch, id, updatedAt: Date.now() })
    await db.profiles.put(updated)
    profiles.value = profiles.value.map(p => (p.id === id ? updated : p))
  }

  async function remove(id: string) {
    await db.profiles.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
  }

  async function toggleFavorite(id: string) {
    const p = getById(id)
    if (p) await update(id, { favorite: !p.favorite })
  }

  async function touchInteraction(id: string) {
    await update(id, { lastInteractionAt: Date.now() })
  }

  async function ensureSelf(address: string): Promise<Profile> {
    const existing = profiles.value.find(p => p.isSelf)
    if (existing) return existing
    const normalized = normalize(address)
    const byAddress = profiles.value.find(p => p.address === normalized)
    if (byAddress) {
      await update(byAddress.id, { isSelf: true } as Partial<Profile>)
      return getById(byAddress.id)!
    }
    const now = Date.now()
    const self: Profile = {
      id: crypto.randomUUID(),
      address: normalized,
      name: 'Me',
      type: 'person',
      isSelf: true,
      notes: '',
      tags: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.profiles.add(self)
    profiles.value.push(self)
    return self
  }

  const self = computed(() => profiles.value.find(p => p.isSelf) ?? null)
  const contacts = computed(() => profiles.value.filter(p => !p.isSelf))

  const byName = (a: Profile, b: Profile) => a.name.localeCompare(b.name)

  const sortedContacts = computed(() => [...contacts.value].sort(byName))
  const favorites = computed(() => contacts.value.filter(p => p.favorite).sort(byName))
  const recent = computed(() =>
    contacts.value
      .filter(p => p.lastInteractionAt)
      .sort((a, b) => b.lastInteractionAt! - a.lastInteractionAt!)
      .slice(0, 5),
  )
  const allTags = computed(() =>
    [...new Set(contacts.value.flatMap(p => p.tags))].sort(),
  )

  function search(query: string): Profile[] {
    const q = query.trim().toLowerCase()
    if (!q) return sortedContacts.value
    const qCompact = q.replace(/\s+/g, '')
    return sortedContacts.value.filter(p =>
      p.name.toLowerCase().includes(q)
      || p.address.toLowerCase().replace(/\s+/g, '').includes(qCompact)
      || p.notes.toLowerCase().includes(q)
      || p.tags.some(t => t.toLowerCase().includes(q)),
    )
  }

  function exportDocument(): ExportDocument {
    return {
      app: 'NimConnect',
      version: 1,
      exportedAt: Date.now(),
      profiles: JSON.parse(JSON.stringify(profiles.value)),
    }
  }

  async function importDocument(doc: unknown): Promise<{ added: number; skipped: number }> {
    const d = doc as ExportDocument
    if (!d || typeof d !== 'object' || d.app !== 'NimConnect' || d.version !== 1 || !Array.isArray(d.profiles)) {
      throw new Error('invalid-export')
    }
    let added = 0
    let skipped = 0
    for (const raw of d.profiles) {
      try {
        await add({
          address: raw.address,
          name: String(raw.name ?? ''),
          notes: String(raw.notes ?? ''),
          tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
          favorite: !!raw.favorite,
          type: raw.type,
        })
        added++
      } catch {
        skipped++
      }
    }
    return { added, skipped }
  }

  return {
    profiles, loaded, self, contacts,
    sortedContacts, favorites, recent, allTags, search,
    load, getById, getByAddress, add, update, remove, toggleFavorite, touchInteraction, ensureSelf,
    exportDocument, importDocument,
  }
})
