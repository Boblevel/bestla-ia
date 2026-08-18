import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AppConfig } from '../src/config.js'
import { JsonDatabase, type ScheduledJob, type SupportTicket } from '../src/core/database.js'

function testConfig(dataDir: string): AppConfig {
  return {
    botName: 'Bestla iA',
    signature: 'RHAFF SERVICE',
    prefix: '.',
    ownerNumbers: [],
    publicMode: true,
    sessionNames: ['main'],
    authMode: 'qr',
    sessionPhones: new Map(),
    sessionAuthModes: new Map(),
    dataDir,
    commandsEnabled: true,
    commandReactions: true,
    markRead: false,
    alwaysOnline: false,
    rejectCalls: false,
    warnLimit: 3,
    maxMediaBytes: 20 * 1024 * 1024,
    maxApkBytes: 100 * 1024 * 1024,
    logLevel: 'silent',
    timezone: 'Africa/Ouagadougou',
    api: { enabled: false, host: '127.0.0.1', port: 3000, key: '', rateLimitPerMinute: 60 },
    webhook: { url: '', secret: '' },
    ai: { provider: 'none', apiKey: '', model: '', baseUrl: '', maxOutputTokens: 700, publicAccess: false },
    mediaAi: {
      enabled: false,
      publicAccess: false,
      apiKey: '',
      imageModel: 'gemini-3.1-flash-image',
      imageAspectRatio: '1:1',
      imageSize: '1K',
      videoModel: 'gemini-omni-flash-preview',
      videoAspectRatio: '9:16',
      videoTimeoutSeconds: 600,
    },
    customPluginsDir: path.join(dataDir, 'plugins'),
  }
}

test('persiste les automatisations et protège les copies retournées', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-db-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()
  await db.mutateAutomation((settings) => {
    settings.autoRepliesEnabled = true
    settings.faq.livraison = 'Sous 24 heures.'
  })

  const snapshot = db.getAutomation()
  snapshot.faq.livraison = 'modifié hors base'
  assert.equal(db.getAutomation().faq.livraison, 'Sous 24 heures.')

  const reopened = new JsonDatabase(testConfig(directory))
  await reopened.init()
  assert.equal(reopened.getAutomation().autoRepliesEnabled, true)
  assert.equal(reopened.getAutomation().faq.livraison, 'Sous 24 heures.')
})

test('réclame puis termine un message programmé', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-schedule-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()
  const job: ScheduledJob = {
    id: 'abc12345',
    sessionName: 'main',
    chatId: '123@s.whatsapp.net',
    createdBy: '123@s.whatsapp.net',
    message: 'Rappel',
    nextRunAt: new Date(Date.now() - 1_000).toISOString(),
    repeat: 'aucune',
    status: 'en_attente',
    createdAt: new Date().toISOString(),
    claimedAt: null,
    lastError: null,
  }
  await db.addSchedule(job)
  const claimed = await db.claimDueSchedules()
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0]?.status, 'en_cours')
  await db.finishSchedule(job.id, true)
  assert.equal(db.listSchedules()[0]?.status, 'envoye')
})

test('persiste les tickets de support et protège leurs copies', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-ticket-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()
  const ticket: SupportTicket = {
    id: 'tk123456',
    sessionName: 'main',
    chatId: '22670000000@s.whatsapp.net',
    createdBy: '22670000000@s.whatsapp.net',
    subject: 'Demande de devis',
    status: 'ouvert',
    priority: 'normale',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.addTicket(ticket)
  const copy = db.getTicket(ticket.id)
  assert.ok(copy)
  copy.subject = 'ne doit pas modifier la base'
  assert.equal(db.getTicket(ticket.id)?.subject, 'Demande de devis')
  await db.updateTicket(ticket.id, { status: 'ferme', priority: 'haute' })
  assert.equal(db.listTickets({ status: 'ferme' })[0]?.priority, 'haute')
})

