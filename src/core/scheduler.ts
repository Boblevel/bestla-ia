import type { AppConfig } from '../config.js'
import { brandedPanel } from '../utils/brand.js'
import type { JsonDatabase, ScheduledJob } from './database.js'
import { logger } from './logger.js'
import type { SessionManager } from './session-manager.js'

export class SchedulerService {
  private timer: NodeJS.Timeout | undefined
  private running = false

  constructor(
    private readonly config: AppConfig,
    private readonly db: JsonDatabase,
    private readonly sessions: SessionManager,
  ) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 10_000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const jobs = await this.db.claimDueSchedules()
      for (const job of jobs) await this.deliver(job)
    } catch (error) {
      logger.error({ err: error }, 'Erreur du planificateur')
    } finally {
      this.running = false
    }
  }

  private async deliver(job: ScheduledJob): Promise<void> {
    try {
      const lines = job.message.split('\n').filter(Boolean)
      await this.sessions.send(job.sessionName, job.chatId, {
        text: brandedPanel('MESSAGE PROGRAMMÉ', lines, this.config),
      })
      await this.db.finishSchedule(job.id, true)
      logger.info({ scheduleId: job.id, session: job.sessionName }, 'Message programmé envoyé')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erreur inconnue'
      await this.db.finishSchedule(job.id, false, reason)
      logger.warn({ err: error, scheduleId: job.id }, 'Message programmé non envoyé')
    }
  }
}
