import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionMonitor } from '../src/monitor'
import { SessionReader, readRollout } from '../src/readers'
import { codexDayDirs, parseCodexRollout } from '../src/codex'
import { codexApprovalDir, codexSessionsDir, parseSessionRecord, registryDir } from '../src/sessions'
import { isCurrentWindow, navigationTarget } from '../src/navigation'
import type { SessionRow } from '../src/types'

const NOW = Date.now()
const folder = 'C:\\projekty\\Žilina & 100% ^ (test)'
function row(fields: Partial<SessionRow> = {}): SessionRow {
  return { key: 'claude:101', agent: 'claude', pid: 101, sessionId: 's-101', name: 'Test', cwd: folder,
    folder: 'Test', status: 'idle', waitingFor: null, since: NOW, startedAt: NOW, entrypoint: 'claude-vscode', isMe: false, ...fields }
}
function event(type: string, at: number, extra: object = {}): string {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload: { type, ...extra } }) + '\n'
}
function meta(id = 'thread-a', originator = 'Codex Desktop'): string {
  return JSON.stringify({ type: 'session_meta', timestamp: new Date(NOW - 1000).toISOString(), payload: { id, cwd: folder, originator } }) + '\n'
}
async function fixture() {
  const profile = await mkdtemp(path.join(tmpdir(), 'sedenia-test-'))
  const registry = registryDir(profile)
  const codex = codexDayDirs(codexSessionsDir(profile), NOW)[0]
  const approvals = codexApprovalDir(profile)
  await Promise.all([registry, codex, approvals].map(dir => mkdir(dir, { recursive: true })))
  const record = async (pid: number, status: string) => {
    await writeFile(path.join(registry, `${pid}.json`), JSON.stringify({ pid, sessionId: `s-${pid}`, name: `Claude ${pid}`, cwd: folder,
      kind: 'interactive', entrypoint: 'claude-vscode', status, statusUpdatedAt: NOW, startedAt: NOW - 1000 }), 'utf8')
  }
  const thread = (id = 'thread-a') => path.join(codex, `rollout-test-${id}.jsonl`)
  const marker = async (id: string, at: number) => {
    const file = path.join(approvals, `${id}.json`)
    await writeFile(file, JSON.stringify({ session_id: id, time_ms: at }), 'utf8')
    await utimes(file, new Date(at), new Date(at))
  }
  return { profile, registry, codex, approvals, record, thread, marker }
}

test('navigácia zachová diakritiku a shellové znaky ako obyčajné dáta', () => {
  assert.deepEqual(navigationTarget(row()), { kind: 'folder', path: folder })
  assert.throws(() => navigationTarget(row({ cwd: 'cmd.exe /c anything' })))
  assert.throws(() => navigationTarget(row({ cwd: 'https://example.com' })))
  assert.throws(() => navigationTarget(row({ cwd: 'C:\\test\nother' })))
})

test('appka dostane presný odkaz, neplatné ID sa nikdy neotvorí', () => {
  const app = row({ agent: 'codex', entrypoint: 'Codex Desktop', sessionId: '22222222-2222-4222-8222-222222222222' })
  assert.equal(navigationTarget(app).kind, 'codex')
  assert.deepEqual(navigationTarget(app), { kind: 'codex', url: 'codex://threads/22222222-2222-4222-8222-222222222222' })
  for (const id of ['', '../settings', 'a?prompt=oops', 'x#fragment']) assert.throws(() => navigationTarget({ ...app, sessionId: id }))
})

test('toto okno porovná normalizované cesty, natívna appka nie je sedením okna', () => {
  assert.equal(isCurrentWindow(row(), [folder.toUpperCase() + '\\']), true)
  assert.equal(isCurrentWindow(row({ cwd: '\\\\?\\' + folder }), [folder]), true)
  assert.equal(isCurrentWindow(row(), [folder + '-other']), false)
  assert.equal(isCurrentWindow(row({ entrypoint: 'Codex Desktop' }), [folder]), false)
})

