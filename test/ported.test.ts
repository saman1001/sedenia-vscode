import { test } from 'node:test'
import { expect } from './expect'
import { homedir } from 'node:os'
import path from 'node:path'

import type { SessionRow } from '../src/types'
import {
  codexDayDirs,
  codexRow,
  codexToasts,
  hasNewApproval,
  isApprovalFile,
  isRolloutFile,
  joinRolloutHeadTail,
  normalizeCodexCwd,
  parseApprovalMarker,
  parseCodexRollout,
  statusesByKey,
  visibleCodexRows,
} from '../src/codex'
import {
  canSwitchWindow,
  codexApprovalDir,
  codexSessionsDir,
  fitRows,
  formatClock,
  formatDuration,
  keepLive,
  newlyWaiting,
  parseSessionRecord,
  parseTasklistPids,
  registryDir,
  rowLine,
  sortRows,
  statusesByPid,
  summaryLine,
  waitingToast,
} from '../src/sessions'

const SECOND = 1000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const T0 = new Date(2026, 9, 27, 9, 5, 7).getTime()
const PROFILE = 'C:\\Users\\test'
const SESSIONS = 'C:\\Users\\test\\.claude\\sessions'
const CODEX = 'C:\\Users\\test\\.codex\\sessions'
const CODEX_TODAY = `${CODEX}\\2026\\10\\27`
const CODEX_YESTERDAY = `${CODEX}\\2026\\10\\26`
const APPROVALS = 'C:\\Users\\test\\.codex\\hooks\\sedenia-cakanie'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// ---------------------------------------------------------------------------
// Pomocníci
// ---------------------------------------------------------------------------

function recordText(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 101,
    sessionId: 's-101',
    cwd: 'c:\\Users\\test\\projekty\\alfa',
    startedAt: T0 - 60 * MINUTE,
    version: '2.1.311',
    kind: 'interactive',
    entrypoint: 'claude-vscode',
    name: 'alfa-1',
    nameSource: 'derived',
    status: 'idle',
    updatedAt: T0 - 10 * MINUTE,
    statusUpdatedAt: T0 - 10 * MINUTE,
    ...fields,
  })
}

function row(fields: Partial<SessionRow> = {}): SessionRow {
  const pid = fields.pid ?? 1
  return {
    key: `claude:${pid}`,
    agent: 'claude',
    pid,
    sessionId: 's-1',
    name: 'alfa-1',
    cwd: 'c:\\p\\alfa',
    folder: 'alfa',
    status: 'idle',
    waitingFor: null,
    since: T0,
    startedAt: T0,
    entrypoint: 'claude-vscode',
    isMe: false,
    ...fields,
  }
}

function tasklistLine(pid: number): string {
  return `"claude.exe","${pid}","Console","1","334\u00a0780 K"`
}

// Riadky JSONL vlákna Codexu v tvare Codexu 0.166 (len polia, ktoré mod číta, a pár navyše).

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function metaLine(fields: Record<string, unknown> = {}, at = T0 - 30 * MINUTE): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'session_meta',
    payload: {
      session_id: 'th-1',
      id: 'th-1',
      timestamp: iso(at),
      cwd: 'c:\\Users\\test\\projekty\\gama',
      originator: 'codex_vscode',
      source: 'vscode',
      ...fields,
    },
  })
}

function eventLine(type: string, at: number): string {
  return JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type } })
}

type CallType = 'function_call' | 'custom_tool_call'

/** Volanie nástroja s doslovným reťazcom argumentov (function_call) či vstupu (custom_tool_call). */
function requestLine(type: CallType, callId: string, at: number, request: string): string {
  const field = type === 'function_call' ? { arguments: request } : { input: request }
  return JSON.stringify({
    timestamp: iso(at),
    type: 'response_item',
    payload: { type, name: 'exec', call_id: callId, ...field },
  })
}

/** Volanie nástroja vo formáte Codexu — `isEscalated` pýta `require_escalated`. */
function callLine(type: CallType, callId: string, at: number, isEscalated: boolean): string {
  const sandbox = isEscalated ? 'require_escalated' : 'use_default'
  const request =
    type === 'function_call'
      ? JSON.stringify({ command: 'git status', sandbox_permissions: sandbox })
      : `exec({cmd:"git status",login:false,sandbox_permissions:"${sandbox}"})`
  return requestLine(type, callId, at, request)
}

/** Výstup nástroja — custom_tool_call_output nesie pole častí, starší function_call_output text. */
function outputLine(type: CallType, callId: string, at: number): string {
  const output = type === 'custom_tool_call' ? [{ type: 'input_text', text: 'ok' }] : 'ok'
  return JSON.stringify({
    timestamp: iso(at),
    type: 'response_item',
    payload: { type: `${type}_output`, id: `out-${callId}`, call_id: callId, output },
  })
}

// Otázka Codexu v tvare z rozšírenia VS Code (Codex 0.166, overené 2026-11-03).
const QUESTION = 'Ukazuje teraz plugin Sedenia stav „čaká na odpoveď“?'
const QUESTIONS = [{ title: QUESTION, options: ['Áno, teraz ukazuje čakanie', 'Nie, stále ukazuje „beží“'] }]

/** Volanie request_user_input_async — mod ho nečíta, otázku nesie agent_message. */
function askCallLine(callId: string, at: number): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'request_user_input_async',
      arguments: JSON.stringify({ questions: QUESTIONS }),
      call_id: callId,
    },
  })
}

/** Otázka — agent_message s poľom `questions`, polia sa dajú prepísať (undefined pole vynechá). */
function questionLine(at: number, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'event_msg',
    payload: {
      type: 'agent_message',
      message: `${QUESTION}\n- Áno, teraz ukazuje čakanie\n- Nie, stále ukazuje „beží“`,
      phase: 'final_answer',
      memory_citation: null,
      delivery: 'async',
      questions: QUESTIONS,
      ...fields,
    },
  })
}

/** Výstup function_call s doslovným textom — `{"accepted":true}` po otázke, koniec clock.sleep. */
function textOutputLine(callId: string, at: number, output: string): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: callId, output },
  })
}

/** Volanie clock.sleep, ktorým Codex po otázke čaká na odpoveď. */
function sleepCallLine(callId: string, at: number): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'sleep',
      namespace: 'clock',
      arguments: JSON.stringify({ duration_ms: 60_000 }),
      call_id: callId,
    },
  })
}

/** Koniec clock.sleep, ktorý prerušila správa používateľa. */
function sleepOutputLine(at: number): string {
  return textOutputLine('call_s-1', at, 'Wall time: 56.7996 seconds\nSleep interrupted by new input.')
}

/** Správa používateľa — event_msg user_message (napísaná správa aj odpoveď na otázku). */
function userMessageLine(at: number, message: string): string {
  return JSON.stringify({
    timestamp: iso(at),
    type: 'event_msg',
    payload: { type: 'user_message', message, images: [], local_images: [], text_elements: [] },
  })
}

