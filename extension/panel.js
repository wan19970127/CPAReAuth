const SCAN_KEY='cpaReauthDOMScanV1';
const BACKGROUND_MODE_KEY='cpaReauthBackgroundMinimizedV1';
const $=id=>document.getElementById(id);
let scanned=null,queue=null,selected=new Set(),busy=false,logsClearedAt=0,backgroundMode=true;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const send=message=>chrome.runtime.sendMessage(message);
const formatTime=value=>new Date(value).toLocaleTimeString('zh-CN',{hour12:false});
function activeTab(){return chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>tabs[0]||null)}
function setConnection(connected,title,detail){$('connection-light').classList.toggle('connected',connected);$('connection-title').textContent=title;$('connection-detail').textContent=detail}
function selectedAccounts(){return (scanned?.accounts||[]).filter(account=>selected.has(account.auth_index))}
function renderAccounts(){
  const items=scanned?.accounts||[];$('account-count').textContent=String(items.length);
  if(!items.length){$('accounts').innerHTML='<div class="empty-state">扫描后，这里会显示管理页筛出的账号。</div>';return}
  $('accounts').innerHTML=items.map((item,index)=>`<div class="account-row" style="animation-delay:${Math.min(index,12)*18}ms"><input type="checkbox" aria-label="选择 ${esc(item.email)}" data-account-select="${esc(item.auth_index)}" ${selected.has(item.auth_index)?'checked':''}><span class="account-copy"><span class="account-email">${esc(item.email)}</span><span class="account-label">${esc(item.label||item.fileName)}</span></span><button class="single-run" type="button" data-run-one="${esc(item.auth_index)}">单个认证</button></div>`).join('');
  $('accounts').querySelectorAll('[data-account-select]').forEach(input=>input.addEventListener('change',()=>{input.checked?selected.add(input.dataset.accountSelect):selected.delete(input.dataset.accountSelect);updateButtons()}));
  $('accounts').querySelectorAll('[data-run-one]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const account=items.find(item=>item.auth_index===button.dataset.runOne);if(account)start([account])}));
}
function renderQueue(){
  const q=queue,done=q?Math.min(q.index+(q.running?1:0),q.items.length):0,total=q?.items.length||0;
  const percent=total?Math.round((q.running?q.index:done)/total*100):0;
  $('progress-bar').style.width=percent+'%';$('progress-count').textContent=q?`${done} / ${total}`:'等待任务';$('progress-success').textContent='成功 '+(q?.success||0);
  $('current-task').textContent=q?.running?(q.phase==='quota'?'刷新额度：':'正在认证：')+(q.items[q.index]?.label||'处理中'):q?.phase==='done'?'队列已完成':q?.phase==='stopped'?'队列已停止':q?.error||'准备就绪';
  $('run-state').textContent=q?.running?'运行中':q?.phase==='done'?'已完成':q?.phase==='error'?'有错误':q?.phase==='stopped'?'已停止':'空闲';
  $('run-state').className='run-state'+(q?.running?' running':'')+(q?.phase==='error'?' error':'');
  $('stop').classList.toggle('hidden',!q?.running);$('scan').disabled=busy||Boolean(q?.running);$('scan').textContent=busy?'正在读取管理页…':'扫描当前管理页';
  const entries=(q?.logs||[]).filter(entry=>entry.at>logsClearedAt).slice().reverse();
  $('logs').innerHTML=entries.length?entries.map(entry=>`<li class="log-entry"><time class="log-time">${formatTime(entry.at)}</time><span class="log-level ${esc(entry.level)}">${esc(entry.level==='ok'?'完成':entry.level==='warn'?'注意':entry.level==='error'?'错误':'信息')}</span><span class="log-message">${esc(entry.message)}</span></li>`).join(''):'<li class="empty-state">尚无任务日志。</li>';
}
function updateButtons(){const idle=!queue?.running&&!busy;const has=Boolean(scanned?.accounts?.length);$('run-all').disabled=!idle||!has;$('run-selected').disabled=!idle||!selected.size;$('background-mode').disabled=!idle;$('select-all').textContent=selected.size===scanned?.accounts?.length?'取消全选':'全选'}
async function loadState(){
  const data=await chrome.storage.session.get([SCAN_KEY,'cpaReauthQueueV4']);scanned=data[SCAN_KEY]||null;queue=data.cpaReauthQueueV4||null;
  const mode=await chrome.storage.local.get(BACKGROUND_MODE_KEY);backgroundMode=mode[BACKGROUND_MODE_KEY]===undefined?true:Boolean(mode[BACKGROUND_MODE_KEY]);if(mode[BACKGROUND_MODE_KEY]===undefined)await chrome.storage.local.set({[BACKGROUND_MODE_KEY]:true});$('background-mode').setAttribute('aria-checked',String(backgroundMode));$('mode-detail').textContent=backgroundMode?'窗口默认最小化；检测到人工步骤时自动弹出':'认证窗口正常显示在前台';
  selected=new Set((scanned?.accounts||[]).map(item=>item.auth_index));
  if(scanned?.pageOrigin)setConnection(true,'已扫描管理页',new URL(scanned.pageOrigin).host+' · 名单仅来自当前重新认证筛选');else setConnection(false,'尚未扫描管理页','请在 CPA-Manager-Plus 管理页点击扩展图标，然后扫描“需要重新认证”账号。');
  renderAccounts();renderQueue();updateButtons();
}
async function scan(){
  if(busy)return;busy=true;scanned=null;selected.clear();await chrome.storage.session.remove(SCAN_KEY);renderAccounts();updateButtons();renderQueue();setConnection(false,'正在连接管理页','将读取面板当前“需要重新认证”筛选，并逐页收集账号。');
  try{
    const tab=await activeTab();if(!tab?.id||!tab.url)throw Error('请先打开 CPA-Manager-Plus 管理页');
    const url=new URL(tab.url);if(!/^https?:$/.test(url.protocol)||!url.pathname.endsWith('/management.html'))throw Error('当前活动标签不是 management.html');
    const pageOrigin=url.origin;
    if(!await chrome.permissions.request({origins:[pageOrigin+'/*']}))throw Error('需要允许扩展读取当前管理页 DOM');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const cpaBase=pageOrigin;
    const pair=await send({type:'pairPage',pageOrigin,cpaBase});if(pair?.error)throw Error(pair.error);
    const result=await chrome.tabs.sendMessage(tab.id,{type:'scanReauthDOM'});if(result?.error)throw Error(result.error);
    scanned={accounts:result.accounts||[],pageOrigin,pageTabId:tab.id,previousFilter:result.previousFilter||'reauth',scannedAt:Date.now()};
    await chrome.storage.session.set({[SCAN_KEY]:scanned});selected=new Set(scanned.accounts.map(item=>item.auth_index));
    setConnection(true,'管理页已就绪',`${url.host} · 已从“需要重新认证”筛选读取 ${scanned.accounts.length} 个账号`);
  }catch(error){setConnection(false,'扫描失败',error.message||String(error))}
  finally{busy=false;renderAccounts();renderQueue();updateButtons()}
}
async function start(items){
  if(!scanned?.pageOrigin||!scanned?.pageTabId)throw Error('请先扫描管理页名单');
  busy=true;renderQueue();updateButtons();
  try{
    const result=await send({type:'startDOMQueue',accounts:items,pageOrigin:scanned.pageOrigin,tabId:scanned.pageTabId,previousFilter:scanned.previousFilter,backgroundMode});
    if(result?.error)throw Error(result.error);
    await loadState();
  }catch(error){setConnection(true,'无法启动任务',error.message||String(error))}
  finally{busy=false;renderQueue();updateButtons()}
}
$('scan').addEventListener('click',scan);
$('run-all').addEventListener('click',()=>start(scanned?.accounts||[]));
$('run-selected').addEventListener('click',()=>start(selectedAccounts()));
$('select-all').addEventListener('click',()=>{selected=selected.size===scanned?.accounts?.length?new Set():new Set((scanned?.accounts||[]).map(item=>item.auth_index));renderAccounts();updateButtons()});
$('stop').addEventListener('click',()=>void send({type:'stopQueue'}));
$('background-mode').addEventListener('click',async()=>{if(queue?.running)return;backgroundMode=!backgroundMode;$('background-mode').setAttribute('aria-checked',String(backgroundMode));$('mode-detail').textContent=backgroundMode?'窗口默认最小化；检测到人工步骤时自动弹出':'认证窗口正常显示在前台';await chrome.storage.local.set({[BACKGROUND_MODE_KEY]:backgroundMode})});
$('clear-log').addEventListener('click',()=>{logsClearedAt=Date.now();renderQueue()});
$('settings').addEventListener('click',event=>{event.preventDefault();void chrome.runtime.openOptionsPage()});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&(changes.cpaReauthQueueV4||changes[SCAN_KEY]))void loadState()});
void loadState();
