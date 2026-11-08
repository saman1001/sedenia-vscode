import type { SessionRow } from './types'

// ---------------------------------------------------------------------------
// Vlákna Codexu z rozšírenia VS Code a desktopovej appky — čisté funkcie (testované v register.test.tsx)
//
// Každé vlákno je súbor %USERPROFILE%\.codex\sessions\RRRR\MM\DD\rollout-…-<id>.jsonl,
// jeden JSON na riadok s `timestamp` (ISO, UTC) a `type`. Prvý riadok je
// `session_meta` s `id`, `cwd` a `originator`. Oba klienty zdieľajú úložisko
// aj formát, líšia sa len `originator`.
// Originator je zakladateľ vlákna (klient posledného ťahu sa nikde nezapisuje),
// takže vlákno z VS Code dokončené v appke má stále šípku do VS Code a vlákno
// appky dokončené vo VS Code stále otvára appku — známe obmedzenie.
//
// Čakanie na schválenie sa do JSONL nezapisuje. Zapisuje ho Codex hook
// PermissionRequest (%USERPROFILE%\.codex\hooks\sedenia_cakanie.py) — jeden
// súbor %USERPROFILE%\.codex\hooks\sedenia-cakanie\<id vlákna>.json so
// `session_id` (= `id` zo session_meta) a `time_ms`. Ďalšia žiadosť ho
// prepíše, po vyriešení ostáva — vyriešenie (schválenie aj zamietnutie)
// pozná mod podľa výstupu nástroja v JSONL.
//
// Otázku používateľovi (nástroj request_user_input_async) Codex do JSONL
// zapisuje sám — `event_msg` `agent_message` s neprázdnym poľom `questions`,
// hook PermissionRequest sa pri nej nespúšťa. Ťah počas otázky beží (Codex
// čaká cez clock.sleep). Odpoveď kliknutím na možnosť aj napísaná správa
// príde ako `event_msg` `user_message` — otázka bez neskoršej správy je otvorená.
// ---------------------------------------------------------------------------

/** Originator vlákna založeného v rozšírení VS Code. */
export const CODEX_VSCODE = 'codex_vscode'
/** Originator vlákna založeného v desktopovej appke Codex. */
export const CODEX_DESKTOP = 'Codex Desktop'
// Zobrazujú sa len tieto dva klienty — headless `codex_exec` (behy zo skillov)
// a iný či chýbajúci originator nie.
const SHOWN_ORIGINATORS: ReadonlySet<string> = new Set([CODEX_VSCODE, CODEX_DESKTOP])
// Len vlákna, ktoré založil používateľ (`thread_source: user`, staršie pole
// nemajú). Pomocné vlákna `subagent` a `guardian_review` (kontrola schválení)
// majú originator rodiča, ale vlastný riadok v paneli nedostanú.
const SHOWN_THREAD_SOURCES: ReadonlySet<string> = new Set(['', 'user'])
// Staršie vlákna sú `.jsonl.zst` — tie sa nečítajú.
const ROLLOUT_FILE = /^rollout-.+\.jsonl$/
const LONG_PATH_PREFIX = '\\\\?\\'
const TURN_EVENTS: ReadonlySet<string> = new Set(['task_started', 'task_complete', 'turn_aborted'])
const OUTPUT_TYPES: ReadonlySet<string> = new Set(['function_call_output', 'custom_tool_call_output'])
// Marker hooku je `<id vlákna>.json` — hook ho zapisuje cez `<id vlákna>.json.tmp`.
const APPROVAL_FILE = /\.json$/
// Skrátené vlákno (len koniec súboru) bez udalosti ťahu beží, kým pribúdajú riadky.
const TRUNCATED_RUNNING_MS = 60_000
// Dôvody čakania — schválenie (marker hooku PermissionRequest) a otázka Codexu.
const WAITING_FOR = 'schválenie'
const WAITING_FOR_QUESTION = 'otázka'
/** Bežiaci ťah, v ktorom 2 h nepribudol riadok — okno sa asi zavrelo uprostred ťahu. */
export const CODEX_STALE_MS = 2 * 60 * 60_000
// Skončené vlákno sa ukazuje 3 h od posledného riadku, potom sa skryje.
const IDLE_SHOWN_MS = 3 * 60 * 60_000