/** Odpoveď kliknutím na možnosť — response_item message používateľa a event_msg user_message. */
function replyLines(at: number): string[] {
  const answer = JSON.stringify([
    {
      questionItemId: '["request_user_input_async","call_q-1",0]',
      question: QUESTION,
      answer: 'Nie, stále ukazuje „beží“',
    },
  ])
  const text = `<send_user_message_question_reply>\n${answer}\n</send_user_message_question_reply>\n`
  return [
    JSON.stringify({
      timestamp: iso(at),
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }),
    userMessageLine(at, text),
  ]
}

/**
 * Otázka v bežiacom ťahu ako v rozšírení — volanie request_user_input_async,
 * agent_message s otázkou, výstup `accepted` a o 2 s clock.sleep bez výstupu.
 */
function askedLines(at: number): string[] {
  return [
    askCallLine('call_q-1', at),
    questionLine(at),
    textOutputLine('call_q-1', at, '{"accepted":true}'),
    sleepCallLine('call_s-1', at + 2 * SECOND),
  ]
}

function rollout(...lines: string[]): string {
  return `${lines.join('\n')}\n`
}

/** Riadok panelu z vlákna th-1 s danými riadkami po session_meta, bez markera schválenia. */
function codexRowOf(now: number, ...lines: string[]): SessionRow | null {
  return markedRowOf(null, now, ...lines)
}

/** Riadok panelu z vlákna th-1 s markerom hooku PermissionRequest z času `approvalAt`. */
function markedRowOf(approvalAt: number | null, now: number, ...lines: string[]): SessionRow | null {
  const thread = parseCodexRollout(rollout(metaLine(), ...lines))
  return thread === null ? null : codexRow(thread, now, approvalAt)
}

/** Marker hooku PermissionRequest v tvare zo sedenia_cakanie.py. */
function markerText(sessionId: string, at: number, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: sessionId,
    turn_id: 'turn-1',
    cwd: 'c:\\Users\\test\\projekty\\gama',
    tool_name: 'Bash',
    event: 'PermissionRequest',
    time_ms: at,
    ...fields,
  })
}

function markerPath(id: string): string {
  return `${APPROVALS}\\${id}.json`
}

/** Súbor markera pre svet testu — hook ho zapíše v čase žiadosti, ten je aj jeho časom zmeny. */
function markerFile(id: string, at: number): { text: string; mtimeMs: number } {
  return { text: markerText(id, at), mtimeMs: at }
}

function codexPath(dir: string, id: string): string {
  return `${dir}\\rollout-2026-10-27T08-35-07-${id}.jsonl`
}

/**
 * Výstup ROLLOUT_TAIL_SCRIPT pre súbor, ktorého celý zvyšok sa zmestí do
 * výrezu — koniec začína bajtom pred výrezom, teda koncom prvého riadku.
 */
function tailScriptOutput(text: string): string {
  const headEnd = text.indexOf('\n') + 1
  return `${text.slice(0, headEnd)}\n${text.slice(headEnd)}`
}

/** Riadok panelu zo skráteného vlákna th-1 (len prvý riadok a koniec súboru) s markerom z `approvalAt`. */
function truncatedRowOf(
  approvalAt: number | null,
  now: number,
  ...lines: string[]
): SessionRow | null {
  const thread = parseCodexRollout(rollout(metaLine(), ...lines))
  return thread === null ? null : codexRow({ ...thread, isTruncated: true }, now, approvalAt)
}

test('záznam registra sa prečíta do riadku panelu', () => {
  const text = recordText({ status: 'waiting', waitingFor: 'input needed' })

  expect(parseSessionRecord('101.json', text, 's-me')).toEqual({
    key: 'claude:101',
    agent: 'claude',
    pid: 101,
    sessionId: 's-101',
    name: 'alfa-1',
    cwd: 'c:\\Users\\test\\projekty\\alfa',
    folder: 'alfa',
    status: 'waiting',
    waitingFor: 'input needed',
    since: T0 - 10 * MINUTE,
    startedAt: T0 - 60 * MINUTE,
    entrypoint: 'claude-vscode',
    isMe: false,
  })
  expect(parseSessionRecord('101.json', text, 's-101')?.isMe).toBe(true)
})

test('súbory .key, chybný JSON a skryté druhy sedení sa preskočia', () => {
  const key = '101.2955711d7533e4f8e175486fed59d7fb4eeff94086ef369257910f9acf3342d1.key'

  expect(parseSessionRecord(key, recordText(), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json.bak', recordText(), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', '{"pid":101,"kind":', 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', 'null', 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', '[1,2]', 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', recordText({ pid: '101' }), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', recordText({ kind: 'daemon' }), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', recordText({ kind: 'daemon-worker' }), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', recordText({ kind: undefined }), 's-me')).toBeNull()
  expect(parseSessionRecord('101.json', recordText({ kind: 'bg' }), 's-me')).not.toBeNull()
})

test('since berie statusUpdatedAt, potom updatedAt, potom startedAt', () => {
  const both = recordText({ statusUpdatedAt: T0 - 1, updatedAt: T0 - 2 })
  const noStatus = recordText({ statusUpdatedAt: undefined, updatedAt: T0 - 2 })
  const onlyStart = recordText({ statusUpdatedAt: undefined, updatedAt: undefined })

  expect(parseSessionRecord('101.json', both, '')?.since).toBe(T0 - 1)
  expect(parseSessionRecord('101.json', noStatus, '')?.since).toBe(T0 - 2)
  expect(parseSessionRecord('101.json', onlyStart, '')?.since).toBe(T0 - 60 * MINUTE)
})

test('chýbajúce meno a stav majú náhradu, prázdne id nie je vlastné sedenie', () => {
  const parsed = parseSessionRecord(
    '101.json',
    recordText({ name: undefined, status: undefined, sessionId: undefined }),
    '',
  )

  expect(parsed?.name).toBe('alfa')
  expect(parsed?.status).toBe('idle')
  expect(parsed?.isMe).toBe(false)
})

test('tasklist CSV dá množinu PID-ov, hlásenie bez procesov prázdnu', () => {
  const stdout = [tasklistLine(29448), tasklistLine(42424), ''].join('\r\n')

  expect([...parseTasklistPids(stdout)]).toEqual([29448, 42424])
  expect(
    parseTasklistPids('INFORMÁCIE: Nie sú spustené žiadne úlohy, ktoré zodpovedajú zadaným kritériám.').size,
  ).toBe(0)
})

test('mŕtve sedenia sa skryjú, bez tasklistu sa ukážu všetky', () => {
  const rows = [row({ pid: 1 }), row({ pid: 2 })]

  expect(keepLive(rows, new Set([2])).map(one => one.pid)).toEqual([2])
  expect(keepLive(rows, null).map(one => one.pid)).toEqual([1, 2])
})

test('radenie — čakajúce (najdlhšie hore), bežiace, nečinné', () => {
  const rows = [
    row({ pid: 1, status: 'idle', since: T0 - 90 * MINUTE }),
    row({ pid: 2, status: 'busy', since: T0 - 5 * MINUTE }),
    row({ pid: 3, status: 'waiting', since: T0 - 1 * MINUTE }),
    row({ pid: 4, status: 'shell', since: T0 - 8 * MINUTE }),
    row({ pid: 5, status: 'waiting', since: T0 - 20 * MINUTE }),
    row({ pid: 6, status: 'novy-stav', since: T0 - 1 * MINUTE }),
  ]

  expect(sortRows(rows).map(one => one.pid)).toEqual([5, 3, 4, 2, 1, 6])
})

