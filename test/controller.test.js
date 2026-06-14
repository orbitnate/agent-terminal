const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentTerminalController } = require('../src/controller');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const exited = new Promise((resolve) => session.once('exit', resolve));
    session.dispose();
    await Promise.race([exited, wait(500)]);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
