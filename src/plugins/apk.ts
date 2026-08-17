import type { BotCommand } from '../types.js'
import { downloadApk, parseApkRequest } from '../core/apk-downloader.js'

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export const apkCommands: BotCommand[] = [
  {
    name: 'telechargerapk',
    description: 'Télécharge un APK public depuis un lien Play Store, APKPure, F-Droid ou un lien direct .apk.',
    usage: '<lien ou identifiant de paquet Android>',
    category: 'Documents & Création',
    cooldownSeconds: 25,
    async execute(ctx) {
      const input = ctx.argText.trim()
      if (!input) {
        return void (await ctx.reply(
          `Utilisation : ${ctx.prefix}telechargerapk https://play.google.com/store/apps/details?id=...\n` +
          `Ou : ${ctx.prefix}telechargerapk com.exemple.application`,
        ))
      }
      try {
        const request = parseApkRequest(input)
        await ctx.reply(`Téléchargement APK en cours…\nSource : ${request.sourceLabel}`)
        const apk = await downloadApk(input, ctx.config.maxApkBytes)
        await ctx.send({
          document: apk.buffer,
          mimetype: 'application/vnd.android.package-archive',
          fileName: apk.fileName,
          caption: [
            '*APK téléchargé par Bestla iA*',
            apk.packageId ? `Paquet : ${apk.packageId}` : undefined,
            `Source : ${apk.sourceLabel}`,
            `Taille : ${megabytes(apk.buffer.length)}`,
            `SHA256 : ${apk.sha256}`,
          ].filter(Boolean).join('\n'),
        })
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : 'Impossible de télécharger cet APK.')
      }
    },
  },
]