test('formát trvania a času', () => {
  expect(formatDuration(0)).toBe('<1 min')
  expect(formatDuration(59_999)).toBe('<1 min')
  expect(formatDuration(-5 * MINUTE)).toBe('<1 min')
  expect(formatDuration(MINUTE)).toBe('1 min')
  expect(formatDuration(59 * MINUTE)).toBe('59 min')
  expect(formatDuration(60 * MINUTE)).toBe('1 h 0 min')
  expect(formatDuration(125 * MINUTE + 30_000)).toBe('2 h 5 min')
  expect(formatClock(T0)).toBe('09:05:07')
})

test('toast len pri prechode cudzieho sedenia do waiting', () => {
  const waiting = row({ pid: 1, status: 'waiting' })

  // Prvý poll po štarte toasty nedáva.
  expect(newlyWaiting(null, [waiting])).toEqual([])
  // Predtým nečakalo alebo v polle nebolo — toast áno.
  expect(newlyWaiting(new Map([[1, 'busy']]), [waiting])).toEqual([waiting])
  expect(newlyWaiting(new Map(), [waiting])).toEqual([waiting])
  // Čakalo už predtým — toast nie.
  expect(newlyWaiting(new Map([[1, 'waiting']]), [waiting])).toEqual([])
  // Vlastné sedenie a nečakajúce — toast nie.
  expect(newlyWaiting(new Map([[1, 'busy']]), [{ ...waiting, isMe: true }])).toEqual([])
  expect(newlyWaiting(new Map([[1, 'busy']]), [row({ pid: 1, status: 'idle' })])).toEqual([])
  expect(statusesByPid([waiting])).toEqual(new Map([[1, 'waiting']]))
})

test('texty riadku, hlavičky a toastu', () => {
  const waiting = row({ status: 'waiting', waitingFor: 'input needed', since: T0 - 3 * MINUTE })
  const asking = row({ status: 'waiting', since: T0 - 30_000 })
  const busy = row({ name: 'beta-2', folder: 'beta', status: 'busy', since: T0 - 75 * MINUTE })
  const idle = row({ status: 'idle' })

  expect(rowLine(waiting, T0)).toBe('! alfa-1  alfa — čaká 3 min · vstup')
  expect(rowLine(asking, T0)).toBe('! alfa-1  alfa — čaká <1 min')
  expect(rowLine(busy, T0)).toBe('> beta-2  beta — beží 1 h 15 min')
  expect(rowLine(idle, T0)).toBe('· alfa-1  alfa')
  expect(summaryLine([waiting, busy, idle, idle])).toBe('1 čaká · 1 beží · 2 nečinné')
  expect(waitingToast(waiting)).toBe('alfa-1 · alfa čaká — vstup')
  expect(waitingToast(asking)).toBe('alfa-1 · alfa čaká — čaká na teba')
})

test('zoznam sa skráti na miesto a zvyšok spočíta', () => {
  expect(fitRows([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], hidden: 0 })
  expect(fitRows([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], hidden: 3 })
  expect(fitRows([1, 2, 3], 1)).toEqual({ shown: [], hidden: 3 })
})

test('cesta registra z USERPROFILE, inak záloha', () => {
  expect(registryDir('C:\\Users\\test')).toBe(SESSIONS)
  expect(registryDir('C:\\Users\\test\\')).toBe(SESSIONS)
  expect(registryDir(undefined)).toBe(path.join(homedir(), '.claude', 'sessions'))
  expect(registryDir('')).toBe(path.join(homedir(), '.claude', 'sessions'))
})

test('radenie a hlavička počítajú Claude aj Codex spolu', () => {
  const codex = (id: string, status: string, since: number) =>
    row({ key: `codex:${id}`, agent: 'codex', pid: 0, status, since })
  const rows = [
    row({ pid: 1, status: 'busy', since: T0 - 5 * MINUTE }),
    codex('b', 'busy', T0 - 8 * MINUTE),
    row({ pid: 2, status: 'idle', since: T0 - 1 * MINUTE }),
    codex('w', 'waiting', T0 - 1 * MINUTE),
    codex('z', 'idle', T0 - 1 * MINUTE),
    codex('a', 'idle', T0 - 1 * MINUTE),
  ]

  expect(sortRows(rows).map(one => one.key)).toEqual([
    'codex:w',
    'codex:b',
    'claude:1',
    'codex:a',
    'codex:z',
    'claude:2',
  ])
  expect(summaryLine(rows)).toBe('1 čaká · 2 beží · 3 nečinné')
})

test('session_meta vlákna z VS Code a z appky sa prečíta, exec a iný či chýbajúci originator nie', () => {
  const text = rollout(
    metaLine({ cwd: '\\\\?\\C:\\Users\\test\\projekty\\gama' }),
    eventLine('task_started', T0 - 20 * MINUTE),
    eventLine('token_count', T0 - 10 * SECOND),
  )

  expect(parseCodexRollout(text)).toEqual({
    id: 'th-1',
    originator: 'codex_vscode',
    cwd: 'C:\\Users\\test\\projekty\\gama',
    startedAt: T0 - 30 * MINUTE,
    lastAt: T0 - 10 * SECOND,
    turn: { isRunning: true, at: T0 - 20 * MINUTE },
    lastOutputAt: null,
    lastQuestionAt: null,
    lastUserMessageAt: null,
    isTruncated: false,
  })
  // Appka má tiež source vscode, rozlišuje sa len cez originator.
  expect(parseCodexRollout(rollout(metaLine({ originator: 'Codex Desktop' })))?.originator).toBe(
    'Codex Desktop',
  )
  expect(parseCodexRollout(rollout(metaLine({ originator: 'codex_exec', source: 'exec' })))).toBeNull()
  expect(parseCodexRollout(rollout(metaLine({ originator: 'codex_cli_rs', source: 'cli' })))).toBeNull()
  expect(parseCodexRollout(rollout(metaLine({ originator: 'codex desktop' })))).toBeNull()
  expect(parseCodexRollout(rollout(metaLine({ originator: '' })))).toBeNull()
  expect(parseCodexRollout(rollout(metaLine({ originator: undefined })))).toBeNull()
  expect(parseCodexRollout(rollout(metaLine({ id: '' })))).toBeNull()
  // Prvý riadok nie je session_meta, chybný JSON, prázdny súbor.
  expect(parseCodexRollout(rollout(eventLine('task_started', T0), metaLine()))).toBeNull()
  expect(parseCodexRollout('{"timestamp":"2026-10-27T')).toBeNull()
  expect(parseCodexRollout('')).toBeNull()
  // Nedopísaný posledný riadok sa preskočí, CRLF nevadí.
  const partial = `${metaLine()}\r\n${eventLine('task_started', T0 - MINUTE)}\r\n{"timestamp":"20`
  expect(parseCodexRollout(partial)?.lastAt).toBe(T0 - MINUTE)
})

