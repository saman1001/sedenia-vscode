import path from 'node:path'
import { CODEX_DESKTOP, normalizeCodexCwd } from './codex'
import type { SessionRow } from './types'

export type NavigationTarget = { kind: 'folder'; path: string } | { kind: 'codex'; url: string }

export function normalizeFolder(folder: string): string {
  return path.win32.normalize(normalizeCodexCwd(folder)).replace(/[\\/]+$/, '').toLowerCase()
}

export function isCurrentWindow(row: SessionRow, folders: readonly string[]): boolean {
  if (!row.cwd || row.entrypoint === CODEX_DESKTOP) return false
  return folders.some(folder => normalizeFolder(folder) === normalizeFolder(row.cwd))
}

export function navigationTarget(row: SessionRow): NavigationTarget {
  if (row.agent === 'codex' && row.entrypoint === CODEX_DESKTOP) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(row.sessionId)) {
      throw new Error('Chat nemá platný identifikátor.')
    }
    return { kind: 'codex', url: `codex://threads/${encodeURIComponent(row.sessionId)}` }
  }
  const folder = normalizeCodexCwd(row.cwd)
  if (!/^[a-zA-Z]:[\\/]/.test(folder) || /[\x00-\x1f]/.test(folder)) {
    throw new Error('Sedenie nemá platnú absolútnu cestu k miestnemu priečinku.')
  }
  return { kind: 'folder', path: folder }
}
