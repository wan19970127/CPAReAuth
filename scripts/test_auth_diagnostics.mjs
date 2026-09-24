import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [background, content, panel, panelHtml] = await Promise.all([
  readFile(resolve(root, 'extension/background.js'), 'utf8'),
  readFile(resolve(root, 'extension/content.js'), 'utf8'),
  readFile(resolve(root, 'extension/panel.js'), 'utf8'),
  readFile(resolve(root, 'extension/panel.html'), 'utf8'),
]);

assert.match(background, /认证状态变化/, 'OAuth status transitions must be visible in task logs');
assert.match(background, /已检测到 OAuth 本地回调/, 'OAuth callback detection must be visible in task logs');
assert.match(background, /onCommitted\.addListener\(observeOAuthNavigation\)/, 'committed navigation must recover callbacks missed before navigation');
assert.match(background, /onCompleted\.addListener\(observeOAuthNavigation\)/, 'completed navigation must be a callback fallback');
assert.match(background, /tabs\.onUpdated\.addListener/, 'tab URL/status changes must be a callback fallback');
assert.match(background, /会话校验通过/, 'callback state validation must be visible without exposing its value');
assert.match(background, /尚未检测到本地 OAuth 回调/, 'OAuth timeout must distinguish a callback that never arrived');
assert.match(background, /service worker 恢复/, 'queue recovery after service worker restart must be visible');
assert.match(content, /认证页面步骤/, 'the active authorization page and step must be logged');
assert.match(content, /验证码已填入并提交/, 'OTP submission outcome must be visible in task logs');
assert.match(panel, /entry\.message/, 'the task panel must display the diagnostic messages received from the background and content scripts');
assert.match(background, /当前 .* 封邮件均为认证开始前的旧邮件/, 'mail logs should explain the stale-mail case in plain language');
assert.doesNotMatch(background, /字段 \$\{fields\.join/, 'mail logs must not dump raw message field names');
assert.match(background, /url:'about:blank'.*state:'minimized'/s, 'background mode should create a minimized blank window before loading OAuth');
assert.match(background, /chrome\.tabs\.update\(tabId,\{url,active:false\}\)/, 'OAuth navigation should happen in an inactive tab after minimization');
assert.match(background, /requestAttention/, 'manual checkpoints must be routed back to the background controller');
assert.match(background, /找到可用验证码/, 'a successful mail lookup must report the successful result');
assert.match(content, /if\(r\.diagnostic\)taskLog\(s\.id,'ok',r\.diagnostic\)/, 'the content script must surface the diagnostic returned with a successful OTP');
assert.doesNotMatch(content, /function warn\(/, 'authentication pages should not receive in-page log banners');
assert.match(panelHtml, /后台最小化认证/, 'the sidebar must expose the background-minimized mode toggle');
assert.match(panel, /backgroundMode=true/, 'background-minimized mode should be the first-run default');
assert.match(content, /CPA ReAuth 需要你操作：/, 'manual-only browser prompts should explain what the user must do');

console.log('OAuth task diagnostics visibility: PASS');