test('ukáže sa len vlákno, ktoré založil používateľ — subagent a kontrola schválení nie', () => {
  const source = (thread_source: unknown, originator = 'codex_vscode') =>
    parseCodexRollout(rollout(metaLine({ thread_source, originator })))?.id ?? null

  expect(source('user')).toBe('th-1')
  expect(source('user', 'Codex Desktop')).toBe('th-1')
  // Staršie vlákna pole nemajú.
  expect(source(undefined)).toBe('th-1')
  expect(source('subagent')).toBeNull()
  expect(source('guardian_review')).toBeNull()
  expect(source('subagent', 'Codex Desktop')).toBeNull()
})

test('cwd Codexu stratí predponu \\\\?\\, inak sa nemení', () => {
  expect(normalizeCodexCwd('\\\\?\\c:\\Users\\test\\gama')).toBe('c:\\Users\\test\\gama')
  expect(normalizeCodexCwd('c:\\Users\\test\\gama')).toBe('c:\\Users\\test\\gama')
  expect(normalizeCodexCwd('C:\\Users\\test\\gama')).toBe('C:\\Users\\test\\gama')
})

test('bežiace vlákno je riadok panelu s názvom Codex HH:MM', () => {
  const busy = codexRowOf(
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    eventLine('token_count', T0 - 10 * SECOND),
  )

  expect(busy).toEqual({
    key: 'codex:th-1',
    agent: 'codex',
    pid: 0,
    sessionId: 'th-1',
    name: 'Codex 08:35',
    cwd: 'c:\\Users\\test\\projekty\\gama',
    folder: 'gama',
    status: 'busy',
    waitingFor: null,
    since: T0 - 5 * MINUTE,
    startedAt: T0 - 30 * MINUTE,
    entrypoint: 'codex_vscode',
    isMe: false,
  })
  expect(busy === null ? '' : rowLine(busy, T0)).toBe('> Codex 08:35  gama — beží 5 min')

  const early = parseCodexRollout(rollout(metaLine({}, new Date(2026, 9, 27, 7, 3, 59).getTime())))
  expect(early === null ? null : codexRow(early, T0, null)?.name).toBe('Codex 07:03')
})

test('vlákno appky je riadok s názvom Codex app HH:MM bez šípky do VS Code', () => {
  const thread = parseCodexRollout(
    rollout(
      metaLine({ originator: 'Codex Desktop' }),
      eventLine('task_started', T0 - 5 * MINUTE),
      eventLine('token_count', T0 - 10 * SECOND),
    ),
  )
  const app = thread === null ? null : codexRow(thread, T0, null)

  expect(app).toEqual({
    key: 'codex:th-1',
    agent: 'codex',
    pid: 0,
    sessionId: 'th-1',
    name: 'Codex app 08:35',
    cwd: 'c:\\Users\\test\\projekty\\gama',
    folder: 'gama',
    status: 'busy',
    waitingFor: null,
    since: T0 - 5 * MINUTE,
    startedAt: T0 - 30 * MINUTE,
    entrypoint: 'Codex Desktop',
    isMe: false,
  })
  expect(app === null ? '' : rowLine(app, T0)).toBe('> Codex app 08:35  gama — beží 5 min')

  // Šípku do okna VS Code má sedenie Claude a vlákno z VS Code, vlákno appky nie.
  const vscode = codexRowOf(T0, eventLine('task_started', T0 - 5 * MINUTE))
  expect(app === null ? null : canSwitchWindow(app)).toBe(false)
  expect(vscode === null ? null : canSwitchWindow(vscode)).toBe(true)
  expect(canSwitchWindow(row())).toBe(true)
})

test('skončené a prerušené vlákno je nečinné od konca ťahu', () => {
  const done = codexRowOf(
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    eventLine('task_complete', T0 - 2 * MINUTE),
    eventLine('thread_settings_applied', T0 - 1 * MINUTE),
  )
  const aborted = codexRowOf(
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    eventLine('turn_aborted', T0 - 3 * MINUTE),
  )
  const again = codexRowOf(
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    eventLine('task_complete', T0 - 4 * MINUTE),
    eventLine('task_started', T0 - 1 * MINUTE),
  )
  const neverAsked = codexRowOf(T0, eventLine('thread_settings_applied', T0 - 20 * MINUTE))

  expect(done).toMatchObject({ status: 'idle', waitingFor: null, since: T0 - 2 * MINUTE })
  expect(aborted).toMatchObject({ status: 'idle', since: T0 - 3 * MINUTE })
  expect(again).toMatchObject({ status: 'busy', since: T0 - 1 * MINUTE })
  // Bez udalosti ťahu platí čas posledného riadku.
  expect(neverAsked).toMatchObject({ status: 'idle', since: T0 - 20 * MINUTE })
})

test('posledný výstup nástroja — function_call_output aj custom_tool_call_output, volanie nie', () => {
  const thread = parseCodexRollout(
    rollout(
      metaLine(),
      eventLine('task_started', T0 - 5 * MINUTE),
      callLine('function_call', 'c-1', T0 - 4 * MINUTE, false),
      outputLine('function_call', 'c-1', T0 - 3 * MINUTE),
      callLine('custom_tool_call', 'c-2', T0 - 2 * MINUTE, false),
      outputLine('custom_tool_call', 'c-2', T0 - 1 * MINUTE),
      callLine('custom_tool_call', 'c-3', T0 - 30 * SECOND, true),
      eventLine('token_count', T0 - 10 * SECOND),
    ),
  )
  // Výstup predchádzajúceho ťahu ostáva posledným výstupom vlákna aj po novom task_started.
  const nextTurn = parseCodexRollout(
    rollout(
      metaLine(),
      outputLine('custom_tool_call', 'c-1', T0 - 3 * MINUTE),
      eventLine('task_complete', T0 - 2 * MINUTE),
      eventLine('task_started', T0 - 1 * MINUTE),
    ),
  )

  expect(thread?.lastOutputAt).toBe(T0 - MINUTE)
  expect(thread?.lastAt).toBe(T0 - 10 * SECOND)
  expect(nextTurn?.lastOutputAt).toBe(T0 - 3 * MINUTE)
})

test('marker novší ako posledný výstup v bežiacom ťahu — čaká na schválenie od času markera', () => {
  const waiting = markedRowOf(
    T0 - 30 * SECOND,
    T0,
    eventLine('task_started', T0 - 2 * MINUTE),
    callLine('custom_tool_call', 'c-0', T0 - 90 * SECOND, false),
    outputLine('custom_tool_call', 'c-0', T0 - 80 * SECOND),
    callLine('custom_tool_call', 'c-1', T0 - 31 * SECOND, true),
  )

  expect(waiting).toMatchObject({
    status: 'waiting',
    waitingFor: 'schválenie',
    since: T0 - 30 * SECOND,
  })
  expect(waiting === null ? '' : rowLine(waiting, T0)).toBe(
    '! Codex 08:35  gama — čaká <1 min · schválenie',
  )
  // Čaká hneď po zápise markera, bez ticha — aj pri staršom tvare function_call.
  expect(
    markedRowOf(
      T0 - SECOND,
      T0,
      eventLine('task_started', T0 - 2 * MINUTE),
      callLine('function_call', 'c-1', T0 - 2 * SECOND, true),
    ),
  ).toMatchObject({ status: 'waiting', since: T0 - SECOND })
  // Bez výstupu vo vlákne stačí marker od začiatku ťahu (aj presne v ňom).
  expect(markedRowOf(T0 - 2 * MINUTE, T0, eventLine('task_started', T0 - 2 * MINUTE))).toMatchObject(
    { status: 'waiting', since: T0 - 2 * MINUTE },
  )
})

