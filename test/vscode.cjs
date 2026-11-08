// Spúšťa VS Code cez --extensionTestsPath. Číta živé zdroje, nemení ich.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.dirname(__dirname);
const reportPath = process.env.SEDENIA_SMOKE_REPORT || path.join(root, 'zdroje/overenie-2026-11-08/extension-smoke.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  const report = { at: new Date().toISOString(), vscode: vscode.version, checks: [] };
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  try {
    const extension = vscode.extensions.getExtension('saman1001.sedenia');
    assert.ok(extension);
    const api = await extension.activate();
    await api.refresh(true);
    assert.equal(api.view.title, 'Sedenia');
    assert.ok(api.provider.snapshot.polledAt > 0);
    for (const row of api.provider.snapshot.rows) {
      const item = api.provider.getTreeItem(row);
      assert.equal(item.id, row.key);
      assert.equal(item.command.command, 'sedenia.open');
      assert.ok(item.iconPath.id);
      if (['busy', 'shell'].includes(row.status)) assert.equal(item.iconPath.id, 'circle-filled');
    }
    // Overíme oba pracovné stavy aj vtedy, keď práve žiadne živé sedenie nepracuje.
    const visualRow = { key: 'visual-test', name: 'Test', cwd: root, folder: 'Test', since: Date.now(), waitingFor: null, entrypoint: 'claude-vscode', isMe: false };
    for (const status of ['busy', 'shell']) {
      assert.equal(api.provider.getTreeItem({ ...visualRow, status }).iconPath.id, 'circle-filled');
    }
    assert.equal(api.provider.getTreeItem({ ...visualRow, status: 'waiting' }).iconPath.id, 'bell');
    report.checks.push('static-working-icons');
    report.rows = api.provider.snapshot.rows.map(({ key, name, folder, status, isMe }) => ({ key, name, folder, status, isMe }));
    if (process.env.SEDENIA_EXPECT_THREAD) {
      assert.ok(api.provider.snapshot.rows.some(row => row.sessionId === process.env.SEDENIA_EXPECT_THREAD), 'Očakávaný chat musí byť vo výslednom paneli.');
      report.checks.push('expected-thread-visible');
    }
    report.issues = api.provider.snapshot.issues;
    report.checks.push('activation', 'live-read', 'tree-items');
    await vscode.commands.executeCommand('sedenia.sessions.focus');
    await save();
    // Čas na vizuálnu kontrolu panela. Potom overenie skutočných navigačných volaní.
    await pause(Number(process.env.SEDENIA_VISUAL_WAIT_MS || 0));
    const { openSession } = require('../out/src/extension');
    const before = vscode.workspace.workspaceFolders[0].uri.fsPath;
    if (process.env.SEDENIA_TARGET_FOLDER) {
      await openSession({ agent: 'claude', entrypoint: 'claude-vscode', cwd: process.env.SEDENIA_TARGET_FOLDER });
      assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, before);
      report.checks.push('open-folder-without-replacing-source');
    }
    if (process.env.SEDENIA_CODEX_THREAD) {
      await openSession({ agent: 'codex', entrypoint: 'Codex Desktop', sessionId: process.env.SEDENIA_CODEX_THREAD });
      report.checks.push('codex-openExternal-accepted');
      await save();
      await pause(8000);
    }
    if (process.env.SEDENIA_CODEX_RETURN) {
      await openSession({ agent: 'codex', entrypoint: 'Codex Desktop', sessionId: process.env.SEDENIA_CODEX_RETURN });
      report.checks.push('codex-return-accepted');
    }
    report.passed = true;
    await save();
  } catch (error) {
    report.error = String(error.stack || error);
    report.passed = false;
    await save();
    throw error;
  }
};
