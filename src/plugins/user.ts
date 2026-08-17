import type { BotCommand, CommandContext } from '../types.js'
import { jidToMention } from '../utils/jid.js'
import { downloadMedia, findMedia } from '../utils/message.js'

function selectedImage(ctx: CommandContext) {
  if (findMedia(ctx.message)?.type === 'image') return ctx.message
  const quoted = ctx.quotedMessage()
  return quoted && findMedia(quoted)?.type === 'image' ? quoted : undefined
}

export const userCommands: BotCommand[] = [
  {
    name: 'fullpp',
    description: 'Met à jour la photo de profil du numéro Bestla avec l’image à laquelle tu réponds.',
    usage: '(en réponse à une image)',
    category: 'Utilisateur',
    ownerOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      const source = selectedImage(ctx)
      if (!source) return void (await ctx.reply(`Réponds à une image avec ${ctx.prefix}fullpp.`))
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
      const me = ctx.sock.user?.id
      if (!me) return void (await ctx.reply('Le compte WhatsApp n’est pas encore complètement connecté.'))
      await ctx.sock.updateProfilePicture(me, media.buffer)
      await ctx.reply('Photo de profil du numéro Bestla mise à jour.')
    },
  },
  {
    name: 'jid',
    description: 'Affiche le JID WhatsApp de la personne ciblée ou de l’expéditeur.',
    usage: '[@personne ou en réponse à un message]',
    category: 'Utilisateur',
    async execute(ctx) {
      const target = ctx.targetUser() ?? (!ctx.isGroup && (ctx.chatId.endsWith('@s.whatsapp.net') || ctx.chatId.endsWith('@lid')) ? ctx.chatId : ctx.sender)
      await ctx.reply(`JID : *${target}*\nContact : ${jidToMention(target)}`, [target])
    },
  },
  {
    name: 'gjid',
    description: 'Affiche le JID du groupe actuel.',
    category: 'Utilisateur',
    groupOnly: true,
    async execute(ctx) {
      await ctx.reply(`JID du groupe : *${ctx.chatId}*`)
    },
  },
  {
    name: 'left',
    description: 'Fait quitter le groupe au numéro Bestla.',
    category: 'Utilisateur',
    ownerOnly: true,
    groupOnly: true,
    async execute(ctx) {
      await ctx.reply('Bestla quitte le groupe.')
      await ctx.sock.groupLeave(ctx.chatId)
    },
  },
]