test('nečaká — výstup po markeri, marker spred začiatku ťahu, skončený ťah, súbor bez ťahu', () => {
  const started = eventLine('task_started', T0 - 2 * MINUTE)
  const call = callLine('custom_tool_call', 'c-1', T0 - 31 * SECOND, true)
  // Schválené aj zamietnuté — výstup prišiel po markeri.
  const answered = markedRowOf(
    T0 - 30 * SECOND,
    T0,
    started,
    call,
    outputLine('custom_tool_call', 'c-1', T0 - 25 * SECOND),
  )
  // Výstup v tú istú milisekundu — marker nie je novší.
  const sameMs = markedRowOf(
    T0 - 30 * SECOND,
    T0,
    started,
    call,
    outputLine('custom_tool_call', 'c-1', T0 - 30 * SECOND),
  )
  // Ťah prerušený počas čakania a nový ťah — marker je starší ako jeho začiatok.
  const oldTurn = markedRowOf(
    T0 - 4 * MINUTE,
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    callLine('custom_tool_call', 'c-1', T0 - 4 * MINUTE - SECOND, true),
    eventLine('turn_aborted', T0 - 3 * MINUTE),
    eventLine('task_started', T0 - 1 * MINUTE),
  )
  // Ťah skončil — nečinné, aj keď na marker výstup neprišiel.
  const ended = markedRowOf(
    T0 - 4 * MINUTE,
    T0,
    eventLine('task_started', T0 - 5 * MINUTE),
    callLine('custom_tool_call', 'c-1', T0 - 4 * MINUTE - SECOND, true),
    eventLine('task_complete', T0 - 3 * MINUTE),
  )
  // Celý súbor bez udalosti ťahu — marker ťah nespustí.
  const noTurn = markedRowOf(T0 - 30 * SECOND, T0, call)

  expect(answered).toMatchObject({ status: 'busy', waitingFor: null, since: T0 - 2 * MINUTE })
  expect(sameMs).toMatchObject({ status: 'busy' })
  expect(oldTurn).toMatchObject({ status: 'busy', since: T0 - 1 * MINUTE })
  expect(ended).toMatchObject({ status: 'idle', since: T0 - 3 * MINUTE })
  expect(noTurn).toMatchObject({ status: 'idle' })
})

test('beží alebo čaká bez riadku 2 h — skončilo, skončené po 3 h zmizne', () => {
  const stale = codexRowOf(
    T0,
    eventLine('task_started', T0 - 3 * HOUR),
    eventLine('token_count', T0 - 2 * HOUR - SECOND),
  )
  const staleWaiting = markedRowOf(
    T0 - 2 * HOUR - SECOND,
    T0,
    eventLine('task_started', T0 - 3 * HOUR),
    callLine('custom_tool_call', 'c-1', T0 - 2 * HOUR - SECOND, true),
  )
  const stillBusy = codexRowOf(
    T0,
    eventLine('task_started', T0 - 3 * HOUR),
    eventLine('token_count', T0 - 2 * HOUR + SECOND),
  )

  expect(stale).toMatchObject({ status: 'idle', since: T0 - 3 * HOUR })
  expect(staleWaiting).toMatchObject({ status: 'idle', since: T0 - 3 * HOUR })
  expect(stillBusy).toMatchObject({ status: 'busy' })

  const lines = [eventLine('task_started', T0 - 4 * HOUR), eventLine('task_complete', T0 - 3 * HOUR)]
  expect(codexRowOf(T0 - SECOND, ...lines)).toMatchObject({ status: 'idle' })
  expect(codexRowOf(T0 + SECOND, ...lines)).toBeNull()
})

test('volanie s require_escalated bez markera nikdy nečaká, ani po dlhom tichu', () => {
  // Skutočné tvary — JSON argumenty function_call, vstup custom_tool_call `exec` (kľúč bez úvodzoviek).
  const realFunction = JSON.stringify({
    command: ['git', 'push'],
    sandbox_permissions: 'require_escalated',
    justification: 'Povolí push',
  })
  const realCustom =
    'exec({cmd:"git push",login:false,max_output_tokens:3000,sandbox_permissions:"require_escalated",justification:"Povolí push"})'
  const requests = [
    ['function_call', realFunction],
    ['custom_tool_call', realCustom],
  ] as const

  for (const [type, request] of requests) {
    const asked = requestLine(type, 'c-1', T0 - HOUR, request)
    expect(codexRowOf(T0, eventLine('task_started', T0 - 2 * HOUR), asked)).toMatchObject({
      status: 'busy',
      waitingFor: null,
      since: T0 - 2 * HOUR,
    })
    // Skrátené vlákno bez udalosti ťahu po 60 s ticha skončí, nečaká.
    expect(truncatedRowOf(null, T0, asked)).toMatchObject({ status: 'idle', since: T0 - HOUR })
  }
})

test('prvý riadok a koniec dlhého súboru — za prvým riadkom len celé riadky', () => {
  const head = `${metaLine()}\n`
  const started = eventLine('task_started', T0 - MINUTE)
  const last = eventLine('token_count', T0 - SECOND)

  // Výrez začal presne na začiatku riadku — bajt pred ním je koniec riadku.
  expect(joinRolloutHeadTail(`${head}\n${started}\n${last}\n`)).toBe(`${head}${started}\n${last}\n`)
  // Výrez začal v strede riadku — nedokončený začiatok sa zahodí.
  expect(joinRolloutHeadTail(`${head}put":"ok"}}\n${started}\n${last}\n`)).toBe(
    `${head}${started}\n${last}\n`,
  )
  // Prázdny koniec alebo koniec bez celého riadku — ostane prvý riadok.
  expect(joinRolloutHeadTail(head)).toBe(head)
  expect(joinRolloutHeadTail(`${head}\n`)).toBe(head)
  expect(joinRolloutHeadTail(`${head}"type":"event_msg"`)).toBe(head)
  expect(joinRolloutHeadTail('')).toBe('')
  expect(parseCodexRollout(joinRolloutHeadTail(`${head}put"}\n${started}\n${last}\n`))?.lastAt).toBe(
    T0 - SECOND,
  )
})

