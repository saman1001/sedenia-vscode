# Codex approval hook

The optional hook lets Sedenia distinguish an approval request from ordinary work. Questions asked by Codex are detected from the session log and do not need this hook.

The supplied script records only `session_id` and `time_ms`. It does not approve or deny requests, print output, execute incoming commands, or store prompts and tool arguments. It uses Python's standard library and runs in the background. Codex's normal approval prompt remains in control.

## Requirements

- Windows with the default Codex home at `%USERPROFILE%\.codex`.
- Python 3.9 or newer. Use the absolute path to the actual `python.exe`, rather than a Windows Store alias.
- A Codex version that supports `PermissionRequest` command hooks.

This setup follows the [official OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks). Review and trust the hook definition when Codex requests it. Hook configuration may change between Codex versions.

## Install the script

Run these commands from the repository root in PowerShell. They stop if a script already exists, so you can compare that copy before replacing it.

```powershell
$hookDir = Join-Path $env:USERPROFILE '.codex\hooks'
$hookFile = Join-Path $hookDir 'sedenia_cakanie.py'
if (Test-Path -LiteralPath $hookFile) {
    throw 'A hook already exists. Compare it with the supplied script before replacing it.'
}
New-Item -ItemType Directory -Force -Path $hookDir | Out-Null
Copy-Item -LiteralPath '.\hooks\sedenia_cakanie.py' -Destination $hookFile
```

The script must be in that directory because Sedenia reads its markers from `%USERPROFILE%\.codex\hooks\sedenia-cakanie`.

## Add the hook configuration

Use [hooks.example.json](../hooks/hooks.example.json) as the template for `%USERPROFILE%\.codex\hooks.json`.

Replace both placeholder paths in `command` with your real Python and script paths. Keep the escaped double quotes around each path, including paths without spaces. `timeout` is in seconds.

If `hooks.json` already exists, back it up and merge the new entry into `hooks.PermissionRequest`. Preserve other events and existing handlers. If you already configure the same hook in `config.toml`, avoid registering it twice. Do not overwrite your existing configuration with the example file.

Check the resulting JSON without printing its contents.

```powershell
$null = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.codex\hooks.json') -Raw | ConvertFrom-Json
```

Start a new Codex session or restart the affected client, then review and trust this hook when prompted.

## Verify the setup

1. Ask Codex to perform an action that normally requires approval in your permission mode.
2. Leave its approval prompt open briefly.
3. Check for a JSON marker in `%USERPROFILE%\.codex\hooks\sedenia-cakanie`.
4. Sedenia should show a yellow bell and `schválenie`, meaning approval, within about 3 seconds.
5. After approving or declining the request, the state clears when a later tool result reaches the session log. Normal Codex polling can add up to 10 seconds.

If no marker appears, check the absolute paths and Codex's hook trust status. To check the script independently, pipe a synthetic event into your Python executable with `-I` and the script path. A successful hook intentionally prints nothing.

```powershell
$pythonExe = 'C:\Path To\Python\python.exe'
$hookFile = Join-Path $env:USERPROFILE '.codex\hooks\sedenia_cakanie.py'
'{"session_id":"sedenia-test","hook_event_name":"PermissionRequest"}' | & $pythonExe -I $hookFile
Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.codex\hooks\sedenia-cakanie\sedenia-test.json')
```

This creates a harmless marker without invoking Codex or requesting approval. It checks writing only, not Codex registration. It will not create a session row because no matching chat exists.

## Limits and removal

An approval marker has no tool-call identifier. Concurrent requests can therefore be resolved by another tool result, and a long approved command can continue to look like it is waiting until it produces a result. Markers older than 48 hours are ignored. The hook and extension do not automatically remove old marker files.

To disable the integration, remove only this handler from your Codex hook configuration and restart the affected client. The extension continues to show work, idle states and questions. Without the hook, an approval prompt usually appears as work.
