const $ = (id) => document.getElementById(id);
const KEY = 'cpaReauthConfigV4';

async function render() {
  const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
  $('key').value = saved.managementKey || '';
  $('cloud').value = saved.cloudBase || '';
  $('email').value = saved.cloudEmail || '';
  $('password').value = '';
  $('password').placeholder = saved.hasCloudPassword ? '已保存，留空保持不变' : '请输入管理员密码';
  $('strict').checked = saved.strictIncognito !== false;
  const allowed = await chrome.extension.isAllowedIncognitoAccess();
  $('incognito').textContent = allowed
    ? '✓ 已允许扩展在无痕模式运行。'
    : '请在 chrome://extensions → CPA ReAuth Helper → 详情中开启“允许在无痕模式下运行”。';
}

$('save').addEventListener('click', async () => {
  const out = $('out');
  out.textContent = '';
  try {
    const cloudBase = new URL($('cloud').value.trim()).origin;
    const managementKey = $('key').value.trim();
    const cloudEmail = $('email').value.trim();
    const password = $('password').value;
    if (!managementKey) throw new Error('请输入 CPA Management Key');
    if (!cloudEmail) throw new Error('请输入 Cloud Mail 管理员邮箱');
    const patterns = [cloudBase + '/*'];
    if (!await chrome.permissions.request({origins: patterns})) {
      throw new Error('需要允许扩展访问 Cloud Mail 地址');
    }
    const old = (await chrome.storage.local.get(KEY))[KEY] || {};
    const cloudPassword = password || old.cloudPassword || '';
    if (!cloudPassword) throw new Error('请输入 Cloud Mail 管理员密码');
    const saved = {
      ...old, managementKey, cloudBase, cloudEmail, cloudPassword,
      hasCloudPassword: true, strictIncognito: $('strict').checked,
    };
    await chrome.storage.local.set({[KEY]: saved});
    $('password').value = '';
    out.textContent = '配置已保存。请确认扩展详情中已开启“允许在无痕模式下运行”。';
    await render();
  } catch (error) {
    out.textContent = error.message || String(error);
  }
});

void render();
