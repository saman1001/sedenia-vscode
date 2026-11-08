/**
 * Jeden riadok panelu — živé sedenie Claude Code na tomto PC (záznam registra
 * `<USERPROFILE>\.claude\sessions\<pid>.json`) alebo vlákno Codexu z rozšírenia
 * VS Code či desktopovej appky (`<USERPROFILE>\.codex\sessions\RRRR\MM\DD\rollout-….jsonl`,
 * úložisko oboch klientov je spoločné).
 */
export type SessionRow = {
  /** Jednoznačný kľúč riadku — `claude:<pid>` alebo `codex:<id vlákna>`. */
  key: string
  agent: 'claude' | 'codex'
  /** PID procesu Claude Code, pri Codexe 0. */
  pid: number
  sessionId: string
  name: string
  cwd: string
  /** Posledný segment cesty `cwd`. */
  folder: string
  /** `busy`, `shell`, `idle` alebo `waiting` (iný reťazec sa kreslí ako nečinné). */
  status: string
  /** Na čo čakajúce sedenie čaká (napr. „input needed", pri Codexe `schválenie` alebo `otázka`), inak null. */
  waitingFor: string | null
  /**
   * Odkedy platí stav, ms od epochy — pri Claude `statusUpdatedAt ?? updatedAt
   * ?? startedAt`, pri Codexe čas poslednej udalosti ťahu, žiadosti
   * o schválenie (marker hooku PermissionRequest) alebo otvorenej otázky
   * (`agent_message` s `questions` v JSONL).
   */
  since: number
  startedAt: number
  /**
   * Pri Codexe zakladateľ vlákna — `codex_vscode` (rozšírenie VS Code, riadok
   * otvára okno VS Code) alebo `Codex Desktop` (odkaz na konkrétny chat appky).
   * Originator je zakladateľ vlákna, takže vlákno z VS Code dokončené v appke
   * stále otvára VS Code a vlákno appky dokončené vo VS Code stále otvára appku —
   * známe obmedzenie.
   */
  entrypoint: string
  /** Sedenie patriace aktuálnemu oknu VS Code podľa pracovného priečinka. */
  isMe: boolean
}
