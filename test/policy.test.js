const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCommand } = require('../src/policy');

test('read-only commands are allowed', () => {
  assert.equal(classifyCommand('pwd').decision, 'allow');
  assert.equal(classifyCommand('git status --short').decision, 'allow');
  assert.equal(classifyCommand('npm run check').decision, 'allow');
});

test('local write and publish commands are allowed without approvals', () => {
  assert.equal(classifyCommand('git commit -m test').decision, 'allow');
  assert.equal(classifyCommand('npm install left-pad').decision, 'allow');
  assert.equal(classifyCommand('touch file.txt').decision, 'allow');
});

test('obviously destructive commands are blocked', () => {
  assert.equal(classifyCommand('rm -rf /').decision, 'block');
  assert.equal(classifyCommand('diskutil eraseDisk APFS Name disk0').decision, 'block');
});
