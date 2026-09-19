#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants as fsConstants, existsSync } from 'node:fs'
import { access, chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface, type Interface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import { APP_VERSION } from './version.js'

const APP_DIRECTORY = process.env.BESTLA_DIR
  ? path.resolve(process.env.BESTLA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(APP_DIRECTORY, '.env')
const PROCESS_NAME = 'bestla-ia-bot'
const PANEL_WIDTH = 62
const COLOR_ENABLED = Boolean(output.isTTY && process.env.NO_COLOR !== '1' && process.env.TERM !== 'dumb')

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface EnvironmentData {
  raw: string
  values: Record<string, string>
}

interface SessionConfig {
  name: string
  phone: string
  mode: 'qr' | 'pairing'
}

interface SessionState extends SessionConfig {
  linked: boolean
}


interface LinkingArtifact {
  session: string
  type: 'qr' | 'pairing'
  value: string
  createdAt: string
}

interface Pm2Application {
  name?: string
  pm2_env?: {
    status?: string
    pm_uptime?: number
    restart_time?: number
  }
  monit?: {
    memory?: number
    cpu?: number
  }
}

interface BackupEntry {
  name: string
  filePath: string
  size: number
  modifiedAt: Date
}

type ToggleKey =
  | 'COMMANDS_ENABLED'
  | 'COMMAND_REACTIONS'
  | 'MARK_READ'
  | 'ALWAYS_ONLINE'
  | 'REJECT_CALLS'
  | 'MEDIA_AI_ENABLED'
  | 'MEDIA_AI_PUBLIC'

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  blue: '\u001b[38;5;39m',
  cyan: '\u001b[38;5;45m',
  green: '\u001b[38;5;42m',
  yellow: '\u001b[38;5;220m',
  red: '\u001b[38;5;203m',
  gray: '\u001b[38;5;245m',
}

function paint(value: string, tone: keyof typeof ANSI): string {
  if (!COLOR_ENABLED) return value
  return `${ANSI[tone]}${value}${ANSI.reset}`
}

function bold(value: string): string {
  return paint(value, 'bold')
}

function blue(value: string): string {
  return paint(value, 'blue')
}

function cyan(value: string): string {
  return paint(value, 'cyan')
}

function green(value: string): string {
  return paint(value, 'green')
}

function yellow(value: string): string {
  return paint(value, 'yellow')
}

function red(value: string): string {
  return paint(value, 'red')
}

function gray(value: string): string {
  return paint(value, 'gray')
}

function print(message = ''): void {
  output.write(`${message}\n`)
}

class ProgressDisplay {
  private current = 0
  private spinnerIndex = 0
  private readonly spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  set(percent: number, label: string): void {
    const target = Math.max(this.current, Math.min(100, Math.round(percent)))
    this.current = target
    this.render(label)
  }

  async step<T>(targetPercent: number, label: string, task: () => Promise<T>): Promise<T> {
    const target = Math.max(this.current, Math.min(100, Math.round(targetPercent)))
    let displayed = this.current
    let timer: ReturnType<typeof setInterval> | undefined

    if (output.isTTY) {
      timer = setInterval(() => {
        if (displayed < Math.max(this.current, target - 1)) {
          const gap = target - displayed
          displayed = Math.min(target - 1, displayed + Math.max(1, Math.ceil(gap / 10)))
          this.current = Math.max(this.current, displayed)
        }
        this.render(label, this.spinners[this.spinnerIndex % this.spinners.length])
        this.spinnerIndex += 1
      }, 180)
    } else {
      this.render(label)
    }

    try {
      const result = await task()
      this.current = target
      this.render(label, target < 100 ? '✓' : '')
      return result
    } catch (error) {
      if (output.isTTY) output.write('\n')
      throw error
    } finally {
      if (timer) clearInterval(timer)
    }
  }

  finish(label = 'Terminé'): void {
    this.current = 100
    this.render(label, '✓')
    output.write('\n')
  }

  private render(label: string, spinner = ''): void {
    // Garde toute la progression sur une seule ligne, même sur un terminal mobile étroit.
    // Une ligne trop longue se repliait visuellement et chaque rafraîchissement semblait
    // ajouter une nouvelle barre verticale dans Termius/Termux.
    const terminalColumns = Math.max(36, output.columns ?? 80)
    const suffix = spinner ? ` ${spinner}` : ''
    const percentText = `${String(this.current).padStart(3, ' ')}%`
    const reserved = percentText.length + suffix.length + 8
    const maxLabelWidth = Math.max(10, Math.min(26, terminalColumns - reserved - 10))
    const compactLabel = label.length > maxLabelWidth
      ? `${label.slice(0, Math.max(1, maxLabelWidth - 1))}…`
      : label
    const width = Math.max(8, Math.min(20, terminalColumns - reserved - compactLabel.length))
    const filled = Math.floor((this.current * width) / 100)
    const empty = Math.max(0, width - filled)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`
    const line = `${cyan(`[${bar}]`)} ${green(percentText)} ${compactLabel}${suffix}`
    if (output.isTTY) output.write(`\r\u001b[2K${line}`)
    else print(line)
  }
}

function panelRule(): void {
  print(blue('─'.repeat(PANEL_WIDTH + 2)))
}

function panelBox(title: string, subtitle?: string): void {
  print(blue(`╔${'═'.repeat(PANEL_WIDTH)}╗`))
  print(blue(`║${centered(title, PANEL_WIDTH)}║`))
  if (subtitle) print(blue(`║${centered(subtitle, PANEL_WIDTH)}║`))
  print(blue(`╚${'═'.repeat(PANEL_WIDTH)}╝`))
}

function sectionBox(title: string, subtitle?: string): void {
  print('')
  print(blue(`┌${'─'.repeat(PANEL_WIDTH)}┐`))
  print(blue(`│${centered(title, PANEL_WIDTH)}│`))
  if (subtitle) print(gray(`│${centered(subtitle, PANEL_WIDTH)}│`))
  print(blue(`└${'─'.repeat(PANEL_WIDTH)}┘`))
}

function centered(value: string, width: number): string {
  const content = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value
  const remaining = Math.max(0, width - content.length)
  const left = Math.floor(remaining / 2)
  return `${' '.repeat(left)}${content}${' '.repeat(remaining - left)}`
}

function clearScreen(): void {
  if (!output.isTTY || process.env.BESTLA_NO_CLEAR === '1') return
  // ESC c (RIS) est mal géré par certains terminaux mobiles. Cette séquence
  // efface l’écran, replace le curseur en haut et nettoie le scrollback.
  output.write('\u001b[2J\u001b[H\u001b[3J')
}

function heading(title: string, _subtitle?: string): void {
  print('')
  panelBox(title)
}

function cleanPhone(value: string): string {
  return value.replace(/\D/g, '')
}

function maskPhone(value: string): string {
  if (!value) return 'non renseigné'
  return value.length < 7 ? '***' : `${value.slice(0, 3)}••••${value.slice(-3)}`
}

function parseCsv(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))]
}

function parsePairs(value: string | undefined): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const entry of parseCsv(value)) {
    const separator = entry.indexOf(':')
    if (separator === -1) continue
    const key = entry.slice(0, separator).trim()
    const entryValue = entry.slice(separator + 1).trim()
    if (key && entryValue) pairs.set(key, entryValue)
  }
  return pairs
}

function validSessionName(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(value)
}

function validPhone(value: string): boolean {
  return /^\d{8,15}$/.test(value)
}

function formatSeconds(value: number): string {
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  return `${days ? `${days}j ` : ''}${hours}h ${minutes}min`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Mo'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const power = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const amount = value / 1024 ** power
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`
}

function parseToggle(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (['activer', 'active', 'on', 'oui', 'true', '1'].includes(normalized ?? '')) return true
  if (['desactiver', 'désactiver', 'inactive', 'off', 'non', 'false', '0'].includes(normalized ?? '')) return false
  return undefined
}

function normalizeMenuChoice(value: string): string {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed
}

function displayToggle(value: string | undefined): string {
  return value?.toLowerCase() === 'true' ? green('activé') : gray('désactivé')
}

function maskSecret(value: string | undefined): string {
  const secret = value?.trim() ?? ''
  if (!secret) return 'non configurée'
  if (secret.length <= 8) return `${secret.slice(0, 2)}••••`
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
}

function fitText(value: string, width: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  const clipped = compact.length > width ? `${compact.slice(0, Math.max(0, width - 1))}…` : compact
  return clipped.padEnd(width)
}

function dashboardInfoRow(label: string, value: string): void {
  const labelWidth = 10
  const valueWidth = PANEL_WIDTH - 15
  print(`${blue('║')} ${cyan(fitText(label.toUpperCase(), labelWidth))} ${blue('│')} ${green(fitText(value, valueWidth))} ${blue('║')}`)
}

async function exists(target: string): Promise<boolean> {
  return access(target, fsConstants.F_OK).then(() => true).catch(() => false)
}

async function run(command: string, args: string[], cwd = APP_DIRECTORY): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdoutValue = ''
    let stderrValue = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutValue += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrValue += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout: stdoutValue, stderr: stderrValue }))
  })
}

async function runInteractive(command: string, args: string[], cwd = APP_DIRECTORY): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

async function requireSuccess(command: string, args: string[], cwd = APP_DIRECTORY): Promise<CommandResult> {
  const result = await run(command, args, cwd)
  if (result.code !== 0) {
    const reason = (result.stderr || result.stdout).trim().slice(0, 600)
    throw new Error(reason || `La commande ${command} a échoué.`)
  }
  return result
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    const result = await run(command, ['--version'], APP_DIRECTORY)
    return result.code === 0
  } catch {
    return false
  }
}

async function readEnvironment(): Promise<EnvironmentData> {
  if (!(await exists(ENV_PATH))) throw new Error(`Fichier .env introuvable dans ${APP_DIRECTORY}. Lance d'abord l'installation.`)
  const raw = await readFile(ENV_PATH, 'utf8')
  return { raw, values: dotenv.parse(raw) }
}

function serializeEnvironmentValue(value: string): string {
  if (/^[A-Za-z0-9_.,:/@+\-]*$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function writeEnvironmentValues(changes: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`Clé de configuration invalide : ${key}`)
    if (/\r|\n/.test(value)) throw new Error('Une valeur de configuration ne peut pas contenir de retour à la ligne.')
  }
  const current = await readEnvironment()
  const lines = current.raw.replace(/\r\n/g, '\n').split('\n')
  for (const [key, value] of Object.entries(changes)) {
    const matcher = new RegExp(`^${key}=`)
    const newLine = `${key}=${serializeEnvironmentValue(value)}`
    const index = lines.findIndex((line) => matcher.test(line))
    if (index >= 0) lines[index] = newLine
    else {
      if (lines.length && lines.at(-1) !== '') lines.push('')
      lines.push(newLine)
    }
  }
  const temporary = `${ENV_PATH}.bestla-tmp`
  await writeFile(temporary, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 })
  await rename(temporary, ENV_PATH)
  await chmod(ENV_PATH, 0o600).catch(() => undefined)
}

async function writeEnvironmentValue(key: string, value: string): Promise<void> {
  await writeEnvironmentValues({ [key]: value })
}

async function removeEnvironmentKeys(keys: string[]): Promise<void> {
  if (!keys.length) return
  const current = await readEnvironment()
  const names = new Set(keys)
  const lines = current.raw.replace(/\r\n/g, '\n').split('\n').filter((line) => {
    const separator = line.indexOf('=')
    if (separator <= 0) return true
    return !names.has(line.slice(0, separator).trim())
  })
  const temporary = `${ENV_PATH}.bestla-tmp`
  await writeFile(temporary, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 })
  await rename(temporary, ENV_PATH)
  await chmod(ENV_PATH, 0o600).catch(() => undefined)
}

