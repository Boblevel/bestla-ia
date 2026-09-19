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
  assert.match(service, /Base de connaissances de cette session/)
  assert.match(automation, /action === 'info'/)
  assert.match(automation, /action === 'media'/)
  assert.match(automation, /downloadMedia\(source, 12 \* 1024 \* 1024, ctx\.sock\)/)
  assert.match(automation, /automation\.knowledge\.push\(entry\)/)
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
  assert.match(group, /groupGetInviteInfo\(sourceCode\)/)
  assert.match(group, /groupGetInviteInfo\(destinationCode\)/)
  assert.match(group, /lienmembres 20 \| LIEN_GROUPE_SOURCE \| LIEN_GROUPE_DESTINATION/)
  assert.match(group, /copiermembres 20 \| LIEN_GROUPE_SOURCE \| LIEN_GROUPE_DESTINATION/)
  const linkMembersBlock = group.slice(group.indexOf("name: 'lienmembres'"), group.indexOf("name: 'copiermembres'"))
  const copyMembersBlock = group.slice(group.indexOf("name: 'copiermembres'"))
  assert.doesNotMatch(linkMembersBlock, /groupOnly:\s*true/)
  assert.doesNotMatch(copyMembersBlock, /groupOnly:\s*true/)
  for (const command of [
    'tupreferescouple',
    'souvenircouple',
    'deficouple',
    'quizcouple',
    'action',
    'actionouverite',
    'jenaijamais',
    'tupreferes',
    'quidenous',
    'capoupascap',
    'septsecondes',
    'chaisechaude',
    'bouteille',
  ]) {
    assert.match(games, new RegExp(`name: '${command}'`))
  }
  const bottleBlock = games.slice(games.indexOf("name: 'bouteille'"), games.indexOf("name: 'blague'"))
  assert.match(bottleBlock, /groupOnly:\s*true/)
})

test('le panneau retire sessions et propriétaires par choix numérique', async () => {
  const cli = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8')
  assert.match(cli, /Choisis le numéro WhatsApp à retirer/)
  assert.match(cli, /reader\.question\('Numéro : '\)/)
  assert.match(cli, /current\[selected - 1\]\?\.name/)
  assert.match(cli, /removeSession\(\[name, 'confirmer'\]\)/)
  assert.match(cli, /Choisis le numéro du propriétaire à retirer/)
  assert.match(cli, /owners\[selected - 1\]/)
})


test('les commandes hors Jeux répondent sans citer la commande, les jeux gardent la citation', async () => {
  const router = await readFile(new URL('../src/core/router.ts', import.meta.url), 'utf8')
  assert.match(router, /command\.category === 'Jeux'/)
  assert.match(router, /reply: commandReply/)
  assert.match(router, /send: commandSend/)
  assert.match(router, /runtime\.send\(chatId, content, options\)/)
})

test('generervideo utilise Hugging Face ZeroGPU sans secours image locale pour le texte', async () => {
  const media = await readFile(new URL('../src/core/media-ai.ts', import.meta.url), 'utf8')
  const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8')
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  const generateBlock = media.slice(media.indexOf('async generateVideo'), media.indexOf('async editVideo'))
  assert.match(generateBlock, /huggingFaceTextVideoRequest\(prompt\)/)
  assert.doesNotMatch(generateBlock, /generateImage\(prompt\)/)
  assert.match(media, /gradio_api\/info/)
  assert.match(media, /gradio_api\/call\/v2/)
  assert.match(media, /gradio_api\/call\/\$\{apiSegment\}/)
  assert.match(media, /api\/predict\/\$\{apiSegment\}/)
  assert.match(media, /text_to_video/)
  assert.match(media, /defaultHuggingFaceVideoPayload/)
  assert.match(media, /event === 'complete'/)
  assert.match(media, /AbortSignal\.timeout\(Math\.min\(180_000, remaining\)\)/)
  assert.doesNotMatch(media, /veo/i)
  assert.match(config, /MEDIA_AI_VIDEO_PROVIDER: z\.enum\(\['huggingface'\]\)\.default\('huggingface'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_SPACE: z\.string\(\)\.default\('https:\/\/lightricks-ltx-video-distilled\.hf\.space'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_MODEL: z\.string\(\)\.default\('Lightricks\/LTX-Video'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_API_NAME: z\.string\(\)\.default\('\/text_to_video'\)/)
  assert.match(config, /MEDIA_AI_HF_TOKEN/)
  assert.match(env, /MEDIA_AI_VIDEO_PROVIDER=huggingface/)
  assert.match(env, /MEDIA_AI_VIDEO_SPACE=https:\/\/lightricks-ltx-video-distilled\.hf\.space/)
  assert.match(env, /MEDIA_AI_VIDEO_API_NAME=\/text_to_video/)
})
