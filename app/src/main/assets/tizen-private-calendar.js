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
  var stable=u.hostname.toLowerCase()==='ballerwatch-web.vudhone.workers.dev'&&
   /^\/web\/v1\/calendar-ics\/[A-Za-z0-9_-]{43}\.ics$/.test(u.pathname)&&!u.search;
  var bw=u.hostname.toLowerCase()==='ballerwatch-web.vudhone.workers.dev'&&u.pathname==='/web/calendar.ics';
  if(bw)u.searchParams.forEach(function(v,k){if(['teams','pickup','watch'].indexOf(k)<0)bw=false;});
  return google||bw||stable;
 }catch(e){return false;}
}
function stableProfileLink(url){
 try{var u=new URL(url);return u.hostname.toLowerCase()==='ballerwatch-web.vudhone.workers.dev'&&
  /^\/web\/v1\/calendar-ics\/[A-Za-z0-9_-]{43}\.ics$/.test(u.pathname)&&!u.search;}
 catch(e){return false;}
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
function sourceOf(url){try{return new URL(url).hostname.toLowerCase()==='ballerwatch-web.vudhone.workers.dev'?'sport':'google';}catch(e){return 'google';}}
function records(profile){
 return Promise.all(['google','sport','legacy'].map(function(type){
  return open(localStorage.getItem(key(profile,type==='legacy'?'secret':'secret_'+type))).catch(function(){return null;});
 })).then(function(list){
  var found=[];
  ['google','sport'].forEach(function(type,i){
   var item=list[i]&&approved(list[i].url)?list[i]:null;
   if(!item&&list[2]&&approved(list[2].url)&&sourceOf(list[2].url)===type)item=list[2];
   if(item)found.push({kind:type,url:item.url,label:item.label||'',legacy:item===list[2]});
  });return found;
 });
}
function cached(profile,source){return open(localStorage.getItem(key(profile,'cache_'+source))).catch(function(){return null;});}
function status(profile,connected,verified,events,detail,more){
 var data={profile:profile,connected:connected,verified:verified,events:events||[],status:detail||'',lastAttempt:Date.now()};
 if(more){data.label=more.label||'';data.lastSuccess=more.success||0;data.calendarName='Private calendar';data.sources=more.sources||[];}
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
   if(req.status!==200){var error=new Error('Calendar source unavailable');error.httpStatus=req.status;done(error);return;}
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
 function publish(sets,label){
  if(version!==(revision[profile]||0))return;
  var all=[],seen={},verified=0,last=0,sources=[];
  sets.forEach(function(x){
   sources.push({kind:x.kind,verified:!!x.verified});
   if(x.verified){verified++;last=Math.max(last,x.success||0);}
   (x.events||[]).forEach(function(e){var id=String(e.uid||e.title)+'/'+e.start;if(!seen[id]){seen[id]=true;all.push(e);}});
  });
  all.sort(function(a,b){return a.start-b.start;});all=all.slice(0,150);
  status(profile,true,verified>0,all,label,{label:sets.map(function(x){return x.kind==='sport'?'BallerWatch':'Google';}).join(' + '),success:last,sources:sources});
 }
 records(profile).then(function(links){
  if(version!==(revision[profile]||0))return;
  if(!links.length){status(profile,false,false,[],'No calendar saved',{sources:[]});return;}
  return Promise.all(links.map(function(link){
   return cached(profile,link.kind).then(function(cache){
    var valid=cache&&cache.day===new Date().toDateString()&&cache.success>0;
    return {kind:link.kind,url:link.url,events:valid?cache.events:[],verified:!!valid,
      checked:valid?cache.checked:0,success:valid?cache.success:0};
   });
  })).then(function(sets){
   if(version!==(revision[profile]||0))return;
   publish(sets,'Reading saved calendar events…');
   if(!force&&sets.every(function(x){return x.verified&&Date.now()-x.checked<TTL;}))return;
   if(inflight[profile])return;
   var job={version:version};inflight[profile]=job;
   return Promise.all(sets.map(function(x){
    if(!force&&x.verified&&Date.now()-x.checked<TTL)return Promise.resolve(x);
    return download(x.url).then(function(body){
     if(version!==(revision[profile]||0))return x;
     var events=window.VelaTizenCalendar.parseWindow(body,Date.now(),60),stamp=Date.now();
     return seal({day:new Date().toDateString(),checked:stamp,success:stamp,events:events}).then(function(encrypted){
      if(version!==(revision[profile]||0))return x;
      localStorage.setItem(key(profile,'cache_'+x.kind),encrypted);
      return {kind:x.kind,events:events,verified:true,success:stamp,checked:stamp};
     });
    }).catch(function(error){
     if(version===(revision[profile]||0)&&x.kind==='sport'&&stableProfileLink(x.url)&&
       error&&(error.httpStatus===404||error.httpStatus===410)){
      // A deleted/rotated token must not be resurrected from offline cache.
      // Other profiles and the independent Google source are untouched.
      localStorage.removeItem(key(profile,'secret_sport'));
      localStorage.removeItem(key(profile,'cache_sport'));
      return {kind:'sport',revoked:true,events:[],verified:false};
     }
     return Object.assign({},x,{refreshFailed:true});
    });
   })).then(function(next){
    var remaining=next.filter(function(x){return !x.revoked;});
    if(!remaining.length){status(profile,false,false,[],'BallerWatch link revoked · reconnect this source',{sources:[]});return;}
    publish(remaining,next.some(function(x){return x.revoked;})?'BallerWatch link revoked · reconnect this source':
     remaining.some(function(x){return x.refreshFailed;})?'Refresh unavailable · showing last verified calendar':
     remaining.every(function(x){return x.verified;})?'Verified · updated just now':
     remaining.some(function(x){return x.verified;})?'Some sources unavailable · verified cache':'Calendar sources unverified');
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
  var source=sourceOf(url);
  localStorage.setItem(key(profile,'secret_'+source),value);
  localStorage.removeItem(key(profile,'cache_'+source));
  return open(localStorage.getItem(key(profile,'secret'))).catch(function(){return null;}).then(function(old){
   if(version!==revision[profile])return;
   if(old&&sourceOf(old.url)===source){localStorage.removeItem(key(profile,'secret'));localStorage.removeItem(key(profile,'cache'));}
   success(profile);load(profile,true);
  });
 }).catch(function(){if(version===revision[profile])failure(profile,'Samsung KeyManager or encrypted storage unavailable');});
};
bridge.removeCalendarSource=function(profile,source){
 if(!validProfile(profile)||['google','sport'].indexOf(source)<0)return;
 var version=revision[profile]=(revision[profile]||0)+1;delete inflight[profile];
 localStorage.removeItem(key(profile,'secret_'+source));localStorage.removeItem(key(profile,'cache_'+source));
 open(localStorage.getItem(key(profile,'secret'))).catch(function(){return null;}).then(function(old){
  if(version!==revision[profile])return;
  if(old&&sourceOf(old.url)===source){localStorage.removeItem(key(profile,'secret'));localStorage.removeItem(key(profile,'cache'));}
  load(profile,true);
 });
};
bridge.removeCalendar=function(profile){
 if(!validProfile(profile))return;
 revision[profile]=(revision[profile]||0)+1;
 delete inflight[profile];
 localStorage.removeItem(key(profile,'secret'));
 localStorage.removeItem(key(profile,'cache'));
 ['google','sport'].forEach(function(source){localStorage.removeItem(key(profile,'secret_'+source));localStorage.removeItem(key(profile,'cache_'+source));});
 status(profile,false,false,[],'Disconnected');
};
window.VelaCalendarSecurity={approved:approved}; // Validation only; never exposes secrets.
})();