function sessionConfigs(values: Record<string, string>): SessionConfig[] {
  const phones = parsePairs(values.SESSION_PHONES)
  const modes = parsePairs(values.SESSION_AUTH_MODES)
  const defaultMode = values.AUTH_MODE === 'pairing' ? 'pairing' : 'qr'
  return parseCsv(values.SESSION_NAMES || 'main').map((name) => ({
    name,
    phone: cleanPhone(phones.get(name) ?? ''),
    mode: modes.get(name) === 'pairing' ? 'pairing' : modes.get(name) === 'qr' ? 'qr' : defaultMode,
  }))
}

function dataDirectory(values: Record<string, string>): string {
  return path.resolve(APP_DIRECTORY, values.DATA_DIR || 'data')
}


function linkingArtifactPath(values: Record<string, string>, name: string): string {
  return path.join(dataDirectory(values), 'linking', `${name}.json`)
}

async function clearLinkingArtifact(values: Record<string, string>, name: string): Promise<void> {
  await rm(linkingArtifactPath(values, name), { force: true }).catch(() => undefined)
}

async function readLinkingArtifact(values: Record<string, string>, name: string): Promise<LinkingArtifact | undefined> {
  try {
    const parsed = JSON.parse(await readFile(linkingArtifactPath(values, name), 'utf8')) as Partial<LinkingArtifact>
    if (parsed.session !== name) return undefined
    if (parsed.type !== 'qr' && parsed.type !== 'pairing') return undefined
    if (typeof parsed.value !== 'string' || !parsed.value.trim()) return undefined
    if (typeof parsed.createdAt !== 'string') return undefined
    const createdAt = Date.parse(parsed.createdAt)
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > 120_000) return undefined
    return parsed as LinkingArtifact
  } catch {
    return undefined
  }
}

async function waitForLinkingArtifact(
  values: Record<string, string>,
  name: string,
  timeoutMs: number,
): Promise<LinkingArtifact | undefined> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  do {
    const artifact = await readLinkingArtifact(values, name)
    if (artifact) return artifact
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (true)
  return undefined
}

function formatPairingCode(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, '')
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : value.trim()
}

function renderLinkingArtifact(artifact: LinkingArtifact): void {
  heading('LIAISON WHATSAPP', `Session ${artifact.session}`)
  if (artifact.type === 'pairing') {
    print('')
    print(bold(centered('CODE DE LIAISON', PANEL_WIDTH + 2)))
    print('')
    print(bold(centered(formatPairingCode(artifact.value), PANEL_WIDTH + 2)))
    print('')
    print('WhatsApp → Appareils connectés → Connecter un appareil')
    print('→ Lier avec un numéro de téléphone → saisis le code ci-dessus.')
  } else {
    print('')
    print(bold('QR WHATSAPP'))
    print('')
    qrcode.generate(artifact.value, { small: true }, (qrText: string) => print(qrText.trimEnd()))
    print('')
    print('WhatsApp → Appareils connectés → Connecter un appareil → scanne ce QR.')
  }
  print('')
  print(yellow('Ne partage jamais ce QR ou ce code de liaison.'))
}

async function showSessionLinking(name: string, timeoutMs = 0): Promise<void> {
  if (!validSessionName(name)) throw new Error('Nom de session invalide.')
  const state = await getSessionStates()
  const session = state.sessions.find((entry) => entry.name === name)
  if (!session) throw new Error(`Session introuvable : ${name}`)
  if (session.linked) {
    print(green(`✓ La session « ${name} » est déjà liée à WhatsApp.`))
    return
  }
  const artifact = await waitForLinkingArtifact(state.environment.values, name, timeoutMs)
  if (!artifact) throw new Error('Aucun QR/code prêt. Depuis Numéros WhatsApp, choisis « Générer / afficher QR ou code ».')
  renderLinkingArtifact(artifact)
}

async function generateOrShowSessionLinking(name: string): Promise<void> {
  if (!validSessionName(name)) throw new Error('Nom de session invalide.')
  const state = await getSessionStates()
  const session = state.sessions.find((entry) => entry.name === name)
  if (!session) throw new Error(`Session introuvable : ${name}`)
  if (session.linked) {
    print(green(`✓ La session « ${name} » est déjà liée à WhatsApp.`))
    print(gray('Pour créer une nouvelle liaison, utilise « Réinitialiser une liaison ».'))
    return
  }
  const existing = await readLinkingArtifact(state.environment.values, name)
  if (existing) {
    renderLinkingArtifact(existing)
    return
  }
  print(gray('Génération de la liaison WhatsApp…'))
  await controlProcess('restart')
  await showSessionLinking(name, 20_000)
}

