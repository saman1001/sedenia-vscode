import { homedir } from 'node:os'
import path from 'node:path'
import type { SessionRow } from './types'
import { CODEX_DESKTOP } from './codex'
const RECORD_FILE = /^\d+\.json$/
const SHOWN_KINDS: ReadonlySet<string> = new Set(['interactive', 'bg'])

export type StatusGroup = 'waiting' | 'running' | 'idle'

const GROUP_ORDER: Record<StatusGroup, number> = { waiting: 0, running: 1, idle: 2 }
const GROUP_MARK: Record<StatusGroup, string> = { waiting: '!', running: '>', idle: '·' }

/** Skupina stavu pre radenie a kreslenie — neznámy stav ide medzi nečinné. */
export function statusGroup(status: string): StatusGroup {
  if (status === 'waiting') return 'waiting'
  if (status === 'busy' || status === 'shell') return 'running'
  return 'idle'
}

/** Posledný segment cesty (názov priečinka), pre Windows aj POSIX oddeľovače. */
export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter(part => part !== '')
  return parts.at(-1) ?? ''
}

/** Profil používateľa bez koncového oddeľovača — bez USERPROFILE záložný homedir(). */
function profileBase(profile: string | undefined): string {
  const base = profile !== undefined && profile !== '' ? profile : homedir()
  return base.replace(/[\\/]+$/, '')
}

/** Priečinok registra sedení pod profilom používateľa. */
export function registryDir(profile: string | undefined): string {
  return path.join(profileBase(profile), '.claude', 'sessions')
}

/** Priečinok vlákien Codexu pod profilom používateľa. */
export function codexSessionsDir(profile: string | undefined): string {
  return path.join(profileBase(profile), '.codex', 'sessions')
}

/** Priečinok markerov hooku PermissionRequest (Codex čaká na schválenie) pod profilom používateľa. */
export function codexApprovalDir(profile: string | undefined): string {
  return path.join(profileBase(profile), '.codex', 'hooks', 'sedenia-cakanie')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function timeOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Jeden súbor registra ako riadok panelu. Null, keď súbor nie je záznam
 * (`.key`), JSON je chybný, chýba pid alebo druh sedenia sa nezobrazuje.
 */
export function parseSessionRecord(
  fileName: string,
  text: string,
  myId: string,
): SessionRow | null {
  if (!RECORD_FILE.test(fileName)) return null

  const data = parseJson(text)
  if (!isObject(data)) return null

  const pid = data.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid)) return null
  if (!SHOWN_KINDS.has(textOf(data.kind))) return null

  const cwd = textOf(data.cwd)
  const folder = lastSegment(cwd)
  const sessionId = textOf(data.sessionId)
  const startedAt = timeOf(data.startedAt) ?? 0

  return {
    key: `claude:${pid}`,
    agent: 'claude',
    pid,
    sessionId,
    name: textOf(data.name) || folder || String(pid),
    cwd,
    folder,
    status: textOf(data.status) || 'idle',
    waitingFor: textOf(data.waitingFor) || null,
    since: timeOf(data.statusUpdatedAt) ?? timeOf(data.updatedAt) ?? startedAt,
    startedAt,
    entrypoint: textOf(data.entrypoint),
    isMe: sessionId !== '' && sessionId === myId,
  }
}

/**
 * PID-y z výstupu `tasklist /FO CSV /NH`. Riadok bez úvodzovky (hlásenie, že
 * žiadny proces nebeží, v jazyku systému) sa preskočí.
 */
export function parseTasklistPids(stdout: string): Set<number> {
  const pids = new Set<number>()
  for (const line of stdout.split(/\r?\n/)) {
    const pid = /^"[^"]*","(\d+)"/.exec(line.trim())?.[1]
    if (pid !== undefined) pids.add(Number(pid))
  }
  return pids
}

/** Len sedenia so živým procesom — null (tasklist zlyhal) nechá všetky. */
export function keepLive(
  rows: readonly SessionRow[],
  livePids: ReadonlySet<number> | null,
): SessionRow[] {
  return livePids === null ? [...rows] : rows.filter(row => livePids.has(row.pid))
}

/** Čakajúce najprv, potom bežiace, potom nečinné — v skupine najstarší stav hore. */
export function sortRows(rows: readonly SessionRow[]): SessionRow[] {
  return [...rows].sort(
    (a, b) =>
      GROUP_ORDER[statusGroup(a.status)] - GROUP_ORDER[statusGroup(b.status)] ||
      a.since - b.since ||
      a.pid - b.pid ||
      a.key.localeCompare(b.key),
  )
}

export function statusesByPid(rows: readonly SessionRow[]): Map<number, string> {
  return new Map(rows.map(row => [row.pid, row.status]))
}

/**
 * Cudzie sedenia, ktoré teraz čakajú a v predchádzajúcom polle nečakali
 * (alebo v ňom neboli). Pri prvom polle (`previous` null) žiadne.
 */
export function newlyWaiting(
  previous: ReadonlyMap<number, string> | null,
  rows: readonly SessionRow[],
): SessionRow[] {
  if (previous === null) return []
  return rows.filter(
    row => !row.isMe && row.status === 'waiting' && previous.get(row.pid) !== 'waiting',
  )
}

// Dôvody čakania z registra sú anglické a dlhé — krátky slovenský štítok.
const WAITING_FOR_LABEL: Record<string, string> = {
  'input needed': 'vstup',
  'permission prompt': 'povolenie',
}

export function waitingForLabel(waitingFor: string): string {
  return WAITING_FOR_LABEL[waitingFor] ?? waitingFor
}

export function waitingToast(row: SessionRow): string {
  const reason = row.waitingFor === null ? 'čaká na teba' : waitingForLabel(row.waitingFor)
  return `${row.name} · ${row.folder} čaká — ${reason}`
}

/** Trvanie ako `<1 min`, `N min` alebo `N h M min`. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** Miestny čas HH:MM:SS. */
export function formatClock(ms: number): string {
  const time = new Date(ms)
  return [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join(':')
}

export function summaryLine(rows: readonly SessionRow[]): string {
  const count = (group: StatusGroup) =>
    rows.filter(row => statusGroup(row.status) === group).length
  return `${count('waiting')} čaká · ${count('running')} beží · ${count('idle')} nečinné`
}

/** Text riadku panelu — značka, názov, priečinok a pri čakajúcom či bežiacom aj trvanie. */
export function rowLine(row: SessionRow, now: number): string {
  const group = statusGroup(row.status)
  const head = `${GROUP_MARK[group]} ${row.name}  ${row.folder}`
  const age = formatDuration(now - row.since)

  if (group === 'waiting') {
    const reason = row.waitingFor === null ? '' : ` · ${waitingForLabel(row.waitingFor)}`
    return `${head} — čaká ${age}${reason}`
  }
  if (group === 'running') return `${head} — beží ${age}`
  return head
}

/** Koľko riadkov sa zmestí — pri pretečení posledné miesto patrí riadku „+N ďalších". */
export function fitRows<T>(rows: readonly T[], room: number): { shown: T[]; hidden: number } {
  if (rows.length <= room) return { shown: [...rows], hidden: 0 }
  const shown = rows.slice(0, Math.max(0, room - 1))
  return { shown, hidden: rows.length - shown.length }
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * Či riadok dostane šípku do okna VS Code — vlákno appky Codex nie, `code`
 * by otvoril VS Code, nie appku. Rozhoduje zakladateľ vlákna (entrypoint).
 */
export function canSwitchWindow(row: SessionRow): boolean {
  return row.entrypoint !== CODEX_DESKTOP
}
