(function cpaReauthContentScript(){
if(globalThis.__CPA_REAUTH_CONTENT_SCRIPT_ACTIVE__)return;
globalThis.__CPA_REAUTH_CONTENT_SCRIPT_ACTIVE__=true;
let currentSession='', otpBusy=false, lastCode='', lastMethodAttempt='', lastMethodAttemptAt=0,lastPageStep='',lastProbeAt=0,lastManualPrompt='';
let lastConsentAttempt='',lastConsentAttemptAt=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function visible(el){if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
function setValue(el,value){const proto=Object.getPrototypeOf(el);const d=Object.getOwnPropertyDescriptor(proto,'value');if(d?.set)d.set.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
function first(selectors){for(const s of selectors){for(const el of document.querySelectorAll(s)){if(visible(el))return el}}return null}
function otpFields(){
  const selectors=['input[autocomplete*="one-time-code" i]','input[name*=otp i]','input[name*=code i]','input[id*=code i]','input[aria-label*=code i]','input[placeholder*=code i]','input[inputmode=numeric]','input[type=tel]','input[maxlength="1"]'];
  return [...new Set(selectors.flatMap(selector=>[...document.querySelectorAll(selector)]))].filter(visible);
}
function looksLikeCodeStep(){
  return /verification code|one[- ]time code|enter.*code|check your email|email.*code|验证码|输入.*代码|检查.*邮箱/i.test(document.body?.innerText||'');
}
function clickContinue(){const buttons=[...document.querySelectorAll('button,input[type=submit],[role=button]')].filter(visible);const b=buttons.find(x=>!x.disabled&&x.getAttribute('aria-disabled')!=='true'&&/continue|verify|next|submit|sign in|继续|验证|下一步/i.test([x.innerText,x.value,x.getAttribute('aria-label'),x.title].filter(Boolean).join(' ').trim()));if(b){b.click();return true}const input=first(['input[autocomplete="one-time-code"]','input[name*=otp i]','input[name*=code i]','input[id*=code i]','input[inputmode=numeric]']);const form=input?.form;if(form?.requestSubmit){form.requestSubmit();return true}return false}
function fillOTP(code){
  const matched=otpFields();
  const segmented=matched.filter(el=>el.maxLength===1);
  if(segmented.length>=code.length&&segmented.length<=8){
    for(let i=0;i<code.length;i++)setValue(segmented[i],code[i]);
    return segmented[0];
  }
  const target=matched.find(el=>el.autocomplete?.toLowerCase().includes('one-time-code'))||matched.find(el=>el.name?.toLowerCase().includes('code')||el.name?.toLowerCase().includes('otp'))||matched[0];
  if(!target)return null;
  setValue(target,code);
  return target;
}
function chooseMethod(method){const els=[...document.querySelectorAll('button,a,[role=button]')].filter(visible);const txt=x=>[x.innerText,x.textContent,x.getAttribute('aria-label'),x.title].filter(Boolean).join(' ').trim();let re=null;if(method==='EMAIL_OTP')re=/email.*(code|verification)|(code|verification).*email|send.*code|one[- ]?time.*code|一次性验证码|验证码登录|邮箱.*验证码|验证码.*邮箱|邮件.*验证码|验证码.*邮件/i;if(method==='PASSWORD')re=/password|密码/i;if(method==='SMS_OTP')re=/sms|text message|phone.*code|mobile.*code|短信.*验证码|手机.*验证码/i;if(!re)return false;const el=els.find(x=>re.test(txt(x)));if(!el)return false;const attempt=method+':'+location.pathname+':'+txt(el);if(lastMethodAttempt===attempt&&Date.now()-lastMethodAttemptAt<4000)return false;lastMethodAttempt=attempt;lastMethodAttemptAt=Date.now();el.click();return true}
async function active(){return new Promise(resolve=>chrome.runtime.sendMessage({type:'active'},resolve))}
async function otp(id){return new Promise(resolve=>chrome.runtime.sendMessage({type:'otp',sessionId:id},resolve))}
function taskLog(sessionId,level,message){try{const pending=chrome.runtime.sendMessage({type:'taskLog',sessionId,level,message});pending?.catch?.(()=>{})}catch{}}
function showManualPrompt(message){let box=document.getElementById('cpa-reauth-manual-prompt');if(!box){box=document.createElement('aside');box.id='cpa-reauth-manual-prompt';Object.assign(box.style,{position:'fixed',left:'16px',right:'16px',top:'16px',zIndex:'2147483647',display:'flex',alignItems:'flex-start',gap:'12px',padding:'13px 14px',background:'#fff4dc',border:'1px solid #e7ad50',borderRadius:'10px',color:'#402b0b',font:'13px/1.5 system-ui,sans-serif',boxShadow:'0 8px 30px #0004'});const copy=document.createElement('div');copy.dataset.role='message';copy.style.flex='1';const close=document.createElement('button');close.type='button';close.textContent='收起';Object.assign(close.style,{border:'1px solid #c8953e',borderRadius:'6px',padding:'4px 8px',background:'#fff9ed',color:'#55380a',cursor:'pointer'});close.addEventListener('click',()=>box.remove());box.append(copy,close);document.documentElement.appendChild(box)}const copy=box.querySelector('[data-role="message"]');copy.textContent='CPA ReAuth 需要你操作：'+message}
function requestAttention(sessionId,message){if(lastManualPrompt!==message){lastManualPrompt=message;showManualPrompt(message)}try{const pending=chrome.runtime.sendMessage({type:'requestAttention',sessionId,message});pending?.catch?.(()=>{})}catch{}}
function hideLegacyPageLauncher(){for(const button of document.querySelectorAll('button')){if(/批量重新认证/.test((button.innerText||button.textContent||'').trim()))button.style.display='none'}}
const domSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const domVisible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
async function domWait(test,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=test();if(value)return value;await domSleep(100)}throw Error(label+'（等待超时）')}
function domRows(){return [...document.querySelectorAll('[data-account-card]')].filter(domVisible)}
function parseDomAccount(card){
  const key=card.getAttribute('data-account-card')||'',split=key.split('\u0000');
  if(split.length<2||!split[0]||!split[1]||split[1]==='-')throw Error('管理页账号缺少可识别的文件名/auth_index，已停止以防误操作');
  const attrs=[...card.querySelectorAll('*')].flatMap(el=>[...el.attributes].map(attribute=>attribute.value));
  const texts=[...attrs,card.innerText||''];
  const email=texts.map(text=>String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'').find(Boolean)||'';
  const label=email||split[0];
  return {auth_index:split[1],email,label,fileName:split[0],domKey:key};
}
function domPageButton(direction){
  const buttons=[...document.querySelectorAll('button')].filter(button=>domVisible(button)&&!button.disabled);
  const re=direction==='next'?/^(下一页|next|forward|вперёд)$/i:/^(上一页|previous|prev|back|назад)$/i;
  return buttons.find(item=>re.test((item.innerText||item.textContent||'').trim()))||null;
}
async function moveDomPage(direction){
  const button=domPageButton(direction);
  if(!button)return false;
  const before=domRows().map(row=>row.getAttribute('data-account-card')).join('|');button.click();
  await domWait(()=>domRows().map(row=>row.getAttribute('data-account-card')).join('|')!==before,'管理页翻页');
  return true;
}
const domFilterPattern=mode=>mode==='all'?/^(全部|所有|全部状态|全部运行状态|all|all operational states|все)$/i:mode==='reauth'?/需要重新认证|reauthentication required|требуется повторная авторизация/i:new RegExp('^'+String(mode).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i');
async function setDomFilter(mode){
  const trigger=[...document.querySelectorAll('button[aria-label]')].find(button=>/运行状态|operational status|рабочее состояние/i.test(button.getAttribute('aria-label')||''));
  if(!trigger)throw Error('没有找到管理页的“运行状态”筛选器；请打开账号列表页面');
  const current=(trigger.innerText||trigger.textContent||'').trim();
  if(domFilterPattern(mode).test(current))return current;
  trigger.click();
  const option=await domWait(()=>[...document.querySelectorAll('[role="option"]')].find(el=>domVisible(el)&&domFilterPattern(mode).test((el.innerText||el.textContent||'').trim())),'筛选选项');
  option.click();
  await domWait(()=>domFilterPattern(mode).test((trigger.innerText||trigger.textContent||'').trim()),'更新运行状态筛选');
  await domSleep(250);
  return current;
}
async function collectDomReauthAccounts(){
  const previousFilter=await setDomFilter('reauth');
  if(!domRows().length&&/暂无|没有|no accounts|no results|未找到/i.test(document.body.innerText)){await setDomFilter(previousFilter);return {accounts:[],previousFilter}}
  const pages=[],seen=new Set();
  for(let page=0;page<200;page++){
    const rows=domRows();
    if(!rows.length&&page===0)throw Error('筛选已选择，但页面没有可读取的账号行');
    pages.push(...rows.map(parseDomAccount));
    const next=domPageButton('next');if(!next)break;
    const before=rows.map(row=>row.getAttribute('data-account-card')).join('|');
    if(seen.has(before))throw Error('管理页分页未前进，已停止以避免重复账号');seen.add(before);
    next.click();
    await domWait(()=>domRows().map(row=>row.getAttribute('data-account-card')).join('|')!==before,'管理页翻页');
    if(page===199)throw Error('重新认证账号超过安全分页上限');
  }
  const unique=new Map();for(const item of pages){if(unique.has(item.auth_index))throw Error('筛选结果包含重复 auth_index：'+item.auth_index);unique.set(item.auth_index,item)}
  for(let i=1;i<200&&moveDomPage('previous');i++){}
  const accounts=[...unique.values()];
  await setDomFilter(previousFilter);
  if(accounts.some(item=>!item.email))throw Error('有账号行没有可读邮箱；为避免认证后无法取码，本次没有启动任务');
  return {accounts,previousFilter};
}
function headerRefreshButton(){return [...document.querySelectorAll('button')].find(button=>domVisible(button)&&/^(刷新|refresh|обновить)$/i.test((button.innerText||button.textContent||'').trim()))||null}
async function refreshDomCredentialSnapshot(){
  let button=headerRefreshButton();if(!button)throw Error('没有找到管理页顶部的刷新按钮；无法加载认证后的最新账号数据');
  if(button.disabled)await domWait(()=>!headerRefreshButton()?.disabled,'管理页可以刷新');
  button=headerRefreshButton();button.click();
  await domWait(()=>headerRefreshButton()?.disabled,'管理页账号刷新开始',10000);
  await domWait(()=>Boolean(headerRefreshButton())&&!headerRefreshButton().disabled,'管理页账号刷新完成',90000);
  await domSleep(250);
}
async function findDomAccount(item){
  await setDomFilter('all');
  await refreshDomCredentialSnapshot();
  for(let page=0;page<200&&await moveDomPage('previous');page++){}
  for(let page=0;page<200;page++){
    const card=domRows().find(row=>row.getAttribute('data-account-card')===item.domKey||row.getAttribute('data-account-card')===item.fileName+'\u0000'+item.auth_index);
    if(card)return card;
    if(!await moveDomPage('next'))break;
  }
  throw Error('管理页当前筛选中找不到目标账号 '+(item.label||item.auth_index));
}
async function refreshDomQuota(item){
  const card=await findDomAccount(item);
  const findButton=()=>[...card.querySelectorAll('button')].find(el=>domVisible(el)&&/刷新额度|refresh quota|обновить квоту/i.test((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')));
  const button=findButton();
  if(!button)throw Error('账号行没有“刷新额度”操作：'+(item.label||item.auth_index));
  if(button.disabled)await domWait(()=>!button.disabled,'额度刷新按钮可用');
  const readNotifications=()=>[...document.querySelectorAll('[role="alert"],[role="status"]')].map(el=>(el.innerText||'').trim()).filter(Boolean);
  const notifications=new Set(readNotifications());
  button.click();
  await domWait(()=>!card.isConnected||findButton()?.disabled||readNotifications().some(text=>!notifications.has(text)),'额度刷新开始',5000);
  if(card.isConnected)await domWait(()=>!card.isConnected||!findButton()?.disabled,'额度刷新完成',90000);
  const alert=readNotifications().filter(text=>text&&!notifications.has(text)).slice(-3).join('；');
  for(const notification of document.querySelectorAll('[role="alert"],[role="status"]'))if(/刷新额度|额度.*刷新|refresh quota|quota.*refresh/i.test(notification.innerText||notification.textContent||''))notification.style.display='none';
  if(/刷新失败|获取失败|失败：|failed|error|ошибка/i.test(alert))throw Error(alert);
  await setDomFilter('reauth');
  return {ok:true,message:alert||'额度刷新操作已完成（管理页未提供结构化结果）'};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==='scanReauthDOM'){collectDomReauthAccounts().then(sendResponse).catch(error=>sendResponse({error:error.message||String(error)}));return true}
  if(message?.type==='refreshQuotaDOM'){refreshDomQuota(message.account).then(sendResponse).catch(error=>sendResponse({error:error.message||String(error)}));return true}
  if(message?.type==='restoreReauthFilterDOM'){setDomFilter(message.mode||'reauth').then(()=>sendResponse({ok:true})).catch(error=>sendResponse({error:error.message||String(error)}));return true}
});
if(!location.hostname.includes('openai.com')&&!location.hostname.includes('chatgpt.com')){
  hideLegacyPageLauncher();
  new MutationObserver(hideLegacyPageLauncher).observe(document.documentElement,{childList:true,subtree:true});
}
async function tick(){
  const a=await active().catch(e=>({error:e.message}));if(a?.error){return}const s=a?.active;if(!s||!s.id){if(location.hostname.includes('openai.com')||location.hostname.includes('chatgpt.com')){const manual=looksLikeCodeStep();if(manual)showManualPrompt('验证码页没有关联到当前认证任务，请检查无痕窗口和侧边栏任务状态');if(Date.now()-lastProbeAt>5000){lastProbeAt=Date.now();try{const pending=chrome.runtime.sendMessage({type:'pageProbe',origin:location.origin,pathname:location.pathname,attention:manual,message:'检测到验证码页面，但没有匹配到当前任务会话'});pending?.catch?.(()=>{})}catch{}}}return}if(currentSession!==s.id){currentSession=s.id;lastCode='';lastMethodAttempt='';lastMethodAttemptAt=0;lastPageStep='';taskLog(s.id,'info','认证页已关联到队列会话；邮箱 '+s.email)}
  const step=location.pathname.includes('/consent')?'OAuth 工作区授权页':otpFields().length?'验证码输入页':first(['input[type=password]'])?'密码输入页':first(['input[type=email]','input[name*=email i]','input[autocomplete=email]'])?'邮箱输入页':'OpenAI 授权页面 '+location.pathname;
  if(lastPageStep!==step){lastPageStep=step;lastManualPrompt='';document.getElementById('cpa-reauth-manual-prompt')?.remove();taskLog(s.id,'info','认证页面步骤：'+step)}
  if(location.pathname.includes('/consent')){
    const workspace=document.querySelector('select,[role=combobox]');
    const selectionText=workspace ? (workspace.value || workspace.getAttribute('aria-valuetext') || workspace.getAttribute('aria-label') || workspace.innerText || workspace.textContent || '') : '';
    const selected=!workspace||Boolean(selectionText.trim()&&!/select .*workspace|choose .*workspace/i.test(selectionText));
    const attempt=location.href;
    if(!selected){requestAttention(s.id,'请选择要授权的工作区');return}
    if(selected&&(lastConsentAttempt!==attempt||Date.now()-lastConsentAttemptAt>5000)){
      lastConsentAttempt=attempt;lastConsentAttemptAt=Date.now();
      if(clickContinue())taskLog(s.id,'info','工作区已确认，扩展已点击继续');
      else requestAttention(s.id,'工作区授权页需要确认，请检查并继续');
    }
    return;
  }
  if(chooseMethod(s.method)){taskLog(s.id,'info','已选择邮箱验证码登录方式');return}
  const pageText=document.body?.innerText||'';
  if(first(['input[type=password]'])){taskLog(s.id,'info','检测到密码输入页；继续优先查找并点击邮箱验证码入口，不填写密码');return}
  const visibleChallenge=[...document.querySelectorAll('iframe[src*="captcha" i],iframe[title*="captcha" i],[id*="captcha" i],[class*="captcha" i]')].some(visible);
  if(visibleChallenge||/verify you are human|人机验证|完成验证码|安全验证|verify your identity|验证你的身份|choose an account|select an account|use another account|选择一个账号|使用其他账号/i.test(pageText)){requestAttention(s.id,'页面要求选择账号或完成人机验证/安全验证');return}
  const email=first(['input[type=email]','input[name*=email i]','input[autocomplete=email]','input[name=username]']);
  if(email && s.email && !email.value){setValue(email,s.email);await sleep(150);const submitted=clickContinue();taskLog(s.id,'info',submitted?'已填入邮箱并提交下一步':'已填入邮箱，但未找到继续按钮');return}
  if(s.method!=='EMAIL_OTP'||otpBusy)return;
  const codeInput=otpFields()[0];
  if(!codeInput){if(looksLikeCodeStep())requestAttention(s.id,'页面显示验证码步骤，但未找到验证码输入框');return}
  if(codeInput.value&&/incorrect code|invalid code|code expired|try again|验证码错误|验证码已过期/i.test(pageText)){requestAttention(s.id,'验证码未通过，页面要求重新输入或确认');return}
  if(codeInput.value||codeInput.maxLength===1&&otpFields().some(input=>input.value))return;
  otpBusy=true;
  try{
    let foundCode=false, terminalError=false;
    for(let i=0;i<60;i++){
      const r=await otp(s.id);if(r?.code){foundCode=true;if(r.diagnostic)taskLog(s.id,'ok',r.diagnostic);if(r.code===lastCode)break;const target=fillOTP(r.code);if(!target){taskLog(s.id,'error','Cloud Mail 已返回验证码，但扩展没有识别到验证码输入框');requestAttention(s.id,'验证码已收到，但需要手动输入');break}lastCode=r.code;await sleep(250);if(clickContinue())taskLog(s.id,'ok','验证码已填入并提交');else requestAttention(s.id,'验证码已填入，但没有识别到继续按钮');break}
      if(r?.diagnostic)taskLog(s.id,r.error?'warn':'info',r.diagnostic);
      if(r?.error&&!/no verification code found yet/i.test(r.error)){terminalError=true;taskLog(s.id,'error','获取验证码失败：'+r.error);break}
      await sleep(2000);
    }
    if(!foundCode&&!terminalError)taskLog(s.id,'warn','本轮等待验证码结束，扩展会继续检查邮箱；确认邮件已投递至 '+s.email);
  }finally{otpBusy=false}
}
const obs=new MutationObserver(()=>{tick().catch(()=>{})});obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true});setInterval(()=>tick().catch(()=>{}),1500);tick().catch(()=>{});
})();
