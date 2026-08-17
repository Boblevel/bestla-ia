import type { BotCommand } from '../types.js'
import { TTS_LANGUAGE_PRESETS, TtsError, TtsService, type TtsGender } from '../core/tts.js'

function genderLabel(value: TtsGender): string {
  return value === 'Female' ? 'femme' : 'homme'
}

function languageLabel(locale: string): string {
  return TTS_LANGUAGE_PRESETS.find((preset) => preset.locale === locale)?.label ?? locale
}

function serviceFor(dataDir: string): TtsService {
  return new TtsService(dataDir)
}

async function replyTtsError(reply: (text: string) => Promise<unknown>, error: unknown): Promise<void> {
  if (error instanceof TtsError) {
    await reply(error.message)
    return
  }
  throw error
}

export const ttsCommands: BotCommand[] = [
  {
    name: 'vocal',
    aliases: ['textevoix', 'vocale'],
    description: 'Transforme gratuitement un texte en note vocale naturelle.',
    usage: '<texte>',
    category: 'Audio & Vidéo',
    cooldownSeconds: 6,
    async execute(ctx) {
      const text = ctx.argText.trim()
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}vocal Bonjour, comment ça va ?`))
      if (text.length > 1_500) return void (await ctx.reply('Le texte est trop long. Limite : 1 500 caractères par vocal.'))

      const service = serviceFor(ctx.config.dataDir)
      try {
        const result = await service.synthesize(ctx.sender, text)
        if (result.buffer.length > ctx.config.maxMediaBytes) {
          await ctx.reply('Le vocal généré dépasse la limite média configurée. Réduis le texte et réessaie.')
          return
        }
        await ctx.send({
          audio: result.buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        })
      } catch (error) {
        await replyTtsError((message) => ctx.reply(message), error)
      }
    },
  },
  {
    name: 'voix',
    aliases: ['voixtts', 'languevoix'],
    description: 'Choisit la langue, la voix et la vitesse utilisées par .vocal.',
    usage: 'langue <fr|en-ng|en|sw|ar...> | homme | femme | choisir <voix> | liste [langue] | vitesse <+10%> | reset',
    category: 'Audio & Vidéo',
    cooldownSeconds: 3,
    async execute(ctx) {
      const service = serviceFor(ctx.config.dataDir)
      const action = ctx.args[0]?.toLowerCase()

      try {
        if (!action || action === 'statut') {
          const preference = await service.getPreference(ctx.sender)
          await ctx.reply(
            `Voix actuelle : *${preference.voice}*\nLangue : *${languageLabel(preference.locale)}*\nGenre : *${genderLabel(preference.gender)}*\nVitesse : *${preference.rate}*\n\n` +
            `${ctx.prefix}voix langue fr\n${ctx.prefix}voix homme\n${ctx.prefix}voix femme\n${ctx.prefix}voix liste fr\n${ctx.prefix}voix choisir fr-FR-DeniseNeural\n${ctx.prefix}voix vitesse +10%\n${ctx.prefix}voix reset`,
          )
          return
        }

        if (action === 'langue') {
          const language = ctx.args[1]
          if (!language) return void (await ctx.reply(`Exemple : ${ctx.prefix}voix langue fr`))
          const preference = await service.setLanguage(ctx.sender, language)
          await ctx.reply(`Langue vocale : *${languageLabel(preference.locale)}*\nVoix : *${preference.voice}*`)
          return
        }

        if (action === 'homme' || action === 'masculin' || action === 'femme' || action === 'feminin' || action === 'féminin') {
          const gender: TtsGender = action === 'homme' || action === 'masculin' ? 'Male' : 'Female'
          const preference = await service.setGender(ctx.sender, gender)
          await ctx.reply(`Voix *${genderLabel(preference.gender)}* activée : ${preference.voice}`)
          return
        }

        if (action === 'choisir' || action === 'selectionner' || action === 'sélectionner') {
          const voice = ctx.args[1]
          if (!voice) return void (await ctx.reply(`Exemple : ${ctx.prefix}voix choisir fr-FR-DeniseNeural`))
          const preference = await service.setVoice(ctx.sender, voice)
          await ctx.reply(`Voix sélectionnée : *${preference.voice}*`)
          return
        }

        if (action === 'liste') {
          const language = ctx.args[1] ?? (await service.getPreference(ctx.sender)).locale
          const voices = (await service.listVoices(language)).slice(0, 16)
          if (!voices.length) {
            await ctx.reply('Aucune voix trouvée pour cette langue.')
            return
          }
          await ctx.reply(
            `Voix disponibles (${language}) :\n` +
            voices.map((voice) => `- ${voice.name} (${genderLabel(voice.gender)})`).join('\n') +
            `\n\nChoisir : ${ctx.prefix}voix choisir NOM_DE_LA_VOIX`,
          )
          return
        }

        if (action === 'vitesse') {
          const rate = ctx.args[1]
          if (!rate) return void (await ctx.reply(`Exemple : ${ctx.prefix}voix vitesse +10%`))
          const preference = await service.setRate(ctx.sender, rate)
          await ctx.reply(`Vitesse vocale : *${preference.rate}*`)
          return
        }

        if (action === 'reset' || action === 'reinitialiser' || action === 'réinitialiser') {
          const preference = await service.resetPreference(ctx.sender)
          await ctx.reply(`Réglages vocaux réinitialisés : *${preference.voice}*`)
          return
        }

        await ctx.reply(
          `Utilisation : ${ctx.prefix}voix langue fr | homme | femme | liste fr | choisir <voix> | vitesse +10% | reset`,
        )
      } catch (error) {
        await replyTtsError((message) => ctx.reply(message), error)
      }
    },
  },
]
