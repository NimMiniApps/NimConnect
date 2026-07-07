import { nimToLunas } from '../services/links'

/**
 * Split a NIM total into n shares, exact in lunas — the first shares absorb
 * the remainder so the parts always sum to the total.
 */
export function splitAmount(totalNim: number, n: number): number[] {
  if (n < 1 || !(totalNim > 0)) return []
  const totalLunas = nimToLunas(totalNim)
  const base = Math.floor(totalLunas / n)
  const remainder = totalLunas - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 1e5)
}
