import { homedir } from 'node:os'
import { codexRow, codexToasts, hasNewApproval, statusesByKey, visibleCodexRows, type CodexThread } from './codex'
import { codexApprovalDir, codexSessionsDir, keepLive, newlyWaiting, registryDir, sortRows, statusesByPid, waitingToast } from './sessions'
import { isCurrentWindow } from './navigation'
import { readLivePids, SessionReader, type Logger } from './readers'
import type { SessionRow } from './types'

export type MonitorSnapshot = { rows: SessionRow[]; polledAt: number; issues: string[]; notifications: string[] }
export type MonitorOptions = { profile?: string; livePids?: () => Promise<ReadonlySet<number>>; reader?: SessionReader }

/** Sledovanie nemá závislosť na VS Code. Iný panel môže použiť rovnaké jadro. */
export class SessionMonitor {
  private readonly reader: SessionReader
  private readonly profile: string
  private readonly getLivePids: () => Promise<ReadonlySet<number>>
  private previousClaude: Map<number, string> | null = null
  private previousCodex: Map<string, string> | null = null
  private previousApprovals = new Map<string, number>()
  private lastLiveRead = -Infinity
  private lastCodexRead = -Infinity
  private knownPids = new Set<number>()
  private livePids: ReadonlySet<number> | null = null
  private threads: CodexThread[] = []
  private records: SessionRow[] = []
  private registryIssues: string[] = []

  constructor(private readonly log: Logger, options: MonitorOptions = {}) {
    this.reader = options.reader ?? new SessionReader(log)
    this.profile = options.profile ?? homedir()
    this.getLivePids = options.livePids ?? readLivePids
  }

  private async updateLivePids(now: number, force: boolean): Promise<void> {
    if (!this.records.length) return
    const newPid = this.records.some(row => !this.knownPids.has(row.pid))
    if (!force && !newPid && now - this.lastLiveRead < 15_000) return
    try { this.livePids = await this.getLivePids() }
    catch (error) { this.livePids = null; this.log('Tasklist zlyhal, zobrazujem aj neoverené PID-y.', error) }
    this.knownPids = new Set(this.records.map(row => row.pid))
    this.lastLiveRead = now
  }

  async poll(now: number, folders: readonly string[], force = false): Promise<MonitorSnapshot> {
    const issues: string[] = []
    const notifications: string[] = []
    let registryRead = false
    try {
      const registry = await this.reader.readRegistry(registryDir(this.profile))
      this.records = registry.records
      this.registryIssues = registry.issues
      registryRead = true
    } catch (error) {
      this.log('Register Claude sa nedá načítať.', error)
      issues.push('Register Claude sa nedá načítať. Zobrazený je posledný známy stav.')
    }
    issues.push(...this.registryIssues)
    await this.updateLivePids(now, force)
    const claudeRows = keepLive(this.records, this.livePids).map(row => ({ ...row, isMe: isCurrentWindow(row, folders) }))
    if (registryRead) {
      notifications.push(...newlyWaiting(this.previousClaude, claudeRows).map(waitingToast))
      // Aj mŕtve záznamy: výpadok tasklistu nesmie vyrobiť falošné upozornenie.
      this.previousClaude = statusesByPid(this.records)
    }

    let approvals = this.previousApprovals
    try { approvals = await this.reader.readApprovalTimes(codexApprovalDir(this.profile), now) }
    catch (error) { this.log('Markery schválení sa nedajú načítať.', error); issues.push('Markery schválení sú nedostupné.') }
    const readCodex = force || now - this.lastCodexRead >= 10_000 || hasNewApproval(this.previousApprovals, approvals)
    let codexRead = false
    if (readCodex) {
      try {
        this.threads = await this.reader.readCodexThreads(codexSessionsDir(this.profile), now)
        this.lastCodexRead = now
        this.previousApprovals = approvals
        codexRead = true
      } catch (error) {
        this.log('Vlákna Codexu sa nedajú načítať.', error)
        issues.push('Vlákna Codexu sú nedostupné. Zobrazený je posledný známy stav.')
      }
    }
    const entries = this.threads.flatMap(thread => {
      const row = codexRow(thread, now, approvals.get(thread.id) ?? null)
      return row ? [{ row: { ...row, isMe: isCurrentWindow(row, folders) }, lastAt: thread.lastAt }] : []
    })
    if (codexRead) {
      const allRows = entries.map(entry => entry.row)
      notifications.push(...codexToasts(this.previousCodex, allRows.filter(row => !row.isMe), now))
      this.previousCodex = statusesByKey(allRows)
    }
    return {
      rows: sortRows([...claudeRows, ...visibleCodexRows(entries)]),
      polledAt: now, issues, notifications,
    }
  }
}
