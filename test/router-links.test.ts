import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('un lien brut ne déclenche plus automatiquement un téléchargement', async () => {
  const source = await readFile(new URL('../src/core/router.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('isPotentialApkLink'), false)
  assert.equal(source.includes('normalizePublicMediaUrl'), false)
  assert.equal(source.includes('Lien APK détecté'), false)
  assert.match(source, /Aucun lien brut n'est traité automatiquement/)
  assert.match(source, /Lien reçu sans commande explicite : aucune analyse ni automatisation lancée/)
  assert.match(source, /https\?:\\\/\\\/\\S\+/)
})
