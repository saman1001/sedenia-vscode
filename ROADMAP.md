# Roadmap

Implemented features and possible next steps. Each item represents one capability.

## Navigation validation

- [x] Activate an existing workspace window with `vscode.openFolder` without replacing the current workspace
- [x] Use the VS Code API without passing workspace paths through a shell
- [x] Verify the Activity Bar badge and themed status icons in VS Code 1.145

## Claude Code sessions

- [x] Read `~/.claude/sessions` for interactive and background sessions
- [x] Filter live processes using a cached Windows process list
- [x] Show waiting, working and idle states with a waiting reason
- [x] Display elapsed time and sort by state

## Codex chats

- [x] Read rollout JSONL across creation dates with size and modification-time caching
- [x] Track growing logs even when modification time remains unchanged, using events for activity age
- [x] Detect approval requests from optional hook markers
- [x] Detect questions and replies in both legacy and current JSONL message formats
- [x] Limit idle chat rows per workspace and for the desktop app
- [x] Read large logs using Node.js and bounded head/tail reads

## Sidebar

- [x] Provide an Activity Bar icon and a sidebar session list
- [x] Show themed status icons, elapsed time and folder tooltips
- [x] Use a static blue dot for work and a yellow bell for waiting
- [x] Display state totals and the last refresh time
- [x] Show a badge with the number of waiting sessions
- [x] Mark sessions belonging to the current window
- [x] Report unavailable registries and unreadable records

## Actions

- [x] Activate the workspace window when a session row is clicked
- [x] Report navigation failures
- [x] Open a specific Codex desktop chat

## Notifications

- [x] Notify when Claude or Codex starts waiting
- [x] Notify when a Codex turn finishes
- [x] Suppress notifications for sessions belonging to the current window

## Tests and packaging

- [x] Port the original pure-function tests
- [x] Provide an Output channel for diagnostics
- [x] Build a VSIX package for local installation

## Migration from the original Claude Code mod

- [x] Validate behavior using automated tests and live Claude/Codex sessions
- [x] Validate the sidebar in a regular workspace window
- [x] Replace the original mod after preserving a local backup

## Public distribution

- [x] English documentation and repository metadata
- [x] MIT license
- [x] Portable optional Codex approval hook and setup guide
- [x] Validate a clean checkout, including the VS Code smoke test

## Possible next steps

- [ ] Share one reader across VS Code windows
- [ ] Read appended JSONL incrementally
- [ ] Explore a standalone local status panel using the same session model
