import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFile(resolve(root, file), 'utf8');

const [bridge, background, panel] = await Promise.all([
  read('extension/content.js'),
  read('extension/background.js'),
  read('extension/panel.js'),
]);

assert.match(background, /chrome\.storage\.session\.get\(QK\)/,
  'the queue must survive extension service-worker restarts and management-tab reloads');
assert.match(panel, /chrome\.storage\.onChanged\.addListener/,
  'the extension panel must restore progress as the session queue changes');
assert.match(bridge, /chrome\.runtime\.onMessage\.addListener/,
  'the management-page content script must remain connected after page reload');

console.log('Side panel queue refresh recovery: PASS');
