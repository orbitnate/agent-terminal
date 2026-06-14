const fs = require('fs');
const path = require('path');

class AuditLog {
  constructor({ runtimeRoot }) {
    this.logDir = path.join(runtimeRoot, 'logs');
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  log(event) {
    const timestamp = new Date().toISOString();
    const file = path.join(this.logDir, `${timestamp.slice(0, 10)}.jsonl`);
    const record = {
      timestamp,
      ...event
    };
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    return record;
  }
}

module.exports = {
  AuditLog
};
