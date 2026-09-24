import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { resolve } from 'node:path';

const source=await readFile(resolve(import.meta.dirname,'../extension/content.js'),'utf8');
let activeFilter='全部运行状态',dropdownOpen=false,page=0,listener;
const data=[
  {key:'codex-a.json\u0000auth-a',email:'a@example.test'},
  {key:'codex-b.json\u0000auth-b',email:'b@example.test'},
  {key:'codex-c.json\u0000auth-c',email:'c@example.test'},
];
const pageSize=2;
const makeCard=item=>({
  isConnected:true,
  innerText:item.email,
  getAttribute:name=>name==='data-account-card'?item.key:null,
  getBoundingClientRect:()=>({width:200,height:80}),
  querySelectorAll:selector=>selector==='*'?[{attributes:[{value:item.email}]}]:[],
});
const filterTrigger={
  disabled:false,
  innerText:activeFilter,
  textContent:activeFilter,
  getAttribute:name=>name==='aria-label'?'运行状态':null,
  getBoundingClientRect:()=>({width:180,height:40}),
  click(){dropdownOpen=true},
};
const options=['全部运行状态','需要重新认证'].map(label=>({
  innerText:label,textContent:label,getBoundingClientRect:()=>({width:180,height:35}),
  click(){activeFilter=label;filterTrigger.innerText=label;filterTrigger.textContent=label;page=0;dropdownOpen=false;},
}));
const nextButton={
  innerText:'下一页',textContent:'下一页',disabled:false,
  getBoundingClientRect:()=>({width:80,height:32}),
  click(){page+=1},
};
const previousButton={
  innerText:'上一页',textContent:'上一页',disabled:false,
  getBoundingClientRect:()=>({width:80,height:32}),
  click(){page=Math.max(0,page-1)},
};
const document={
  documentElement:{},body:{innerText:'账号列表'},
  querySelectorAll(selector){
    if(selector==='[data-account-card]')return data.slice(page*pageSize,(page+1)*pageSize).map(makeCard);
    if(selector==='button[aria-label]')return [filterTrigger];
    if(selector==='[role="option"]')return dropdownOpen?options:[];
    if(selector==='button')return [filterTrigger,nextButton,previousButton].filter(button=>{
      if(button===nextButton)return page<Math.ceil(data.length/pageSize)-1;
      if(button===previousButton)return page>0;
      return true;
    });
    if(selector==='*')return [];
    return [];
  },
  getElementById:()=>null,
};
const context=createContext({
  document,location:{hostname:'freecpa.example',origin:'https://freecpa.example',pathname:'/management.html'},
  getComputedStyle:()=>({display:'block',visibility:'visible'}),
  MutationObserver:class{observe(){}},setInterval:()=>0,setTimeout,
  chrome:{runtime:{onMessage:{addListener:fn=>{listener=fn}},sendMessage:(message,callback)=>{callback?.({active:null});return Promise.resolve({active:null})}}},
});
new Script(source).runInContext(context);
const result=await new Promise(resolve=>listener({type:'scanReauthDOM'},{},resolve));
assert.equal(result.error,undefined);
assert.deepEqual(Array.from(result.accounts,item=>item.auth_index),['auth-a','auth-b','auth-c']);
assert.deepEqual(Array.from(result.accounts,item=>item.email),['a@example.test','b@example.test','c@example.test']);
assert.equal(result.previousFilter,'全部运行状态');
assert.equal(activeFilter,'全部运行状态','the scanner must restore the filter the user had selected');
assert.equal(page,0,'the scanner must return to the first page');
console.log('Management page multi-page DOM scan: PASS');
