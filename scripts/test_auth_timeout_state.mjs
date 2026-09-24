import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { resolve } from 'node:path';

const source = await readFile(resolve(import.meta.dirname, '../extension/background.js'), 'utf8');
const local = {
  cpaReauthConfigV4: {
    pageOrigin: 'https://manager.example.test', cpaBase: 'https://cpa.example.test',
    managementKey: 'test-key', cloudBase: 'https://mail.example.test',
    cloudEmail: 'admin@example.test', cloudPassword: 'test-password',
  },
};
const session = {};
const clone = value => structuredClone(value);
const storageArea = state => ({
  get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in state).map(k => [k, clone(state[k])])),
  set: async values => Object.assign(state, clone(values)),
  remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; },
});
let messageListener;
let authPolls = 0;
let callbackPosts = 0;
let callbackRequestBody;
let createdWindowOptions;
let restoredWindowOptions;
let windowState = 'normal';
let authTabNavigation;
const redirectUrl = 'http://localhost:1455/auth/callback?code=secret-code&state=test-state';
let authWindowCallbackUrl = '';
const windowUpdates = [];
const navigationListeners = {};
let tabsUpdatedListener;
const navigationEvent = name => ({ addListener: listener => { navigationListeners[name] = listener; } });
const mailRows = Array.from({ length: 4 }, (_, index) => ({
  emailId: `old-${index}`, toEmail: 'user@example.test', sendEmail: 'noreply@openai.com', subject: 'Sign-in code', text: '123456',
}));
const chrome = {
  storage: { local: storageArea(local), session: storageArea(session) },
  runtime: { onMessage: { addListener: listener => { messageListener = listener; } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} }, create() {} },
  webNavigation: { onBeforeNavigate: navigationEvent('onBeforeNavigate'), onCommitted: navigationEvent('onCommitted'), onCompleted: navigationEvent('onCompleted') },
  sidePanel: { setPanelBehavior: async () => {} },
  action: { setBadgeText: async () => {} },
  extension: { isAllowedIncognitoAccess: async () => true },
  windows: { getAll: async () => [], create: async options => { createdWindowOptions = options; windowState = options.state; return { id: 22, tabs: [{ id: 23 }] }; }, update: async (id, options) => { windowUpdates.push({ id, ...options }); windowState = options.state || windowState; if (options.state === 'normal') restoredWindowOptions = { id, ...options }; return { id, state: windowState, ...options }; }, get: async id => ({ id, state: windowState }), remove: async () => {} },
  tabs: {
    onUpdated: { addListener: listener => { tabsUpdatedListener = listener; } },
    get: async () => ({ id: 11, url: 'https://manager.example.test/management.html' }), update: async (id, options) => { authTabNavigation = { id, ...options }; return authTabNavigation; },
    sendMessage: async () => ({ ok: true }), remove: async () => {}, query: async ({ windowId } = {}) => windowId === 22 && authWindowCallbackUrl ? [{ id: 23, url: authWindowCallbackUrl }] : [],
  },
  scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, executeScript: async () => {} },
};
const fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/api/login') return Response.json({ code: 200, data: { token: 'test-token' } });
  if (url.pathname === '/api/allEmail/list') return Response.json({ code: 200, data: mailRows });
  if (url.pathname.endsWith('/codex-auth-url')) return Response.json({ url: 'https://auth.openai.com/test', state: 'test-state' });
  if (url.pathname.endsWith('/oauth-callback')) { callbackPosts++; callbackRequestBody = JSON.parse(init.body || '{}'); return Response.json({ ok: true }); }
  if (url.pathname.endsWith('/get-auth-status')) { authPolls++; return Response.json({ status: 'pending' }); }
  throw new Error(`Unexpected request: ${url.pathname}`);
};
const context = createContext({
  chrome, fetch, URL, Date, Math, Response, console,
  setTimeout: callback => setTimeout(callback, 10),
  clearTimeout() {},
});
new Script(source).runInContext(context);

const response = await new Promise(resolveReply => messageListener({
  type: 'startDOMQueue', backgroundMode: true,
  pageOrigin: 'https://manager.example.test', tabId: 11, previousFilter: 'reauth',
  accounts: [{ auth_index: 'idx-1', email: 'user@example.test', label: 'user@example.test', fileName: 'auth.json', domKey: 'auth.json\u0000idx-1' }],
}, {}, resolveReply));
assert.ok(response?.message, 'queue should start');
await new Promise(resolveTurn => setTimeout(resolveTurn, 30));

