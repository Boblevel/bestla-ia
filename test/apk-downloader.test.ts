import assert from 'node:assert/strict'
import test from 'node:test'
import { isPotentialApkLink, parseApkRequest } from '../src/core/apk-downloader.js'

test('reconnaît un lien Google Play et extrait le paquet Android', () => {
  const request = parseApkRequest('https://play.google.com/store/apps/details?id=com.instagram.android&hl=fr')
  assert.equal(request.packageId, 'com.instagram.android')
  assert.equal(request.source, 'apk-pure')
})

test('reconnaît F-Droid, APKPure et les liens APK directs', () => {
  assert.deepEqual(
    { packageId: parseApkRequest('https://f-droid.org/packages/org.videolan.vlc/').packageId, source: parseApkRequest('https://f-droid.org/packages/org.videolan.vlc/').source },
    { packageId: 'org.videolan.vlc', source: 'f-droid' },
  )
  assert.equal(parseApkRequest('https://apkpure.com/exemple/com.exemple.app').packageId, 'com.exemple.app')
  assert.equal(parseApkRequest('https://example.org/releases/app.apk').source, 'direct')
})

test('refuse une page APK inconnue non directe', () => {
  assert.throws(() => parseApkRequest('https://example.org/page/application'), /lien APK direct reconnu/i)
})


test('détecte les liens APK à télécharger dès leur collage en privé', () => {
  assert.equal(isPotentialApkLink('https://play.google.com/store/apps/details?id=com.whatsapp'), true)
  assert.equal(isPotentialApkLink('https://f-droid.org/packages/org.fdroid.fdroid/'), true)
  assert.equal(isPotentialApkLink('https://example.org/app.apk'), true)
  assert.equal(isPotentialApkLink('https://youtube.com/watch?v=123'), false)
})
