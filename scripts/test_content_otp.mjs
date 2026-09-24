import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { resolve } from 'node:path';

const source = await readFile(resolve(import.meta.dirname, '../extension/content.js'), 'utf8');
assert.doesNotMatch(source, /cpa-reauth-warning/, 'authentication status must not be injected into the browser page');

async function runPasswordPage(buttonText) {
  let clicks = 0;
  let attentionRequests = 0;
  const otpButton = {
    innerText: buttonText,
    textContent: buttonText,
    title: '',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 280, height: 42 }),
    click: () => { clicks += 1; },
  };
  const passwordInput = {
    type: 'password', value: '',
    getBoundingClientRect: () => ({ width: 280, height: 42 }),
  };
  const document = {
    documentElement: {},
    querySelectorAll: (selector) => selector === 'button,a,[role=button]' ? [otpButton] : selector === 'input[type=password]' ? [passwordInput] : [],
    getElementById: () => null,
  };
  const context = createContext({
    document,
    location: { pathname: '/log-in/password', hostname: 'auth.openai.com' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    MutationObserver: class { observe() {} },
    setInterval: () => 0,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (message, reply) => {
          if (message.type === 'active') return reply({ active: { id: 'session-test', method: 'EMAIL_OTP', email: 'user@example.test' } });
          if (message.type === 'requestAttention') attentionRequests++;
          return Promise.resolve({ alreadyIncognito: true });
        },
      },
    },
    window: { addEventListener: () => {}, postMessage: () => {} },
  });
  new Script(source).runInContext(context);
  await new Promise((resolveTick) => setImmediate(resolveTick));
  return { clicks, attentionRequests };
}

async function runCodePage(otpReply) {
  let submitClicks = 0;
  const logs = [];
  class CodeInput {
    value = '';
    getBoundingClientRect() { return { width: 280, height: 42 }; }
    dispatchEvent() {}
  }
  const codeInput = new CodeInput();
  const submit = {
    innerText: 'Verify',
    disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 280, height: 42 }),
    click: () => { submitClicks += 1; },
  };
  const document = {
    documentElement: {},
    body: { innerText: 'Enter verification code' },
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === 'input[autocomplete*="one-time-code" i]' || selector === 'input[autocomplete="one-time-code"]') return [codeInput];
      if (selector === 'button,input[type=submit],[role=button]') return [submit];
      return [];
    },
    getElementById: () => null,
  };
  const context = createContext({
    document,
    location: { pathname: '/log-in/code', hostname: 'auth.openai.com' },
    Event: class {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    MutationObserver: class { observe() {} },
    setInterval: () => 0,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (message, reply) => {
          if (message.type === 'active') return reply({ active: { id: 'session-test', method: 'EMAIL_OTP', email: 'user@example.test' } });
          if (message.type === 'otp') return reply(otpReply);
          if (message.type === 'taskLog') logs.push(message.message);
          return Promise.resolve({ alreadyIncognito: true });
        },
      },
    },
    window: { addEventListener: () => {}, postMessage: () => {} },
  });
  new Script(source).runInContext(context);
  await new Promise((resolveTick) => setTimeout(resolveTick, 400));
  return { code: codeInput.value, submitClicks, logs };
}

async function runManualConsentPage() {
  let prompt = null;
  let attentionRequests = 0;
  const element = () => ({
    style: {}, dataset: {}, children: [], textContent: '',
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
    querySelector() { return this.children.find(child => child.dataset?.role === 'message') || null; },
  });
  const document = {
    documentElement: { appendChild: box => { prompt = box; } },
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: id => id === 'cpa-reauth-manual-prompt' ? prompt : null,
    createElement: element,
  };
  const context = createContext({
    document,
    location: { href: 'https://auth.openai.com/consent', pathname: '/consent', hostname: 'auth.openai.com' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    MutationObserver: class { observe() {} },
    setInterval: () => 0,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (message, reply) => {
          if (message.type === 'active') return reply({ active: { id: 'session-test', method: 'EMAIL_OTP', email: 'user@example.test' } });
          if (message.type === 'requestAttention') attentionRequests++;
          return Promise.resolve({ ok: true });
        },
      },
    },
  });
  new Script(source).runInContext(context);
  await new Promise(resolveTick => setImmediate(resolveTick));
  return { prompt: prompt?.children?.[0]?.textContent || '', attentionRequests };
}

assert.ok(
  (await runPasswordPage('使用一次性验证码登录')).clicks > 0,
  'EMAIL_OTP must click the visible one-time-code entry on the password page'
);
assert.ok(
  (await runPasswordPage('Use a one-time code')).clicks > 0,
  'EMAIL_OTP must also handle the English one-time-code entry'
);
assert.equal((await runPasswordPage('Use a one-time code')).attentionRequests, 0,
  'a password input must not pop the minimized window if the email-code option is available');
const manualConsent = await runManualConsentPage();
assert.ok(manualConsent.attentionRequests > 0, 'a manual consent checkpoint should request the window to be restored');
assert.match(manualConsent.prompt, /CPA ReAuth 需要你操作：工作区授权页需要确认/,
  'a manual checkpoint must display an actionable prompt on the browser page');
const filled = await runCodePage({ code: '123456', diagnostic: '邮箱检查：在 1 封验证码邮件中找到可用验证码。' });
assert.equal(filled.code, '123456', 'the code returned by CPA must be entered');
assert.equal(filled.submitClicks, 1, 'the entered code must be submitted');
assert.ok(filled.logs.includes('邮箱检查：在 1 封验证码邮件中找到可用验证码。'));
const failed = await runCodePage({ error: 'Cloud Mail HTTP 401' });
assert.ok(failed.logs.some(message => /获取验证码失败：Cloud Mail HTTP 401/.test(message)));
console.log('Content OTP password-page transition: PASS');
