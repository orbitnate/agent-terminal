function stripTerminalControls(text) {
  let stripped = String(text || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r/g, '\n');
  let readable = '';

  for (const char of stripped) {
    if (char === '\b') {
      readable = readable.slice(0, -1);
    } else if (char >= ' ' || char === '\n' || char === '\t') {
      readable += char;
    }
  }

  return readable;
}

function summarizeInput(input, maxLength = 160) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  stripTerminalControls,
  summarizeInput,
  shellQuote,
  escapeRegExp
};
