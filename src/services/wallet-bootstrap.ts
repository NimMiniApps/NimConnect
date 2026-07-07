import { connectWallet, resetWalletConnection } from './nimiq'
import { useProfilesStore } from '../stores/profiles'

let bootstrapPromise: Promise<void> | null = null

/** Single wallet bootstrap for the whole app — connect + ensureSelf profile. */
export function bootstrapWallet(): Promise<void> {
  bootstrapPromise ??= doBootstrap().finally(() => { bootstrapPromise = null })
  return bootstrapPromise
}

async function doBootstrap() {
  const store = useProfilesStore()
  await store.load()
  try {
    const address = await connectWallet()
    if (address) await store.ensureSelf(address)
  } catch {
    // Declined or invalid — offline mode still works
  }
}

export function resetBootstrap() {
  resetWalletConnection()
  bootstrapPromise = null
}

export async function retryWalletBootstrap(): Promise<void> {
  resetBootstrap()
  await bootstrapWallet()
}
