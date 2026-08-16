import type { BotCommand } from '../types.js'
import { jidToMention, phoneToJid } from '../utils/jid.js'
import { safeFetchBuffer } from '../utils/safe-fetch.js'

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
]
