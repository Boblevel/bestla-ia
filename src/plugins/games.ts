import { randomInt } from 'node:crypto'
import type { BotCommand, CommandContext } from '../types.js'
import { normalizeWords } from '../utils/text.js'

type Mark = '❌' | '⭕'

interface MorpionGame {
  players: [string, string]
  board: Array<Mark | null>
  turn: 0 | 1
  createdAt: number
}

interface GuessGame {
  target: number
  attempts: number
  createdAt: number
}

interface QuizGame {
  answer: string
  question: string
  createdAt: number
}

const morpionGames = new Map<string, MorpionGame>()
const guessGames = new Map<string, GuessGame>()
const quizGames = new Map<string, QuizGame>()

const QUIZZES = [
  { question: 'Quel est le résultat de 7 × 8 ?', answer: '56' },
  { question: 'Quelle planète est surnommée la planète rouge ?', answer: 'mars' },
  { question: 'Combien de côtés possède un hexagone ?', answer: '6' },
  { question: 'Quelle est la capitale du Burkina Faso ?', answer: 'ouagadougou' },
  { question: 'Quel mot français désigne l’opposé de « rapide » ?', answer: 'lent' },
]

function gameKey(ctx: CommandContext): string {
  return `${ctx.sessionName}:${ctx.chatId}`
}

function personalKey(ctx: CommandContext): string {
  return `${ctx.sessionName}:${ctx.chatId}:${ctx.sender}`
}

function compactJid(jid: string): string {
  return `@${jid.split('@')[0]?.split(':')[0] ?? 'joueur'}`
}

function boardView(board: Array<Mark | null>): string {
  const cells = board.map((value, index) => value ?? String(index + 1))
  return `${cells.slice(0, 3).join(' | ')}\n─────────\n${cells.slice(3, 6).join(' | ')}\n─────────\n${cells.slice(6, 9).join(' | ')}`
}

function winner(board: Array<Mark | null>): 0 | 1 | 2 | undefined {
  const lines: Array<[number, number, number]> = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ]
  for (const [a, b, c] of lines) {
    const first = board[a]
    if (first && first === board[b] && first === board[c]) return first === '❌' ? 0 : 1
  }
  return board.every(Boolean) ? 2 : undefined
}

function normalize(value: string): string {
  return normalizeWords(value).join(' ')
}

