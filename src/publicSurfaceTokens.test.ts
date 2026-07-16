import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function collectVueAndCssFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) collectVueAndCssFiles(full, files)
    else if (/\.(vue|css)$/.test(entry)) files.push(full)
  }
  return files
}

describe('public surface token migration', () => {
  it('no source file under src/ references the removed --public-* custom properties', () => {
    const files = collectVueAndCssFiles(__dirname)
    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (/--public-(ink|blue|gold|soft-blue)\b/.test(content)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
