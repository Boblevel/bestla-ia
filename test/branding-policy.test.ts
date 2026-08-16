import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { brandedPanel, signText } from '../src/utils/brand.js'
import type { AppConfig } from '../src/config.js'

const config = {
  botName: 'Bestla iA',
  signature: 'RHAFF SERVICE',
} as AppConfig

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(target))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(target)
  }
  return files
}

test('les réponses ordinaires ne reçoivent plus de signature automatique', () => {
  assert.equal(signText('Bonjour', config), 'Bonjour')
  const panel = brandedPanel('TEST', ['Une ligne'], config)
  assert.equal(panel.includes('Bestla iA'), false)
  assert.equal(panel.includes('RHAFF SERVICE'), false)
  assert.equal(panel.includes('✦ BY'), false)
})

test('la mention ✦ BY est réservée au code du menu WhatsApp', async () => {
  const root = path.resolve('src')
  const offenders: string[] = []
  for (const file of await sourceFiles(root)) {
    const relative = path.relative(process.cwd(), file).replaceAll('\\', '/')
    const content = await readFile(file, 'utf8')
    if (content.includes('✦ BY') && relative !== 'src/plugins/general.ts') offenders.push(relative)
  }
  assert.deepEqual(offenders, [])
})
