#!/usr/bin/env node

const { requestJson, buildPath, streamSession } = require('../src/client');
const { stripTerminalControls } = require('../src/text-utils');

function printHelp() {
  console.log(`agent-terminal

Usage:
  agent-terminal list
  agent-terminal create [cwd]
  agent-terminal inspect <session-id>
  agent-terminal send <session-id> <command>
  agent-terminal write <session-id> <raw-input>
  agent-terminal read <session-id> [--since <offset>] [--plain]
  agent-terminal screen <session-id>
  agent-terminal state <session-id>
  agent-terminal watch <session-id> [--since <offset>] [--plain]
  agent-terminal run <session-id> <command> [--force]
  agent-terminal launch <session-id> <claude-opus|claude-plan|codex>
  agent-terminal interrupt <session-id>
  agent-terminal restart <session-id>
  agent-terminal resize <session-id> <cols> <rows>
  agent-terminal pause
  agent-terminal resume
  agent-terminal disable-api
  agent-terminal enable-api
  agent-terminal approvals
  agent-terminal approve <approval-id>
  agent-terminal deny <approval-id>
  agent-terminal tasks

Environment:
  AGENT_TERMINAL_URL=http://127.0.0.1:9876
  AGENT_TERMINAL_TOKEN=<token>

The helper auto-loads the latest local URL and token from the app runtime file.
`);
}

function parseSince(args) {
  const sinceIndex = args.indexOf('--since');
  if (sinceIndex === -1) {
    return null;
  }
  return args[sinceIndex + 1] || '0';
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printable(data, plain) {
  return plain ? stripTerminalControls(data || '') : data || '';
}

async function watch(sessionId, since, plain) {
  streamSession(
    sessionId,
    since,
    (payload) => {
      if (typeof payload.data === 'string') {
        process.stdout.write(printable(payload.data, plain));
      }
    },
    (error) => {
      console.error(error.message);
      process.exit(1);
    }
  );
}

async function main() {
  const [command, sessionId, ...rest] = process.argv.slice(2);

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      return;
    }

    if (command === 'list') {
      const payload = await requestJson('GET', '/sessions');
      for (const session of payload.sessions) {
        const marker = session.id === payload.activeSessionId ? '*' : ' ';
        console.log(`${marker} ${session.id}\t${session.shell}\t${session.cwd}`);
      }
      return;
    }

    if (command === 'create') {
      const payload = await requestJson('POST', '/sessions', { cwd: sessionId || process.cwd() });
      console.log(JSON.stringify(payload.session, null, 2));
      return;
    }

    if (command === 'pause') {
      console.log(JSON.stringify(await requestJson('POST', '/control/pause', {}), null, 2));
      return;
    }

    if (command === 'resume') {
      console.log(JSON.stringify(await requestJson('POST', '/control/resume', {}), null, 2));
      return;
    }

    if (command === 'disable-api') {
      console.log(JSON.stringify(await requestJson('POST', '/control/api-enabled', { enabled: false }), null, 2));
      return;
    }

    if (command === 'enable-api') {
      console.log(JSON.stringify(await requestJson('POST', '/control/api-enabled', { enabled: true }), null, 2));
      return;
    }

    if (command === 'approvals') {
      console.log(JSON.stringify(await requestJson('GET', '/approvals'), null, 2));
      return;
    }

    if (command === 'tasks') {
      console.log(JSON.stringify(await requestJson('GET', '/tasks'), null, 2));
      return;
    }

    if ((command === 'approve' || command === 'deny') && sessionId) {
      console.log(JSON.stringify(await requestJson('POST', `/approvals/${sessionId}/${command}`, {}), null, 2));
      return;
    }

    if (!sessionId) {
      throw new Error('Missing session ID.');
    }

    if (command === 'inspect') {
      console.log(JSON.stringify(await requestJson('GET', `/sessions/${sessionId}`), null, 2));
      return;
    }

    if (command === 'send') {
      const text = rest.join(' ');
      if (!text) throw new Error('Missing command text.');
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/input`, { command: text }), null, 2));
      return;
    }

    if (command === 'write') {
      const text = rest.join(' ');
      if (!text) throw new Error('Missing raw input text.');
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/input`, { data: text }), null, 2));
      return;
    }

    if (command === 'read') {
      const since = parseSince(rest);
      const plain = hasFlag(rest, '--plain');
      const payload = await requestJson('GET', buildPath(`/sessions/${sessionId}/output`, { since }));
      process.stdout.write(printable(payload.data, plain));
      if (payload.nextOffset !== undefined) {
        process.stderr.write(`\n[nextOffset ${payload.nextOffset}]\n`);
      }
      return;
    }

    if (command === 'screen') {
      const payload = await requestJson('GET', `/sessions/${sessionId}/screen`);
      process.stdout.write(`${payload.text}\n`);
      return;
    }

    if (command === 'state') {
      console.log(JSON.stringify(await requestJson('GET', `/sessions/${sessionId}/state`), null, 2));
      return;
    }

    if (command === 'watch') {
      await watch(sessionId, parseSince(rest), hasFlag(rest, '--plain'));
      return;
    }

    if (command === 'run') {
      const force = hasFlag(rest, '--force');
      const text = rest.filter((part) => part !== '--force').join(' ');
      if (!text) throw new Error('Missing command text.');
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/run`, { command: text, force }), null, 2));
      return;
    }

    if (command === 'launch') {
      const profile = rest[0] || 'claude-opus';
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/launch`, { profile }), null, 2));
      return;
    }

    if (command === 'interrupt' || command === 'restart') {
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/${command}`, {}), null, 2));
      return;
    }

    if (command === 'resize') {
      const [cols, rows] = rest;
      console.log(JSON.stringify(await requestJson('POST', `/sessions/${sessionId}/resize`, { cols, rows }), null, 2));
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
