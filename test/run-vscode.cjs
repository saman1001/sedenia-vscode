const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = path.dirname(__dirname);
const profile = mkdtempSync(path.join(tmpdir(), 'sedenia-vscode-host-'));
const executable = process.env.VSCODE_EXECUTABLE_PATH || path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VSCODE_CLI;
delete env.VSCODE_IPC_HOOK_CLI;
const child = spawn(executable, [
  `--user-data-dir=${profile}`, `--extensions-dir=${path.join(profile, 'extensions')}`,
  '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(__dirname, 'vscode.cjs')}`,
  '--new-window', root,
], { env, stdio: 'inherit', shell: false });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
