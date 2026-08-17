import type { BotCommand } from '../types.js'
import { jidToMention, phoneToJid } from '../utils/jid.js'
import { safeFetchBuffer } from '../utils/safe-fetch.js'
import { pendingStatusCount, readRememberedStatuses } from '../core/status-viewer.js'

function safeContactName(value: string): string {
  return value.trim().replace(/[\r\n;:]/g, ' ').slice(0, 60) || 'Contact Bestla'
}

export const whatsappCommands: BotCommand[] = [
  {
    name: 'reaction',
    aliases: ['reagir'],
    description: 'Réagit avec un emoji au message auquel tu réponds.',
    usage: '<emoji> (en réponse à un message)',
    category: 'WhatsApp',
    cooldownSeconds: 2,
    async execute(ctx) {
      const emoji = ctx.argText.trim()
      const quoted = ctx.quotedMessage()
      if (!quoted?.key?.id || !emoji || emoji.length > 16) return void (await ctx.reply(`Réponds à un message avec ${ctx.prefix}reaction ❤️`))
      await ctx.sock.sendMessage(ctx.chatId, { react: { text: emoji, key: quoted.key } })
    },
  },
  {
    name: 'photoprofil',
    aliases: ['photo-profil'],
    description: 'Envoie la photo de profil visible d’un contact ou de toi-même.',
    usage: '[@personne ou numéro]',
    category: 'WhatsApp',
    cooldownSeconds: 10,
    async execute(ctx) {
      const target = ctx.targetUser() ?? ctx.sender
      const url = await ctx.sock.profilePictureUrl(target, 'image').catch(() => undefined)
      if (!url) return void (await ctx.reply('Photo de profil indisponible : elle est peut-être protégée par les réglages de confidentialité.'))
      try {
        const media = await safeFetchBuffer(url, ctx.config.maxMediaBytes)
        await ctx.send({ image: media.buffer, caption: `Photo de profil de ${jidToMention(target)}.`, mentions: [target] })
      } catch {
        await ctx.reply('Impossible de récupérer cette photo de profil pour le moment.')
      }
    },
  },
  {
    name: 'envoyercontact',
    aliases: ['partagercontact'],
    description: 'Envoie une fiche contact vCard dans la discussion actuelle.',
    usage: '<numéro> | <nom>',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const separator = ctx.argText.indexOf('|')
      const number = separator === -1 ? '' : ctx.argText.slice(0, separator).trim().replace(/\D/g, '')
      const name = separator === -1 ? '' : safeContactName(ctx.argText.slice(separator + 1))
      const jid = phoneToJid(number)
      if (!jid || !name) return void (await ctx.reply(`Utilisation : ${ctx.prefix}envoyercontact 22670000000 | Contact`))
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${number}:${number}\nEND:VCARD`
      await ctx.send({ contacts: { displayName: name, contacts: [{ vcard }] } })
    },
  },
  {
    name: 'liremessage',
    aliases: ['marquerlu'],
    description: 'Marque le message actuel comme lu.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      await ctx.sock.readMessages([ctx.message.key])
      await ctx.react('👁️')
    },
  },
  {
    name: 'lirestatuts',
    aliases: ['voirstatuts', 'statutsvus'],
    description: 'Marque en une fois comme vus les statuts récents reçus par cette session.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const before = pendingStatusCount(ctx.sock)
      if (before === 0) {
        return void (await ctx.reply('Aucun nouveau statut mémorisé pour cette session. Les prochains statuts reçus seront disponibles ici.'))
      }
      const result = await readRememberedStatuses(ctx.sock)
      if (result.failed === 0) {
        return void (await ctx.reply(`${result.read} statut${result.read > 1 ? 's' : ''} marqué${result.read > 1 ? 's' : ''} comme vu${result.read > 1 ? 's' : ''}.`))
      }
      await ctx.reply(`${result.read} statut(s) marqué(s) comme vus ; ${result.failed} n'ont pas pu être confirmés par WhatsApp.`)
    },
  },
  {
    name: 'autostatuts',
    aliases: ['autovuestatuts', 'statutsauto'],
    description: 'Active ou désactive la lecture automatique des nouveaux statuts WhatsApp.',
    usage: 'activer|desactiver|statut',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (!action || action === 'statut') {
        return void (await ctx.reply(`Lecture automatique des statuts : *${ctx.db.getAutoStatusView() ? 'ACTIVÉE' : 'DÉSACTIVÉE'}*.`))
      }
      if (action !== 'activer' && action !== 'desactiver') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}autostatuts activer|desactiver|statut`))
      }
      const enabled = action === 'activer'
      await ctx.db.setAutoStatusView(enabled)
      await ctx.reply(`Lecture automatique des nouveaux statuts *${enabled ? 'activée' : 'désactivée'}*.`)
    },
  },
  {
    name: 'presence',
    aliases: ['presencewa'],
    description: 'Change manuellement la présence WhatsApp du compte connecté.',
    usage: 'enligne|horsligne|ecriture|audio|pause',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const modes = {
        enligne: 'available',
        horsligne: 'unavailable',
        ecriture: 'composing',
        audio: 'recording',
        pause: 'paused',
      } as const
      const mode = action ? modes[action as keyof typeof modes] : undefined
      if (!mode) return void (await ctx.reply(`Utilisation : ${ctx.prefix}presence enligne|horsligne|ecriture|audio|pause`))
      if (mode === 'available' || mode === 'unavailable') await ctx.sock.sendPresenceUpdate(mode)
      else await ctx.sock.sendPresenceUpdate(mode, ctx.chatId)
      await ctx.reply(`Présence WhatsApp réglée sur *${action}*.`)
    },
  },
  {
    name: 'apropos',
    aliases: ['biowhatsapp', 'statutprofil'],
    description: 'Modifie le texte À propos du profil WhatsApp connecté.',
    usage: '<texte>',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const text = ctx.argText.trim().replace(/\s+/g, ' ').slice(0, 139)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}apropos Disponible pour vos messages.`))
      await ctx.sock.updateProfileStatus(text)
      await ctx.reply('Texte À propos du profil WhatsApp mis à jour.')
    },
  },
  {
    name: 'confidentialite',
    aliases: ['privacywa'],
    description: 'Affiche les réglages de confidentialité visibles par Baileys.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      const settings = await ctx.sock.fetchPrivacySettings(true)
      const entries = Object.entries(settings).filter(([, value]) => typeof value === 'string')
      if (!entries.length) return void (await ctx.reply('WhatsApp n’a renvoyé aucun réglage de confidentialité exploitable.'))
      await ctx.reply(`*CONFIDENTIALITÉ WHATSAPP*\n\n${entries.map(([key, value]) => `${key} : *${String(value)}*`).join('\n')}`)
    },
  },
]
