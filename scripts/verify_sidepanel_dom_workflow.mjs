import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=path=>readFile(resolve(root,path),'utf8');
const [manifestText,content,background,panel,panelHtml]=await Promise.all([
  read('extension/manifest.json'),read('extension/content.js'),read('extension/background.js'),read('extension/panel.js'),read('extension/panel.html'),
]);
const manifest=JSON.parse(manifestText);
assert.ok(manifest.permissions.includes('sidePanel'));
assert.equal(manifest.side_panel.default_path,'panel.html');
assert.equal(manifest.action.default_popup,undefined,'toolbar action must open persistent side panel instead of transient popup');
assert.match(content,/\[data-account-card\]/,'collection must read account cards already rendered by the management filter');
assert.match(content,/domFilterPattern\('reauth'\)|setDomFilter\('reauth'\)/);
assert.match(content,/data-account-card.*auth_index|split\[1\]/,'account matching must use the panel row identity/auth_index');
assert.match(content,/refreshQuotaDOM/);
assert.match(content,/额度刷新完成/);
assert.match(content,/type==='refreshQuotaDOM'/);
assert.ok(background.indexOf("type:'refreshQuotaDOM'")<background.indexOf('q.index++;q.phase=\'auth\''),'the next account must not start before quota refresh finishes');
assert.match(background,/chrome\.sidePanel\.setPanelBehavior/);
assert.match(panelHtml,/认证所选/);
assert.match(panelHtml,/全部认证/);
assert.match(panelHtml,/运行日志/);
assert.match(panel,/type:'scanReauthDOM'/);
assert.match(panel,/type:'startDOMQueue'/);
console.log('Side panel DOM workflow contract: PASS');