test('register filtruje cudzie súbory, hlási pokazené záznamy a nemaže ich', async () => {
  const f = await fixture()
  const errors: string[] = []
  const reader = new SessionReader(message => errors.push(message))
  await writeFile(path.join(f.registry, '101.json'), '{bad')
  await writeFile(path.join(f.registry, '102.json'), JSON.stringify({ pid: 102, kind: 'daemon' }))
  await writeFile(path.join(f.registry, '101.secret.key'), 'ignored')
  const result = await reader.readRegistry(f.registry)
  assert.equal(result.records.length, 0)
  assert.match(result.issues[0], /žiadny/)
  assert.equal(errors.length, 1)
  assert.equal(await readFile(path.join(f.registry, '101.json'), 'utf8'), '{bad')
})

test('veľký JSONL zachová hlavičku a celé riadky konca bez rozbitia UTF-8', async () => {
  const f = await fixture()
  const filler = event('agent_message', NOW, { message: 'Žilina — ľščťžýáíé漢'.repeat(400) })
  await writeFile(f.thread(), meta() + event('task_started', NOW) + filler.repeat(900) + event('task_complete', NOW + 1) + '{partial', 'utf8')
  const read = await readRollout(f.thread())
  assert.equal(read.truncated, true)
  assert.ok(Buffer.byteLength(read.text) < 1024 * 1024 + 2048)
  assert.equal(read.text.includes('\ufffd'), false)
  assert.equal(parseCodexRollout(read.text)?.turn?.isRunning, false)
})

test('cache Codexu zachová posledný platný stav po poškodení súboru', async () => {
  const f = await fixture()
  const errors: string[] = []
  const reader = new SessionReader(message => errors.push(message))
  await writeFile(f.thread(), meta() + event('task_started', NOW))
  const original = await reader.readCodexThreads(codexSessionsDir(f.profile), NOW)
  await writeFile(f.thread(), 'broken header\n')
  const fallback = await reader.readCodexThreads(codexSessionsDir(f.profile), NOW + 1)
  assert.deepEqual(fallback, original)
  assert.equal(errors.length, 1)
})

test('markery staršie ako 48 h a rozpísané .tmp sa ignorujú', async () => {
  const f = await fixture()
  await f.marker('fresh', NOW)
  await f.marker('old', NOW - 49 * 60 * 60_000)
  await writeFile(path.join(f.approvals, 'pending.json.tmp'), '{bad')
  assert.deepEqual(await new SessionReader(() => {}).readApprovalTimes(f.approvals, NOW), new Map([['fresh', NOW]]))
})

test('Codex sa zobrazí aj bez registra Claude, prvý poll nedáva upozornenia', async () => {
  const f = await fixture()
  // Neexistujúci register simulujeme čítaním inej cesty, bez mazania testovacích súborov.
  const reader = new SessionReader(() => {})
  reader.readRegistry = async () => ({ records: [], issues: ['Register Claude nenájdený'] })
  await writeFile(f.thread(), meta() + event('task_started', NOW))
  await f.marker('thread-a', NOW + 1)
  const monitor = new SessionMonitor(() => {}, { profile: f.profile, reader })
  const snapshot = await monitor.poll(NOW + 2, [])
  assert.equal(snapshot.rows[0].status, 'waiting')
  assert.deepEqual(snapshot.notifications, [])
  assert.match(snapshot.issues[0], /nenájdený/)
})

test('Claude upozorní raz, vlastné okno mlčí a mŕtve PID-y sa skryjú', async () => {
  const f = await fixture()
  await f.record(101, 'busy')
  await f.record(202, 'waiting')
  const monitor = new SessionMonitor(() => {}, { profile: f.profile, livePids: async () => new Set([101]) })
  assert.equal((await monitor.poll(NOW, [])).rows.length, 1)
  await f.record(101, 'waiting')
  assert.equal((await monitor.poll(NOW + 3000, [])).notifications.length, 1)
  assert.equal((await monitor.poll(NOW + 6000, [])).notifications.length, 0)
  const own = new SessionMonitor(() => {}, { profile: f.profile, livePids: async () => new Set([101]) })
  await f.record(101, 'busy')
  await own.poll(NOW, [folder])
  await f.record(101, 'waiting')
  assert.deepEqual((await own.poll(NOW + 3000, [folder])).notifications, [])
})

