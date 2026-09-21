import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('le panel Bestla gère le token Hugging Face pour ZeroGPU', async () => {
  const cli = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8')
  assert.match(cli, /HUGGING_FACE_TOKENS_URL = 'https:\/\/huggingface\.co\/settings\/tokens'/)
  assert.match(cli, /async function testHuggingFaceToken/)
  assert.match(cli, /https:\/\/huggingface\.co\/api\/whoami-v2/)
  assert.match(cli, /async function huggingFaceTokenPanel/)
  assert.match(cli, /GÉRER LE TOKEN HUGGING FACE/)
  assert.match(cli, /updateConfiguration\(\['hftoken', token\]\)/)
  assert.match(cli, /MEDIA_AI_HF_TOKEN: value/)
  assert.match(cli, /MEDIA_AI_VIDEO_PROVIDER: 'huggingface'/)
  assert.doesNotMatch(cli, /MEDIA_AI_VIDEO_PROVIDER: 'gemini'/)
})
