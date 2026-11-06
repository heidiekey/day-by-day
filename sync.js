'use strict';
(() => {
const URL='https://ajakdtcpxzlndadzvh.supabase.co';
const APIKEY='sb_publishable_ZkPq0vlNtcIZv58s5w14Yw_gJ94d_fj';
const SESSION='day-by-day-session-v1', LOCAL='day-by-day-app-v1';
let session=null, record=null, busy=false, authBusy=false, generation=0, conflict=null, timer;
let writer=false;
const el=id=>document.getElementById(id);
const clone=x=>JSON.parse(JSON.stringify(x));
const cacheKey=()=>`day-by-day-account-v1:${session.user.id}`;
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function write(key,value){localStorage.setItem(key,JSON.stringify(value));}
function message(text){el('syncMessage').textContent=text;}
function valid(p){
 if(!p||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Array.isArray(p.tasks)||p.tasks.length>500)throw Error('This plan is not a supported backup.');
 const ids=new Set();
 const statuses=['pending','running','paused','done','skipped','delegated','recovery'];
 const types=['flexible','priority','fixed','personal'];
 for(const t of p.tasks){
  if(!Number.isSafeInteger(t.id)||t.id<0||ids.has(t.id)||typeof t.name!=='string'||t.name.length>1000||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.start)||!Number.isFinite(t.minutes)||t.minutes<5||t.minutes>1440||!types.includes(t.type)||!statuses.includes(t.status)||!Array.isArray(t.steps)||!t.steps.every(s=>typeof s==='string'))throw Error('This plan contains an unsupported activity.');
  ids.add(t.id); if(t.started!==null&&t.started!==undefined&&!Number.isFinite(t.started))throw Error('Invalid timer.');
  t.history=Array.isArray(t.history)?t.history.filter(h=>h&&statuses.includes(h.status)&&(!h.started||Number.isFinite(h.started))&&Number.isFinite(h.actual)).slice(-15):[];
  t.actual=Number.isFinite(t.actual)?Math.max(0,t.actual):0;
  if(t.recoveryReason!==undefined&&typeof t.recoveryReason!=='string')throw Error('Invalid recovery note.');
 }
 for(const key of ['target','logged'])if(!Number.isFinite(p[key])||p[key]<0)throw Error('Invalid work hours.');
 if(p.proposal){if(!Array.isArray(p.proposal.changes)||!p.proposal.changes.every(c=>ids.has(c.id)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.old)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.next)))throw Error('Invalid schedule proposal.');}
 if(new TextEncoder().encode(JSON.stringify(p)).length>900000)throw Error('Plan is too large. Save a backup.');
 return p;
}
function saveRecord(){write(cacheKey(),record);}
function view(){
 el('authForm').classList.toggle('hidden',!!session);
 el('signedIn').classList.toggle('hidden',!session);
 el('signedAs').textContent=session?`Signed in as ${session.user.email}`:'';
 el('conflictBox').classList.toggle('hidden',!conflict);
 if(session)el('useLocal').classList.toggle('hidden',!read(LOCAL)?.tasks?.length);
}
function applyPlan(p){state=valid(clone(p));history=[];expanded.clear();render();}
const originalPersist=persist;
persist=function(){
 if(!writer)return;
 if(!session){originalPersist();return;}
 try{valid(state);record.state=clone(state);record.dirty=true;saveRecord();el('saveMsg').textContent='Saved on this device. Waiting to sync.';message(navigator.onLine?'Changes waiting to sync.':'Offline — changes saved on this device.');clearTimeout(timer);timer=setTimeout(sync,700);}
 catch(e){message('Could not save: '+e.message+' Use Save backup now.');}
};
async function request(path,{method='GET',body,token}={}){
 const headers={apikey:APIKEY,'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const response=await fetch(URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const e=Error(data?.msg||data?.message||data?.error_description||'Request failed. Try again.');e.status=response.status;throw e;}
 return data;
}
async function token(){
 if(!session)throw Error('Please sign in.');
 if(session.expires_at*1000>Date.now()+60000)return session.access_token;
 const epoch=generation;
 const next=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
 if(epoch!==generation)throw Error('Account changed.');
 session=next;write(SESSION,session);return session.access_token;
}
async function latest(t){const rows=await request('/rest/v1/day_by_day_snapshots?select=id,revision,plan&order=revision.desc&limit=1',{token:t});return rows[0]||null;}
function setConflict(remote){conflict=remote;view();message('Both devices have changes. Save a backup, then choose which whole plan to keep below.');}
async function sync(){
 if(!writer||!session||busy||conflict)return;
 if(!navigator.onLine){message('Offline — your changes remain on this device.');return;}
 busy=true;const epoch=generation;
 try{
  let t=await token();if(epoch!==generation)return;
  // Retry the identical request ID after a lost response, before making a new snapshot.
  if(record.pending){
   const pending=clone(record.pending);
   const rows=await request('/rest/v1/rpc/save_day_by_day_plan',{method:'POST',token:t,body:{request_id:pending.id,expected_revision:pending.base,new_plan:pending.plan}});
   if(epoch!==generation)return;
   record.base=rows[0].revision;record.pending=null;
   record.dirty=JSON.stringify(record.state)!==JSON.stringify(pending.plan);saveRecord();
  }
  const remote=await latest(t);if(epoch!==generation)return;
  if(record.dirty){
   if((remote?.revision||0)!==record.base){setConflict(remote);return;}
   record.pending={id:crypto.randomUUID(),base:record.base,plan:clone(record.state)};saveRecord();
   const pending=clone(record.pending);
   const rows=await request('/rest/v1/rpc/save_day_by_day_plan',{method:'POST',token:t,body:{request_id:pending.id,expected_revision:pending.base,new_plan:pending.plan}});
   if(epoch!==generation)return;
   record.base=rows[0].revision;record.pending=null;
   record.dirty=JSON.stringify(record.state)!==JSON.stringify(pending.plan);saveRecord();
  }else if(remote&&remote.revision!==record.base){
   // The user might have edited the plan while the read was in flight.
   if(!record.dirty){valid(remote.plan);record={state:clone(remote.plan),base:remote.revision,dirty:false,pending:null};saveRecord();applyPlan(record.state);}
  }
  message(record.dirty?'New changes waiting to sync.':'Up to date · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
 }catch(e){
  if(epoch!==generation)return;
  if(e.message.includes('PLAN_CONFLICT')){
   // A rejected write was not committed; keep the local plan and fetch the competing version.
   record.pending=null;saveRecord();
   try{setConflict(await latest(await token()));}catch{message('Changes saved here. Reconnect and tap Sync now.');}
  }else message(e.status===401||e.status===400?'Sign-in needs attention. Your plan stays here; sign out and sign back in.':e.message.includes('save_day_by_day_plan')?'The database sync step is not installed yet. Your plan stays here.':'Could not sync. Your plan stays here. '+e.message);
 }finally{busy=false;}
}
async function auth(create){
 if(!writer||authBusy)return;
 const email=el('accountEmail').value.trim(),password=el('accountPassword').value;
 if(!email||password.length<8){message('Enter your email and a password of at least 8 characters.');return;}
 if(create&&!confirm('Create a Day by Day account? Your email and password will be sent to this app’s Supabase project for sign-in.'))return;
 authBusy=true;message(create?'Creating your account…':'Signing in…');
 try{
  const data=await request(create?'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname):'/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  el('accountPassword').value='';
  if(!data.access_token){message('Check your email for a confirmation link, then return here and Sign in.');return;}
  session=data;generation++;write(SESSION,session);await openAccount();
 }catch(e){message(e.message);}finally{authBusy=false;}
}
async function openAccount(){
 const cached=read(cacheKey());
 record=cached||{state:fresh(),base:0,dirty:false,pending:null};
 try{applyPlan(record.state);}catch{message('Stored account plan could not be opened. Sign out and keep your backup.');return;}
 view();message('Checking your account…');await sync();
}
async function signOut(){
 if(!session||busy||authBusy)return;
 if(!confirm('Sign out on this device? Unsynced changes stay in this account’s local cache. Sign back in to resume.'))return;
 const old=session;session=null;generation++;record=null;conflict=null;localStorage.removeItem(SESSION);
 applyPlan(read(LOCAL)||fresh());view();message('Local mode. Account plans remain cached on this trusted device.');
 request('/auth/v1/logout?scope=local',{method:'POST',token:old.access_token}).catch(()=>{});
}
async function importLocal(){
 if(busy||!session)return;
 const p=read(LOCAL);if(!p)return;
 if(!confirm('Copy this device’s original local plan into your signed-in account? This sends its activities and notes to your private Supabase storage. It will replace the current account plan after any conflict is resolved.'))return;
 try{applyPlan(p);persist();await sync();}catch(e){message(e.message);}
}
async function resolve(keepLocal){
 if(busy||!session||!conflict)return;
 if(!confirm(keepLocal?'Use this device’s whole plan for the account? The other version stays in cloud history.':'Use the cloud plan? A recovery copy of this device’s plan will be saved locally first.'))return;
 const remote=conflict;
 try{
  write(`day-by-day-recovery:${session.user.id}:${Date.now()}`,record.state);
  if(keepLocal){record.base=remote.revision;record.pending=null;record.dirty=true;}
  else {record={state:valid(clone(remote.plan)),base:remote.revision,dirty:false,pending:null};applyPlan(record.state);}
  saveRecord();conflict=null;view();await sync();
 }catch(e){message('Could not resolve: '+e.message);}
}
importBackup=async function(e){const file=e.target.files?.[0];if(!file)return;try{const j=JSON.parse(await file.text());const p=valid(j.state||j);if(!confirm('Restore this backup over the displayed plan? If signed in, it will sync to your account.'))return;snapshot();state=clone(p);persist();render();}catch(err){alert('Could not restore: '+err.message);}finally{e.target.value='';}};
el('authForm').addEventListener('submit',e=>{e.preventDefault();auth(false);});
el('createAccount').onclick=()=>auth(true);
el('syncNow').onclick=sync;el('signOut').onclick=signOut;el('useLocal').onclick=importLocal;
el('keepDevice').onclick=()=>resolve(true);el('keepCloud').onclick=()=>resolve(false);
window.addEventListener('online',sync);window.addEventListener('focus',sync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
async function start(){
 writer=true;session=read(SESSION);view();
 if(session?.user?.id&&session.refresh_token){await openAccount();}else{session=null;view();message('Local mode. Sign in to sync, or keep using this device only.');}
 setInterval(()=>{if(!document.hidden)sync();},15000);
}
// One writing tab per device prevents local edits and refresh tokens racing.
if(navigator.locks){navigator.locks.request('day-by-day-writer-v2',{ifAvailable:true},async lock=>{
 if(!lock){document.querySelector('main').inert=true;el('otherTab').classList.remove('hidden');return;}
 await start();await new Promise(()=>{});
});}else{message('This browser does not support safe syncing. Use current Chrome.');document.querySelector('main').inert=true;}
})();
