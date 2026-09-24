const CK='cpaReauthConfigV4', QK='cpaReauthQueueV4', ALARM='cpa-reauth-queue';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let processing=false,cloudToken='';
const callbackTabs=new Set();
const workerInstance=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const origin=v=>new URL(v).origin;
const config=async()=>(await chrome.storage.local.get(CK))[CK]||{};
const queue=async()=>(await chrome.storage.session.get(QK))[QK]||null;
const save=async q=>chrome.storage.session.set({[QK]:q});
const summary=q=>!q?'尚未开始认证':(q.running?'执行中':'已停止')+' '+Math.min(q.index+(q.running?1:0),q.items.length)+'/'+q.items.length+'；成功 '+q.success+' 个'+(q.error?'；失败：'+q.error:'');
async function addLog(q,level,message){q.logs=q.logs||[];q.logs.push({at:Date.now(),level,message:String(message||'')});if(q.logs.length>300)q.logs=q.logs.slice(-300);await save(q)}
async function report(q){
  await chrome.action.setBadgeText({text:q.running?String(q.index+1):q.error?'!':''}).catch(()=>{});
}
async function sendToManagement(q,message){
  if(!q.pageTabId)throw Error('没有关联的管理页标签；请保持 CPA-Manager-Plus 页面打开');
  const tab=await chrome.tabs.get(q.pageTabId).catch(()=>null);
  if(!tab?.url||new URL(tab.url).origin!==origin(q.pageOrigin))throw Error('管理页已关闭或地址发生变化');
  return chrome.tabs.sendMessage(q.pageTabId,message);
}
async function api(path,opts={}){
  const c=await config();
  const cpaBase=c.cpaBase||c.pageOrigin;
  if(!cpaBase||!c.managementKey)throw Error('请先从 management.html 连接扩展，并在设置中填写 CPA Management Key');
  const r=await fetch(origin(cpaBase)+'/v0/management/'+path,{...opts,headers:{Authorization:'Bearer '+c.managementKey,'Content-Type':'application/json',...opts.headers}});
  const raw=await r.text();let body;try{body=JSON.parse(raw)}catch{body={}};
  if(!r.ok)throw Error('CPA HTTP '+r.status+'：'+String(body.error||body.message||raw).slice(0,180));
  return body;
}
async function loginMail(){
  const c=await config();
  if(!c.cloudBase||!c.cloudEmail||!c.cloudPassword)throw Error('请在扩展选项中配置 Cloud Mail 管理员账号');
  const r=await fetch(origin(c.cloudBase)+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.cloudEmail,password:c.cloudPassword})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok||b.code!==200||!b.data?.token)throw Error('Cloud Mail 登录失败：'+(b.message||'HTTP '+r.status+' / code '+b.code));
  cloudToken=b.data.token;
}
async function messages(email){
  if(!cloudToken)await loginMail();
  const c=await config(),u=new URL(origin(c.cloudBase)+'/api/allEmail/list');
  Object.entries({type:'receive',size:'50',full:'1',timeSort:'0',accountEmail:email}).forEach(([k,v])=>u.searchParams.set(k,v));
  let r=await fetch(u,{headers:{Authorization:cloudToken}});
  if(r.status===401||r.status===403){cloudToken='';await loginMail();r=await fetch(u,{headers:{Authorization:cloudToken}})}
  const b=await r.json().catch(()=>({}));
  if(!r.ok||(b.code!=null&&Number(b.code)!==200))throw Error('Cloud Mail 查询失败：'+(b.message||'HTTP '+r.status+' / code '+b.code));
  const findRows=(value,depth=0)=>{
    if(Array.isArray(value))return value;
    if(!value||typeof value!=='object'||depth>5)return [];
    for(const key of ['list','records','items','rows','data']) {
      const rows=findRows(value[key],depth+1);
      if(rows.length)return rows;
    }
    return [];
  };
  return {rows:findRows(b)};
}
function messageId(message){return String(message.emailId||message.messageId||message.mailId||message.id||'').trim()}
async function otp(email,started,used,baselineIds){
  if(!email)throw Error('此凭证缺少邮箱，无法自动获取验证码');
  const candidates=[];
  const result=await messages(email);
  const baseline=new Set(baselineIds||[]);
  const stats={total:result.rows.length,recipient:0,baseline:0,time:0,openai:0,code:0};
  for(const m of result.rows){
    const to=String(m.toEmail||m.recipient||m.accountEmail||'').trim();
    if(to&&to.toLowerCase()!==email.toLowerCase())continue;
    stats.recipient++;
    const id=messageId(m);
    if(id&&baseline.has(id)){stats.baseline++;continue}
    const raw=m.createTime||m.createdAt||m.date||m.receivedAt||'',time=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(String(raw).replace(' ','T'));
    // Cloud Mail may return timestamps in a timezone/format that parses as
    // older than the OAuth start. A message with a new server ID is stronger
    // evidence of arrival than that timestamp; use time only if no ID exists.
    if(!id&&Number.isFinite(time)&&time<started-30000)continue;
    stats.time++;
    const from=String(m.sendEmail||m.from||m.fromEmail||'').toLowerCase();
    const subject=String(m.subject||m.title||''),body=String(m.text||m.content||m.html||m.body||m.mailContent||'').replace(/<[^>]*>/g,' ');
    if(!/openai|chatgpt/.test(from)&&!/openai|chatgpt/i.test(subject))continue;
    stats.openai++;
    if(!/verification|verify|code|login|sign in|验证码|验证/i.test(subject+' '+body))continue;
    stats.code++;
    const code=(subject+' '+body).match(/\b\d{6}\b/)?.[0];
    if(code&&!used.includes(code))candidates.push({code,time:Number.isFinite(time)?time:0});
  }
  candidates.sort((a,b)=>b.time-a.time);
  const usableCode=Boolean(candidates[0]?.code);
  let diagnostic;
  if(!stats.total)diagnostic='邮箱检查：当前没有邮件，继续等待验证码邮件。';
  else if(stats.recipient===0)diagnostic=`邮箱检查：收到 ${stats.total} 封邮件，但没有匹配到该账号收件地址。`;
  else if(stats.time===0)diagnostic=`邮箱检查：当前 ${stats.total} 封邮件均为认证开始前的旧邮件，尚无新邮件。`;
  else if(stats.openai===0)diagnostic=`邮箱检查：发现 ${stats.time} 封新邮件，但尚未匹配到 OpenAI 发件人或主题。`;
  else if(stats.code===0)diagnostic=`邮箱检查：发现 ${stats.openai} 封 OpenAI 邮件，但暂未识别到验证码内容。`;
  else if(usableCode)diagnostic=`邮箱检查：在 ${stats.code} 封验证码邮件中找到可用验证码。`;
  else diagnostic=`邮箱检查：发现 ${stats.code} 封验证码邮件，但没有新的可用验证码（可能已使用）。`;
  return {code:candidates[0]?.code||null,diagnostic};
}
async function closeWindow(q){if(q.windowId)await chrome.windows.remove(q.windowId).catch(()=>{});q.windowId=null;await save(q)}
async function createAuthWindow(url,minimized){
  if(!minimized)return chrome.windows.create({url,incognito:true,focused:true,state:'normal',type:'normal'});
  const window=await chrome.windows.create({url:'about:blank',incognito:true,focused:false,state:'minimized',type:'normal'});
  const tabId=window.tabs?.[0]?.id;
  await chrome.windows.update(window.id,{state:'minimized',focused:false});
  if(!tabId)throw Error('Chrome 没有返回无痕窗口标签，无法在后台启动认证');
  await chrome.tabs.update(tabId,{url,active:false});
  await chrome.windows.update(window.id,{state:'minimized',focused:false});
  const confirmed=await chrome.windows.get(window.id);
  if(confirmed.state!=='minimized')throw Error('Chrome 未能将无痕认证窗口保持最小化；请关闭窗口后重试');
  return window;
}
async function processQueue(){
  if(processing)return;processing=true;
  try{
    let q=await queue();if(!q?.running)return;
    if(q.workerInstance&&q.workerInstance!==workerInstance)await addLog(q,'warn','service worker 恢复：检测到扩展后台重启，正在恢复认证队列');
    q.workerInstance=workerInstance;await save(q);
    while(q.running&&q.index<q.items.length){
      q=await queue()||q;if(!q.running)break;
      const item=q.items[q.index];
      q.phase='auth';await save(q);await report(q);
      if(!item.email)throw Error(item.label+' 没有邮箱；队列已暂停');
      if(!q.state){
        await addLog(q,'info',item.label+'：开始认证');
        q.callbackObserved=false;q.callbackObservedAt=0;q.callbackSubmitted=false;q.callbackSubmittedAt=0;q.callbackInFlight=false;q.callbackStateMismatchLogged=false;
        await save(q);
        const c=await config();
        if(!await chrome.extension.isAllowedIncognitoAccess())throw Error('请在扩展详情中启用“允许在无痕模式下运行”');
        if(c.strictIncognito!==false&&(await chrome.windows.getAll()).some(w=>w.incognito))throw Error('请先关闭其他无痕窗口，以免账号会话混用');
        const before=await messages(item.email);
        q=await queue()||q;if(!q.running)break;
        q.baselineMailIds=before.rows.map(messageId).filter(Boolean);q.lastAttention='';q.lastPageProbe='';
        await addLog(q,'info',item.label+'：邮箱基线已建立，现有邮件 '+before.rows.length+' 封');
        q.startedAt=Date.now();q.lastOAuthStatus='';q.lastOAuthLogAt=0;
        await save(q);
        const a=await api('codex-auth-url?is_webui=true');
        q=await queue()||q;if(!q.running)break;
        if(!a.url||!a.state)throw Error('CPA 没有返回 OAuth URL 或 state');
        q.state=a.state;q.usedCodes=[];await save(q);
        await addLog(q,'info',item.label+'：已从 CPA 获取 OAuth 授权地址');
        const w=await createAuthWindow(a.url,q.backgroundMode);
        if(!w?.id)throw Error('无法创建无痕窗口');
        q.windowId=w.id;await addLog(q,'info',item.label+(q.backgroundMode?'：无痕窗口已最小化并在后台打开认证':'：已打开无痕认证窗口'));await report(q);
      }
      await inspectAuthWindowForCallback(q);
      q=await queue()||q;if(!q.running)break;
      const result=await api('get-auth-status?state='+encodeURIComponent(q.state));
      q=await queue()||q;if(!q.running)break;
      const oauthStatus=String(result.status||'未知');
      if(q.lastOAuthStatus!==oauthStatus){
        q.lastOAuthStatus=oauthStatus;q.lastOAuthLogAt=Date.now();
        await addLog(q,oauthStatus==='error'?'error':'info',item.label+'：认证状态变化 → '+oauthStatus+'（已等待 '+Math.max(0,Math.floor((Date.now()-q.startedAt)/1000))+' 秒）');
      }else if(Date.now()-(q.lastOAuthLogAt||0)>=30000){
        q.lastOAuthLogAt=Date.now();await addLog(q,'info',item.label+'：CPA 仍在等待 OAuth 完成（状态 '+oauthStatus+'，已等待 '+Math.max(0,Math.floor((Date.now()-q.startedAt)/1000))+' 秒）');
      }
      if(result.status==='ok'){
        await closeWindow(q);q.state='';q.startedAt=0;q.usedCodes=[];q.baselineMailIds=[];
        await addLog(q,'ok',item.label+'：认证成功');
        q.phase='quota';await report(q);
        try{
          const refreshed=await sendToManagement(q,{type:'refreshQuotaDOM',account:item});
          if(refreshed?.error)throw Error(refreshed.error);
          q=await queue()||q;if(!q.running)return;
          item.quotaStatus='success';await addLog(q,'ok',item.label+'：'+(refreshed?.message||'额度刷新完成'));
        }catch(refreshError){q=await queue()||q;if(!q.running)return;item.authStatus='success';item.quotaStatus='error';item.quotaError=String(refreshError.message||refreshError);q.running=false;q.phase='error';q.error=item.label+'：认证成功，但额度刷新失败；队列已暂停：'+item.quotaError;await addLog(q,'error',q.error);await save(q);await report(q);try{await sendToManagement(q,{type:'restoreReauthFilterDOM',mode:q.previousFilter||'reauth'})}catch{}return}
        q.success++;q.index++;q.phase='auth';await save(q);await report(q);continue
      }
      if(result.status==='error')throw Error(item.label+'：'+(result.error||'CPA OAuth 失败'));
      if(Date.now()-q.startedAt>600000){
        const callbackState=q.callbackSubmitted?'CPA 已收到本地 OAuth 回调，但认证状态仍未完成':q.callbackObserved?'已检测到本地 OAuth 回调，但 CPA 尚未确认认证完成':'尚未检测到本地 OAuth 回调；请检查无痕认证页是否仍在运行，或是否需要人工操作';
        throw Error(item.label+'：认证等待超时（'+callbackState+'）');
      }
      await sleep(3000);q=await queue()||q;
    }
    if(q.index>=q.items.length){q.running=false;q.phase='done';await addLog(q,'ok','队列完成：'+q.success+'/'+q.items.length+' 个账号认证成功');await save(q);await report(q);try{await sendToManagement(q,{type:'restoreReauthFilterDOM',mode:q.previousFilter||'reauth'})}catch{}}
  }catch(e){const q=await queue();if(q?.running){await closeWindow(q);q.running=false;q.phase='error';q.error=String(e.message||e);await addLog(q,'error',q.error);await save(q);await report(q);try{await sendToManagement(q,{type:'restoreReauthFilterDOM',mode:q.previousFilter||'reauth'})}catch{}}}
  finally{processing=false}
}
async function start(items,pageOrigin,pageTabId,previousFilter,backgroundMode){
  const c=await config();pageOrigin=origin(pageOrigin||'');
  if(!c.pageOrigin||pageOrigin!==origin(c.pageOrigin))throw Error('当前页面地址与扩展已连接的管理页不匹配');
  const pageTab=await chrome.tabs.get(pageTabId).catch(()=>null);
  if(!pageTab?.url||new URL(pageTab.url).origin!==pageOrigin)throw Error('请保持已连接的 CPA-Manager-Plus 管理页打开');
  if(!Array.isArray(items)||!items.length||items.length>10000)throw Error('重新认证名单为空或过长');
  if((await queue())?.running)throw Error('已有批量认证任务在运行');
  const seen=new Set(),normalized=items.map(x=>({auth_index:String(x.auth_index||'').trim(),email:String(x.email||'').trim(),label:String(x.label||'').trim(),fileName:String(x.fileName||'').trim(),domKey:String(x.domKey||'')})).filter(x=>{if(!x.auth_index||!x.fileName||seen.has(x.auth_index))return false;seen.add(x.auth_index);return true});
  if(!normalized.length)throw Error('没有有效的需重新认证账号');
  const missing=normalized.filter(x=>!x.email);
  if(missing.length)throw Error(`有 ${missing.length} 个账号缺少邮箱，暂不能自动获取验证码：${missing.slice(0,4).map(x=>x.label||x.auth_index).join('、')}`);
  const q={items:normalized,index:0,success:0,running:true,error:'',pageOrigin,pageTabId,previousFilter:previousFilter||'reauth',state:'',windowId:null,startedAt:0,usedCodes:[],baselineMailIds:[],phase:'auth',logs:[],backgroundMode:Boolean(backgroundMode),manualPrompt:''};
  await addLog(q,'info','已从管理页 DOM 收集 '+normalized.length+' 个账号；队列开始');
  await addLog(q,'info',q.backgroundMode?'模式：后台最小化；需要人工处理时认证窗口会自动弹出':'模式：认证窗口在前台运行');
  await report(q);void processQueue();return {message:summary(q)};
}
async function installPageBridge(){
  const c=await config();if(!c.pageOrigin)return;
  const id='cpamp-reauth-page-bridge';
  await chrome.scripting.unregisterContentScripts({ids:[id]}).catch(()=>{});
  await chrome.scripting.registerContentScripts([{id,matches:[origin(c.pageOrigin)+'/*'],js:['content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
  for(const tab of await chrome.tabs.query({url:origin(c.pageOrigin)+'/*'})){
    if(tab.id)await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}).catch(()=>{});
  }
}
function localOAuthCallback(url){
  try{
    const parsed=new URL(url);
    if(parsed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.port!=='1455')return null;
    if(!parsed.searchParams.has('code')&&!parsed.searchParams.has('error'))return null;
    return {url:parsed.href,state:parsed.searchParams.get('state')||''};
  }catch{return null}
}
async function callback(url,tabId){
  const candidate=localOAuthCallback(url);if(!candidate)return;
  if(callbackTabs.has(tabId))return;
  callbackTabs.add(tabId);
  try{
    const q=await queue();if(!q?.running||!q.state)return;
    q.callbackObserved=true;q.callbackObservedAt=q.callbackObservedAt||Date.now();
    if(candidate.state!==q.state){
      if(!q.callbackStateMismatchLogged){q.callbackStateMismatchLogged=true;await addLog(q,'warn','检测到本地 OAuth 回调，但会话校验未通过；为安全起见未提交给 CPA');}
      else await save(q);
      return;
    }
    if(q.callbackInFlight||q.callbackSubmitted)return;
    q.callbackInFlight=true;await save(q);
    await addLog(q,'info','已检测到 OAuth 本地回调且会话校验通过，正在提交给 CPA');
    try{
      await api('oauth-callback',{method:'POST',body:JSON.stringify({provider:'codex',redirect_url:candidate.url})});
      q.callbackSubmitted=true;q.callbackSubmittedAt=Date.now();await save(q);
      await addLog(q,'ok','OAuth 回调已提交给 CPA，正在等待认证状态确认');
      await chrome.tabs.remove(tabId).catch(()=>{});
    }catch(e){
      q.error='OAuth 回调提交失败：'+e.message;q.running=false;q.phase='error';await addLog(q,'error',q.error);await report(q);
    }finally{q.callbackInFlight=false;await save(q)}
  }finally{callbackTabs.delete(tabId)}
}
function observeOAuthNavigation(details){
  if(details?.frameId!==0||!details.url)return;
  const candidate=localOAuthCallback(details.url);if(candidate)void callback(candidate.url,details.tabId);
}
async function inspectAuthWindowForCallback(q){
  if(!q?.windowId||q.callbackSubmitted)return;
  const tabs=await chrome.tabs.query({windowId:q.windowId}).catch(()=>[]);
  for(const tab of tabs){
    const candidate=localOAuthCallback(tab.url||'');
    if(candidate){await callback(candidate.url,tab.id);return;}
  }
}
async function raiseAttention(q,message){
  const detail=String(message||'页面需要人工确认').slice(0,240),item=q.items[q.index];
  if(q.lastAttention===detail)return;
  q.lastAttention=detail;q.lastAttentionAt=Date.now();
  await addLog(q,'warn',(item?.label||'当前账号')+'：需要人工操作——'+detail);
  if(q.backgroundMode&&q.windowId){
    const window=await chrome.windows.update(q.windowId,{state:'normal',focused:true}).catch(()=>null);
    if(window)await addLog(q,'info','认证窗口已弹出，请完成页面中的人工步骤');
    else await addLog(q,'error','未能自动弹出认证窗口，请从任务栏恢复无痕窗口');
  }else await addLog(q,'info','认证窗口已在前台，请完成页面中的人工步骤');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{(async()=>{
  if(m?.type==='pairPage'){
    const pageOrigin=origin(m.pageOrigin);
    const old=await config();
    const cpaBase=origin(m.cpaBase||pageOrigin);
    await chrome.storage.local.set({[CK]:{...old,pageOrigin,cpaBase}});
    await installPageBridge();
    return {ok:true,message:'已自动连接当前管理页和 CPA API'};
  }
  if(m?.type==='startDOMQueue')return start(m.accounts,m.pageOrigin,m.tabId,m.previousFilter,m.backgroundMode);
  if(m?.type==='stopQueue'){
    const q=await queue();if(!q?.running)return {ok:true};q.running=false;q.phase='stopped';q.error='用户停止队列';await closeWindow(q);await addLog(q,'warn','队列已停止');await report(q);try{await sendToManagement(q,{type:'restoreReauthFilterDOM',mode:q.previousFilter||'reauth'})}catch{}return {ok:true};
  }
  if(m?.type==='pageProbe'){
    const q=await queue();if(!q?.running)return {ok:false};
    if(!sender.tab?.incognito||sender.tab.windowId!==q.windowId)return {ok:false};
    const probe=`${m.origin||''}${m.pathname||''}`;
    if(q.lastPageProbe!==probe){q.lastPageProbe=probe;await addLog(q,'warn','认证页面尚未关联到任务会话：'+probe);}
    if(m.attention)await raiseAttention(q,m.message||'页面需要人工确认');
    return {ok:true};
  }
  if(m?.type==='requestAttention'){
    const q=await queue();if(!q?.running||q.state!==m.sessionId||!sender.tab?.incognito||sender.tab.windowId!==q.windowId)return {ok:false};
    await raiseAttention(q,m.message);return {ok:true};
  }
  if(m?.type==='taskLog'){
    const q=await queue();if(!q?.running||q.state!==m.sessionId)return {ok:false};
    const previous=q.logs?.at(-1);if(previous?.message===m.message&&Date.now()-previous.at<15000)return {ok:true,duplicate:true};
    if(String(m.message||'').startsWith('认证页面步骤：'))q.lastAttention='';
    await addLog(q,m.level||'info',m.message||'');return {ok:true};
  }
  if(m?.type==='active'){const q=await queue();return {active:q?.running&&q.state&&sender.tab?.windowId===q.windowId?{id:q.state,email:q.items[q.index].email,method:'EMAIL_OTP',windowId:q.windowId}:null}}
  if(m?.type==='otp'){const q=await queue();if(!q?.running||!q.state||sender.tab?.windowId!==q.windowId||m.sessionId!==q.state)return {error:'没有匹配的活动认证会话'};const result=await otp(q.items[q.index].email,q.startedAt,q.usedCodes,q.baselineMailIds);if(result.code){q.usedCodes.push(result.code);await save(q);return {code:result.code,diagnostic:result.diagnostic}}return {error:'no verification code found yet',diagnostic:result.diagnostic}}
  return {error:'未知消息'};
})().then(reply).catch(async e=>{
  const message=String(e.message||e);
  if(m?.type==='otp'){
    const q=await queue();
    if(q?.running&&q.state===m.sessionId){
      await closeWindow(q);q.running=false;q.phase='error';q.error=message;await addLog(q,'error',message);await save(q);await report(q);try{await sendToManagement(q,{type:'restoreReauthFilterDOM',mode:q.previousFilter||'reauth'})}catch{}
    }
  }
  reply({error:message});
});return true});
chrome.webNavigation.onBeforeNavigate.addListener(observeOAuthNavigation);
chrome.webNavigation.onCommitted.addListener(observeOAuthNavigation);
chrome.webNavigation.onCompleted.addListener(observeOAuthNavigation);
chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
  if(changeInfo?.url)observeOAuthNavigation({frameId:0,tabId,url:changeInfo.url});
  else if(changeInfo?.status==='complete'&&tab?.url)observeOAuthNavigation({frameId:0,tabId,url:tab.url});
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)void processQueue()});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create(ALARM,{periodInMinutes:0.5});void processQueue()});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create(ALARM,{periodInMinutes:0.5}));
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.alarms.create(ALARM,{periodInMinutes:0.5});