/** Čo panel potrebuje z jedného súboru vlákna — stav sa z toho počíta k času `now`. */
export type CodexThread = {
  id: string
  /** Zakladateľ vlákna — `codex_vscode` (CODEX_VSCODE) alebo `Codex Desktop` (CODEX_DESKTOP). */
  originator: string
  /** Pracovný priečinok bez predpony `\\?\`. */
  cwd: string
  /** Timestamp riadku `session_meta`, ms od epochy. */
  startedAt: number
  /** Timestamp posledného platného riadku. */
  lastAt: number
  /** Posledná udalosť ťahu — `task_started` beží, `task_complete` a `turn_aborted` skončili. */
  turn: { isRunning: boolean; at: number } | null
  /** Timestamp posledného výstupu nástroja (`function_call_output`, `custom_tool_call_output`), inak null. */
  lastOutputAt: number | null
  /** Timestamp poslednej otázky Codexu (`event_msg` `agent_message` s neprázdnym `questions`), inak null. */
  lastQuestionAt: number | null
  /** Timestamp poslednej správy používateľa (`event_msg` `user_message`, aj odpoveď na otázku), inak null. */
  lastUserMessageAt: number | null
  /** Prečítaný len prvý riadok a koniec súboru nad 4 MiB. */
  isTruncated: boolean
}

type RolloutLine = { at: number; type: string; payload: Record<string, unknown> }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Jeden riadok JSONL — null pri chybnom JSON alebo bez platného timestampu. */
function parseLine(line: string): RolloutLine | null {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(data)) return null

  const at = Date.parse(textOf(data.timestamp))
  if (!Number.isFinite(at)) return null
  return { at, type: textOf(data.type), payload: isObject(data.payload) ? data.payload : {} }
}

/** Otázka Codexu používateľovi — payload `agent_message` s neprázdnym poľom `questions`. */
function isQuestion(payload: Record<string, unknown>): boolean {
  const questions = payload.questions
  return payload.type === 'agent_message' && Array.isArray(questions) && questions.length > 0
}

/** Názov priečinka ako `lastSegment` v register.tsx — kópia, aby sa moduly neimportovali navzájom. */
function folderOf(path: string): string {
  return path.split(/[\\/]+/).filter(part => part !== '').at(-1) ?? ''
}

/** Miestny čas HH:MM. */
function hourMinute(ms: number): string {
  const time = new Date(ms)
  return [time.getHours(), time.getMinutes()].map(part => String(part).padStart(2, '0')).join(':')
}

/** Súbor vlákna (`rollout-….jsonl`), nie `.jsonl.zst` ani nič iné. */
export function isRolloutFile(name: string): boolean {
  return ROLLOUT_FILE.test(name)
}

/** `cwd` bez predpony `\\?\` (dlhé cesty Windows), inak bezo zmeny. */
export function normalizeCodexCwd(cwd: string): string {
  return cwd.startsWith(LONG_PATH_PREFIX) ? cwd.slice(LONG_PATH_PREFIX.length) : cwd
}

/** Priečinky dnešného a včerajšieho miestneho dátumu — Codex ich zakladá podľa začiatku vlákna. */
export function codexDayDirs(root: string, now: number): string[] {
  const today = new Date(now)
  return [0, 1].map(daysBack => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack)
    const month = String(day.getMonth() + 1).padStart(2, '0')
    const date = String(day.getDate()).padStart(2, '0')
    return `${root}\\${day.getFullYear()}\\${month}\\${date}`
  })
}

/**
 * Súbor vlákna ako `CodexThread`. Null, keď prvý riadok nie je `session_meta`
 * rozšírenia VS Code alebo appky s `id` a timestampom, alebo keď vlákno
 * nezaložil používateľ (subagent, kontrola schválení). Chybný riadok (napr.
 * nedopísaný posledný) sa preskočí.
 */
