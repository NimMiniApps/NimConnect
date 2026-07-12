import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { db } from '../db/db'
import type { ExportDocument, Profile, ProfileType } from '../types/profile'
import { uuid } from '../utils/uuid'
import { useInvoicesStore } from './invoices'
import { useBucketsStore } from './buckets'
import { notifyDataChanged } from '../services/cloud-backup'

export interface NewProfile {
  address: string
  name: string
  notes?: string
  tags?: string[]
  favorite?: boolean
  type?: ProfileType
  bio?: string
  website?: string
  github?: string
  x?: string
}

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref<Profile[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    profiles.value = await db.profiles.toArray()
    loaded.value = true
  }

  async function reload() {
    profiles.value = await db.profiles.toArray()
    loaded.value = true
  }

  function getById(id: string): Profile | undefined {
    return profiles.value.find(p => p.id === id)
  }

  function getByAddress(address: string): Profile | undefined {
    return profiles.value.find(p => p.address === address)
  }

  /** Only http(s) URLs survive persistence — blocks javascript:/data: from form or imported files. */
  function safeUrl(url?: string): string | undefined {
    if (!url) return undefined
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
    } catch {
      return undefined
    }
  }

  const GITHUB_HANDLE = /^[A-Za-z0-9-]{1,39}$/
  const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/

  function safeHandle(handle: string | undefined, pattern: RegExp): string | undefined {
    const h = handle?.trim().replace(/^@/, '')
    return h && pattern.test(h) ? h : undefined
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
      id: uuid(),
      address,
      name: input.name.trim(),
      type: input.type ?? 'person',
      isSelf: false,
      notes: input.notes ?? '',
      tags: [...(input.tags ?? [])],
      favorite: input.favorite ?? false,
      createdAt: now,
      updatedAt: now,
      ...(input.bio ? { bio: input.bio } : {}),
      ...(safeUrl(input.website) ? { website: safeUrl(input.website) } : {}),
      ...(safeHandle(input.github, GITHUB_HANDLE) ? { github: safeHandle(input.github, GITHUB_HANDLE) } : {}),
      ...(safeHandle(input.x, X_HANDLE) ? { x: safeHandle(input.x, X_HANDLE) } : {}),
    }
    await db.profiles.add(profile)
    profiles.value.push(profile)
    notifyDataChanged()
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
    if ('website' in patch) patch = { ...patch, website: safeUrl(patch.website) }
    if ('github' in patch) patch = { ...patch, github: safeHandle(patch.github, GITHUB_HANDLE) }
    if ('x' in patch) patch = { ...patch, x: safeHandle(patch.x, X_HANDLE) }
    const updated: Profile = plainProfile({ ...existing, ...patch, id, updatedAt: Date.now() })
    await db.profiles.put(updated)
    profiles.value = profiles.value.map(p => (p.id === id ? updated : p))
    notifyDataChanged()
  }

  async function remove(id: string) {
    await db.profiles.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
    notifyDataChanged()
  }

  async function toggleFavorite(id: string) {
    const p = getById(id)
    if (p) await update(id, { favorite: !p.favorite })
  }

  async function touchInteraction(id: string) {
    await update(id, { lastInteractionAt: Date.now() })
  }

  let ensureSelfLock: Promise<Profile> | null = null

  async function ensureSelf(address: string): Promise<Profile> {
    const existing = profiles.value.find(p => p.isSelf)
    if (existing) return existing
    ensureSelfLock ??= ensureSelfOnce(address).finally(() => { ensureSelfLock = null })
    return ensureSelfLock
  }

  async function ensureSelfOnce(address: string): Promise<Profile> {
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
      id: uuid(),
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
    try {
      await db.profiles.add(self)
      profiles.value.push(self)
      return self
    } catch {
      // Concurrent ensureSelf or import may have added this address first
      const raced = await db.profiles.where('address').equals(normalized).first()
      if (raced) {
        if (!raced.isSelf) await update(raced.id, { isSelf: true })
        if (!profiles.value.some(p => p.id === raced.id)) profiles.value.push(raced)
        return getById(raced.id) ?? raced
      }
      throw new Error('duplicate-address')
    }
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

  async function exportDocument(): Promise<ExportDocument> {
    const invoicesStore = useInvoicesStore()
    const bucketsStore = useBucketsStore()
    await invoicesStore.load()
    await bucketsStore.load()
    return {
      app: 'NimConnect',
      version: 3,
      exportedAt: Date.now(),
      profiles: JSON.parse(JSON.stringify(profiles.value)),
      invoices: JSON.parse(JSON.stringify(invoicesStore.invoices)),
      buckets: JSON.parse(JSON.stringify(bucketsStore.buckets)),
    }
  }

  async function resetAll() {
    ensureSelfLock = null
    await db.invoices.clear()
    const invoicesStore = useInvoicesStore()
    invoicesStore.invoices = []
    await db.buckets.clear()
    const bucketsStore = useBucketsStore()
    bucketsStore.buckets = []
    await db.profiles.clear()
    if (await db.profiles.count() > 0) {
      await db.delete()
      await db.open()
    }
    profiles.value = []
    loaded.value = false
    await load()
  }

  async function importDocument(doc: unknown): Promise<{ added: number; skipped: number; merged: number }> {
    const d = doc as ExportDocument
    if (!d || typeof d !== 'object' || d.app !== 'NimConnect' || ![1, 2, 3].includes(d.version) || !Array.isArray(d.profiles)) {
      throw new Error('invalid-export')
    }
    let added = 0
    let skipped = 0
    let merged = 0

    async function applySelfFlag(profileId: string) {
      for (const p of profiles.value.filter(p => p.isSelf && p.id !== profileId)) {
        await update(p.id, { isSelf: false })
      }
      await update(profileId, { isSelf: true })
    }

    for (const raw of d.profiles) {
      try {
        const address = normalize(String(raw.address ?? ''))
        const fields = {
          name: String(raw.name ?? ''),
          notes: String(raw.notes ?? ''),
          tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
          favorite: !!raw.favorite,
          type: (raw.type ?? 'person') as ProfileType,
          bio: raw.bio ? String(raw.bio) : undefined,
          website: raw.website ? String(raw.website) : undefined,
          github: raw.github ? String(raw.github) : undefined,
          x: raw.x ? String(raw.x) : undefined,
          ...(typeof raw.lastInteractionAt === 'number' ? { lastInteractionAt: raw.lastInteractionAt } : {}),
        }
        const existing = getByAddress(address)
        if (existing) {
          await update(existing.id, fields)
          if (raw.isSelf) await applySelfFlag(existing.id)
          merged++
          continue
        }
        const now = Date.now()
        const profile: Profile = {
          id: uuid(),
          address,
          name: fields.name.trim(),
          type: fields.type,
          isSelf: !!raw.isSelf,
          notes: fields.notes,
          tags: [...fields.tags],
          favorite: fields.favorite,
          createdAt: now,
          updatedAt: now,
          ...(fields.bio ? { bio: fields.bio } : {}),
          ...(safeUrl(fields.website) ? { website: safeUrl(fields.website) } : {}),
          ...(safeHandle(fields.github, GITHUB_HANDLE) ? { github: safeHandle(fields.github, GITHUB_HANDLE) } : {}),
          ...(safeHandle(fields.x, X_HANDLE) ? { x: safeHandle(fields.x, X_HANDLE) } : {}),
          ...(fields.lastInteractionAt ? { lastInteractionAt: fields.lastInteractionAt } : {}),
        }
        if (profile.isSelf) {
          for (const p of profiles.value.filter(p => p.isSelf)) {
            await update(p.id, { isSelf: false })
          }
        }
        await db.profiles.add(profile)
        profiles.value.push(profile)
        notifyDataChanged()
        added++
      } catch {
        skipped++
      }
    }
    if (Array.isArray(d.invoices)) {
      const invoicesStore = useInvoicesStore()
      await invoicesStore.reload()
      await invoicesStore.importMany(d.invoices)
    }
    if (Array.isArray(d.buckets)) {
      const bucketsStore = useBucketsStore()
      await bucketsStore.reload()
      await bucketsStore.importMany(d.buckets)
    }
    await reload()
    notifyDataChanged()
    return { added, skipped, merged }
  }

  return {
    profiles, loaded, self, contacts,
    sortedContacts, favorites, recent, allTags, search,
    load, reload, getById, getByAddress, add, update, remove, toggleFavorite, touchInteraction, ensureSelf,
    exportDocument, importDocument, resetAll,
  }
})