async function runtimeDatabase(values: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  const databasePath = path.join(dataDirectory(values), 'database.json')
  try {
    const parsed = JSON.parse(await readFile(databasePath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function effectivePrefix(values: Record<string, string>): Promise<string> {
  const database = await runtimeDatabase(values)
  const global = database?.global && typeof database.global === 'object' && !Array.isArray(database.global)
    ? database.global as Record<string, unknown>
    : undefined
  const runtimePrefix = typeof global?.prefix === 'string' ? global.prefix.trim() : ''
  return runtimePrefix || values.PREFIX || '.'
}

async function persistRuntimePrefix(values: Record<string, string>, prefix: string): Promise<void> {
  const databasePath = path.join(dataDirectory(values), 'database.json')
  if (!(await exists(databasePath))) return
  const database = await runtimeDatabase(values)
  if (!database) return
  const global = database.global && typeof database.global === 'object' && !Array.isArray(database.global)
    ? database.global as Record<string, unknown>
    : {}
  global.prefix = prefix
  database.global = global
  const temporary = `${databasePath}.bestla-prefix-tmp`
  await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, databasePath)
}

function sessionRuntimeStatusPath(directory: string, name: string): string {
  return path.join(directory, 'session-status', `${name}.json`)
}

async function clearSessionRuntimeStatus(values: Record<string, string>, name: string): Promise<void> {
  await rm(sessionRuntimeStatusPath(dataDirectory(values), name), { force: true }).catch(() => undefined)
}

async function sessionIsLinked(directory: string, name: string): Promise<boolean> {
  try {
    const credentials = JSON.parse(await readFile(path.join(directory, 'sessions', name, 'creds.json'), 'utf8')) as {
      registered?: unknown
      me?: { id?: unknown }
    }
    if (credentials.registered === true) return true
    if (typeof credentials.me?.id === 'string' && credentials.me.id.trim()) return true
  } catch {
    // Le fichier d'authentification peut être en cours d'écriture : on vérifie aussi l'état runtime ci-dessous.
  }

  try {
    const runtime = JSON.parse(await readFile(sessionRuntimeStatusPath(directory, name), 'utf8')) as {
      linked?: unknown
    }
    return runtime.linked === true
  } catch {
    return false
  }
}

async function getSessionStates(): Promise<{ environment: EnvironmentData; sessions: SessionState[] }> {
  const environment = await readEnvironment()
  const directory = dataDirectory(environment.values)
  const sessions = await Promise.all(sessionConfigs(environment.values).map(async (session) => ({
    ...session,
    linked: await sessionIsLinked(directory, session.name),
  })))
  return { environment, sessions }
}

function printSessionRows(sessions: SessionState[]): void {
  if (!sessions.length) {
    print(gray('Aucune session configurée.'))
    return
  }
  print(`${bold('SESSION'.padEnd(18))}${bold('MODE'.padEnd(12))}${bold('NUMÉRO'.padEnd(18))}${bold('LIAISON')}`)
  print(blue('─'.repeat(PANEL_WIDTH + 2)))
  for (const session of sessions) {
    const status = session.linked ? green('liée') : yellow('à lier')
    print(`${cyan(session.name.padEnd(18))}${session.mode.padEnd(12)}${maskPhone(session.phone).padEnd(18)}${status}`)
  }
}

async function listSessions(): Promise<void> {
  const { sessions } = await getSessionStates()
  heading('NUMÉROS WHATSAPP', 'Bestla iA - gestion multi-sessions')
  printSessionRows(sessions)
  print('')
  print(gray('Ajouter : ') + 'bestla sessions ajouter NOM NUMERO qr|pairing')
  print(gray('Mode    : ') + 'bestla sessions mode NOM qr|pairing')
  print(gray('Réinitialiser : ') + 'bestla sessions reinitialiser NOM confirmer')
  print(gray('Retirer : ') + 'bestla sessions retirer NOM confirmer')
}

async function pm2Installed(): Promise<boolean> {
  return commandAvailable('pm2')
}

async function getPm2Application(): Promise<Pm2Application | undefined> {
  if (!(await pm2Installed())) return undefined
  const result = await run('pm2', ['jlist'])
  if (result.code !== 0) return undefined
  try {
    const list = JSON.parse(result.stdout) as Pm2Application[]
    return list.find((entry) => entry.name === PROCESS_NAME)
  } catch {
    return undefined
  }
}

async function pm2ProcessExists(): Promise<boolean> {
  return Boolean(await getPm2Application())
}

async function controlProcess(action: 'start' | 'stop' | 'restart', quiet = false): Promise<void> {
  if (!(await pm2Installed())) throw new Error('PM2 est absent. Lance : bash installer-vps.sh')
  const processExists = await pm2ProcessExists()
  if (action === 'start') {
    if (processExists) await requireSuccess('pm2', ['start', PROCESS_NAME, '--update-env'])
    else await requireSuccess('pm2', ['start', 'ecosystem.config.cjs', '--only', PROCESS_NAME, '--update-env'])
  } else if (action === 'stop') {
    if (!processExists) {
      if (!quiet) print('Le bot est déjà arrêté ou non enregistré dans PM2.')
      return
    }
    await requireSuccess('pm2', ['stop', PROCESS_NAME])
  } else if (processExists) {
    await requireSuccess('pm2', ['restart', PROCESS_NAME, '--update-env'])
  } else {
    await requireSuccess('pm2', ['start', 'ecosystem.config.cjs', '--only', PROCESS_NAME, '--update-env'])
  }
  await requireSuccess('pm2', ['save'])
  const message = action === 'stop' ? 'Bestla iA est arrêté.' : action === 'start' ? 'Bestla iA est démarré.' : 'Bestla iA est redémarré.'
  if (!quiet) print(green(`✓ ${message}`))
}

async function restartAfterConfiguration(message: string): Promise<void> {
  print(green(`✓ ${message}`))
  await controlProcess('restart', true)
  print(gray('La configuration est appliquée. La liaison WhatsApp se gère dans Numéros WhatsApp.'))
}

async function addSession(args: string[]): Promise<void> {
  const [name = '', rawPhone = '', rawMode = 'qr'] = args
  const phone = cleanPhone(rawPhone)
  const mode = rawMode.toLowerCase()
  if (!validSessionName(name)) throw new Error('Nom de session invalide. Utilise lettres, chiffres, _ ou -, sans espace.')
  if (!validPhone(phone)) throw new Error('Numéro invalide. Utilise le format international sans +, espace ni tiret.')
  if (mode !== 'qr' && mode !== 'pairing') throw new Error('Mode invalide. Utilise qr ou pairing.')
  const environment = await readEnvironment()
  const sessions = sessionConfigs(environment.values)
  if (sessions.some((session) => session.name === name)) throw new Error(`La session « ${name} » existe déjà.`)
  if (sessions.some((session) => session.phone === phone)) throw new Error('Ce numéro est déjà associé à une session.')
  const phones = parsePairs(environment.values.SESSION_PHONES)
  const modes = parsePairs(environment.values.SESSION_AUTH_MODES)
  phones.set(name, phone)
  modes.set(name, mode)
  await clearLinkingArtifact(environment.values, name)
  await clearSessionRuntimeStatus(environment.values, name)
  await writeEnvironmentValues({
    SESSION_NAMES: [...sessions.map((session) => session.name), name].join(','),
    SESSION_PHONES: [...phones].map(([key, value]) => `${key}:${value}`).join(','),
    SESSION_AUTH_MODES: [...modes].map(([key, value]) => `${key}:${value}`).join(','),
  })
  await restartAfterConfiguration(`Session « ${name} » ajoutée en mode ${mode}.`)
}

async function setSessionMode(args: string[]): Promise<void> {
  const [name = '', rawMode = ''] = args
  const mode = rawMode.toLowerCase()
  if (mode !== 'qr' && mode !== 'pairing') throw new Error('Utilisation : bestla sessions mode NOM qr|pairing')
  const environment = await readEnvironment()
  const sessions = sessionConfigs(environment.values)
  if (!sessions.some((session) => session.name === name)) throw new Error(`Session introuvable : ${name}`)
  const modes = parsePairs(environment.values.SESSION_AUTH_MODES)
  modes.set(name, mode)
  await clearLinkingArtifact(environment.values, name)
  await writeEnvironmentValue('SESSION_AUTH_MODES', [...modes].map(([key, value]) => `${key}:${value}`).join(','))
  await restartAfterConfiguration(`Mode de liaison de « ${name} » réglé sur ${mode}.`)
}

async function retiredSessionDirectory(values: Record<string, string>): Promise<string> {
  const directory = path.join(dataDirectory(values), 'sessions-retirees')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}

async function resetSession(args: string[]): Promise<void> {
  const [name = '', confirmation = ''] = args
  if (confirmation.toLowerCase() !== 'confirmer') {
    throw new Error('Pour confirmer : bestla sessions reinitialiser NOM confirmer')
  }
  const environment = await readEnvironment()
  const sessions = sessionConfigs(environment.values)
  if (!sessions.some((session) => session.name === name)) throw new Error(`Session introuvable : ${name}`)
  const sessionDirectory = path.join(dataDirectory(environment.values), 'sessions', name)
  await clearLinkingArtifact(environment.values, name)
  await clearSessionRuntimeStatus(environment.values, name)
  if (await exists(sessionDirectory)) {
    const retiredDirectory = await retiredSessionDirectory(environment.values)
    const target = path.join(retiredDirectory, `${name}-reinitialisee-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    await rename(sessionDirectory, target)
    print(gray(`Anciennes clés déplacées dans : ${target}`))
  }
  await restartAfterConfiguration(`Liaison de « ${name} » réinitialisée.`)
}

async function removeSession(args: string[]): Promise<void> {
  const [name = '', confirmation = ''] = args
  if (confirmation.toLowerCase() !== 'confirmer') throw new Error('Pour confirmer : bestla sessions retirer NOM confirmer')
  const environment = await readEnvironment()
  const sessions = sessionConfigs(environment.values)
  if (sessions.length <= 1) throw new Error('Impossible de retirer la dernière session. Ajoute d abord un autre numéro ou garde main.')
  if (!sessions.some((session) => session.name === name)) throw new Error(`Session introuvable : ${name}`)
  const phones = parsePairs(environment.values.SESSION_PHONES)
  const modes = parsePairs(environment.values.SESSION_AUTH_MODES)
  phones.delete(name)
  modes.delete(name)
  const sessionDirectory = path.join(dataDirectory(environment.values), 'sessions', name)
  await clearLinkingArtifact(environment.values, name)
  await clearSessionRuntimeStatus(environment.values, name)
  if (await exists(sessionDirectory)) {
    const retiredDirectory = await retiredSessionDirectory(environment.values)
    await rename(sessionDirectory, path.join(retiredDirectory, `${name}-retiree-${new Date().toISOString().replace(/[:.]/g, '-')}`))
  }
  await writeEnvironmentValues({
    SESSION_NAMES: sessions.filter((session) => session.name !== name).map((session) => session.name).join(','),
    SESSION_PHONES: [...phones].map(([key, value]) => `${key}:${value}`).join(','),
    SESSION_AUTH_MODES: [...modes].map(([key, value]) => `${key}:${value}`).join(','),
  })
  await restartAfterConfiguration(`Session « ${name} » retirée. Ses clés éventuelles restent dans data/sessions-retirees.`)
}

async function manageOwners(args: string[]): Promise<void> {
  const action = args[0]?.toLowerCase() ?? 'liste'
  const environment = await readEnvironment()
  const owners = parseCsv(environment.values.OWNER_NUMBERS).map(cleanPhone).filter(Boolean)
  if (action === 'liste') {
    heading('NUMÉROS PROPRIÉTAIRES', 'Seuls ces numéros peuvent contrôler le bot')
    if (!owners.length) print(yellow('Aucun numéro propriétaire configuré.'))
    else owners.forEach((phone) => print(`• ${cyan(maskPhone(phone))}`))
    print('')
    print(gray('Ajouter : ') + 'bestla proprietaires ajouter 22670000000')
    print(gray('Retirer : ') + 'bestla proprietaires retirer 22670000000 confirmer')
    return
  }
  const phone = cleanPhone(args[1] ?? '')
  if (!validPhone(phone)) throw new Error('Numéro invalide. Utilise le format international sans +.')
  if (action === 'ajouter') {
    if (owners.includes(phone)) throw new Error('Ce numéro est déjà propriétaire.')
    await writeEnvironmentValue('OWNER_NUMBERS', [...owners, phone].join(','))
    await restartAfterConfiguration('Numéro propriétaire ajouté.')
    return
  }
  if (action === 'retirer') {
    if (args[2]?.toLowerCase() !== 'confirmer') throw new Error('Pour confirmer : bestla proprietaires retirer NUMERO confirmer')
    if (!owners.includes(phone)) throw new Error('Ce numéro n est pas dans la liste des propriétaires.')
    if (owners.length === 1) throw new Error('Garde au moins un numéro propriétaire pour conserver le contrôle du bot.')
    await writeEnvironmentValue('OWNER_NUMBERS', owners.filter((entry) => entry !== phone).join(','))
    await restartAfterConfiguration('Numéro propriétaire retiré.')
    return
  }
  throw new Error('Utilise : liste, ajouter ou retirer.')
}

async function showConfiguration(): Promise<void> {
  const { values } = await readEnvironment()
  const prefix = await effectivePrefix(values)
  heading('CONFIGURATION BESTLA iA', 'Réglages protégés du bot')
  print(`${cyan('Nom')}              : ${values.BOT_NAME || 'Bestla iA'}`)
  print(`${cyan('Signature')}        : ${values.BOT_SIGNATURE || 'RHAFF SERVICE'}`)
  print(`${cyan('Préfixe WhatsApp')} : ${prefix}`)
  print(`${cyan('Mode')}             : ${values.PUBLIC_MODE === 'false' ? yellow('privé') : green('public')}`)
  print(`${cyan('Fuseau horaire')}   : ${values.TIMEZONE || 'Africa/Ouagadougou'}`)
  print(`${cyan('Commandes')}       : ${displayToggle(values.COMMANDS_ENABLED)}`)
  print(`${cyan('Réactions ⏳/✅')}  : ${displayToggle(values.COMMAND_REACTIONS ?? 'true')}`)
  print(`${cyan('Marquer lu')}       : ${displayToggle(values.MARK_READ)}`)
  print(`${cyan('Toujours en ligne')}: ${displayToggle(values.ALWAYS_ONLINE)}`)
  print(`${cyan('Rejeter appels')}   : ${displayToggle(values.REJECT_CALLS)}`)
  const geminiKey = (values.AI_API_KEY || values.MEDIA_AI_API_KEY || '').trim()
  const imageProvider = (values.MEDIA_AI_IMAGE_PROVIDER || 'cloudflare').trim()
  const videoProvider = (values.MEDIA_AI_VIDEO_PROVIDER || 'gemini').trim()
  print(`${cyan('Assistant IA')}     : ${green('Gemini')} ${geminiKey ? green('(clé configurée)') : gray('(clé manquante)')}`)
  print(`${cyan('Modèle texte')}      : ${values.AI_MODEL || 'gemini-3.6-flash'}`)
  print(`${cyan('Clé Gemini')}        : ${maskSecret(geminiKey)}`)
  print(`${cyan('Médias IA')}        : ${displayToggle(values.MEDIA_AI_ENABLED ?? 'true')}`)
  print(`${cyan('Images IA')}        : ${imageProvider} ${green('(pool central 2 comptes)')}`)
  print(`${cyan('Vidéos IA')}        : ${videoProvider}${geminiKey ? green(' + secours local 5 s') : green(' (secours local 5 s)')}`)
  print(`${cyan('Médias IA publics')}: ${displayToggle(values.MEDIA_AI_PUBLIC)}`)
  print('')
  print(gray('Exemples : ') + 'bestla configuration prefixe !')
  print(gray('            ') + 'bestla configuration apigemini statut')
  print(gray('            ') + 'bestla configuration mediaia activer')

}

async function setToggleConfiguration(key: ToggleKey, value: string | undefined, label: string): Promise<void> {
  const enabled = parseToggle(value)
  if (enabled === undefined) throw new Error(`Utilisation : bestla configuration ${label} activer|desactiver`)
  await writeEnvironmentValue(key, enabled ? 'true' : 'false')
  await restartAfterConfiguration(`${label} ${enabled ? 'activé' : 'désactivé'}.`)
}

async function updateConfiguration(args: string[]): Promise<void> {
  const action = args[0]?.toLowerCase()
  if (!action || action === 'voir' || action === 'liste') return showConfiguration()
  if (action === 'prefixe') {
    const prefix = args[1] ?? ''
    if (!prefix || prefix.length > 4 || /\s/.test(prefix)) throw new Error('Le préfixe doit contenir 1 à 4 caractères sans espace.')
    const environment = await readEnvironment()
    await writeEnvironmentValue('PREFIX', prefix)
    await persistRuntimePrefix(environment.values, prefix)
    return restartAfterConfiguration(`Préfixe changé pour « ${prefix} » sur le serveur et dans WhatsApp.`)
  }
  if (action === 'mode') {
    const mode = args[1]?.toLowerCase()
    if (mode !== 'public' && mode !== 'prive' && mode !== 'privé') throw new Error('Utilisation : bestla configuration mode public|prive')
    await writeEnvironmentValue('PUBLIC_MODE', mode === 'public' ? 'true' : 'false')
    return restartAfterConfiguration(`Mode ${mode === 'public' ? 'public' : 'privé'} activé.`)
  }
  if (action === 'nom' || action === 'signature') {
    const value = args.slice(1).join(' ').trim()
    if (!value || value.length > 80) throw new Error('Indique un texte de 1 à 80 caractères.')
    await writeEnvironmentValue(action === 'nom' ? 'BOT_NAME' : 'BOT_SIGNATURE', value)
    return restartAfterConfiguration(`${action === 'nom' ? 'Nom du bot' : 'Signature'} mis à jour.`)
  }
  if (action === 'fuseau' || action === 'timezone') {
    const timezone = args[1]?.trim() ?? ''
    if (!timezone || timezone.length > 80) throw new Error('Indique un fuseau valide, par exemple Africa/Ouagadougou.')
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format()
    } catch {
      throw new Error('Fuseau horaire invalide. Exemple : Africa/Ouagadougou')
    }
    await writeEnvironmentValue('TIMEZONE', timezone)
    return restartAfterConfiguration(`Fuseau horaire réglé sur ${timezone}.`)
  }
  if (action === 'commandes') return setToggleConfiguration('COMMANDS_ENABLED', args[1], 'commandes')
  if (action === 'reactionscommandes' || action === 'reactioncommandes') return setToggleConfiguration('COMMAND_REACTIONS', args[1], 'reactionscommandes')
  if (action === 'apigemini' || action === 'mediaapikey' || action === 'clemediaia') {
    const value = (args[1] ?? '').trim()
    if (!value) {
      throw new Error('Utilisation : bestla configuration apigemini statut|tester|vider|TA_CLE_API')
    }
    const normalized = value.toLowerCase()
    if (normalized === 'statut' || normalized === 'status') {
      const values = (await readEnvironment()).values
      const currentKey = (values.AI_API_KEY || values.MEDIA_AI_API_KEY || '').trim()
      heading('CLÉ GEMINI', 'État de la connexion Google Gemini')
      print(`${cyan('Fournisseur')} : ${green('Gemini')}`)
      print(`${cyan('Clé')}         : ${maskSecret(currentKey)}`)
      print(`${cyan('Texte')}       : ${values.AI_MODEL || 'gemini-3.6-flash'}`)
      print(`${cyan('Retouche')}    : ${values.MEDIA_AI_IMAGE_EDIT_MODEL || 'gemini-3.1-flash-image'}`)
      print(`${cyan('Vidéo')}       : ${values.MEDIA_AI_VIDEO_MODEL || 'gemini-omni-flash-preview'}`)
      return
    }
    if (normalized === 'tester' || normalized === 'test') {
      const values = (await readEnvironment()).values
      const currentKey = (values.AI_API_KEY || values.MEDIA_AI_API_KEY || '').trim()
      if (!currentKey) throw new Error('Aucune clé Gemini configurée. Ajoute-la d’abord dans Configuration > Clé Gemini.')
      const currentModel = (values.AI_MODEL || 'gemini-3.6-flash').trim()
      await testGeminiApiKey(currentKey, currentModel)
      print(green(`✓ Clé Gemini valide : ${currentModel} répond correctement.`))
      return
    }
    if (normalized === 'vider' || normalized === 'supprimer' || normalized === 'retirer') {
      await writeEnvironmentValues({
        AI_PROVIDER: 'gemini',
        AI_API_KEY: '',
        AI_MODEL: 'gemini-3.6-flash',
        AI_BASE_URL: '',
        AI_PUBLIC: 'false',
        MEDIA_AI_PROVIDER: 'mixed',
        MEDIA_AI_API_KEY: '',
        MEDIA_AI_IMAGE_EDIT_MODEL: 'gemini-3.1-flash-image',
        MEDIA_AI_VIDEO_MODEL: 'gemini-omni-flash-preview',
      })
      await removeEnvironmentKeys(['POLLINATIONS_API_KEY', 'POLLINATIONS_TEXT_MODEL'])
      return restartAfterConfiguration('Clé Gemini retirée. Le texte, la retouche image et la vidéo IA resteront désactivés jusqu’à l’ajout d’une nouvelle clé.')
    }
    if (value.length < 20) throw new Error('La clé Gemini semble trop courte. Copie la clé complète depuis Google AI Studio.')
    await testGeminiApiKey(value, 'gemini-3.6-flash')
    await writeEnvironmentValues({
      AI_PROVIDER: 'gemini',
      AI_API_KEY: value,
      AI_MODEL: 'gemini-3.6-flash',
      AI_BASE_URL: '',
      AI_PUBLIC: 'false',
      MEDIA_AI_PROVIDER: 'mixed',
      MEDIA_AI_API_KEY: value,
      MEDIA_AI_IMAGE_EDIT_MODEL: 'gemini-3.1-flash-image',
      MEDIA_AI_VIDEO_MODEL: 'gemini-omni-flash-preview',
      MEDIA_AI_VIDEO_PROVIDER: 'gemini',
    })
    await removeEnvironmentKeys(['POLLINATIONS_API_KEY', 'POLLINATIONS_TEXT_MODEL'])
    return restartAfterConfiguration('Clé Gemini vérifiée et enregistrée. Bestla utilise maintenant Gemini pour le texte et la vidéo IA.')
  }
  if (action === 'imagecloudflare' || action === 'cloudflareimage') {
    const first = (args[1] ?? '').trim()
    const second = (args[2] ?? '').trim()
    if (!first) {
      throw new Error('Utilisation : bestla configuration imagecloudflare statut|vider|ACCOUNT_ID API_TOKEN')
    }
    const normalized = first.toLowerCase()
    if (normalized === 'statut' || normalized === 'status') {
      const values = (await readEnvironment()).values
      const accountId = (values.MEDIA_AI_CLOUDFLARE_ACCOUNT_ID || '').trim()
      const token = (values.MEDIA_AI_CLOUDFLARE_API_TOKEN || '').trim()
      heading('CLOUDFLARE IMAGE', "État de la génération d'images")
      print(`${cyan('Fournisseur')} : ${values.MEDIA_AI_IMAGE_PROVIDER || 'cloudflare'}`)
      print(`${cyan('Account ID')}  : ${accountId || 'non configuré'}`)
      print(`${cyan('API Token')}   : ${maskSecret(token)}`)
      print(`${cyan('Modèle')}      : ${values.MEDIA_AI_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell'}`)
      return
    }
    if (normalized === 'vider' || normalized === 'supprimer' || normalized === 'retirer') {
      await writeEnvironmentValues({
        MEDIA_AI_IMAGE_PROVIDER: 'cloudflare',
        MEDIA_AI_CLOUDFLARE_ACCOUNT_ID: '',
        MEDIA_AI_CLOUDFLARE_API_TOKEN: '',
        MEDIA_AI_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
      })
      return restartAfterConfiguration('Configuration Cloudflare image supprimée.')
    }
    const accountId = first
    const apiToken = second
    if (accountId.length < 8 || apiToken.length < 20) {
      throw new Error('Indique un Account ID et un API Token Cloudflare valides.')
    }
    await writeEnvironmentValues({
      MEDIA_AI_PROVIDER: 'mixed',
      MEDIA_AI_IMAGE_PROVIDER: 'cloudflare',
      MEDIA_AI_CLOUDFLARE_ACCOUNT_ID: accountId,
      MEDIA_AI_CLOUDFLARE_API_TOKEN: apiToken,
      MEDIA_AI_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
    })
    return restartAfterConfiguration('Configuration Cloudflare enregistrée. Les images IA utiliseront maintenant Cloudflare.')
  }
  if (action === 'mediaia') {
    const enabled = parseToggle(args[1])
    if (enabled === undefined) throw new Error('Utilisation : bestla configuration mediaia activer|desactiver')
    return setToggleConfiguration('MEDIA_AI_ENABLED', enabled ? 'activer' : 'desactiver', 'mediaia')
  }
  if (action === 'mediaiapublic') return setToggleConfiguration('MEDIA_AI_PUBLIC', args[1], 'mediaiapublic')
  if (action === 'marquerlu') return setToggleConfiguration('MARK_READ', args[1], 'marquerlu')
  if (action === 'toujoursenligne') return setToggleConfiguration('ALWAYS_ONLINE', args[1], 'toujoursenligne')
  if (action === 'rejeterappels') return setToggleConfiguration('REJECT_CALLS', args[1], 'rejeterappels')
  throw new Error('Configuration : prefixe, mode, nom, signature, fuseau, commandes, reactionscommandes, apigemini, imagecloudflare, mediaia, mediaiapublic, marquerlu, toujoursenligne, rejeterappels.')
}

async function processStatus(): Promise<void> {
  heading('ÉTAT DU SERVICE BESTLA iA', `Version ${APP_VERSION}`)
  if (!(await pm2Installed())) {
    print(red('PM2 est absent. Exécute : bash installer-vps.sh'))
    return
  }
  const app = await getPm2Application()
  if (!app) {
    print(yellow('Bestla iA n est pas encore enregistré dans PM2. Lance : bestla demarrer'))
    return
  }
  const memory = app.monit?.memory ? formatBytes(app.monit.memory) : 'inconnue'
  const uptime = app.pm2_env?.pm_uptime ? Math.max(0, Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1_000)) : 0
  const status = app.pm2_env?.status ?? 'inconnu'
  print(`Statut       : ${status === 'online' ? green(status) : red(status)}`)
  print(`Mémoire      : ${memory} • CPU : ${app.monit?.cpu ?? 0} %`)
  print(`Redémarrages : ${app.pm2_env?.restart_time ?? 0} • Durée : ${formatSeconds(uptime)}`)
  print('')
  printSessionRows((await getSessionStates()).sessions)
}

async function showLogs(live: boolean): Promise<void> {
  if (!(await pm2Installed())) throw new Error('PM2 est absent.')
  if (live) {
    print(yellow('Journaux en direct : arrête avec Ctrl+C.'))
    await runInteractive('pm2', ['logs', PROCESS_NAME, '--lines', '80'])
    return
  }
  const result = await run('pm2', ['logs', PROCESS_NAME, '--lines', '80', '--nostream'])
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim() || 'Journaux indisponibles.')
  output.write(result.stdout || result.stderr)
}

function backupDirectory(): string {
  return path.join(path.dirname(APP_DIRECTORY), 'sauvegardes-bestla')
}

async function listBackupsData(): Promise<BackupEntry[]> {
  const directory = backupDirectory()
  const names = await readdir(directory).catch(() => [] as string[])
  const entries = await Promise.all(names
    .filter((name) => /^bestla-[A-Za-z0-9T_.-]+\.tar\.gz$/.test(name))
    .map(async (name) => {
      const filePath = path.join(directory, name)
      const metadata = await stat(filePath)
      return { name, filePath, size: metadata.size, modifiedAt: metadata.mtime }
    }))
  return entries.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime())
}

async function createBackup(): Promise<void> {
  const progress = new ProgressDisplay()
  progress.set(0, 'Préparation de la sauvegarde')
  const environment = await progress.step(20, 'Lecture de la configuration', readEnvironment)
  const directory = backupDirectory()
  await progress.step(35, 'Préparation du dossier', () => mkdir(directory, { recursive: true, mode: 0o700 }))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archive = path.join(directory, `bestla-${stamp}.tar.gz`)
  const configuredDataDirectory = dataDirectory(environment.values)
  const argumentsForTar = ['-czf', archive, '-C', APP_DIRECTORY, '.env']
  const relativeDataDirectory = path.relative(APP_DIRECTORY, configuredDataDirectory)
  if (relativeDataDirectory && !relativeDataDirectory.startsWith('..') && !path.isAbsolute(relativeDataDirectory) && await exists(configuredDataDirectory)) {
    argumentsForTar.push(relativeDataDirectory)
  }
  await progress.step(90, 'Compression des données', () => requireSuccess('tar', argumentsForTar, APP_DIRECTORY))
  await chmod(archive, 0o600).catch(() => undefined)
  progress.finish('Sauvegarde terminée')
  print(green(`✓ Sauvegarde créée : ${archive}`))
  print(yellow('Elle contient les réglages et sessions WhatsApp : garde-la strictement privée.'))
}

async function listBackups(): Promise<void> {
  heading('SAUVEGARDES BESTLA iA', 'Archives privées de configuration et de sessions')
  const backups = await listBackupsData()
  if (!backups.length) {
    print(gray('Aucune sauvegarde créée pour le moment.'))
    return
  }
  print(`${bold('ARCHIVE'.padEnd(38))}${bold('TAILLE'.padEnd(12))}${bold('DATE')}`)
  print(blue('─'.repeat(PANEL_WIDTH + 2)))
  for (const backup of backups) {
    print(`${cyan(backup.name.slice(0, 37).padEnd(38))}${formatBytes(backup.size).padEnd(12)}${backup.modifiedAt.toLocaleString('fr-FR')}`)
  }
  print('')
  print(gray('Restaurer : ') + 'bestla sauvegardes restaurer NOM_ARCHIVE confirmer')
  print(gray('Nettoyer : ') + 'bestla sauvegardes nettoyer 5 confirmer')
}

async function restoreBackup(args: string[]): Promise<void> {
  const [name = '', confirmation = ''] = args
  if (confirmation.toLowerCase() !== 'confirmer') {
    throw new Error('Pour confirmer : bestla sauvegardes restaurer NOM_ARCHIVE confirmer')
  }
  if (!/^bestla-[A-Za-z0-9T_.-]+\.tar\.gz$/.test(name)) throw new Error('Nom de sauvegarde invalide.')
  const backup = (await listBackupsData()).find((entry) => entry.name === name)
  if (!backup) throw new Error('Sauvegarde introuvable.')

  const contents = await requireSuccess('tar', ['-tzf', backup.filePath])
  const members = contents.stdout.split('\n').map((item) => item.trim()).filter(Boolean)
  if (!members.includes('.env') || members.some((entry) => entry.startsWith('/') || entry.split('/').includes('..') || (entry !== '.env' && !entry.startsWith('data/')))) {
    throw new Error('Cette archive ne correspond pas à une sauvegarde valide.')
  }

  // Crée d'abord un point de sécurité complet. Cette opération affiche sa
  // propre progression 0→100, puis la restauration démarre avec une nouvelle barre.
  await createBackup()

  const progress = new ProgressDisplay()
  progress.set(0, 'Préparation de la restauration')
  const processExists = await pm2ProcessExists()
  if (processExists) await progress.step(20, 'Arrêt temporaire du service', () => controlProcess('stop', true))
  else progress.set(20, 'Service déjà arrêté')
  await progress.step(82, 'Restauration des données', () => requireSuccess('tar', ['-xzf', backup.filePath, '-C', APP_DIRECTORY, '--no-same-owner']))
  await chmod(ENV_PATH, 0o600).catch(() => undefined)
  if (processExists) await progress.step(96, 'Redémarrage du service', () => controlProcess('restart', true))
  progress.finish('Restauration terminée')
  print(green(`✓ Sauvegarde restaurée : ${name}`))
}

async function cleanBackups(args: string[]): Promise<void> {
  const keep = Number(args[0])
  const confirmation = args[1]?.toLowerCase()
  if (!Number.isInteger(keep) || keep < 1 || keep > 50) throw new Error('Indique le nombre de sauvegardes à conserver (1 à 50).')
  if (confirmation !== 'confirmer') throw new Error(`Pour confirmer : bestla sauvegardes nettoyer ${keep} confirmer`)
  const progress = new ProgressDisplay()
  progress.set(0, 'Analyse des sauvegardes')
  const backups = await progress.step(25, 'Inventaire des archives', listBackupsData)
  const toDelete = backups.slice(keep)
  const total = Math.max(1, toDelete.length)
  for (const [index, backup] of toDelete.entries()) {
    await rm(backup.filePath, { force: true })
    progress.set(25 + Math.floor(((index + 1) / total) * 70), 'Suppression des anciennes archives')
  }
  progress.finish('Nettoyage des sauvegardes terminé')
  print(green(`✓ ${toDelete.length} ancienne(s) sauvegarde(s) supprimée(s). ${Math.min(keep, backups.length)} conservée(s).`))
}

async function listSchedulesFromPanel(): Promise<void> {
  const environment = await readEnvironment()
  const databasePath = path.join(dataDirectory(environment.values), 'database.json')
  heading('MESSAGES PROGRAMMÉS', 'Les programmes restent liés à leur chat WhatsApp')
  if (!(await exists(databasePath))) {
    print(gray('Aucun fichier de données trouvé pour le moment.'))
    return
  }
  let parsed: { schedules?: Array<{ id?: string; nextRunAt?: string; repeat?: string; status?: string; sessionName?: string; message?: string }> }
  try {
    parsed = JSON.parse(await readFile(databasePath, 'utf8')) as typeof parsed
  } catch {
    throw new Error('La base de données des programmes est illisible.')
  }
  const jobs = (parsed.schedules ?? [])
    .filter((job) => job.status === 'en_attente' || job.status === 'en_cours')
    .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''))
    .slice(0, 50)
  if (!jobs.length) {
    print(gray('Aucun message programmé actif.'))
  } else {
    for (const job of jobs) {
      print(`• ${cyan(job.id ?? '?')} | ${job.status ?? '?'} | ${job.nextRunAt ?? '?'} | ${job.repeat ?? 'aucune'} | ${job.sessionName ?? 'main'}`)
      print(`  ${gray(String(job.message ?? '').replace(/\s+/g, ' ').slice(0, 120))}`)
    }
  }
  print('')
  print(gray('Pour programmer/annuler dans le bon chat WhatsApp : ') + '.programmer et .annulerprogramme')
}

