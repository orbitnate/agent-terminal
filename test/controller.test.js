const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentTerminalController } = require('../src/controller');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function disposeController(controller) {
  const exits = [];
  for (const session of controller.sessions.values()) {
    if (!session.exited) {
      exits.push(new Promise((resolve) => session.once('exit', resolve)));
    }
    session.dispose();
  }

  await Promise.race([Promise.all(exits), wait(1000)]);
}

test('controller run returns output and exit code', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-test-'));
  const controller = new AgentTerminalController({ runtimeRoot });
  const session = controller.createSession({ cwd: runtimeRoot, cols: 100, rows: 24 });

  try {
    await wait(500);
    const result = await controller.runCommand(session.id, { command: 'pwd', force: true }, { source: 'api' });
    assert.equal(result.exitCode, 0);
    assert.match(result.output, new RegExp(runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await disposeController(controller);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('controller runs local write commands without approvals', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-test-'));
  const controller = new AgentTerminalController({ runtimeRoot });
  const session = controller.createSession({ cwd: runtimeRoot, cols: 100, rows: 24 });
  const target = path.join(runtimeRoot, 'created.txt');

  try {
    await wait(500);
    const result = await controller.runCommand(session.id, { command: 'touch created.txt', force: true }, { source: 'api' });
    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(target), true);
  } finally {
    await disposeController(controller);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('controller deletes active session and switches to another session', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-test-'));
  const controller = new AgentTerminalController({ runtimeRoot });
  const first = controller.createSession({ cwd: runtimeRoot, cols: 100, rows: 24 });
  const second = controller.createSession({ cwd: runtimeRoot, cols: 100, rows: 24 });

  try {
    await wait(500);
    controller.setActiveSession(second.id);
    const secondExited = new Promise((resolve) => second.once('exit', resolve));
    const result = controller.deleteSession(second.id, 'test');

    assert.equal(result.deletedSessionId, second.id);
    assert.equal(result.activeSessionId, first.id);
    assert.equal(controller.listSessions().length, 1);
    assert.throws(() => controller.getSession(second.id), /Unknown terminal session/);
    await Promise.race([secondExited, wait(500)]);
  } finally {
    await disposeController(controller);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('controller replaces the last deleted session with a fresh session', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-test-'));
  const controller = new AgentTerminalController({ runtimeRoot });
  const session = controller.createSession({ cwd: runtimeRoot, cols: 100, rows: 24 });

  try {
    await wait(500);
    const sessionExited = new Promise((resolve) => session.once('exit', resolve));
    const result = controller.deleteSession(session.id, 'test');

    assert.equal(result.deletedSessionId, session.id);
    assert.notEqual(result.activeSessionId, session.id);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, result.activeSessionId);
    assert.equal(result.sessions[0].exited, false);
    await Promise.race([sessionExited, wait(500)]);
  } finally {
    await disposeController(controller);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