export function parseCodexRollout(text: string): CodexThread | null {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  const meta = parseLine(lines[0] ?? '')
  if (meta === null || meta.type !== 'session_meta') return null
  const originator = textOf(meta.payload.originator)
  if (!SHOWN_ORIGINATORS.has(originator)) return null
  if (!SHOWN_THREAD_SOURCES.has(textOf(meta.payload.thread_source))) return null
  const id = textOf(meta.payload.id)
  if (id === '') return null

  let lastAt = meta.at
  let turn: CodexThread['turn'] = null
  let lastOutputAt: number | null = null
  let lastQuestionAt: number | null = null
  let lastUserMessageAt: number | null = null

  for (const line of lines.slice(1)) {
    const item = parseLine(line)
    if (item === null) continue
    lastAt = item.at
    const kind = textOf(item.payload.type)

    if (item.type === 'event_msg' && TURN_EVENTS.has(kind)) {
      turn = { isRunning: kind === 'task_started', at: item.at }
      continue
    }
    if (item.type === 'response_item' && OUTPUT_TYPES.has(kind)) lastOutputAt = item.at
    if (item.type === 'event_msg' && isQuestion(item.payload)) lastQuestionAt = item.at
    if (item.type === 'event_msg' && kind === 'user_message') lastUserMessageAt = item.at
  }

  return {
    id,
    originator,
    cwd: normalizeCodexCwd(textOf(meta.payload.cwd)),
    startedAt: meta.at,
    lastAt,
    turn,
    lastOutputAt,
    lastQuestionAt,
    lastUserMessageAt,
    isTruncated: false,
  }
}

/** Marker hooku PermissionRequest — id vlákna a čas žiadosti o schválenie (ms od epochy). */
export type ApprovalMarker = { sessionId: string; at: number }

/** Súbor markera (`<id vlákna>.json`), nie rozpísaný `.json.tmp` ani nič iné. */
export function isApprovalFile(name: string): boolean {
  return APPROVAL_FILE.test(name)
}

/**
 * Súbor markera ako `ApprovalMarker`. Null pri chybnom JSON, prázdnom či
 * chýbajúcom `session_id` a nečíselnom či chýbajúcom `time_ms`.
 */
export function parseApprovalMarker(text: string): ApprovalMarker | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(data)) return null

  const sessionId = textOf(data.session_id)
  const at = data.time_ms
  if (sessionId === '' || typeof at !== 'number' || !Number.isFinite(at)) return null
  return { sessionId, at }
}

/**
 * Či medzi časmi markerov (id vlákna → čas) pribudlo vlákno alebo sa zmenil
 * čas oproti predchádzajúcemu pollu — vtedy sa Codex číta hneď. Zmiznutý
 * marker zmena nie je, čakanie nepridá.
 */
export function hasNewApproval(
  previous: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
): boolean {
  for (const [id, at] of current) {
    if (previous.get(id) !== at) return true
  }
  return false
}

/**
 * Text pre parseCodexRollout z spojených bajtov hlavy a konca súboru — prvý riadok a za
 * ním len celé riadky konca (nedokončený začiatok výrezu sa zahodí).
 */
export function joinRolloutHeadTail(output: string): string {
  const headEnd = output.indexOf('\n')
  if (headEnd < 0) return output

  const tail = output.slice(headEnd + 1)
  const firstWhole = tail.indexOf('\n')
  return output.slice(0, headEnd + 1) + (firstWhole < 0 ? '' : tail.slice(firstWhole + 1))
}

type CodexState = Pick<SessionRow, 'status' | 'waitingFor' | 'since'>

/**
 * Čas markera, na ktorý ešte neprišiel výstup nástroja (marker je novší ako
 * posledný výstup vo vlákne), inak null. Pri známom ťahu len marker od jeho
 * začiatku — marker ťahu prerušeného počas čakania nový ťah neovplyvní.
 */
function openApprovalAt(thread: CodexThread, approvalAt: number | null): number | null {
  if (approvalAt === null) return null
  if (thread.lastOutputAt !== null && approvalAt <= thread.lastOutputAt) return null
  if (thread.turn !== null && approvalAt < thread.turn.at) return null
  return approvalAt
}

/**
 * Čas otázky Codexu, na ktorú ešte neprišla správa používateľa (otázka je
 * prísne novšia ako posledný `user_message`), inak null. Pri známom ťahu len
 * otázka od jeho začiatku — otázka prerušeného ťahu nový ťah neovplyvní.
 */
