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

test('generervideo utilise Wan 2.7 via Gradio officiel sans faux fallback statique', async () => {
  const media = await readFile(new URL('../src/core/media-ai.ts', import.meta.url), 'utf8')
  const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8')
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  const commands = await readFile(new URL('../src/plugins/generative-media.ts', import.meta.url), 'utf8')
  const generateBlock = media.slice(media.indexOf('async generateVideo'), media.indexOf('async editVideo'))
  assert.match(generateBlock, /ensureVideoHasMotion\(await this\.huggingFaceTextVideoRequest\(prompt\), 'Hugging Face'\)/)
  assert.doesNotMatch(generateBlock, /generateImage\(prompt\)/)
  assert.match(media, /async function runFfmpegCapture/)
  assert.match(media, /private async ensureVideoHasMotion/)
  assert.match(media, /framemd5/)
  assert.match(media, /vidéo statique sans vrai mouvement/)
  assert.match(media, /parseSseEventBlocks/)
  assert.match(media, /const fallback = \[null, prompt, this\.videoCanvas\(\), 5\]/)
  assert.match(media, /'480x832'/)
  assert.match(media, /'832x480'/)
  assert.match(media, /Wan 2\.7 attend exactement/)
  assert.doesNotMatch(commands, /Génération vidéo en cours… Le mode ZeroGPU rapide est utilisé/)
  assert.match(media, /\/call\/\$\{apiSegment\}/)
  assert.match(media, /\/gradio_api\/call\/\$\{apiSegment\}/)
  assert.match(media, /AbortSignal\.timeout\(Math\.min\(remaining, 900_000\)\)/)
  assert.doesNotMatch(media, /gradio_api\/call\/v2/)
  assert.match(config, /MEDIA_AI_VIDEO_PROVIDER: z\.enum\(\['huggingface'\]\)\.default\('huggingface'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_SPACE: z\.string\(\)\.default\('https:\/\/alexcheng0072-wan27-free-video-generator\.hf\.space'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_MODEL: z\.string\(\)\.default\('FastVideo\/FastWan2\.2-TI2V-5B-FullAttn-Diffusers'\)/)
  assert.match(config, /MEDIA_AI_VIDEO_API_NAME: z\.string\(\)\.default\('\/generate_video'\)/)
  assert.match(config, /MEDIA_AI_HF_TOKEN/)
  assert.match(env, /MEDIA_AI_VIDEO_PROVIDER=huggingface/)
  assert.match(env, /MEDIA_AI_VIDEO_SPACE=https:\/\/alexcheng0072-wan27-free-video-generator\.hf\.space/)
  assert.match(env, /MEDIA_AI_VIDEO_MODEL=FastVideo\/FastWan2\.2-TI2V-5B-FullAttn-Diffusers/)
  assert.match(env, /MEDIA_AI_VIDEO_API_NAME=\/generate_video/)
})