function detectedPackageManager(): string {
  const commands: Array<[string, string]> = [
    ['apt-get', 'APT'],
    ['dnf', 'DNF'],
    ['yum', 'YUM'],
    ['apk', 'APK'],
    ['pacman', 'Pacman'],
    ['zypper', 'Zypper'],
    ['xbps-install', 'XBPS'],
  ]
  return commands.find(([command]) => process.env.PATH?.split(path.delimiter).some((folder) => existsSync(path.join(folder, command))))?.[1] ?? 'inconnu'
}

async function getOperatingSystemName(): Promise<string> {
  if (process.platform !== 'linux') return `${process.platform} ${os.release()}`
  try {
    const release = await readFile('/etc/os-release', 'utf8')
    const match = release.match(/^PRETTY_NAME="?([^"\n]+)"?$/m)
    if (match?.[1]) return match[1]
  } catch {
    // Fallback below.
  }
  return `Linux ${os.release()}`
}

function localIpAddress(): string {
  try {
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const item of interfaces ?? []) {
        if (!item.internal && item.family === 'IPv4') return item.address
      }
    }
  } catch {
    return 'non détectée'
  }
  return 'non détectée'
}

async function doctor(): Promise<void> {
  heading('DIAGNOSTIC BESTLA iA', 'Vérification du bot et de son environnement')
  const progress = new ProgressDisplay()
  progress.set(0, 'Initialisation du diagnostic')
  const node = await progress.step(18, 'Vérification Node.js', async () => run('node', ['--version']).catch(() => ({ code: 1, stdout: '', stderr: '' })))
  const npm = await progress.step(34, 'Vérification npm', async () => run('npm', ['--version']).catch(() => ({ code: 1, stdout: '', stderr: '' })))
  const ffmpeg = await progress.step(50, 'Vérification FFmpeg', () => commandAvailable('ffmpeg'))
  const pm2 = await progress.step(66, 'Vérification PM2', pm2Installed)
  const packageExists = await progress.step(78, 'Vérification des fichiers', () => exists(path.join(APP_DIRECTORY, 'package.json')))
  const environmentExists = await progress.step(88, 'Vérification de la configuration', () => exists(ENV_PATH))
  const operatingSystem = await progress.step(96, 'Lecture du système', getOperatingSystemName)
  const sessions = environmentExists ? await getSessionStates() : undefined
  progress.finish('Diagnostic terminé')
  print(`Système          : ${operatingSystem} (${detectedPackageManager()})`)
  print(`Dossier projet   : ${packageExists ? green('✓') : red('✗')} ${APP_DIRECTORY}`)
  print(`Node.js          : ${node.code === 0 ? green(`✓ ${node.stdout.trim()}`) : red('✗ absent')}`)
  print(`npm              : ${npm.code === 0 ? green(`✓ ${npm.stdout.trim()}`) : red('✗ absent')}`)
  print(`FFmpeg           : ${ffmpeg ? green('✓ disponible') : yellow('✗ absent - audio/vidéo indisponibles')}`)
  print(`PM2              : ${pm2 ? green('✓ disponible') : red('✗ absent')}`)
  print(`.env             : ${environmentExists ? green('✓ présent') : red('✗ absent')}`)
  if (sessions) {
    print('')
    printSessionRows(sessions.sessions)
  }
}

