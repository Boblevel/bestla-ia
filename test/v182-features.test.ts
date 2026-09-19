import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('AssistantAuto est isolé par session Bestla', async () => {
  const database = await readFile(new URL('../src/core/database.ts', import.meta.url), 'utf8')
  const automation = await readFile(new URL('../src/plugins/automation.ts', import.meta.url), 'utf8')
  const service = await readFile(new URL('../src/core/automation.ts', import.meta.url), 'utf8')
  assert.match(database, /getSessionAutomation\(sessionName: string\)/)
  assert.match(database, /mutateSessionAutomation/)
  const assistantBlock = automation.slice(automation.indexOf("name: 'assistantauto'"), automation.indexOf("name: 'attentes'"))
  assert.match(assistantBlock, /getSessionAutomation\(ctx\.sessionName\)/)
  assert.match(assistantBlock, /mutateSessionAutomation\(ctx\.sessionName/)
  assert.match(service, /getSessionAutomation\(input\.sessionName\)/)
})

test('V18.2 expose rendez-vous, secrétaire, base IA et originaux supprimés/modifiés', async () => {
  const productivity = await readFile(new URL('../src/plugins/productivity.ts', import.meta.url), 'utf8')
  const sessions = await readFile(new URL('../src/core/session-manager.ts', import.meta.url), 'utf8')
  for (const command of ['rendezvous', 'secretaire', 'connaissance', 'historique', 'original']) {
    assert.match(productivity, new RegExp(`name: '${command}'`))
  }
  assert.match(sessions, /messages\.delete/)
  assert.match(sessions, /messages\.update/)
  assert.match(sessions, /captureIncomingMessage/)
})

test('V18.2 ajoute les deux outils groupe demandés et les jeux couple', async () => {
  const group = await readFile(new URL('../src/plugins/group.ts', import.meta.url), 'utf8')
  const games = await readFile(new URL('../src/plugins/utilitaires.ts', import.meta.url), 'utf8')
  assert.match(group, /name: 'lienmembres'/)
  assert.match(group, /name: 'copiermembres'/)
  for (const command of ['tupreferescouple', 'souvenircouple', 'deficouple', 'quizcouple']) {
    assert.match(games, new RegExp(`name: '${command}'`))
  }
})

test('le panneau retire sessions et propriétaires par choix numérique', async () => {
  const cli = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8')
  assert.match(cli, /Choisis le numéro de la session à retirer/)
  assert.match(cli, /current\[selected - 1\]\?\.name/)
  assert.match(cli, /Choisis le numéro du propriétaire à retirer/)
  assert.match(cli, /owners\[selected - 1\]/)
})
