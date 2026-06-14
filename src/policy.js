const SAFE_READ_PREFIXES = [
  'pwd',
  'ls',
  'rg',
  'cat',
  'sed',
  'head',
  'tail',
  'wc',
  'find',
  'git status',
  'git diff',
  'git log',
  'git show',
  'git branch',
  'git rev-parse',
  'npm run check',
  'npm test',
  'node --check'
];

const REQUIRE_APPROVAL_PATTERNS = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsudo\b/,
  /\bnpm\s+(install|update|audit\s+fix)\b/,
  /\byarn\s+(add|install|upgrade)\b/,
  /\bpnpm\s+(add|install|update)\b/,
  /\bgit\s+(add|commit|push|merge|rebase|reset|checkout|switch|clean|tag)\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)/,
  /\b(sh|bash|zsh)\s+[^;&|]+/,
  />|>>|\btee\b/,
  /\bpython3?\b.*(-c|\S+\.py)/,
  /\bnode\b.*(-e|\S+\.js)/
];

const HARD_BLOCK_PATTERNS = [
  /\brm\s+-[^;&|]*r[^;&|]*f(?:\s+|=)(\/|\$HOME|~)(?:\s|$)/,
  /\bchmod\s+-R\s+777\s+(\/|\$HOME|~)\b/,
  /\bchown\s+-R\b.*\s(\/|\$HOME|~)\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bdiskutil\s+erase/i,
  /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  /\bkill\s+-9\s+-1\b/
];

function normalize(command) {
  return String(command || '').replace(/\s+/g, ' ').trim();
}

function isSafeReadCommand(command) {
  const normalized = normalize(command);
  if (!normalized || /[;&|`$()<>]/.test(normalized)) {
    return false;
  }
  return SAFE_READ_PREFIXES.some((prefix) => {
    return normalized === prefix || normalized.startsWith(`${prefix} `);
  });
}

function classifyCommand(command) {
  const normalized = normalize(command);
  if (!normalized) {
    return { decision: 'block', reason: 'Empty command.' };
  }

  for (const pattern of HARD_BLOCK_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'block', reason: 'Command matches a hard-blocked destructive pattern.' };
    }
  }

  if (isSafeReadCommand(normalized)) {
    return { decision: 'allow', reason: 'Read-only command.' };
  }

  for (const pattern of REQUIRE_APPROVAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'approve', reason: 'Command can modify files, install software, publish, or run scripts.' };
    }
  }

  return { decision: 'approve', reason: 'Command is not in the read-only allowlist.' };
}

function classifyRawInput(input) {
  const text = String(input || '');
  if (!text) {
    return { decision: 'block', reason: 'Empty input.' };
  }

  const printable = text.replace(/[\r\n\t]/g, '').replace(/[\x20-\x7e]/g, '');
  if (printable.length > 0) {
    return { decision: 'approve', reason: 'Raw input contains control characters.' };
  }

  if (text.length > 4096) {
    return { decision: 'approve', reason: 'Raw input is large.' };
  }

  const commandish = text.split(/\r?\n/).find((line) => line.trim());
  if (commandish) {
    const commandDecision = classifyCommand(commandish);
    if (commandDecision.decision === 'block') {
      return commandDecision;
    }
  }

  return { decision: 'allow', reason: 'Short raw text input.' };
}

module.exports = {
  classifyCommand,
  classifyRawInput,
  isSafeReadCommand
};