test('enregistre et efface uniquement le budget du propriétaire concerné', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-budget-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()
  await db.addFinance({
    id: 'finance01',
    owner: '22670000000@s.whatsapp.net',
    type: 'revenu',
    amount: 15_000,
    category: 'Vente',
    note: 'Site vitrine',
    createdAt: '2026-08-15T10:00:00.000Z',
  })
  await db.addFinance({
    id: 'finance02',
    owner: '22671111111@s.whatsapp.net',
    type: 'depense',
    amount: 2_000,
    category: 'Data',
    note: '',
    createdAt: '2026-08-15T10:00:00.000Z',
  })
  assert.equal(db.listFinance('22670000000@s.whatsapp.net', '2026-08').length, 1)
  assert.equal(await db.removeFinance('finance02', '22670000000@s.whatsapp.net'), false)
  assert.equal(await db.removeFinance('finance01', '22670000000@s.whatsapp.net'), true)
})

test('active/désactive des commandes et persiste ce choix', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-command-switch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()

  assert.equal(db.isCommandEnabled('generervideo'), true)
  await db.setCommandEnabled('generervideo', false)
  assert.equal(db.isCommandEnabled('generervideo'), false)
  assert.deepEqual(db.listDisabledCommands(), ['generervideo'])

  const reopened = new JsonDatabase(testConfig(directory))
  await reopened.init()
  assert.equal(reopened.isCommandEnabled('generervideo'), false)
  await reopened.setCommandEnabled('generervideo', true)
  assert.equal(reopened.isCommandEnabled('generervideo'), true)
})

test('gère le catalogue et la livraison des produits digitaux', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-digital-products-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()

  const now = new Date().toISOString()
  await db.upsertDigitalProduct({
    id: 'pack1',
    name: 'Pack Premium',
    description: 'Accès digital',
    deliveryText: 'Lien privé',
    active: true,
    deliveredCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  assert.equal(db.listDigitalProducts().length, 1)

  const copy = db.getDigitalProduct('pack1')
  assert.ok(copy)
  copy.deliveryText = 'ne doit pas modifier la base'
  assert.equal(db.getDigitalProduct('pack1')?.deliveryText, 'Lien privé')

  await db.markDigitalProductDelivered('pack1')
  assert.equal(db.getDigitalProduct('pack1')?.deliveredCount, 1)
  assert.equal(await db.setDigitalProductActive('pack1', false), true)
  assert.equal(db.listDigitalProducts().length, 0)
  assert.equal(db.listDigitalProducts(true)[0]?.active, false)
  assert.equal(await db.removeDigitalProduct('pack1'), true)
  assert.equal(db.getDigitalProduct('pack1'), undefined)
})


test('persiste le réglage de lecture automatique des statuts', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-status-auto-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()

  assert.equal(db.getAutoStatusView(), false)
  await db.setAutoStatusView(true)
  assert.equal(db.getAutoStatusView(), true)

  const reopened = new JsonDatabase(testConfig(directory))
  await reopened.init()
  assert.equal(reopened.getAutoStatusView(), true)
})

test('persiste le réglage automatique des messages éphémères 24 h', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-ephemeral-auto-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()

  assert.equal(db.getAutoEphemeral24h(), false)
  await db.setAutoEphemeral24h(true)
  assert.equal(db.getAutoEphemeral24h(), true)

  const reopened = new JsonDatabase(testConfig(directory))
  await reopened.init()
  assert.equal(reopened.getAutoEphemeral24h(), true)
})

test('persiste les règles de coordination entre sessions Bestla', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-duo-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new JsonDatabase(testConfig(directory))
  await db.init()

  const initial = db.getAutomation()
  assert.equal(initial.peerRepliesEnabled, false)
  assert.equal(initial.peerReplies.some((rule) => rule.trigger === 'mentioncachee' && rule.response === 'cache'), true)

  await db.mutateAutomation((settings) => {
    settings.peerRepliesEnabled = true
    settings.peerReplies.push({ id: 'test-duo', trigger: 'salutbot', response: 'présent' })
  })

  const reopened = new JsonDatabase(testConfig(directory))
  await reopened.init()
  assert.equal(reopened.getAutomation().peerRepliesEnabled, true)
  assert.equal(reopened.getAutomation().peerReplies.some((rule) => rule.id === 'test-duo'), true)
})
