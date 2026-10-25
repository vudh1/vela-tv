/* Samsung-only private, read-only iCalendar. No cloud proxy or plaintext persistence. */
(function(){
'use strict';
if(!window.VelaPlatform||window.VelaPlatform.kind!=='tizen'||!window.QuietTV)return;
var bridge=window.QuietTV,MASTER='vela-calendar-aes-key-v1',TTL=15*60000,keyPromise=null,inflight={},revision={};
function validProfile(p){return typeof p==='string'&&/^[A-Za-z0-9_-]{1,48}$/.test(p)&&p!=='guest';}
function approved(url){
 try{
  if(typeof url!=='string'||url.length>4096)return false;
  var u=new URL(url.trim());
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)return false;
  var google=u.hostname.toLowerCase()==='calendar.google.com'&&u.pathname.indexOf('/calendar/ical/')===0&&/\.ics$/i.test(u.pathname);
  var bw=u.hostname.toLowerCase()==='ballerwatch-web.vudhone.workers.dev'&&u.pathname==='/web/calendar.ics';
  if(bw)u.searchParams.forEach(function(v,k){if(['teams','pickup','watch'].indexOf(k)<0)bw=false;});
  return google||bw;
 }catch(e){return false;}
}
function bytesTo64(b){var s='';for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function from64(s){var t=atob(s),out=new Uint8Array(t.length);for(var i=0;i<t.length;i++)out[i]=t.charCodeAt(i);return out;}
function cryptoReady(){return !!(window.crypto&&crypto.subtle&&crypto.getRandomValues&&window.TextEncoder&&window.TextDecoder&&tizen.keymanager);}
function masterKey(){
 if(keyPromise)return keyPromise;
 keyPromise=new Promise(function(resolve,reject){
  if(!cryptoReady()){reject(new Error('Samsung secure storage is unavailable'));return;}
  try{
   var value;
   try{value=tizen.keymanager.getData({name:MASTER});}catch(e){value='';}
   if(value){resolve(from64(value));return;}
   var bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
   tizen.keymanager.saveData(MASTER,bytesTo64(bytes),null,function(){resolve(bytes);},function(){reject(new Error('Could not create protected calendar key'));});
  }catch(e){reject(new Error('Samsung secure storage failed'));}
 }).then(function(bytes){return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);});
 // A transient failure should be retryable after system services become ready.
 keyPromise.catch(function(){keyPromise=null;});
 return keyPromise;
}
function seal(value){
 return masterKey().then(function(key){
  var iv=new Uint8Array(12);crypto.getRandomValues(iv);
  return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(value))).then(function(data){
   return bytesTo64(iv)+'.'+bytesTo64(new Uint8Array(data));
  });
 });
}
function open(text){
 if(!text)return Promise.resolve(null);
 return masterKey().then(function(key){
  var parts=text.split('.');if(parts.length!==2)throw new Error('Invalid encrypted calendar data');
  return crypto.subtle.decrypt({name:'AES-GCM',iv:from64(parts[0])},key,from64(parts[1])).then(function(data){
   return JSON.parse(new TextDecoder('utf-8').decode(data));
  });
 });
}
function key(profile,suffix){return 'vela_private_calendar_'+suffix+'_'+profile;}
function cached(profile){return open(localStorage.getItem(key(profile,'cache')));}
function status(profile,connected,verified,events,detail,more){
 var data={profile:profile,connected:connected,verified:verified,events:events||[],status:detail||'',lastAttempt:Date.now()};
 if(more){data.label=more.label||'';data.lastSuccess=more.success||0;data.calendarName='Private calendar';}
 if(window.QH&&window.QH.receiveCalendar)window.QH.receiveCalendar(data);
}
function failure(profile,message){if(window.QH&&window.QH.calendarSaveReady)window.QH.calendarSaveReady(profile,false,message);}
function success(profile){if(window.QH&&window.QH.calendarSaveReady)window.QH.calendarSaveReady(profile,true,'Calendar link protected on this TV');}
function download(url){
 return new Promise(function(resolve,reject){
  if(!approved(url)){reject(new Error('Unsupported calendar address'));return;}
  var req=new XMLHttpRequest(),finished=false;
  function done(err,result){if(finished)return;finished=true;if(err)reject(err);else resolve(result);}
  req.open('GET',url,true);req.timeout=16000;
  req.setRequestHeader('Accept','text/calendar,text/plain');
  req.onreadystatechange=function(){if(req.readyState!==4)return;
   if(req.status!==200){done(new Error('Calendar could not be reached (HTTP '+req.status+')'));return;}
   // Browsers follow redirects; reject unexpected destinations after completion.
   if(req.responseURL&&!approved(req.responseURL)){done(new Error('Calendar redirected to an unapproved host'));return;}
   var body=req.responseText||'';if(body.length>2000000){done(new Error('Calendar feed is too large'));return;}
   done(null,body);
  };
  req.onerror=function(){done(new Error('Network/CORS blocked calendar access'));};
  req.ontimeout=function(){done(new Error('Calendar request timed out'));};
  try{req.send();}catch(e){done(new Error('Calendar HTTPS request failed'));}
 });
}
function load(profile,force){
 if(!validProfile(profile))return;
 if(inflight[profile]&&!force)return;
 var version=revision[profile]||0;
 open(localStorage.getItem(key(profile,'secret'))).then(function(record){
  if(version!==(revision[profile]||0))return;
  if(!record||!approved(record.url)){status(profile,false,false,[],'No calendar saved');return;}
  return cached(profile).catch(function(){return null;}).then(function(cache){
   if(version!==(revision[profile]||0))return;
   var today=new Date().toDateString(),todayCache=cache&&cache.day===today&&cache.success>0;
   status(profile,true,!!todayCache,todayCache?cache.events:[],todayCache?'Verified feed · locally encrypted cache':'Checking calendar…',
    {label:record.label,success:todayCache?cache.success:0});
   if(!force&&todayCache&&Date.now()-cache.checked<TTL)return;
   if(inflight[profile])return;
   var job={version:version};inflight[profile]=job;
   return download(record.url).then(function(body){
    if(version!==(revision[profile]||0))return;
    var events=window.VelaTizenCalendar.parseToday(body,Date.now()),stamp=Date.now();
    return seal({day:today,checked:stamp,success:stamp,events:events}).then(function(encrypted){
     if(version!==(revision[profile]||0))return;
     localStorage.setItem(key(profile,'cache'),encrypted);
     status(profile,true,true,events,events.length?'Verified · updated just now':'Verified · no events today',{label:record.label,success:stamp});
    });
   }).catch(function(){
    if(version!==(revision[profile]||0))return;
    status(profile,true,!!todayCache,todayCache?cache.events:[],
      todayCache?'Refresh failed · showing verified cache':'Could not verify private feed · check link and connection',
      {label:record.label,success:todayCache?cache.success:0});
   }).then(function(){if(inflight[profile]===job)delete inflight[profile];});
  });
 }).catch(function(){if(version===(revision[profile]||0))status(profile,false,false,[],'Secure calendar storage unavailable');});
}
bridge.loadCalendar=load;
bridge.saveCalendar=function(profile,url,label){
 if(!validProfile(profile)||!approved(url)){failure(profile,'Enter an approved Google or BallerWatch HTTPS iCal URL');return;}
 var version=revision[profile]=(revision[profile]||0)+1;
 delete inflight[profile];
 // Commit only after encryption succeeds. Old link is unchanged on any failure.
 seal({url:url.trim(),label:String(label||'Private calendar').slice(0,80)}).then(function(value){
  if(version!==revision[profile])return;
  localStorage.setItem(key(profile,'secret'),value);
  localStorage.removeItem(key(profile,'cache'));
  success(profile);load(profile,true);
 }).catch(function(){if(version===revision[profile])failure(profile,'Samsung KeyManager or encrypted storage unavailable');});
};
bridge.removeCalendar=function(profile){
 if(!validProfile(profile))return;
 revision[profile]=(revision[profile]||0)+1;
 delete inflight[profile];
 localStorage.removeItem(key(profile,'secret'));
 localStorage.removeItem(key(profile,'cache'));
 status(profile,false,false,[],'Disconnected');
};
window.VelaCalendarSecurity={approved:approved}; // Validation only; never exposes secrets.
})();
