import * as vscode from 'vscode'
import { stat } from 'node:fs/promises'
import { SessionMonitor, type MonitorSnapshot } from './monitor'
import { navigationTarget } from './navigation'
import { formatClock, formatDuration, rowLine, statusGroup, summaryLine, waitingForLabel } from './sessions'
import type { SessionRow } from './types'

export class SessionsProvider implements vscode.TreeDataProvider<SessionRow> {
  private readonly changed = new vscode.EventEmitter<SessionRow | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  snapshot: MonitorSnapshot = { rows: [], issues: [], notifications: [], polledAt: 0 }

  update(snapshot: MonitorSnapshot): void { this.snapshot = snapshot; this.changed.fire(undefined) }
  getChildren(): SessionRow[] { return this.snapshot.rows }
  getTreeItem(row: SessionRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.name)
    const group = statusGroup(row.status)
    const state = group === 'waiting' ? 'čaká' : group === 'running' ? 'beží' : 'nečinné'
    const age = formatDuration(this.snapshot.polledAt - row.since)
    const reason = row.waitingFor ? ` · ${waitingForLabel(row.waitingFor)}` : ''
    item.id = row.key
    item.description = `${row.folder} · ${state}${group === 'idle' ? '' : ` ${age}`}${group === 'waiting' ? reason : ''}${row.isMe ? ' · toto okno' : ''}`
    item.tooltip = `${rowLine(row, this.snapshot.polledAt)}\n${row.cwd}\n${row.entrypoint === 'Codex Desktop' ? 'Otvoriť chat v natívnej appke Codexu' : 'Prepnúť do okna VS Code'}${row.isMe ? '\nToto okno' : ''}`
    item.iconPath = new vscode.ThemeIcon(
      group === 'waiting' ? 'bell' : group === 'running' ? 'sync~spin' : 'circle-outline',
      new vscode.ThemeColor(group === 'waiting' ? 'notificationsWarningIcon.foreground' : group === 'running' ? 'progressBar.background' : 'disabledForeground'),
    )
    item.command = { command: 'sedenia.open', title: 'Otvoriť sedenie', arguments: [row.key] }
    item.accessibilityInformation = { label: `${row.name}, ${item.description}` }
    return item
  }
  dispose(): void { this.changed.dispose() }
}

export async function openSession(row: SessionRow): Promise<void> {
  const target = navigationTarget(row)
  if (target.kind === 'codex') {
    const opened = await vscode.env.openExternal(vscode.Uri.parse(target.url))
    if (!opened) throw new Error('Windows neotvoril odkaz Codexu. Over inštaláciu natívnej appky.')
    return
  }
  if (!(await stat(target.path)).isDirectory()) throw new Error('Priečinok sedenia neexistuje.')
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target.path), { forceNewWindow: true })
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Sedenia')
  if (process.platform !== 'win32') {
    output.appendLine('Sedenia podporujú len miestny Windows.')
    void vscode.window.showWarningMessage('Sedenia podporujú len miestny Windows.')
    context.subscriptions.push(output)
    return
  }
  const reported = new Map<string, number>()
  const log = (message: string, error?: unknown) => {
    const text = `${message}${error ? ` — ${error instanceof Error ? error.message : String(error)}` : ''}`
    const now = Date.now()
    if (now - (reported.get(text) ?? -Infinity) < 60_000) return
    if (reported.size > 200) reported.clear()
    reported.set(text, now)
    output.appendLine(`[${new Date(now).toISOString()}] ${text}`)
  }
  const provider = new SessionsProvider()
  const view = vscode.window.createTreeView('sedenia.sessions', { treeDataProvider: provider, showCollapseAll: false })
  view.message = 'Načítavam sedenia…'
  const monitor = new SessionMonitor(log)
  let disposed = false
  let polling: Promise<void> | undefined

  const refresh = (force = false): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (polling) return polling
    polling = (async () => {
      try {
        const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? []
        const snapshot = await monitor.poll(Date.now(), folders, force)
        if (disposed) return
        provider.update(snapshot)
        const waiting = snapshot.rows.filter(row => row.status === 'waiting').length
        view.badge = waiting ? { value: waiting, tooltip: `${waiting} sedení čaká na odpoveď` } : undefined
        view.description = formatClock(snapshot.polledAt)
        view.message = [summaryLine(snapshot.rows), ...snapshot.issues, ...(snapshot.rows.length ? [] : ['Žiadne sedenia.'])].join('\n')
        for (const message of snapshot.notifications) void vscode.window.showInformationMessage(message)
      } catch (error) {
        log('Obnova panela zlyhala.', error)
        if (!disposed) view.message = 'Obnova zlyhala. Posledný známy stav ostáva, detail nájdeš v diagnostike Sedenia.'
      }
    })().finally(() => { polling = undefined })
    return polling
  }

  const timer = setInterval(() => void refresh(), 3000)
  context.subscriptions.push(
    output, provider, view,
    { dispose() { disposed = true; clearInterval(timer) } },
    vscode.commands.registerCommand('sedenia.refresh', () => refresh(true)),
    vscode.commands.registerCommand('sedenia.showOutput', () => output.show()),
    vscode.commands.registerCommand('sedenia.open', async (key: unknown) => {
      // Príkaz používa len aktuálny riadok, nie ľubovoľný objekt od iného rozšírenia.
      const row = provider.snapshot.rows.find(item => item.key === key)
      if (!row) return
      try { await openSession(row) }
      catch (error) {
        const message = `Prepnutie do ${row.folder || row.name} zlyhalo`
        log(message, error)
        void vscode.window.showErrorMessage(`${message} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
  )
  output.appendLine('Sedenia spustené. Obnova 3 s, Codex 10 s. Zdroje sa iba čítajú.')
  void refresh()
  return { provider, refresh, view }
}