async function updateFromGit(args: string[]): Promise<void> {
  if (args[0]?.toLowerCase() !== 'confirmer') {
    throw new Error('Cette action applique la dernière version disponible. Confirme avec : bestla miseajour confirmer')
  }
  if (!(await commandAvailable('git'))) throw new Error('Le moteur de mise à jour est indisponible. Lance : bash installer-vps.sh')
  if (!(await exists(path.join(APP_DIRECTORY, '.git')))) {
    throw new Error('Cette installation ne prend pas encore en charge la mise à jour automatique. Utilise le fichier de mise à jour fourni.')
  }
  const dirty = await requireSuccess('git', ['status', '--porcelain'])
  if (dirty.stdout.trim()) throw new Error('Le dossier contient des modifications locales. Sauvegarde-les ou publie-les avant la mise à jour.')
  heading('MISE À JOUR BESTLA iA', 'Vérification, tests et redémarrage sécurisé')
  const progress = new ProgressDisplay()
  progress.set(0, 'Préparation de la mise à jour')
  await progress.step(18, 'Téléchargement GitHub', () => requireSuccess('git', ['pull', '--ff-only']))
  await progress.step(42, 'Dépendances Node.js', () => requireSuccess('npm', ['ci']))
  await progress.step(58, 'Vérification TypeScript', () => requireSuccess('npm', ['run', 'typecheck']))
  await progress.step(74, 'Tests automatiques', () => requireSuccess('npm', ['test']))
  await progress.step(90, 'Construction', () => requireSuccess('npm', ['run', 'build']))
  await progress.step(98, 'Redémarrage du service', () => controlProcess('restart', true))
  progress.finish('Mise à jour terminée')
  print(green('✓ Nouvelle version appliquée.'))
}

async function enableBootStart(): Promise<void> {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('Cette action demande root. Lance le panneau avec sudo.')
  }
  if (!(await pm2Installed())) throw new Error('PM2 est absent.')
  const progress = new ProgressDisplay()
  progress.set(0, 'Configuration du démarrage')
  if (await commandAvailable('systemctl')) {
    await progress.step(75, 'Activation systemd', () => requireSuccess('pm2', ['startup', 'systemd', '-u', 'root', '--hp', '/root']))
  } else if (await commandAvailable('rc-service')) {
    await progress.step(75, 'Activation OpenRC', () => requireSuccess('pm2', ['startup', 'openrc', '-u', 'root', '--hp', '/root']))
  } else {
    throw new Error('Aucun système d initialisation compatible détecté. Utilise la politique de redémarrage de ton conteneur.')
  }
  await progress.step(95, 'Enregistrement PM2', () => requireSuccess('pm2', ['save']))
  progress.finish('Démarrage automatique activé')
  print(green('✓ Démarrage automatique PM2 configuré.'))
}

async function restartServer(args: string[]): Promise<void> {
  if (args[0]?.toLowerCase() !== 'confirmer') {
    throw new Error('Le VPS va redémarrer et la connexion SSH sera coupée. Confirme avec : bestla serveur redemarrer confirmer')
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) throw new Error('Cette action demande root.')
  if (await commandAvailable('systemctl')) {
    await run('systemctl', ['reboot'])
    return
  }
  await requireSuccess('shutdown', ['-r', 'now'])
}

async function displayQuickHelp(): Promise<void> {
  heading('BESTLA iA - COMMANDES VPS', `RHAFF SERVICE • version ${APP_VERSION}`)
  print(`${cyan('bestla')}                     ouvre le panneau de contrôle interactif`)
  print(`${cyan('bestla statut')}              état du bot et des numéros WhatsApp`)
  print(`${cyan('bestla sessions')}            liste les numéros configurés`)
  print(`${cyan('bestla logs live')}           affiche les journaux en direct`)
  print(`${cyan('bestla sauvegarde')}          sauvegarde privée des réglages/sessions`)
  print(`${cyan('bestla nettoyer confirmer')}  supprime ZIP/tests/sauvegardes de migration`)
  print(`${cyan('bestla desinstaller confirmer')} désinstalle complètement Bestla`)
  print(`${cyan('bestla miseajour confirmer')} applique la dernière version disponible`)
  print('')
  print(gray('Dans WhatsApp : ') + '.menu pour les commandes du bot, ou .menu categorie.')
}

