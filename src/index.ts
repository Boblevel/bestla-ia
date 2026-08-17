import type { Server } from 'node:http'
import { config } from './config.js'
import { startApi } from './core/api.js'
import { JsonDatabase } from './core/database.js'
import { logger } from './core/logger.js'
import { CommandRegistry } from './core/registry.js'
import { MessageRouter } from './core/router.js'
import { SchedulerService } from './core/scheduler.js'
import { SessionManager } from './core/session-manager.js'
import { registerBuiltInCommands } from './plugins/index.js'

async function main(): Promise<void> {
  const db = new JsonDatabase(config)
  await db.init()

  const registry = new CommandRegistry()
  registerBuiltInCommands(registry)
  await registry.loadCustomPlugins(config.customPluginsDir)
  process.stdout.write(
    `\n╔══════════════════════════════╗\n║       ✦ ${config.botName.padEnd(18)} ✦ ║\n║       ${config.signature.padEnd(20)} ║\n╚══════════════════════════════╝\n\n`,
  )

  const router = new MessageRouter(config, db, registry)
  const sessions = new SessionManager(
    config,
    (runtime, message) => router.handleMessage(runtime, message),
    (runtime, event) => router.handleParticipants(runtime, event),
    () => db.getAutoStatusView(),
  )

  await sessions.start()
  const scheduler = new SchedulerService(config, db, sessions)
  scheduler.start()
  const apiServer = await startApi(config, sessions, registry)
  logger.info(
    { sessions: config.sessionNames, commands: registry.list().length },
    `${config.botName} est démarré`,
  )

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Arrêt propre du bot')
    scheduler.stop()
    await closeServer(apiServer)
    await sessions.stop()
    process.exitCode = 0
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Promesse rejetée non gérée')
})

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Exception non gérée')
  process.exitCode = 1
})

void main().catch((error) => {
  logger.fatal({ err: error }, 'Impossible de démarrer le bot')
  process.exitCode = 1
})