const queue = session.cpaReauthQueueV4;
assert.ok(authPolls >= 1, 'the test must reach the real OAuth pending-status branch');
assert.equal(queue.running, true, 'a pending OAuth response must not become a timeout immediately');
assert.notEqual(queue.phase, 'error', `unexpected immediate error: ${queue.error}`);
assert.ok(queue.startedAt > 0, 'the OAuth start timestamp must persist in session storage');
assert.equal(createdWindowOptions.url, 'about:blank', 'background mode must not navigate to the OAuth page while creating the window');
assert.equal(createdWindowOptions.state, 'minimized', 'background mode must create the private auth window minimized');
assert.equal(createdWindowOptions.focused, false, 'background mode must not steal browser focus');
assert.equal(authTabNavigation.url, 'https://auth.openai.com/test', 'the auth tab should navigate only after the window is minimized');
assert.equal(authTabNavigation.active, false, 'auth navigation must not activate the tab');
assert.ok(windowUpdates.some(update => update.state === 'minimized' && update.focused === false), 'minimization should be enforced after creation/navigation');
navigationListeners.onBeforeNavigate({ frameId: 0, tabId: 31, url: 'https://auth.openai.com/authorize' });
authWindowCallbackUrl = redirectUrl;
await new Promise(resolveTurn => setTimeout(resolveTurn, 30));
assert.equal(callbackPosts, 1, 'periodic auth-window inspection must recover the callback URL when browser navigation events are missed');
navigationListeners.onCommitted({ frameId: 0, tabId: 31, url: redirectUrl });
navigationListeners.onCompleted({ frameId: 0, tabId: 31, url: redirectUrl });
tabsUpdatedListener(31, { status: 'complete' }, { id: 31, url: redirectUrl });
await new Promise(resolveTurn => setTimeout(resolveTurn, 30));
assert.equal(callbackPosts, 1, 'committed/completed callback navigation must be captured even when beforeNavigate is missed, without duplicate posts');
assert.equal(callbackRequestBody.provider, 'codex');
assert.equal(callbackRequestBody.redirect_url, redirectUrl, 'the exact redirect URL must be forwarded to CPA');
assert.equal(session.cpaReauthQueueV4.callbackSubmitted, true, 'the callback should remain marked submitted after completion');
const callbackLogs = session.cpaReauthQueueV4.logs.map(entry => entry.message).join('\n');
assert.match(callbackLogs, /OAuth 本地回调/);
assert.doesNotMatch(callbackLogs, /secret-code|test-state|localhost:1455/ , 'callback diagnostics must not expose URL, code, or state');
navigationListeners.onCommitted({ frameId: 0, tabId: 31, url: redirectUrl });
await new Promise(resolveTurn => setTimeout(resolveTurn, 10));
assert.equal(callbackPosts, 1, 'later callback events must not submit a duplicate callback');
const otpResult = await new Promise(resolveReply => messageListener({ type: 'otp', sessionId: 'test-state' }, { tab: { incognito: true, windowId: 22 } }, resolveReply));
assert.match(otpResult.diagnostic, /当前 4 封邮件均为认证开始前的旧邮件/);
assert.doesNotMatch(otpResult.diagnostic, /字段|emailId|sendEmail/);
mailRows.push({ emailId: 'new-5', toEmail: 'user@example.test', sendEmail: 'noreply@openai.com', subject: 'Sign-in code', text: '654321' });
const foundOtp = await new Promise(resolveReply => messageListener({ type: 'otp', sessionId: 'test-state' }, { tab: { incognito: true, windowId: 22 } }, resolveReply));
assert.equal(foundOtp.code, '654321');
assert.match(foundOtp.diagnostic, /找到可用验证码/);
await new Promise(resolveReply => messageListener({ type: 'requestAttention', sessionId: 'test-state', message: 'captcha test' }, { tab: { incognito: true, windowId: 22 } }, resolveReply));
assert.equal(restoredWindowOptions?.state, 'normal', 'manual attention must restore the private window');
assert.equal(restoredWindowOptions?.focused, true, 'manual attention must bring the private window forward');
await new Promise(resolveReply => messageListener({ type: 'stopQueue' }, {}, resolveReply));
await new Promise(resolveTurn => setTimeout(resolveTurn, 30));

console.log('OAuth timestamp and minimized/manual-attention window behavior: PASS');