function openQuestionAt(thread: CodexThread): number | null {
  const askedAt = thread.lastQuestionAt
  if (askedAt === null) return null
  if (thread.lastUserMessageAt !== null && askedAt <= thread.lastUserMessageAt) return null
  if (thread.turn !== null && askedAt < thread.turn.at) return null
  return askedAt
}

type OpenWait = { waitingFor: string; since: number }

/**
 * Na čo vlákno čaká a odkedy — otvorené schválenie má prednosť pred otvorenou
 * otázkou (blokuje vykonanie), bez oboch null. Či ťah beží, rieši codexState.
 */
function openWaitOf(thread: CodexThread, approvalAt: number | null): OpenWait | null {
  const approvalOpenAt = openApprovalAt(thread, approvalAt)
  if (approvalOpenAt !== null) return { waitingFor: WAITING_FOR, since: approvalOpenAt }
  const questionOpenAt = openQuestionAt(thread)
  if (questionOpenAt !== null) return { waitingFor: WAITING_FOR_QUESTION, since: questionOpenAt }
  return null
}

/**
 * Stav vlákna k času `now` — null, keď je skončené a mlčí dlhšie ako 3 h.
 * `approvalAt` je čas markera hooku PermissionRequest vlákna, bez markera null.
 * Otázku nesie vlákno samo (`lastQuestionAt`, `lastUserMessageAt`).
 */
function codexState(thread: CodexThread, now: number, approvalAt: number | null): CodexState | null {
  const silentMs = now - thread.lastAt
  const turn = thread.turn
  const wait = openWaitOf(thread, approvalAt)
  // Skrátené vlákno bez udalosti ťahu — task_started bol pred výrezom konca
  // súboru. Beží, kým pribúdajú riadky, alebo kým čaká na schválenie či odpoveď.
  const isTurnUnknown = thread.isTruncated && turn === null
  const isRunning = isTurnUnknown
    ? wait !== null || silentMs <= TRUNCATED_RUNNING_MS
    : turn !== null && turn.isRunning

  if (isRunning && silentMs <= CODEX_STALE_MS) {
    if (wait !== null) return { status: 'waiting', ...wait }
    // Začiatok ťahu skráteného vlákna nepoznáme — beží od posledného riadku.
    return { status: 'busy', waitingFor: null, since: turn?.at ?? thread.lastAt }
  }
  if (silentMs > IDLE_SHOWN_MS) return null
  return { status: 'idle', waitingFor: null, since: turn?.at ?? thread.lastAt }
}

/** Začiatok názvu riadku — `Codex` pre vlákno z VS Code, `Codex app` pre vlákno appky. */
function rowLabel(originator: string): string {
  return originator === CODEX_DESKTOP ? 'Codex app' : 'Codex'
}

/**
 * Vlákno ako riadok panelu (`Codex HH:MM`, z appky `Codex app HH:MM`, pid 0,
 * entrypoint je originator) — null, keď sa už neukazuje. `approvalAt` je čas
 * markera hooku PermissionRequest vlákna, bez markera null (vlákno nečaká na
 * schválenie, na odpoveď na otázku z JSONL čakať môže).
 */
export function codexRow(
  thread: CodexThread,
  now: number,
  approvalAt: number | null,
): SessionRow | null {
  const state = codexState(thread, now, approvalAt)
  if (state === null) return null

  return {
    key: `codex:${thread.id}`,
    agent: 'codex',
    pid: 0,
    sessionId: thread.id,
    name: `${rowLabel(thread.originator)} ${hourMinute(thread.startedAt)}`,
    cwd: thread.cwd,
    folder: folderOf(thread.cwd),
    ...state,
    startedAt: thread.startedAt,
    entrypoint: thread.originator,
    isMe: false,
  }
}

export function statusesByKey(rows: readonly SessionRow[]): Map<string, string> {
  return new Map(rows.map(row => [row.key, row.status]))
}

/** Riadok vlákna s časom jeho posledného riadku — podľa neho sa vyberá skončené vlákno. */
export type CodexEntry = { row: SessionRow; lastAt: number }

