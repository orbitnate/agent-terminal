const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCommand } = require('../src/policy');

test('read-only commands are allowed', () => {
  assert.equal(classifyCommand('pwd').decision, 'allow');
  assert.equal(classifyCommand('git status --short').decision, 'allow');
  assert.equal(classifyCommand('npm run check').decision, 'allow');
});

test('write and publish commands require approval', () => {
  assert.equal(classifyCommand('git commit -m test').decision, 'approve');
  assert.equal(classifyCommand('npm install left-pad').decision, 'approve');
  assert.equal(classifyCommand('touch file.txt').decision, 'approve');
});

test('obviously destructive commands are blocked', () => {
  assert.equal(classifyCommand('rm -rf /').decision, 'block');
  assert.equal(classifyCommand('diskutil eraseDisk APFS Name disk0').decision, 'block');
});
