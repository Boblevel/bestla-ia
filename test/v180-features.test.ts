import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('V18.0 garde les commandes publiques et sous-ordres ciblés en français', async () => {
  const [whatsapp, media, tts] = await Promise.all([
    source('../src/plugins/whatsapp.ts'),
    source('../src/plugins/advanced-media.ts'),
    source('../src/plugins/tts.ts'),
  ])
  assert.equal(whatsapp.includes("'pp'"), false)
  assert.equal(media.includes("'framevideo'"), false)
  assert.equal(tts.includes("action === 'reset'"), false)
  assert.equal(tts.includes('voix reset'), false)
  assert.match(tts, /voix reinitialiser/)
})

test('V18.0 active le TextMaker premium avec secours local', async () => {
  const textmaker = await source('../src/plugins/textmaker.ts')
  assert.match(textmaker, /MediaAiService/)
  assert.match(textmaker, /generateImage\(premiumBackgroundPrompt/)
  assert.match(textmaker, /textOverlaySvg/)
  assert.match(textmaker, /return sharp\(textSvg\(styleName, text\)\)/)
})

test('V18.0 ajoute statut, effectif, bienvenue enrichie et outils business/détente', async () => {
  const [whatsapp, group, router, utilities] = await Promise.all([
    source('../src/plugins/whatsapp.ts'),
    source('../src/plugins/group.ts'),
    source('../src/core/router.ts'),
    source('../src/plugins/utilitaires.ts'),
  ])
  assert.match(whatsapp, /name: 'telechargerstatut'/)
  assert.match(group, /name: 'comptermembres'/)
  assert.match(router, /profilePictureUrl/)
  assert.match(router, /NOUVEAU MEMBRE/)
  for (const command of [
    'calculmarge', 'prixvente', 'remise', 'objectifvente', 'relanceclient', 'ficheclient',
    'tiragemembre', 'choisirhasard', 'questioncouple', 'defirigolo', 'verite', 'gage', 'compatibilite', 'blague',
  ]) assert.match(utilities, new RegExp(`name: '${command}'`))
})