test('skrátené vlákno bez udalosti ťahu beží, kým pribúdajú riadky (60 s)', () => {
  const quiet = [
    callLine('function_call', 'c-1', T0 - 2 * MINUTE, false),
    outputLine('function_call', 'c-1', T0 - 30 * SECOND),
  ]

  expect(truncatedRowOf(null, T0, ...quiet)).toMatchObject({ status: 'busy', since: T0 - 30 * SECOND })
  expect(truncatedRowOf(null, T0 + 31 * SECOND, ...quiet)).toMatchObject({
    status: 'idle',
    since: T0 - 30 * SECOND,
  })
  // Celý súbor bez udalosti ťahu je nečinný aj s čerstvým riadkom.
  expect(codexRowOf(T0, ...quiet)).toMatchObject({ status: 'idle' })
  // Marker novší ako posledný výstup drží skrátené vlákno v čakaní aj po 60 s ticha.
  const asked = [
    outputLine('custom_tool_call', 'c-0', T0 - 2 * MINUTE),
    callLine('custom_tool_call', 'c-1', T0 - 91 * SECOND, true),
  ]
  expect(truncatedRowOf(T0 - 90 * SECOND, T0, ...asked)).toMatchObject({
    status: 'waiting',
    waitingFor: 'schválenie',
    since: T0 - 90 * SECOND,
  })
  // Marker spred posledného výstupu je vybavený — platí 60 s ticha.
  expect(truncatedRowOf(T0 - 3 * MINUTE, T0, ...asked)).toMatchObject({
    status: 'idle',
    since: T0 - 91 * SECOND,
  })
  // Udalosť ťahu v konci súboru platí ako pri celom súbore.
  expect(truncatedRowOf(null, T0, eventLine('task_complete', T0 - 10 * MINUTE))).toMatchObject({
    status: 'idle',
    since: T0 - 10 * MINUTE,
  })
  expect(
    truncatedRowOf(
      null,
      T0,
      eventLine('task_started', T0 - 10 * MINUTE),
      eventLine('token_count', T0 - 5 * MINUTE),
    ),
  ).toMatchObject({ status: 'busy', since: T0 - 10 * MINUTE })
})

test('posledná otázka a správa používateľa — agent_message s otázkami a user_message, iné nie', () => {
  const thread = parseCodexRollout(
    rollout(
      metaLine(),
      eventLine('task_started', T0 - 5 * MINUTE),
      userMessageLine(T0 - 5 * MINUTE, 'spýtaj sa ma ešte raz'),
      // Commentary pred otázkou pole questions nemá.
      questionLine(T0 - 4 * MINUTE, { questions: undefined, phase: 'commentary', delivery: undefined }),
      ...askedLines(T0 - 3 * MINUTE),
      sleepOutputLine(T0 - 2 * MINUTE),
      ...replyLines(T0 - 2 * MINUTE),
      // Prázdne pole otázok sa nepočíta.
      questionLine(T0 - MINUTE, { questions: [] }),
      eventLine('task_complete', T0 - 30 * SECOND),
    ),
  )

  expect(thread?.lastQuestionAt).toBe(T0 - 3 * MINUTE)
  expect(thread?.lastUserMessageAt).toBe(T0 - 2 * MINUTE)
  // Volanie request_user_input_async bez agent_message otázka nie je, správa
  // používateľa len v response_item message nie je user_message.
  const signalsOnly = parseCodexRollout(
    rollout(
      metaLine(),
      askCallLine('call_q-1', T0 - 2 * MINUTE),
      questionLine(T0 - MINUTE, { questions: undefined }),
      ...replyLines(T0 - 30 * SECOND).slice(0, 1),
    ),
  )
  expect(signalsOnly?.lastQuestionAt).toBeNull()
  expect(signalsOnly?.lastUserMessageAt).toBeNull()
})

test('otázka v bežiacom ťahu — čaká na odpoveď od času otázky, aj počas clock.sleep', () => {
  const asking = codexRowOf(
    T0,
    eventLine('task_started', T0 - 2 * MINUTE),
    userMessageLine(T0 - 2 * MINUTE, 'spýtaj sa ma ešte raz'),
    ...askedLines(T0 - 30 * SECOND),
  )

  expect(asking).toMatchObject({ status: 'waiting', waitingFor: 'otázka', since: T0 - 30 * SECOND })
  expect(asking === null ? '' : rowLine(asking, T0)).toBe('! Codex 08:35  gama — čaká <1 min · otázka')
})

test('otázka nečaká — po odpovedi, spred začiatku ťahu, po konci ťahu', () => {
  const started = eventLine('task_started', T0 - 5 * MINUTE)
  const asked = askedLines(T0 - 2 * MINUTE)
  // Odpoveď kliknutím na možnosť.
  const clicked = codexRowOf(T0, started, ...asked, sleepOutputLine(T0 - MINUTE), ...replyLines(T0 - MINUTE))
  // Napísaná správa namiesto kliknutia.
  const typed = codexRowOf(
    T0,
    started,
    ...asked,
    sleepOutputLine(T0 - MINUTE),
    userMessageLine(T0 - MINUTE, 'ukazuje mi to, že beží'),
  )
  // Správa v tú istú milisekundu — otázka nie je novšia.
  const sameMs = codexRowOf(T0, started, ...asked, userMessageLine(T0 - 2 * MINUTE, 'hneď'))
  // Ťah prerušený počas otázky a nový ťah (tu aj bez user_message) — otázka je
  // staršia ako jeho začiatok.
  const oldTurn = codexRowOf(
    T0,
    eventLine('task_started', T0 - 10 * MINUTE),
    ...askedLines(T0 - 9 * MINUTE),
    eventLine('turn_aborted', T0 - 8 * MINUTE),
    eventLine('task_started', T0 - MINUTE),
  )
  // Ťah skončil s nezodpovedanou otázkou — nečinné.
  const ended = codexRowOf(T0, started, ...asked, eventLine('task_complete', T0 - MINUTE))

  expect(clicked).toMatchObject({ status: 'busy', waitingFor: null, since: T0 - 5 * MINUTE })
  expect(typed).toMatchObject({ status: 'busy', waitingFor: null, since: T0 - 5 * MINUTE })
  expect(sameMs).toMatchObject({ status: 'busy' })
  expect(oldTurn).toMatchObject({ status: 'busy', waitingFor: null, since: T0 - MINUTE })
  expect(ended).toMatchObject({ status: 'idle', waitingFor: null, since: T0 - MINUTE })
  // Otvorená otázka bez riadku 2 h — skončilo ako pri schválení.
  const lastAt = T0 - 2 * MINUTE + 2 * SECOND
  expect(codexRowOf(lastAt + 2 * HOUR + SECOND, started, ...asked)).toMatchObject({
    status: 'idle',
    since: T0 - 5 * MINUTE,
  })
})

test('otvorené schválenie má prednosť pred otázkou, po jeho vybavení čaká otázka', () => {
  const lines = [
    eventLine('task_started', T0 - 5 * MINUTE),
    askCallLine('call_q-1', T0 - 2 * MINUTE),
    questionLine(T0 - 2 * MINUTE),
    textOutputLine('call_q-1', T0 - 2 * MINUTE, '{"accepted":true}'),
    // Async otázka Codex nezastaví — pracuje ďalej a pýta schválenie príkazu.
    callLine('custom_tool_call', 'c-1', T0 - 31 * SECOND, true),
  ]

  expect(markedRowOf(T0 - 30 * SECOND, T0, ...lines)).toMatchObject({
    status: 'waiting',
    waitingFor: 'schválenie',
    since: T0 - 30 * SECOND,
  })
  // Výstup príkazu prišiel — schválenie je vybavené, otázka ostáva otvorená.
  expect(
    markedRowOf(T0 - 30 * SECOND, T0, ...lines, outputLine('custom_tool_call', 'c-1', T0 - 10 * SECOND)),
  ).toMatchObject({ status: 'waiting', waitingFor: 'otázka', since: T0 - 2 * MINUTE })
})