export const gameCommands: BotCommand[] = [
  {
    name: 'morpion',
    aliases: [],
    description: 'Joue au morpion avec une personne dans le chat actuel.',
    usage: 'creer @personne|jouer <1-9>|annuler',
    category: 'Jeux',
    cooldownSeconds: 2,
    async execute(ctx) {
      const key = gameKey(ctx)
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'creer') {
        const target = ctx.targetUser()
        if (!target || target === ctx.sender) return void (await ctx.reply(`Utilisation : ${ctx.prefix}morpion creer @personne`))
        morpionGames.set(key, { players: [ctx.sender, target], board: Array<Mark | null>(9).fill(null), turn: 0, createdAt: Date.now() })
        await ctx.reply(`🎮 *MORPION*\n\n${compactJid(ctx.sender)} joue ❌\n${compactJid(target)} joue ⭕\n\n${boardView(Array<Mark | null>(9).fill(null))}\n\nTour de ${compactJid(ctx.sender)} : ${ctx.prefix}morpion jouer 1`, [ctx.sender, target])
        return
      }
      if (action === 'annuler') {
        const game = morpionGames.get(key)
        if (!game) return void (await ctx.reply('Aucune partie de morpion en cours.'))
        if (!game.players.includes(ctx.sender) && !ctx.isOwner) return void (await ctx.reply('Seuls les joueurs ou le propriétaire peuvent annuler.'))
        morpionGames.delete(key)
        await ctx.reply('Partie de morpion annulée.')
        return
      }
      if (action !== 'jouer') return void (await ctx.reply(`Utilisation : ${ctx.prefix}morpion creer @personne ou ${ctx.prefix}morpion jouer 5`))
      const game = morpionGames.get(key)
      if (!game) return void (await ctx.reply(`Aucune partie. Commence avec ${ctx.prefix}morpion creer @personne`))
      const cell = Number(ctx.args[1])
      if (!Number.isInteger(cell) || cell < 1 || cell > 9) return void (await ctx.reply(`Utilisation : ${ctx.prefix}morpion jouer 1`))
      const player = game.players[game.turn]
      if (ctx.sender !== player) return void (await ctx.reply(`Ce n’est pas ton tour. Tour de ${compactJid(player)}.`, [player]))
      if (game.board[cell - 1]) return void (await ctx.reply('Cette case est déjà occupée.'))
      game.board[cell - 1] = game.turn === 0 ? '❌' : '⭕'
      const result = winner(game.board)
      if (result === 0 || result === 1) {
        const victor = game.players[result]
        morpionGames.delete(key)
        await ctx.reply(`🏆 ${compactJid(victor)} gagne !\n\n${boardView(game.board)}`, [victor])
        return
      }
      if (result === 2) {
        morpionGames.delete(key)
        await ctx.reply(`🤝 Match nul !\n\n${boardView(game.board)}`)
        return
      }
      game.turn = game.turn === 0 ? 1 : 0
      const next = game.players[game.turn]
      await ctx.reply(`${boardView(game.board)}\n\nTour de ${compactJid(next)} : ${ctx.prefix}morpion jouer <1-9>`, [next])
    },
  },
  {
    name: 'devinenombre',
    aliases: ['nombresecret'],
    description: 'Devine le nombre secret entre 1 et 100.',
    usage: 'debut|<nombre>|arreter',
    category: 'Jeux',
    cooldownSeconds: 2,
    async execute(ctx) {
      const key = personalKey(ctx)
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'debut') {
        guessGames.set(key, { target: randomInt(1, 101), attempts: 0, createdAt: Date.now() })
        return void (await ctx.reply(`🔢 J’ai choisi un nombre entre 1 et 100. Tente : ${ctx.prefix}devinenombre 50`))
      }
      if (action === 'arreter') {
        guessGames.delete(key)
        return void (await ctx.reply('Partie arrêtée.'))
      }
      const guess = Number(action)
      const game = guessGames.get(key)
      if (!game) return void (await ctx.reply(`Commence avec ${ctx.prefix}devinenombre debut`))
      if (!Number.isInteger(guess) || guess < 1 || guess > 100) return void (await ctx.reply('Choisis un nombre entier entre 1 et 100.'))
      game.attempts += 1
      if (guess === game.target) {
        guessGames.delete(key)
        return void (await ctx.reply(`🎉 Bravo ! C’était *${game.target}*. Trouvé en ${game.attempts} essai(s).`))
      }
      await ctx.reply(guess < game.target ? 'C’est plus grand ⬆️' : 'C’est plus petit ⬇️')
    },
  },
  {
    name: 'quiz',
    description: 'Lance un petit quiz de culture générale.',
    usage: 'nouveau|<réponse>|arreter',
    category: 'Jeux',
    cooldownSeconds: 3,
    async execute(ctx) {
      const key = personalKey(ctx)
      const action = ctx.argText.trim()
      if (!action || action.toLowerCase() === 'nouveau') {
        const quiz = QUIZZES[randomInt(0, QUIZZES.length)] ?? QUIZZES[0]
        if (!quiz) return
        quizGames.set(key, { ...quiz, createdAt: Date.now() })
        return void (await ctx.reply(`🧠 *QUIZ*\n\n${quiz.question}\n\nRéponds avec ${ctx.prefix}quiz ta réponse`))
      }
      if (action.toLowerCase() === 'arreter') {
        quizGames.delete(key)
        return void (await ctx.reply('Quiz arrêté.'))
      }
      const game = quizGames.get(key)
      if (!game) return void (await ctx.reply(`Lance un quiz avec ${ctx.prefix}quiz`))
      if (normalize(action) === normalize(game.answer)) {
        quizGames.delete(key)
        await ctx.reply('✅ Bonne réponse !')
      } else {
        await ctx.reply('❌ Pas encore. Essaie encore ou utilise .quiz arreter.')
      }
    },
  },
  {
    name: 'arreterjeu',
    description: 'Arrête tes jeux en cours dans ce chat.',
    category: 'Jeux',
    cooldownSeconds: 2,
    async execute(ctx) {
      const key = gameKey(ctx)
      const individual = personalKey(ctx)
      const morpion = morpionGames.get(key)
      if (morpion && (morpion.players.includes(ctx.sender) || ctx.isOwner)) morpionGames.delete(key)
      guessGames.delete(individual)
      quizGames.delete(individual)
      await ctx.reply('Tes jeux en cours ont été arrêtés.')
    },
  },
]