test('cache tasklistu platí 15 s, nový PID vyvolá okamžité čítanie', async () => {
  const f = await fixture()
  await f.record(101, 'busy')
  let reads = 0
  const monitor = new SessionMonitor(() => {}, { profile: f.profile, livePids: async () => { reads++; return new Set([101, 102]) } })
  await monitor.poll(NOW, [])
  await monitor.poll(NOW + 3000, [])
  assert.equal(reads, 1)
  await f.record(102, 'busy')
  await monitor.poll(NOW + 6000, [])
  assert.equal(reads, 2)
  await monitor.poll(NOW + 21_000, [])
  assert.equal(reads, 3)
})

test('výpadok tasklistu nevyrobí upozornenie za predtým mŕtve sedenie', async () => {
  const f = await fixture()
  await f.record(101, 'waiting')
  let fails = false
  const monitor = new SessionMonitor(() => {}, { profile: f.profile, livePids: async () => { if (fails) throw new Error('unavailable'); return new Set() } })
  assert.equal((await monitor.poll(NOW, [])).rows.length, 0)
  fails = true
  const fallback = await monitor.poll(NOW + 16_000, [])
  assert.equal(fallback.rows.length, 1)
  assert.deepEqual(fallback.notifications, [])
})

test('nový marker vynúti Codex pred 10 s, po výstupe a dokončení sa čakajúci stav zruší', async () => {
  const f = await fixture()
  let contents = meta() + event('task_started', NOW)
  await writeFile(f.thread(), contents)
  const monitor = new SessionMonitor(() => {}, { profile: f.profile })
  assert.equal((await monitor.poll(NOW, [])).rows[0].status, 'busy')
  await f.marker('thread-a', NOW + 1000)
  const waiting = await monitor.poll(NOW + 3000, [folder])
  assert.equal(waiting.rows[0].status, 'waiting')
  assert.equal(waiting.notifications.length, 1) // appka upozorňuje aj pri zhodnom cwd
  assert.equal((await monitor.poll(NOW + 6000, [])).notifications.length, 0)
  contents += JSON.stringify({ type: 'response_item', timestamp: new Date(NOW + 7000).toISOString(), payload: { type: 'custom_tool_call_output' } }) + '\n'
  contents += event('task_complete', NOW + 8000)
  await writeFile(f.thread(), contents)
  const done = await monitor.poll(NOW + 13_000, [])
  assert.equal(done.rows[0].status, 'idle')
  assert.match(done.notifications[0], /dokončil ťah/)
})

test('Codex upozorní aj za dokončený chat skrytý limitom a potlačí vlastné okno', async () => {
  const f = await fixture()
  await writeFile(f.thread('a'), meta('a') + event('task_started', NOW))
  const monitor = new SessionMonitor(() => {}, { profile: f.profile })
  await monitor.poll(NOW, [])
  await writeFile(f.thread('a'), meta('a') + event('task_complete', NOW + 1000))
  await writeFile(f.thread('b'), meta('b') + event('task_complete', NOW + 2000))
  const snapshot = await monitor.poll(NOW + 10_000, [])
  assert.equal(snapshot.rows.length, 1)
  assert.equal(snapshot.rows[0].sessionId, 'b')
  assert.equal(snapshot.notifications.length, 1)
  const own = new SessionMonitor(() => {}, { profile: f.profile })
  await writeFile(f.thread('c'), meta('c', 'codex_vscode') + event('task_started', NOW))
  await own.poll(NOW, [folder])
  await writeFile(f.thread('c'), meta('c', 'codex_vscode') + event('task_complete', NOW + 5000))
  assert.deepEqual((await own.poll(NOW + 10_000, [folder])).notifications, [])
})
