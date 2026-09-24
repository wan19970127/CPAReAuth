import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { resolve } from 'node:path';

const source = await readFile(resolve(import.meta.dirname, '../extension/background.js'), 'utf8');
const local = { cpaReauthConfigV4: {
  pageOrigin: 'https://manager.example.test', cpaBase: 'https://cpa.example.test',
  managementKey: 'test-key', cloudBase: 'https://mail.example.test', cloudEmail: 'admin@example.test', cloudPassword: 'test-password',
} };
const session = {};
const clone = value => structuredClone(value);
const storageArea = state => ({
  get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in state).map(k => [k, clone(state[k])])),
  set: async values => Object.assign(state, clone(values)),
  remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; },
});
let messageListener;
let nextWindowId = 20;
let currentState = '';
let stateSequence = 0;
let callbackPosts = 0;
const callbackStates = [];
const oauthStatus = new Map();
const chrome = {
  storage: { local: storageArea(local), session: storageArea(session) },
  runtime: { onMessage: { addListener: listener => { messageListener = listener; } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} }, create() {} },
  webNavigation: Object.fromEntries(['onBeforeNavigate', 'onCommitted', 'onCompleted'].map(name => [name, { addListener() {} }])),
  sidePanel: { setPanelBehavior: async () => {} }, action: { setBadgeText: async () => {} },
  extension: { isAllowedIncognitoAccess: async () => true },
  windows: {
    getAll: async () => [],
    create: async options => ({ id: ++nextWindowId, tabs: [{ id: nextWindowId + 100 }] }),
    update: async (id, options) => ({ id, state: options.state || 'minimized', ...options }),
    get: async id => ({ id, state: 'minimized' }), remove: async () => {},
  },
  tabs: {
    onUpdated: { addListener() {} }, get: async id => ({ id, url: 'https://manager.example.test/management.html' }),
    update: async (id, options) => ({ id, ...options }), sendMessage: async () => ({ ok: true }), remove: async () => {},
    query: async ({ windowId } = {}) => windowId > 20 && currentState ? [{ id: windowId + 100, url: `http://localhost:1455/auth/callback?code=code-${currentState}&state=${currentState}` }] : [],
  },
  scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, executeScript: async () => {} },
};
const fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/api/login') return Response.json({ code: 200, data: { token: 'mail-token' } });
  if (url.pathname === '/api/allEmail/list') return Response.json({ code: 200, data: [] });
  if (url.pathname.endsWith('/codex-auth-url')) {
    currentState = `state-${++stateSequence}`;
    return Response.json({ url: 'https://auth.openai.com/test', state: currentState });
  }
  if (url.pathname.endsWith('/oauth-callback')) {
    const body = JSON.parse(init.body || '{}');
    const callbackUrl = new URL(body.redirect_url);
    const state = callbackUrl.searchParams.get('state');
    callbackPosts++;
    callbackStates.push(state);
    oauthStatus.set(state, 'ok');
    return Response.json({ ok: true });
  }
  if (url.pathname.endsWith('/get-auth-status')) return Response.json({ status: oauthStatus.get(url.searchParams.get('state')) || 'pending' });
  throw new Error(`Unexpected request: ${url.pathname}`);
};
const context = createContext({
  chrome, fetch, URL, Date, Math, Response, console,
  setTimeout: callback => setTimeout(callback, 10), clearTimeout() {},
});
new Script(source).runInContext(context);

const response = await new Promise(reply => messageListener({
  type: 'startDOMQueue', backgroundMode: true, pageOrigin: 'https://manager.example.test', tabId: 11, previousFilter: 'reauth',
  accounts: [
    { auth_index: 'idx-1', email: 'first@example.test', label: 'first@example.test', fileName: 'first.json', domKey: 'first.json\u0000idx-1' },
    { auth_index: 'idx-2', email: 'second@example.test', label: 'second@example.test', fileName: 'second.json', domKey: 'second.json\u0000idx-2' },
  ],
}, {}, reply));
assert.ok(response?.message, 'two-account queue should start');
const deadline = Date.now() + 1500;
while (Date.now() < deadline && callbackPosts < 2) await new Promise(resolveTurn => setTimeout(resolveTurn, 10));
assert.equal(callbackPosts, 2, `both account callbacks must be submitted; observed ${callbackPosts}`);
assert.deepEqual(callbackStates, ['state-1', 'state-2'], 'each account must submit only its own OAuth callback state');
await new Promise(resolveTurn => setTimeout(resolveTurn, 30));
const queue = session.cpaReauthQueueV4;
assert.equal(queue.phase, 'done', `two-account queue should complete, got ${queue.phase}: ${queue.error}`);
assert.equal(queue.success, 2);
console.log('Consecutive multi-account OAuth callback regression: PASS');