test('skrátené vlákno bez udalosti ťahu s otvorenou otázkou čaká aj po 60 s ticha', () => {
  const asked = askedLines(T0 - 2 * MINUTE)

  expect(truncatedRowOf(null, T0, ...asked)).toMatchObject({
    status: 'waiting',
    waitingFor: 'otázka',
    since: T0 - 2 * MINUTE,
  })
  // Po odpovedi platí 60 s ticha — skončilo od posledného riadku.
  expect(
    truncatedRowOf(null, T0, ...asked, sleepOutputLine(T0 - 90 * SECOND), ...replyLines(T0 - 90 * SECOND)),
  ).toMatchObject({ status: 'idle', since: T0 - 90 * SECOND })
  // Celý súbor bez udalosti ťahu — otázka ťah nespustí.
  expect(codexRowOf(T0, ...asked)).toMatchObject({ status: 'idle' })
})

test('priečinky Codexu — dnešný a včerajší miestny dátum, len súbory rollout-*.jsonl', () => {
  expect(codexSessionsDir('C:\\Users\\test\\')).toBe(CODEX)
  expect(codexSessionsDir(undefined)).toBe(path.join(homedir(), '.codex', 'sessions'))
  expect(codexDayDirs(CODEX, T0)).toEqual([CODEX_TODAY, CODEX_YESTERDAY])
  expect(codexDayDirs(CODEX, new Date(2026, 10, 1, 0, 30).getTime())).toEqual([
    `${CODEX}\\2026\\11\\01`,
    `${CODEX}\\2026\\10\\31`,
  ])
  expect(codexDayDirs(CODEX, new Date(2027, 0, 1, 8, 0).getTime())).toEqual([
    `${CODEX}\\2027\\01\\01`,
    `${CODEX}\\2026\\12\\31`,
  ])
  expect(isRolloutFile('rollout-2026-11-03T16-12-23-01a1a1f7.jsonl')).toBe(true)
  expect(isRolloutFile('rollout-2026-10-01T10-00-00-01a0.jsonl.zst')).toBe(false)
  expect(isRolloutFile('session_index.jsonl')).toBe(false)
})

test('marker hooku PermissionRequest — id vlákna a čas, chybný alebo neúplný je null', () => {
  // Formát zo sedenia_cakanie.py so syntetickými údajmi, medzerami a diakritikou v cwd.
  const real = String.raw`{"session_id": "11111111-1111-4111-8111-111111111111", "turn_id": "33333333-3333-4333-8333-333333333333", "cwd": "C:\\Users\\test\\projekty\\Žilina", "tool_name": "Bash", "event": "PermissionRequest", "time_ms": 1793741524040}`

  expect(parseApprovalMarker(real)).toEqual({
    sessionId: '11111111-1111-4111-8111-111111111111',
    at: 1793741524040,
  })
  expect(parseApprovalMarker(markerText('th-1', T0))).toEqual({ sessionId: 'th-1', at: T0 })
  // Chybný JSON, prázdny súbor, nie objekt.
  expect(parseApprovalMarker('{"session_id": "th-1", "time_ms": 17')).toBeNull()
  expect(parseApprovalMarker('')).toBeNull()
  expect(parseApprovalMarker('null')).toBeNull()
  expect(parseApprovalMarker('[1]')).toBeNull()
  // Chýbajúce, prázdne alebo nie textové session_id.
  expect(parseApprovalMarker(markerText('th-1', T0, { session_id: undefined }))).toBeNull()
  expect(parseApprovalMarker(markerText('', T0))).toBeNull()
  expect(parseApprovalMarker(markerText('th-1', T0, { session_id: 42 }))).toBeNull()
  // Nečíselný alebo chýbajúci time_ms.
  expect(parseApprovalMarker(markerText('th-1', T0, { time_ms: String(T0) }))).toBeNull()
  expect(parseApprovalMarker(markerText('th-1', T0, { time_ms: null }))).toBeNull()
  expect(parseApprovalMarker(markerText('th-1', T0, { time_ms: undefined }))).toBeNull()
  // Marker je len <id>.json, rozpísaný súbor hooku nie.
  expect(isApprovalFile('11111111-1111-4111-8111-111111111111.json')).toBe(true)
  expect(isApprovalFile('11111111-1111-4111-8111-111111111111.json.tmp')).toBe(false)
  expect(isApprovalFile('poznamka.txt')).toBe(false)
})

test('priečinok markerov pod profilom, nový či zmenený marker je zmena, zmiznutý nie', () => {
  expect(codexApprovalDir(PROFILE)).toBe(APPROVALS)
  expect(codexApprovalDir('C:\\Users\\test\\')).toBe(APPROVALS)
  expect(codexApprovalDir(undefined)).toBe(path.join(homedir(), '.codex', 'hooks', 'sedenia-cakanie'))
  expect(codexApprovalDir('')).toBe(path.join(homedir(), '.codex', 'hooks', 'sedenia-cakanie'))

  const times = (...pairs: [string, number][]) => new Map(pairs)
  expect(hasNewApproval(times(), times())).toBe(false)
  expect(hasNewApproval(times(['th-1', T0]), times(['th-1', T0]))).toBe(false)
  expect(hasNewApproval(times(), times(['th-1', T0]))).toBe(true)
  expect(hasNewApproval(times(['th-1', T0]), times(['th-1', T0 + SECOND]))).toBe(true)
  expect(hasNewApproval(times(['th-1', T0]), times(['th-1', T0], ['th-2', T0]))).toBe(true)
  expect(hasNewApproval(times(['th-1', T0], ['th-2', T0]), times(['th-1', T0]))).toBe(false)
})

