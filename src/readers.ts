import { open, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  codexDayDirs, isApprovalFile, isRolloutFile, joinRolloutHeadTail,
  parseApprovalMarker, parseCodexRollout, type ApprovalMarker, type CodexThread,
} from './codex'
import { parseSessionRecord, parseTasklistPids } from './sessions'
import type { SessionRow } from './types'

export type Logger = (message: string, error?: unknown) => void
type Cached<T> = { size: number; mtimeMs: number; value: T | null }
const execFileAsync = promisify(execFile)
const FULL_READ_LIMIT = 4 * 1024 * 1024
const TAIL_BYTES = 1024 * 1024
const APPROVAL_MAX_AGE = 48 * 60 * 60_000

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function listFiles(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }) }
  catch (error) { if (isMissing(error)) return null; throw error }
}

/** Číta obmedzený počet bajtov aj z mnohomegabajtových živých JSONL. */
export async function readRollout(file: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size <= FULL_READ_LIMIT) return { text: await handle.readFile('utf8'), truncated: false }
    const head = Buffer.alloc(TAIL_BYTES)
    const first = await handle.read(head, 0, head.length, 0)
    const headEnd = head.subarray(0, first.bytesRead).indexOf(10) + 1
    if (headEnd === 0) throw new Error('Hlavička JSONL nemá ukončený riadok v prvom MiB.')
    const tailStart = Math.max(headEnd, size - TAIL_BYTES) - 1
    const tail = Buffer.alloc(size - tailStart)
    const last = await handle.read(tail, 0, tail.length, tailStart)
    const joined = Buffer.concat([head.subarray(0, headEnd), tail.subarray(0, last.bytesRead)])
    return { text: joinRolloutHeadTail(joined.toString('utf8')), truncated: true }
  } finally { await handle.close() }
}

export async function readLivePids(): Promise<Set<number>> {
  const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'], {
    timeout: 10_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  })
  return parseTasklistPids(stdout)
}

export class SessionReader {
  private readonly threads = new Map<string, Cached<CodexThread>>()
  private readonly markers = new Map<string, Cached<ApprovalMarker>>()
  constructor(private readonly log: Logger) {}

  async readRegistry(dir: string): Promise<{ records: SessionRow[]; issues: string[] }> {
    const entries = await listFiles(dir)
    if (entries === null) return { records: [], issues: [`Register Claude nenájdený — ${dir}`] }
    const records: SessionRow[] = []
    let failed = 0
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.json$/.test(entry.name)) continue
      const file = path.join(dir, entry.name)
      try {
        const text = await readFile(file, 'utf8')
        const row = parseSessionRecord(entry.name, text, '')
        if (row) {
          records.push(row)
          if (!['busy', 'shell', 'waiting', 'idle'].includes(row.status)) this.log(`Neznámy stav Claude — ${row.status} (${file})`)
          continue
        }
        const data = JSON.parse(text)
        if (data && ['daemon', 'daemon-worker'].includes(data.kind)) continue
        throw new Error('Neznámy formát záznamu Claude.')
      } catch (error) { failed++; this.log(`Čítanie registra zlyhalo — ${file}`, error) }
    }
    const issues = failed ? [records.length ? `Niektoré záznamy Claude sa nedajú prečítať (${failed}).` : 'Záznamy Claude existujú, ale žiadny sa nedá prečítať.'] : []
    return { records, issues }
  }

  private async cached<T>(file: string, cache: Map<string, Cached<T>>, parse: () => Promise<T | null>): Promise<T | null> {
    const previous = cache.get(file)
    try {
      const info = await stat(file)
      if (previous?.size === info.size && previous.mtimeMs === info.mtimeMs) return previous.value
      const value = await parse()
      cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, value })
      return value
    } catch (error) {
      this.log(`Súbor sa nedá prečítať, ostáva posledný známy stav — ${file}`, error)
      return previous?.value ?? null
    }
  }

  async readCodexThreads(root: string, now: number): Promise<CodexThread[]> {
    const seen = new Set<string>()
    const threads: CodexThread[] = []
    for (const dir of codexDayDirs(root, now)) {
      const entries = await listFiles(dir)
      for (const entry of entries ?? []) {
        if (!entry.isFile() || !isRolloutFile(entry.name)) continue
        const file = path.join(dir, entry.name)
        seen.add(file)
        const thread = await this.cached(file, this.threads, async () => {
          const read = await readRollout(file)
          const parsed = parseCodexRollout(read.text)
          if (parsed) return { ...parsed, isTruncated: read.truncated }
          // Zámerne skryté klienty a subagenti nie sú chyba formátu.
          const meta = JSON.parse(read.text.split(/\r?\n/, 1)[0] || '{}')
          const payload = meta.payload
          if (meta.type === 'session_meta' && payload?.id && payload?.originator) {
            if (!['codex_vscode', 'Codex Desktop'].includes(payload.originator)) return null
            if (payload.thread_source && payload.thread_source !== 'user') return null
          }
          throw new Error('Neznámy formát hlavičky Codex JSONL.')
        })
        if (thread) threads.push(thread)
      }
    }
    for (const file of this.threads.keys()) if (!seen.has(file)) this.threads.delete(file)
    return threads
  }

  async readApprovalTimes(dir: string, now: number): Promise<Map<string, number>> {
    const entries = await listFiles(dir)
    const seen = new Set<string>()
    const times = new Map<string, number>()
    for (const entry of entries ?? []) {
      if (!entry.isFile() || !isApprovalFile(entry.name)) continue
      const file = path.join(dir, entry.name)
      try {
        if (now - (await stat(file)).mtimeMs > APPROVAL_MAX_AGE) continue
        seen.add(file)
        const marker = await this.cached(file, this.markers, async () => {
          const parsed = parseApprovalMarker(await readFile(file, 'utf8'))
          if (!parsed) throw new Error('Neznámy formát markera schválenia.')
          return parsed
        })
        if (marker) times.set(marker.sessionId, Math.max(times.get(marker.sessionId) ?? 0, marker.at))
      } catch (error) { this.log(`Čítanie markera zlyhalo — ${file}`, error) }
    }
    for (const file of this.markers.keys()) if (!seen.has(file)) this.markers.delete(file)
    return times
  }
}