async function dispatch(argumentsList: string[]): Promise<void> {
  const command = argumentsList[0]?.toLowerCase()
  const args = argumentsList.slice(1)
  switch (command) {
    case undefined:
      await interactivePanel()
      return
    case 'aide':
    case 'help':
    case 'menu':
    case 'panneau':
      await displayQuickHelp()
      return
    case 'statut':
    case 'status':
      await processStatus()
      return
    case 'demarrer':
    case 'start':
      await controlProcess('start')
      return
    case 'stopper':
    case 'stop':
      await controlProcess('stop')
      return
    case 'redemarrer':
    case 'restart':
      await controlProcess('restart')
      return
    case 'logs':
      await showLogs(args[0]?.toLowerCase() === 'live')
      return
    case 'sessions':
      if (!args[0] || args[0] === 'liste') await listSessions()
      else if (args[0] === 'ajouter') await addSession(args.slice(1))
      else if (args[0] === 'retirer') await removeSession(args.slice(1))
      else if (args[0] === 'mode') await setSessionMode(args.slice(1))
      else if (args[0] === 'reinitialiser' || args[0] === 'réinitialiser') await resetSession(args.slice(1))
      else if (args[0] === 'liaison' || args[0] === 'lier') {
        const timeoutSeconds = Math.max(0, Number(args[2] ?? '0') || 0)
        await showSessionLinking(args[1] ?? 'main', timeoutSeconds * 1_000)
      }
      else throw new Error('Utilise : bestla sessions [liste|ajouter|mode|reinitialiser|retirer]')
      return
    case 'proprietaires':
    case 'proprietaire':
      await manageOwners(args)
      return
    case 'configuration':
    case 'config':
      await updateConfiguration(args)
      return
    case 'sauvegarde':
    case 'backup':
      await createBackup()
      return
    case 'sauvegardes':
      if (!args[0] || args[0] === 'liste') await listBackups()
      else if (args[0] === 'restaurer') await restoreBackup(args.slice(1))
      else if (args[0] === 'nettoyer') await cleanBackups(args.slice(1))
      else throw new Error('Utilise : bestla sauvegardes [liste|restaurer|nettoyer]')
      return
    case 'programmes':
    case 'planification':
      await listSchedulesFromPanel()
      return
    case 'diagnostic':
    case 'doctor':
      await doctor()
      return
    case 'miseajour':
    case 'update':
      await updateFromGit(args)
      return
    case 'nettoyer':
    case 'cleanup':
      if (args[0]?.toLowerCase() !== 'confirmer') throw new Error('Confirme avec : bestla nettoyer confirmer')
      await cleanupWorkspaceArtifacts()
      return
    case 'desinstaller':
    case 'uninstall':
      if (args[0]?.toLowerCase() !== 'confirmer') throw new Error('Confirme avec : bestla desinstaller confirmer')
      await uninstallBestlaCompletely()
      return
    case 'demarrageauto':
      await enableBootStart()
      return
    case 'serveur':
      if (args[0]?.toLowerCase() === 'redemarrer') await restartServer(args.slice(1))
      else throw new Error('Utilise : bestla serveur redemarrer confirmer')
      return
    case 'version':
      print(`Bestla iA v${APP_VERSION}`)
      return
    default:
      throw new Error(`Commande inconnue : ${command}. Tape simplement « bestla » pour le panneau.`)
  }
}

async function pause(reader: Interface, message = 'Entrée pour revenir au menu…'): Promise<void> {
  await reader.question(`\n${gray(message)}`)
}

async function safely(reader: Interface, action: () => Promise<void>, returnMessage?: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    print(red(`✗ ${error instanceof Error ? error.message : 'Erreur inconnue.'}`))
  }
  await pause(reader, returnMessage)
}

async function askConfirmation(reader: Interface, prompt: string, _legacyExpected?: string): Promise<boolean> {
  while (true) {
    const answer = (await reader.question(`${prompt} ${gray('[o/n]')} : `)).trim().toLowerCase()
    if (['o', 'oui', 'y', 'yes'].includes(answer)) return true
    if (['n', 'non', 'no', ''].includes(answer)) {
      print(yellow('Action annulée.'))
      return false
    }
    print(yellow('Réponds simplement par o (oui) ou n (non).'))
  }
}

async function renderDashboard(): Promise<void> {
  clearScreen()
  const [systemName, app, sessionData] = await Promise.all([
    getOperatingSystemName(),
    getPm2Application(),
    getSessionStates().catch(() => undefined),
  ])
  const usedMemory = Math.max(0, os.totalmem() - os.freemem())
  const appStatus = app?.pm2_env?.status ?? 'non démarré'
  const uptime = app?.pm2_env?.pm_uptime
    ? formatSeconds(Math.max(0, Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1_000)))
    : '—'
  const linkedCount = sessionData?.sessions.filter((entry) => entry.linked).length ?? 0
  const ownersCount = parseCsv(sessionData?.environment.values.OWNER_NUMBERS).length

  print(blue(`╔${'═'.repeat(PANEL_WIDTH)}╗`))
  print(blue(`║${centered('R H A F F   S E R V I C E', PANEL_WIDTH)}║`))
  print(blue(`║${centered(`BESTLA iA • V4`, PANEL_WIDTH)}║`))
  print(blue(`╠${'═'.repeat(PANEL_WIDTH)}╣`))
  dashboardInfoRow('OS', systemName)
  dashboardInfoRow('IP', localIpAddress())
  dashboardInfoRow('RAM', `${formatBytes(usedMemory)} / ${formatBytes(os.totalmem())}`)
  dashboardInfoRow('CPU', `${os.cpus().length} cœur(s)`)
  dashboardInfoRow('BOT', `${appStatus.toUpperCase()} • ${uptime}`)
  dashboardInfoRow('WHATSAPP', `${sessionData?.sessions.length ?? 0} session(s) • ${linkedCount} liée(s) • ${ownersCount} propriétaire(s)`)
  print(blue(`╚${'═'.repeat(PANEL_WIDTH)}╝`))

  print('')
  print(bold(centered('MENU PRINCIPAL', PANEL_WIDTH + 2)))
  panelRule()
  print(`${cyan('[01]')}  ${bold('📱  NUMÉROS WHATSAPP')}`)
  print(`${cyan('[02]')}  ${bold('🔌  CONTRÔLE DU BOT')}`)
  print(`${cyan('[03]')}  ${bold('⚙️   CONFIGURATION & PROPRIÉTAIRES')}`)
  print(`${cyan('[04]')}  ${bold('⏱️   AUTOMATISATIONS & CLIENTS')}`)
  print(`${cyan('[05]')}  ${bold('🧰  SAUVEGARDES')}`)
  print(`${cyan('[06]')}  ${bold('🩺  MAINTENANCE & SYSTÈME')}`)
  print(`${cyan('[07]')}  ${bold('📜  JOURNAUX')}`)
  print(`${cyan('[08]')}  ${bold('📚  GUIDE D UTILISATION')}`)
  panelRule()
  print(`${cyan('[00]')}  ${bold('🚪  QUITTER')}`)
}

function renderSubmenu(title: string, _subtitle?: string): void {
  clearScreen()
  panelBox('R H A F F   S E R V I C E', `BESTLA iA • ${title}`)
  panelRule()
}

function returnOption(): void {
  panelRule()
  print(`${cyan('[0]')} ${bold('⬅ RETOUR AU MENU PRINCIPAL')}`)
}

