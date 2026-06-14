const fs = require('fs');
const os = require('os');
const path = require('path');

function getRuntimeRoot() {
  if (process.env.AGENT_TERMINAL_RUNTIME_DIR) {
    return process.env.AGENT_TERMINAL_RUNTIME_DIR;
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Agent Terminal');
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    fs.chmodSync(dir, mode);
  } catch (error) {
    // Best effort on filesystems that do not support chmod.
  }
}

function ensureRuntimeDirs(root = getRuntimeRoot()) {
  ensureDir(root);
  ensureDir(path.join(root, 'logs'));
  ensureDir(path.join(root, 'tasks'));
  return root;
}

function getConnectionFile(root = getRuntimeRoot()) {
  return path.join(root, 'runtime.json');
}

function writeConnectionInfo(info, root = getRuntimeRoot()) {
  ensureRuntimeDirs(root);
  const file = getConnectionFile(root);
  fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    // Best effort on filesystems that do not support chmod.
  }
}

function readConnectionInfo(root = getRuntimeRoot()) {
  const file = getConnectionFile(root);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  getRuntimeRoot,
  ensureRuntimeDirs,
  getConnectionFile,
  writeConnectionInfo,
  readConnectionInfo
};