function isActiveRow(row: SessionRow): boolean {
  return row.status === 'busy' || row.status === 'waiting'
}

/**
 * Koľko vlákien Codexu má jedno okno VS Code (priečinok) naraz otvorených —
 * kartu v editore a bočný panel. Staršie chaty sú len história.
 */
export const CODEX_SLOTS_PER_FOLDER = 2

/**
 * Koľko skončených vlákien appky Codex sa ukáže — appka má na obrazovke
 * otvorené jedno vlákno, ostatné sú len história. Bežiace a čakajúce vlákna
 * appky sa ukážu všetky a toto miesto nezaberajú.
 */
export const CODEX_DESKTOP_IDLE_SLOTS = 1

// Skupina vlákien appky — vlákna VS Code majú kľúč s predponou `vscode:`, nezrazia sa.
const DESKTOP_GROUP = 'desktop'

/** Skupina pre výber skončených — appka jedna spoločná, VS Code podľa `cwd` bez ohľadu na veľkosť písmen. */
function codexGroupOf(row: SessionRow): string {
  return row.entrypoint === CODEX_DESKTOP ? DESKTOP_GROUP : `vscode:${row.cwd.toLowerCase()}`
}

/** Koľko skončených vlákien skupina ukáže popri `activeCount` bežiacich a čakajúcich. */
function idleSlotsOf(group: string, activeCount: number): number {
  if (group === DESKTOP_GROUP) return CODEX_DESKTOP_IDLE_SLOTS
  return Math.max(0, CODEX_SLOTS_PER_FOLDER - activeCount)
}

/**
 * Riadky Codexu, ktoré panel ukáže. Vlákna VS Code pre každý `cwd` (bez ohľadu
 * na veľkosť písmen) — všetky bežiace a čakajúce, voľné miesta do
 * CODEX_SLOTS_PER_FOLDER doplnia skončené s najnovším posledným riadkom.
 * Vlákna appky sú samostatná skupina bez ohľadu na `cwd` — všetky bežiace
 * a čakajúce plus CODEX_DESKTOP_IDLE_SLOTS skončené s najnovším posledným
 * riadkom. Skupiny si miesta nezaberajú.
 */
export function visibleCodexRows(entries: readonly CodexEntry[]): SessionRow[] {
  const byGroup = new Map<string, CodexEntry[]>()
  for (const entry of entries) {
    const group = codexGroupOf(entry.row)
    byGroup.set(group, [...(byGroup.get(group) ?? []), entry])
  }

  const shownIdle = new Set<string>()
  for (const [group, groupEntries] of byGroup) {
    const activeCount = groupEntries.filter(entry => isActiveRow(entry.row)).length
    groupEntries
      .filter(entry => !isActiveRow(entry.row))
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, idleSlotsOf(group, activeCount))
      .forEach(entry => shownIdle.add(entry.row.key))
  }

  return entries
    .filter(entry => isActiveRow(entry.row) || shownIdle.has(entry.row.key))
    .map(entry => entry.row)
}

/**
 * Toasty vlákien Codexu — prechod do čakania a koniec ťahu (z behu alebo
 * čakania do nečinnosti). Pri prvom čítaní (`previous` null) žiadne, za
 * vlákno, ktoré zo zoznamu zmizlo, tiež nie. Ťah, ktorý skončil len tým, že
 * vlákno 2 h mlčí, toast nedá — okno sa asi zavrelo, ťah sa nedokončil.
 */
export function codexToasts(
  previous: ReadonlyMap<string, string> | null,
  rows: readonly SessionRow[],
  now: number,
): string[] {
  if (previous === null) return []

  const texts: string[] = []
  for (const row of rows) {
    const before = previous.get(row.key)
    if (row.status === 'waiting' && before !== 'waiting') {
      texts.push(`${row.name} · ${row.folder} čaká — ${row.waitingFor ?? WAITING_FOR}`)
      continue
    }
    const wasRunning = before === 'busy' || before === 'waiting'
    if (row.status === 'idle' && wasRunning && now - row.since <= CODEX_STALE_MS) {
      texts.push(`${row.name} · ${row.folder} dokončil ťah`)
    }
  }
  return texts
}