async function sessionsPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('NUMÉROS WHATSAPP', 'Chaque numéro possède sa session indépendante')
    const sessionData = await getSessionStates()
    printSessionRows(sessionData.sessions)
    panelRule()
    print(`${cyan('[1]')} ${bold('➕ AJOUTER UN NUMÉRO WHATSAPP')}`)
    print(`${cyan('[2]')} ${bold('🔗 CHANGER LE MODE QR / CODE DE LIAISON')}`)
    print(`${cyan('[3]')} ${bold('♻ RÉINITIALISER UNE LIAISON')}`)
    print(`${cyan('[4]')} ${bold('🗑 RETIRER UN NUMÉRO')}`)
    print(`${cyan('[5]')} ${bold('📋 VOIR LE DÉTAIL DES SESSIONS')}`)
    print(`${cyan('[6]')} ${bold('🔳 GÉNÉRER / AFFICHER QR OU CODE')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') {
      await safely(reader, async () => {
        const name = (await reader.question('Nom de session (ex. boutique) : ')).trim()
        const phone = (await reader.question('Numéro international sans + : ')).trim()
        const modeChoice = (await reader.question('Mode [1] QR  [2] code de liaison : ')).trim()
        const mode = modeChoice === '2' || modeChoice.toLowerCase() === 'pairing' ? 'pairing' : 'qr'
        await addSession([name, phone, mode])
        await showSessionLinking(name, 20_000)
      })
      continue
    }
    if (choice === '2') {
      await safely(reader, async () => {
        const name = (await reader.question('Session concernée : ')).trim()
        const modeChoice = (await reader.question('Nouveau mode [1] QR  [2] code : ')).trim()
        const mode = modeChoice === '2' || modeChoice.toLowerCase() === 'pairing' ? 'pairing' : 'qr'
        await setSessionMode([name, mode])
        await showSessionLinking(name, 20_000)
      })
      continue
    }
    if (choice === '3') {
      await safely(reader, async () => {
        const name = (await reader.question('Session à réinitialiser : ')).trim()
        if (await askConfirmation(reader, `Réinitialiser la liaison de ${name}`)) {
          await resetSession([name, 'confirmer'])
          await showSessionLinking(name, 20_000)
        }
      })
      continue
    }
    if (choice === '4') {
      await safely(reader, async () => {
        const current = (await getSessionStates()).sessions
        if (!current.length) throw new Error('Aucune session à retirer.')
        print('')
        print(bold('Choisis le numéro WhatsApp à retirer :'))
        current.forEach((session, index) => print(`${cyan(`[${index + 1}]`)} ${session.name} • ${maskPhone(session.phone)}`))
        print(`${cyan('[0]')} Annuler`)
        const selected = Number.parseInt((await reader.question('Numéro : ')).trim(), 10)
        if (selected === 0) return
        const name = current[selected - 1]?.name
        if (!name) throw new Error('Choix invalide.')
        await removeSession([name, 'confirmer'])
      })
      continue
    }
    if (choice === '5') {
      await safely(reader, listSessions)
      continue
    }
    if (choice === '6') {
      await safely(reader, async () => {
        const sessionData = await getSessionStates()
        const defaultName = sessionData.sessions.length === 1 ? sessionData.sessions[0]?.name ?? 'main' : ''
        const answer = (await reader.question(`Session à lier${defaultName ? ` [${defaultName}]` : ''} : `)).trim()
        await generateOrShowSessionLinking(answer || defaultName)
      }, 'Entrée pour revenir aux numéros…')
      continue
    }
    print(yellow('Choix invalide.'))
    await pause(reader)
  }
}

async function botControlPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('CONTRÔLE DU BOT', 'Actions directes sur le service Bestla iA')
    const app = await getPm2Application()
    const status = app?.pm2_env?.status ?? 'non démarré'
    print(`${cyan('État actuel')} : ${status === 'online' ? green(status) : yellow(status)} • ${gray(`redémarrages : ${app?.pm2_env?.restart_time ?? 0}`)}`)
    panelRule()
    print(`${cyan('[1]')} ${bold('📊 VOIR L ÉTAT COMPLET')}`)
    print(`${cyan('[2]')} ${bold('▶ DÉMARRER LE BOT')}`)
    print(`${cyan('[3]')} ${bold('🔄 REDÉMARRER LE BOT')}`)
    print(`${cyan('[4]')} ${bold('⏹ ARRÊTER LE BOT')}`)
    print(`${cyan('[5]')} ${bold('🧷 ACTIVER LE DÉMARRAGE APRÈS REBOOT')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, processStatus)
    else if (choice === '2') await safely(reader, () => controlProcess('start'))
    else if (choice === '3') await safely(reader, () => controlProcess('restart', true))
    else if (choice === '4') await safely(reader, async () => {
      if (await askConfirmation(reader, 'Arrêter le bot', 'ARRETER')) await controlProcess('stop')
    })
    else if (choice === '5') await safely(reader, enableBootStart)
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function ownersPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('PROPRIÉTAIRES', 'Numéros autorisés à commander Bestla iA')
    const values = (await readEnvironment()).values
    const owners = parseCsv(values.OWNER_NUMBERS).map(cleanPhone).filter(Boolean)
    owners.forEach((phone, index) => print(`${cyan(`[${index + 1}]`)} ${maskPhone(phone)}`))
    if (!owners.length) print(yellow('Aucun propriétaire configuré.'))
    panelRule()
    print(`${cyan('[1]')} ${bold('➕ AJOUTER UN PROPRIÉTAIRE')}`)
    print(`${cyan('[2]')} ${bold('🗑 RETIRER UN PROPRIÉTAIRE')}`)
    print(`${cyan('[3]')} ${bold('📋 VOIR LA LISTE DÉTAILLÉE')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, async () => {
      const phone = (await reader.question('Numéro international à ajouter : ')).trim()
      await manageOwners(['ajouter', phone])
    })
    else if (choice === '2') await safely(reader, async () => {
      if (!owners.length) throw new Error('Aucun propriétaire à retirer.')
      const selected = Number.parseInt((await reader.question('Choisis le numéro du propriétaire à retirer : ')).trim(), 10)
      const phone = owners[selected - 1]
      if (!phone) throw new Error('Choix invalide.')
      if (await askConfirmation(reader, `Retirer ${maskPhone(phone)}`, 'RETIRER')) await manageOwners(['retirer', phone, 'confirmer'])
    })
    else if (choice === '3') await safely(reader, () => manageOwners(['liste']))
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

const GEMINI_API_KEYS_URL = 'https://aistudio.google.com/app/apikey'

async function testGeminiApiKey(apiKey: string, model = 'gemini-3.6-flash'): Promise<void> {
  const key = apiKey.trim()
  if (key.length < 20) throw new Error('Clé Gemini absente ou incomplète.')
  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(25_000),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Réponds uniquement: OK' }] }],
          generationConfig: { maxOutputTokens: 16 },
        }),
      },
    )
  } catch {
    throw new Error('Impossible de joindre Google Gemini. Vérifie la connexion Internet du VPS puis réessaie.')
  }
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string }
    candidates?: unknown[]
  }
  if (!response.ok) {
    const message = payload.error?.message?.trim()
    throw new Error(
      message
        ? `Gemini a refusé le test (${response.status}) : ${message.slice(0, 220)}`
        : `Gemini a refusé le test (${response.status}).`,
    )
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new Error(`La clé est reconnue, mais le modèle ${model} n’a pas renvoyé de réponse exploitable.`)
  }
}

async function showGeminiInstructions(): Promise<void> {
  heading('OBTENIR UNE CLÉ GEMINI', 'Guide simple • Google AI Studio')
  print(`${cyan('1.')} Ouvre ce lien officiel dans ton navigateur :`)
  print(blue(GEMINI_API_KEYS_URL))
  print('')
  print(`${cyan('2.')} Connecte-toi avec ton compte Google.`)
  print(`${cyan('3.')} Dans « Clés API », utilise une clé existante ou appuie sur « Créer une clé API ».`)
  print(`${cyan('4.')} Appuie sur l’icône de copie à côté de la clé.`)
  print(`${cyan('5.')} Sur le VPS concerné, ouvre Bestla > Configuration > Clé Gemini > Ajouter / remplacer.`)
  print(`${cyan('6.')} Colle la clé complète. Bestla la vérifie avant de l’enregistrer.`)
  print('')
  print(yellow('Important : chaque VPS doit utiliser sa propre clé. Ne la partage jamais dans WhatsApp, GitHub ou une capture d’écran.'))
  print(gray('Le niveau gratuit et les modèles disponibles dépendent des quotas et règles de Google.'))
}

async function geminiKeyPanel(reader: Interface): Promise<void> {
  const initialValues = (await readEnvironment()).values
  const legacyTextModels = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.5-flash'])
  const currentTextModel = (initialValues.AI_MODEL || '').trim()
  await writeEnvironmentValues({
    AI_PROVIDER: 'gemini',
    MEDIA_AI_PROVIDER: 'gemini',
    ...(legacyTextModels.has(currentTextModel) || !currentTextModel ? { AI_MODEL: 'gemini-3.6-flash' } : {}),
  })
  await removeEnvironmentKeys(['POLLINATIONS_API_KEY', 'POLLINATIONS_TEXT_MODEL'])
  while (true) {
    const values = (await readEnvironment()).values
    const currentKey = (values.AI_API_KEY || values.MEDIA_AI_API_KEY || '').trim()
    renderSubmenu('CLÉ GEMINI', 'Clé privée de ce VPS • chaque installation utilise sa propre clé')
    print(`${cyan('État')}       : ${currentKey ? green('configurée') : yellow('non configurée')}`)
    print(`${cyan('Clé')}        : ${maskSecret(currentKey)}`)
    print(`${cyan('Modèle texte')}: ${values.AI_MODEL || 'gemini-3.6-flash'}`)
    panelRule()
    print(`${cyan('[1]')} ${bold('🔑 AJOUTER / REMPLACER LA CLÉ')}`)
    print(`${cyan('[2]')} ${bold('🧪 TESTER LA CLÉ ACTUELLE')}`)
    print(`${cyan('[3]')} ${bold('🗑 RETIRER LA CLÉ')}`)
    print(`${cyan('[4]')} ${bold('📖 COMMENT OBTENIR UNE CLÉ GEMINI')}`)
    print(`${cyan('[5]')} ${bold('📋 VOIR LE STATUT GEMINI')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, async () => {
      print(gray('Cette clé appartient uniquement à ce VPS / cette installation Bestla.'))
      print(gray('Pour un autre utilisateur ou un autre VPS, configure sa propre clé depuis ce même menu.'))
      const apiKey = (await reader.question('Colle la clé Gemini complète : ')).trim()
      if (!apiKey) throw new Error('Aucune clé saisie.')
      await updateConfiguration(['apigemini', apiKey])
    })
    else if (choice === '2') await safely(reader, async () => {
      await updateConfiguration(['apigemini', 'tester'])
    })
    else if (choice === '3') await safely(reader, async () => {
      if (!currentKey) {
        print(yellow('Aucune clé Gemini n’est configurée.'))
        return
      }
      if (await askConfirmation(reader, 'Retirer la clé Gemini et désactiver les fonctions IA')) {
        await updateConfiguration(['apigemini', 'vider'])
      }
    })
    else if (choice === '4') await safely(reader, showGeminiInstructions)
    else if (choice === '5') await safely(reader, async () => {
      await updateConfiguration(['apigemini', 'statut'])
    })
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function configurationPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('CONFIGURATION', 'Réglages essentiels • les clés API restent protégées dans .env')
    const values = (await readEnvironment()).values
    const prefix = await effectivePrefix(values)
    print(`${cyan('Préfixe')} : ${prefix}  •  ${cyan('Mode')} : ${values.PUBLIC_MODE === 'false' ? yellow('privé') : green('public')}  •  ${cyan('⏳ commandes')} : ${displayToggle(values.COMMAND_REACTIONS ?? 'true')}`)
    panelRule()
    print(`${cyan('[1]')} ${bold('📋 VOIR TOUTE LA CONFIGURATION')}`)
    print(`${cyan('[2]')} ${bold('✏ CHANGER LE PRÉFIXE WHATSAPP')}`)
    print(`${cyan('[3]')} ${bold('🔐 PASSER EN MODE PUBLIC / PRIVÉ')}`)
    print(`${cyan('[4]')} ${bold('🏷 CHANGER LE NOM DU BOT')}`)
    print(`${cyan('[5]')} ${bold('✍ CHANGER LA SIGNATURE')}`)
    print(`${cyan('[6]')} ${bold('👁 MARQUER LES MESSAGES COMME LUS')}`)
    print(`${cyan('[7]')} ${bold('🟢 TOUJOURS EN LIGNE')}`)
    print(`${cyan('[8]')} ${bold('☎ REJETER LES APPELS')}`)
    print(`${cyan('[9]')} ${bold('👤 GÉRER LES PROPRIÉTAIRES')}`)
    print(`${cyan('[10]')} ${bold('⏳ RÉACTIONS D EXÉCUTION ⏳ / ✅ / ❌')}`)
    print(`${cyan('[11]')} ${bold('🔑 GÉRER LA CLÉ GEMINI')}`)
    print(`${cyan('[12]')} ${bold('🎨 ACTIVER / DÉSACTIVER LES MÉDIAS IA')}`)
    print(`${cyan('[13]')} ${bold('🌍 ACCÈS PUBLIC AUX MÉDIAS IA')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, showConfiguration)
    else if (choice === '2') await safely(reader, async () => {
      const prefix = (await reader.question('Nouveau préfixe (1 à 4 caractères) : ')).trim()
      await updateConfiguration(['prefixe', prefix])
    })
    else if (choice === '3') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] public  [2] privé : ')).trim()
      await updateConfiguration(['mode', selected === '2' ? 'prive' : 'public'])
    })
    else if (choice === '4') await safely(reader, async () => {
      const name = (await reader.question('Nouveau nom du bot : ')).trim()
      await updateConfiguration(['nom', name])
    })
    else if (choice === '5') await safely(reader, async () => {
      const signature = (await reader.question('Nouvelle signature : ')).trim()
      await updateConfiguration(['signature', signature])
    })
    else if (choice === '6') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] activer  [2] désactiver : ')).trim()
      await updateConfiguration(['marquerlu', selected === '1' ? 'activer' : 'desactiver'])
    })
    else if (choice === '7') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] activer  [2] désactiver : ')).trim()
      await updateConfiguration(['toujoursenligne', selected === '1' ? 'activer' : 'desactiver'])
    })
    else if (choice === '8') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] activer  [2] désactiver : ')).trim()
      await updateConfiguration(['rejeterappels', selected === '1' ? 'activer' : 'desactiver'])
    })
    else if (choice === '9') await ownersPanel(reader)
    else if (choice === '10') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] activer  [2] désactiver : ')).trim()
      await updateConfiguration(['reactionscommandes', selected === '2' ? 'desactiver' : 'activer'])
    })
    else if (choice === '11') await geminiKeyPanel(reader)
    else if (choice === '12') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] activer  [2] désactiver : ')).trim()
      await updateConfiguration(['mediaia', selected === '2' ? 'desactiver' : 'activer'])
    })
    else if (choice === '13') await safely(reader, async () => {
      const selected = (await reader.question('Choisis [1] accès public  [2] propriétaire uniquement : ')).trim()
      await updateConfiguration(['mediaiapublic', selected === '1' ? 'activer' : 'desactiver'])
    })
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function automationsPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('AUTOMATISATIONS', 'Les actions WhatsApp restent liées au chat concerné')
    print(`${cyan('[1]')} ${bold('📅 VOIR LES MESSAGES PROGRAMMÉS')}`)
    print(`${cyan('[2]')} ${bold('💬 VOIR LES COMMANDES D AUTOMATISATION WHATSAPP')}`)
    print(`${cyan('[3]')} ${bold('🎫 RAPPEL : SUIVI DES TICKETS CLIENTS')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, listSchedulesFromPanel)
    else if (choice === '2') await safely(reader, async () => {
      heading('AUTOMATISATION DANS WHATSAPP')
      print('.autoreponse ajouter prive bonjour | Bonjour, comment pouvons-nous vous aider ?')
      print('.absence activer Nous vous répondrons bientôt.')
      print('.horaires definir Lundi-Vendredi 08:00-18:00')
      print('.assistantauto activer|desactiver|statut|consigne')
      print('.attentes')
      print('.reprendreclient ID | MESSAGE')
      print('.programmer quotidien 08:00 | Bonjour à toute l équipe')
      print('.programmes')
      print('.annulerprogramme ID')
      print('.ticket ouvrir Je souhaite un devis')
      print('.produitsnumeriques')
      print('.produitnumerique liste')
      print('.livrernumerique ID NUMERO')
      print(gray('Les réponses IA automatiques restent privées et les livraisons numériques exigent une action du propriétaire.'))
    })
    else if (choice === '3') await safely(reader, async () => {
      heading('TICKETS CLIENTS')
      print('Dans WhatsApp : .ticket ouvrir MESSAGE')
      print('Propriétaire : .tickets puis .repondreticket ID | RÉPONSE')
      print('Propriétaire : .prioriteticket ID haute')
    })
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function backupsPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('SAUVEGARDES')
    const backups = await listBackupsData()
    print(`${cyan('Archives disponibles')} : ${backups.length}  •  ${cyan('Plus récente')} : ${backups[0]?.modifiedAt.toLocaleString('fr-FR') ?? 'aucune'}`)
    panelRule()
    print(`${cyan('[1]')} ${bold('➕ CRÉER UNE SAUVEGARDE MAINTENANT')}`)
    print(`${cyan('[2]')} ${bold('📋 LISTER LES SAUVEGARDES')}`)
    print(`${cyan('[3]')} ${bold('↩ RESTAURER UNE SAUVEGARDE')}`)
    print(`${cyan('[4]')} ${bold('🧹 NETTOYER LES ANCIENNES ARCHIVES')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, createBackup)
    else if (choice === '2') await safely(reader, listBackups)
    else if (choice === '3') await safely(reader, async () => {
      const selected = (await reader.question('Nom exact de l archive à restaurer : ')).trim()
      if (await askConfirmation(reader, 'Restaurer cette sauvegarde', 'RESTAURER')) await restoreBackup([selected, 'confirmer'])
    })
    else if (choice === '4') await safely(reader, async () => {
      const keep = (await reader.question('Combien de sauvegardes récentes conserver ? : ')).trim()
      if (await askConfirmation(reader, `Supprimer les archives au-delà de ${keep}`, 'NETTOYER')) await cleanBackups([keep, 'confirmer'])
    })
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function cleanupWorkspaceArtifacts(): Promise<void> {
  const progress = new ProgressDisplay()
  progress.set(0, 'Analyse des fichiers')
  const workspace = path.dirname(APP_DIRECTORY)
  const names = await progress.step(20, 'Inventaire du dossier', async () => readdir(workspace).catch(() => [] as string[]))
  const candidates = names.filter((name) =>
    /^bestla-v[\d.]+-test$/.test(name)
    || /^bestla-ia-bot-v[\d.].*\.zip$/.test(name)
    || /^sauvegarde-bestla-avant-v[\d.]+-/.test(name)
    || /^sauvegarde-complete-avant-v[\d.]+-/.test(name),
  )
  let removed = 0
  const candidateTotal = Math.max(1, candidates.length)
  for (const [index, name] of candidates.entries()) {
    await rm(path.join(workspace, name), { recursive: true, force: true })
    removed += 1
    progress.set(20 + Math.floor(((index + 1) / candidateTotal) * 45), 'Suppression des migrations')
  }

  const backups = await progress.step(75, 'Analyse des sauvegardes', listBackupsData)
  const oldBackups = backups.slice(1)
  const backupTotal = Math.max(1, oldBackups.length)
  for (const [index, backup] of oldBackups.entries()) {
    await rm(backup.filePath, { force: true })
    progress.set(75 + Math.floor(((index + 1) / backupTotal) * 22), 'Rotation des sauvegardes')
  }
  progress.finish('Nettoyage terminé')
  print(green(`✓ ${removed} ancien(s) dossier(s)/ZIP de migration supprimé(s).`))
  print(green(`✓ ${oldBackups.length} ancienne(s) sauvegarde(s) privée(s) supprimée(s).`))
  print(gray(`Conservé : ${APP_DIRECTORY}, tes sessions actuelles et ${backups.length ? 'la sauvegarde privée la plus récente' : 'aucune sauvegarde privée inexistante'}.`))
}

async function uninstallBestlaCompletely(): Promise<void> {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) throw new Error('Cette action demande root.')
  const progress = new ProgressDisplay()
  progress.set(0, 'Préparation de la désinstallation')

  if (await pm2ProcessExists()) {
    await progress.step(20, 'Arrêt du service', async () => {
      await run('pm2', ['delete', PROCESS_NAME])
      await run('pm2', ['save'])
    })
  } else progress.set(20, 'Service déjà arrêté')

  const launcherPath = '/usr/local/bin/bestla'
  if (await exists(launcherPath)) await rm(launcherPath, { force: true })
  progress.set(35, 'Suppression de la commande')

  const pm2Home = path.join(os.homedir(), '.pm2')
  for (const directory of ['logs', 'pids']) {
    const target = path.join(pm2Home, directory)
    const names = await readdir(target).catch(() => [] as string[])
    for (const name of names) {
      if (name.startsWith(PROCESS_NAME)) await rm(path.join(target, name), { force: true })
    }
  }
  progress.set(55, 'Suppression des journaux dédiés')

  const workspace = path.dirname(APP_DIRECTORY)
  if (path.basename(workspace) === 'bestla-ia') {
    await rm(workspace, { recursive: true, force: true })
  } else {
    await rm(APP_DIRECTORY, { recursive: true, force: true })
  }
  progress.set(85, 'Suppression des données')

  for (const legacy of [
    '/root/bestla-install',
    '/root/bestla-update-v4',
    '/root/bestla-ia-bot-v4-final.zip',
    '/root/bestla-ia-bot-v4.zip',
  ]) {
    await rm(legacy, { recursive: true, force: true }).catch(() => undefined)
  }
  progress.finish('Désinstallation terminée')
  print(green('✓ Code, sessions, données, sauvegardes et journaux dédiés supprimés.'))
  print(gray('Node.js, npm, PM2, FFmpeg, Git et les autres services du VPS ont été conservés.'))
  process.exit(0)
}

async function maintenancePanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('MAINTENANCE & SYSTÈME')
    print(`${cyan('[1]')} ${bold('🩺 LANCER LE DIAGNOSTIC COMPLET')}`)
    print(`${cyan('[2]')} ${bold('⬆ METTRE À JOUR BESTLA iA')}`)
    print(`${cyan('[3]')} ${bold('🧷 ACTIVER LE DÉMARRAGE APRÈS REBOOT')}`)
    print(`${cyan('[4]')} ${bold('🖥 REDÉMARRER LE SERVEUR')}`)
    print(`${cyan('[5]')} ${bold('🔎 VÉRIFIER LES FICHIERS BESTLA')}`)
    print(`${cyan('[6]')} ${bold('🧹 NETTOYER LES ANCIENS FICHIERS BESTLA')}`)
    print(`${cyan('[7]')} ${bold('🗑 DÉSINSTALLER COMPLÈTEMENT BESTLA')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, doctor)
    else if (choice === '2') await safely(reader, async () => {
      if (await askConfirmation(reader, 'Télécharger et appliquer la dernière version Bestla iA', 'METTREAJOUR')) await updateFromGit(['confirmer'])
    })
    else if (choice === '3') await safely(reader, enableBootStart)
    else if (choice === '4') await safely(reader, async () => {
      if (await askConfirmation(reader, 'Le serveur va redémarrer et Termius sera coupé', 'REBOOT')) await restartServer(['confirmer'])
    }, 'Entrée pour revenir à la maintenance…')
    else if (choice === '5') await safely(reader, async () => {
      if (!(await commandAvailable('git'))) throw new Error('Le moteur de vérification est indisponible.')
      const result = await requireSuccess('git', ['status', '--porcelain'])
      print(result.stdout.trim() ? 'Des fichiers Bestla ont été modifiés localement.' : 'Aucune modification locale détectée.')
    })
    else if (choice === '6') await safely(reader, async () => {
      if (await askConfirmation(reader, 'Supprimer les anciens ZIP, tests et sauvegardes de migration', 'NETTOYER')) await cleanupWorkspaceArtifacts()
    })
    else if (choice === '7') await safely(reader, async () => {
      if (await askConfirmation(reader, 'Désinstaller complètement Bestla du VPS', 'SUPPRIMERBESTLA')) await uninstallBestlaCompletely()
    }, 'Entrée pour terminer…')
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function logsPanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('JOURNAUX')
    print(`${cyan('[1]')} ${bold('📜 AFFICHER LES 80 DERNIERS JOURNAUX')}`)
    print(`${cyan('[2]')} ${bold('📡 JOURNAUX EN DIRECT')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, () => showLogs(false), 'Entrée pour revenir aux journaux…')
    else if (choice === '2') {
      print(yellow('Les journaux en direct utilisent Ctrl+C pour s arrêter.'))
      await showLogs(true).catch((error) => print(red(`✗ ${error instanceof Error ? error.message : 'Erreur inconnue.'}`)))
      await pause(reader, 'Entrée pour revenir aux journaux…')
    } else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function guidePanel(reader: Interface): Promise<void> {
  while (true) {
    renderSubmenu('GUIDE D UTILISATION', 'Commandes du bot dans WhatsApp et commandes du VPS')
    print(`${cyan('[1]')} ${bold('💬 MENU WHATSAPP ET CATÉGORIES')}`)
    print(`${cyan('[2]')} ${bold('🛡 MODÉRATION ET GESTION DES GROUPES')}`)
    print(`${cyan('[3]')} ${bold('🤖 IA, MÉDIAS ET OUTILS')}`)
    print(`${cyan('[4]')} ${bold('📁 CHEMINS ET FICHIERS IMPORTANTS')}`)
    returnOption()
    const choice = normalizeMenuChoice(await reader.question(`\n${bold('Choix')} : `))
    if (choice === '0') return
    if (choice === '1') await safely(reader, async () => {
      heading('MENU WHATSAPP')
      print('.menu                 menu général')
      print('.menu ia              assistant, traduction, résumé')
      print('.menu groupe          administration de groupe')
      print('.menu moderation      protections et avertissements')
      print('.menu media           images, audio et vidéo')
      print('.menu automatisation  réponses, horaires, programmes')
      print('.menu tout            catalogue complet')
    })
    else if (choice === '2') await safely(reader, async () => {
      heading('GROUPES ET MODÉRATION')
      print('.reglement definir TEXTE')
      print('.antilien activer')
      print('.antispam activer')
      print('.bienvenue activer')
      print('.avertir @personne raison')
      print('.expulser @personne')
      print(gray('Bestla doit être administrateur pour les actions de groupe.'))
    })
    else if (choice === '3') await safely(reader, async () => {
      heading('IA, MÉDIAS ET OUTILS')
      print('.assistant QUESTION')
      print('.traduire langue | texte')
      print('.genererimage DESCRIPTION')
      print('.modifierimage INSTRUCTION  (en réponse à une image)')
      print('.generervideo DESCRIPTION')
      print('.animerimage MOUVEMENT  (en réponse à une image)')
      print('.autocollant  (en réponse à une image)')
      print('.convertiraudio  (en réponse à une vidéo)')
      print('.creerpdf Titre | Contenu')
      print('.commande desactiver NOM')
      print('.commande activer NOM')
      print('.prefixe !')
    })
    else if (choice === '4') await safely(reader, async () => {
      heading('FICHIERS IMPORTANTS')
      print(`${cyan('Projet')}     : ${APP_DIRECTORY}`)
      print(`${cyan('Réglages')}   : ${ENV_PATH} ${yellow('(privé)')}`)
      print(`${cyan('Sessions')}   : ${path.join(APP_DIRECTORY, 'data', 'sessions')} ${yellow('(privé)')}`)
      print(`${cyan('Sauvegardes')}: ${backupDirectory()} ${yellow('(privé)')}`)
      print(`${cyan('Code source')} : publication sans .env ni data`)
    })
    else {
      print(yellow('Choix invalide.'))
      await pause(reader)
    }
  }
}

async function interactivePanel(): Promise<void> {
  const reader = createInterface({ input, output })
  try {
    while (true) {
      try {
        await renderDashboard()
        const choice = normalizeMenuChoice(await reader.question(`\n${bold('➤ Choix')} : `))
        if (choice === '0' || choice.toLowerCase() === 'quitter' || choice.toLowerCase() === 'exit') return
        if (choice === '1') await sessionsPanel(reader)
        else if (choice === '2') await botControlPanel(reader)
        else if (choice === '3') await configurationPanel(reader)
        else if (choice === '4') await automationsPanel(reader)
        else if (choice === '5') await backupsPanel(reader)
        else if (choice === '6') await maintenancePanel(reader)
        else if (choice === '7') await logsPanel(reader)
        else if (choice === '8') await guidePanel(reader)
        else {
          print(yellow('Choisis un numéro du menu.'))
          await pause(reader)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur inconnue.'
        if (message === 'readline was closed') return
        print(red(`✗ ${message}`))
        await pause(reader)
      }
    }
  } finally {
    reader.close()
  }
}

async function main(): Promise<void> {
  try {
    if (!(await exists(path.join(APP_DIRECTORY, 'package.json')))) {
      throw new Error(`Projet Bestla iA introuvable dans ${APP_DIRECTORY}. Configure BESTLA_DIR ou lance la commande depuis l installation.`)
    }
    const args = process.argv.slice(2)
    await dispatch(args)
  } catch (error) {
    print(red(`✗ ${error instanceof Error ? error.message : 'Erreur inconnue.'}`))
    process.exitCode = 1
  }
}

void main()