test('na priečinok najviac dve vlákna — bežiace a čakajúce vždy, skončené doplnia voľné miesta', () => {
  // `since` skončeného vlákna je opačne ako `lastAt` — vyberá sa podľa posledného riadku.
  const entry = (id: string, status: string, lastAt: number, cwd = 'c:\\p\\gama') => ({
    row: row({ key: `codex:${id}`, agent: 'codex', pid: 0, cwd, status, since: T0 - lastAt }),
    lastAt,
  })
  const keysOf = (entries: Parameters<typeof visibleCodexRows>[0]) =>
    visibleCodexRows(entries).map(one => one.key)

  // Tri skončené — ostanú dve s najnovším posledným riadkom.
  expect(
    keysOf([
      entry('stare', 'idle', T0 - 3 * MINUTE),
      entry('nove', 'idle', T0 - 1 * MINUTE),
      entry('stredne', 'idle', T0 - 2 * MINUTE),
    ]),
  ).toEqual(['codex:nove', 'codex:stredne'])
  // Jedno bežiace a dve skončené — bežiace a najnovšie skončené.
  expect(
    keysOf([
      entry('stare', 'idle', T0 - 3 * MINUTE),
      entry('bezi', 'busy', T0 - 5 * MINUTE),
      entry('nove', 'idle', T0 - 1 * MINUTE),
    ]),
  ).toEqual(['codex:bezi', 'codex:nove'])
  // Dve bežiace či čakajúce — skončené sa neukážu, aktívne vždy všetky.
  expect(
    keysOf([
      entry('bezi', 'busy', T0 - 5 * MINUTE),
      entry('caka', 'waiting', T0 - 4 * MINUTE),
      entry('nove', 'idle', T0 - 1 * MINUTE),
    ]),
  ).toEqual(['codex:bezi', 'codex:caka'])
  expect(
    keysOf([
      entry('a', 'busy', T0),
      entry('b', 'busy', T0),
      entry('c', 'waiting', T0),
    ]),
  ).toEqual(['codex:a', 'codex:b', 'codex:c'])
  // Rôzne priečinky sa počítajú zvlášť, c:\ a C:\ je ten istý priečinok.
  expect(
    keysOf([
      entry('gama-1', 'idle', T0 - 3 * MINUTE, 'c:\\p\\gama'),
      entry('delta-1', 'idle', T0 - 2 * MINUTE, 'c:\\p\\delta'),
      entry('gama-2', 'idle', T0 - 2 * MINUTE, 'C:\\p\\gama'),
      entry('gama-3', 'busy', T0 - 1 * MINUTE, 'C:\\P\\Gama'),
      entry('delta-2', 'idle', T0 - 1 * MINUTE, 'c:\\p\\delta'),
    ]),
  ).toEqual(['codex:delta-1', 'codex:gama-2', 'codex:gama-3', 'codex:delta-2'])
  expect(visibleCodexRows([])).toEqual([])
})

test('appka je samostatná skupina — jedno skončené naprieč priečinkami, aktívne vždy, miesta VS Code nezaberá', () => {
  const entry = (id: string, entrypoint: string, status: string, lastAt: number, cwd: string) => ({
    row: row({ key: `codex:${id}`, agent: 'codex', pid: 0, cwd, status, since: T0 - lastAt, entrypoint }),
    lastAt,
  })
  const vscode = (id: string, status: string, lastAt: number, cwd = 'c:\\p\\gama') =>
    entry(id, 'codex_vscode', status, lastAt, cwd)
  const app = (id: string, status: string, lastAt: number, cwd = 'c:\\p\\gama') =>
    entry(id, 'Codex Desktop', status, lastAt, cwd)
  const keysOf = (entries: Parameters<typeof visibleCodexRows>[0]) =>
    visibleCodexRows(entries).map(one => one.key)

  // Appka v rovnakom priečinku nezaberie miesta VS Code — z appky len najnovšie
  // skončené naprieč priečinkami.
  expect(
    keysOf([
      vscode('vs-1', 'idle', T0 - 3 * MINUTE),
      app('app-1', 'idle', T0 - 1 * MINUTE),
      vscode('vs-2', 'idle', T0 - 2 * MINUTE),
      app('app-2', 'idle', T0 - 30 * SECOND, 'c:\\p\\delta'),
      app('app-3', 'idle', T0 - 4 * MINUTE),
    ]),
  ).toEqual(['codex:vs-1', 'codex:vs-2', 'codex:app-2'])
  // Bežiace a čakajúce z appky vždy, jedno skončené popri nich tiež.
  expect(
    keysOf([
      app('app-bezi', 'busy', T0 - 5 * MINUTE),
      app('app-stare', 'idle', T0 - 3 * MINUTE),
      app('app-caka', 'waiting', T0 - 4 * MINUTE, 'c:\\p\\delta'),
      app('app-nove', 'idle', T0 - 1 * MINUTE),
      app('app-bezi-2', 'busy', T0 - 2 * MINUTE),
    ]),
  ).toEqual(['codex:app-bezi', 'codex:app-caka', 'codex:app-nove', 'codex:app-bezi-2'])
  // Dve bežiace vlákna VS Code zaplnia priečinok — skončené z VS Code nie, z appky áno.
  expect(
    keysOf([
      vscode('vs-a', 'busy', T0),
      vscode('vs-b', 'busy', T0),
      vscode('vs-idle', 'idle', T0 - 1 * MINUTE),
      app('app-idle', 'idle', T0 - 2 * MINUTE),
    ]),
  ).toEqual(['codex:vs-a', 'codex:vs-b', 'codex:app-idle'])
})

test('toasty Codexu — do čakania a koniec ťahu, prvé čítanie a zmiznuté bez toastu', () => {
  const busy = row({
    key: 'codex:a',
    agent: 'codex',
    pid: 0,
    name: 'Codex 08:35',
    folder: 'gama',
    status: 'busy',
    since: T0 - MINUTE,
  })
  const waiting = { ...busy, status: 'waiting', waitingFor: 'schválenie' }
  const done = { ...busy, status: 'idle', since: T0 - 5 * SECOND }
  const before = (status: string) => new Map([['codex:a', status]])

  // Prvé čítanie po štarte toasty nedáva.
  expect(codexToasts(null, [waiting, done], T0)).toEqual([])
  expect(codexToasts(before('busy'), [waiting], T0)).toEqual(['Codex 08:35 · gama čaká — schválenie'])
  expect(codexToasts(new Map(), [waiting], T0)).toEqual(['Codex 08:35 · gama čaká — schválenie'])
  // Bez dôvodu čakania platí rovnaký text — schválenie.
  expect(codexToasts(before('busy'), [{ ...waiting, waitingFor: null }], T0)).toEqual([
    'Codex 08:35 · gama čaká — schválenie',
  ])
  expect(codexToasts(before('waiting'), [waiting], T0)).toEqual([])
  // Otázka Codexu — dôvod z riadku. Zo schválenia rovno do otázky toast nie, vlákno čakalo už predtým.
  const asking = { ...waiting, waitingFor: 'otázka' }
  expect(codexToasts(before('busy'), [asking], T0)).toEqual(['Codex 08:35 · gama čaká — otázka'])
  expect(codexToasts(before('waiting'), [asking], T0)).toEqual([])
  expect(codexToasts(before('busy'), [done], T0)).toEqual(['Codex 08:35 · gama dokončil ťah'])
  expect(codexToasts(before('waiting'), [done], T0)).toEqual(['Codex 08:35 · gama dokončil ťah'])
  // Bolo nečinné alebo je nové — toast nie, z čakania späť do behu tiež nie.
  expect(codexToasts(before('idle'), [done], T0)).toEqual([])
  expect(codexToasts(new Map(), [done], T0)).toEqual([])
  expect(codexToasts(before('waiting'), [busy], T0)).toEqual([])
  // Zmizlo zo zoznamu — toast nie.
  expect(codexToasts(before('busy'), [], T0)).toEqual([])
  // Ťah „skončil" len 2 h tichom — toast nie.
  expect(codexToasts(before('busy'), [{ ...done, since: T0 - 3 * HOUR }], T0)).toEqual([])
  expect(statusesByKey([waiting])).toEqual(new Map([['codex:a', 'waiting']]))
})
