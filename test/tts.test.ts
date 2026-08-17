import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseRate, resolveLanguagePreset, TtsService } from '../src/core/tts.js'

test('résout les principales langues vocales sans configuration manuelle', () => {
  assert.equal(resolveLanguagePreset('fr')?.locale, 'fr-FR')
  assert.equal(resolveLanguagePreset('français')?.locale, 'fr-FR')
  assert.equal(resolveLanguagePreset('en-ng')?.locale, 'en-NG')
  assert.equal(resolveLanguagePreset('swahili')?.locale, 'sw-KE')
  assert.equal(resolveLanguagePreset('arabe')?.locale, 'ar-EG')
})

test('valide la vitesse vocale', () => {
  assert.equal(parseRate('+10%'), '+10%')
  assert.equal(parseRate('-20'), '-20%')
  assert.equal(parseRate('50'), '+50%')
  assert.equal(parseRate('+51%'), undefined)
})

test('préférences vocales sont persistées automatiquement par utilisateur', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bestla-tts-test-'))
  try {
    const service = new TtsService(directory)
    const initial = await service.getPreference('22670000000@s.whatsapp.net')
    assert.equal(initial.voice, 'fr-FR-HenriNeural')

    const female = await service.setGender('22670000000@s.whatsapp.net', 'Female')
    assert.equal(female.voice, 'fr-FR-DeniseNeural')

    const nigeria = await service.setLanguage('22670000000@s.whatsapp.net', 'en-ng')
    assert.equal(nigeria.locale, 'en-NG')
    assert.equal(nigeria.voice, 'en-NG-EzinneNeural')

    const faster = await service.setRate('22670000000@s.whatsapp.net', '+15%')
    assert.equal(faster.rate, '+15%')

    const secondInstance = new TtsService(directory)
    assert.equal((await secondInstance.getPreference('22670000000@s.whatsapp.net')).rate, '+15%')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
