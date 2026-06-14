const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class TaskStore {
  constructor({ runtimeRoot }) {
    this.taskDir = path.join(runtimeRoot, 'tasks');
    fs.mkdirSync(this.taskDir, { recursive: true });
  }

  createTask({ objective = '', rules = '', cwd = '', profile = '', sessionId = null }) {
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      objective,
      rules,
      cwd,
      profile,
      sessionId,
      status: 'active',
      lastReadOffset: 0,
      checkpoints: [],
      createdAt: now,
      updatedAt: now
    };
    this.writeTask(task);
    return task;
  }

  getTask(id) {
    const file = this.getTaskFile(id);
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  addCheckpoint(id, checkpoint = {}) {
    const task = this.getTask(id);
    if (!task) {
      const error = new Error(`Unknown task: ${id}`);
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();
    task.checkpoints.push({
      timestamp: now,
      summary: checkpoint.summary || '',
      status: checkpoint.status || task.status,
      lastReadOffset: Number(checkpoint.lastReadOffset || task.lastReadOffset || 0)
    });
    task.status = checkpoint.status || task.status;
    task.lastReadOffset = Number(checkpoint.lastReadOffset || task.lastReadOffset || 0);
    task.updatedAt = now;
    this.writeTask(task);
    return task;
  }

  listTasks() {
    return fs
      .readdirSync(this.taskDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(this.taskDir, name), 'utf8')))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  writeTask(task) {
    fs.writeFileSync(this.getTaskFile(task.id), `${JSON.stringify(task, null, 2)}\n`, {
      mode: 0o600
    });
  }

  getTaskFile(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      throw new Error('Invalid task id.');
    }
    return path.join(this.taskDir, `${id}.json`);
  }
}

module.exports = {
  TaskStore
};
