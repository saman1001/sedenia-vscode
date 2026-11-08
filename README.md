# Sedenia

**A local session monitor for Claude Code and OpenAI Codex in VS Code on Windows.**

Working with AI agents in several project windows makes it easy to miss a question or approval request. Sedenia brings those sessions into one sidebar, puts waiting sessions first, and lets you jump to the relevant VS Code window or Codex desktop chat.

Sedenia means *sessions* in Slovak. The documentation is in English. The extension currently uses Slovak UI labels, explained below.

## Features

- Monitor interactive Claude Code sessions and Codex chats across local project folders.
- See working, waiting and idle states, with elapsed time and the reason for waiting.
- Keep recently active Codex chats visible regardless of their creation date.
- Open the matching VS Code workspace window or a specific Codex desktop chat.
- Receive notifications when a session needs input and when a Codex turn finishes.
- Use static status icons and a badge showing the number of waiting sessions.
- Read local session files without telemetry, AI API calls or runtime npm dependencies.

| Icon | UI label | Meaning |
| --- | --- | --- |
| Yellow bell | `čaká` | Waiting for you |
| Blue dot | `beží` | Working |
| Gray circle outline | `nečinné` | Idle |

Waiting reasons include `otázka` for a question, `schválenie` for Codex approval, and `vstup` or `povolenie` for Claude input or permission. `toto okno` marks a session belonging to the current VS Code window.

## Requirements

- Windows and VS Code 1.100 or newer. Tested on Windows 11 with VS Code 1.145.2.
- Claude Code and/or Codex using the default local data directories under your user profile.
- Git and Node.js 22 or newer to build from source. The current build was tested with Node.js 24.
- Python 3.9 or newer only if you want to use the optional Codex approval hook.

This is an independent community project. It is not affiliated with Anthropic, OpenAI or Microsoft.

## Build and install

```powershell
git clone https://github.com/saman1001/sedenia-vscode.git
cd sedenia-vscode
npm ci
npm test
npm run package
code --install-extension .\sedenia-0.1.3.vsix
```

The package is built locally. No Marketplace installation is required.

Open the **Sedenia** icon in the Activity Bar. You can also use **Ctrl+Shift+P → View: Open View… → Sedenia**. If you just updated the extension and still see the previous version, use **Developer: Reload Window** when it is safe to reload your workspace.

Use the refresh button to read sessions immediately. Diagnostics are available in **Output → Sedenia**, or through the command **Sedenia — Zobraziť diagnostiku**.

## Codex approval detection

Questions are detected from the session log. Approval requests require a small optional `PermissionRequest` hook.

Follow the [hook setup guide](docs/codex-hook.md). The repository includes a portable Python script and an example configuration. The hook writes a session identifier and timestamp locally. It never approves requests or stores tool arguments.

The extension does not install hooks or change Codex settings automatically. Without the hook, an approval prompt will generally appear as ordinary work.

## How it works

Sedenia reads the Claude Code session registry, Codex JSONL logs and optional approval markers. It refreshes every 3 seconds, with normal Codex log reads every 10 seconds. A new approval marker triggers an earlier read.

The extension scans date folders independently of when a chat was created. File size and modification time control the read cache. Session events determine activity because an open log can grow without updating its filesystem timestamp. Large logs are read using their first line and a bounded tail.

The session model and file readers are separate from the VS Code UI. See the [roadmap](ROADMAP.md) for possible next steps.

## Privacy

The extension does not send session data to a server. It reads local files and invokes the local Windows process list. Clicking a row activates VS Code or opens a `codex://` link in the installed Codex app.

Diagnostics and optional smoke-test reports can contain local folder names and session identifiers. Keep those reports private when reporting a bug, or replace their identifying details with synthetic examples. Generated reports and local session data are excluded from this repository.

## Known limitations

- Windows only. VS Code forks, remote hosts and custom Claude/Codex data directories are not supported.
- VS Code navigation activates a workspace window, not an individual chat tab. Codex desktop navigation can open a specific chat.
- A Codex chat's original client determines its navigation target, even if you later continue it in the other client.
- Headless agents, helper subagents and compressed `.jsonl.zst` archives are not shown.
- An active Codex turn with no log events for 2 hours is treated as idle. Chats disappear after 3 hours without events. If a large log's latest turn boundary is outside the read tail, its running state is estimated from recent activity or an open request.
- Each VS Code window polls independently and can notify you about sessions outside that window. The Codex desktop app is always treated as external.
- The session formats are internal and may change between Claude Code or Codex releases. Check **Output → Sedenia** if sessions disappear after an update.

## Development and tests

```powershell
npm ci
npm test
npm run build
code --extensionDevelopmentPath .
```

`npm test` uses synthetic session files. To test activation and rendering against your live sessions in an isolated VS Code window, run `npm run test:vscode`. The default report is `test-results/extension-smoke.json`. The directory is created automatically and ignored by Git.

Set `VSCODE_EXECUTABLE_PATH` if VS Code is not installed at the usual per-user Windows location. `SEDENIA_SMOKE_REPORT` selects another report path. Optional visual and navigation checks use `SEDENIA_VISUAL_WAIT_MS`, `SEDENIA_EXPECT_THREAD`, `SEDENIA_TARGET_FOLDER`, `SEDENIA_CODEX_THREAD` and `SEDENIA_CODEX_RETURN`. Navigation checks activate real windows, so enable them deliberately.

The optional hook has a separate test suite. Run `npm run test:hook` with Python on your PATH, or `& 'C:\path\to\python.exe' -I test/hook_test.py`. These tests use temporary directories and do not change your installed hook.

## Contributing

Bug reports and small pull requests are welcome. Include your Windows, VS Code and agent versions, the expected state and the observed state. Use a synthetic log excerpt rather than uploading a real conversation. Run the relevant tests before submitting a change.

## License

[MIT](LICENSE) © 2026 Juraj Fabuš.
