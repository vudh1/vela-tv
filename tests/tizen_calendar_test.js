#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
process.env.TZ='America/Los_Angeles';
const assets=path.resolve(__dirname,'../app/src/main/assets');
const ics=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:daily\r\nSUMMARY:Standup\r\nDTSTART;TZID=America/Los_Angeles:20261020T090000\r\nDTEND;TZID=America/Los_Angeles:20261020T093000\r\nRRULE:FREQ=DAILY;COUNT=8\r\nEXDATE;TZID=America/Los_Angeles:20261024T090000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:utc\r\nSUMMARY:UTC test\r\nDTSTART:20261025T173000Z\r\nDTEND:20261025T180000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:all\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const tomorrow=new Date(Date.now()+86400000),after=new Date(tomorrow.getTime()+5400000);
function zulu(date){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
const sportICS=`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:pickup@ballerwatch\r\nSUMMARY:Thursday pickup\r\nDTSTART:${zulu(tomorrow)}\r\nDTEND:${zulu(after)}\r\nLOCATION:Jefferson Park Playfield\r\nDESCRIPTION:Playing · BallerWatch\\nWear red\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:sounders@ballerwatch-watch\r\nSUMMARY:Sounders match\r\nDTSTART:${zulu(tomorrow)}\r\nDTEND:${zulu(after)}\r\nDESCRIPTION:Watching · professional sports\r\nX-VELA-CHANNEL:Drogon Sports HD\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const pickupCopy='BEGIN:VEVENT'+sportICS.split('BEGIN:VEVENT')[1];
const googleWithDuplicate=ics.replace('END:VCALENDAR',pickupCopy+'END:VCALENDAR');
const settings=new Map(),vault=new Map(),updates=[],saved=[];
let stableHttp=200,overlapGoogle=false;
function memoryStorage(){return {getItem(k){return settings.get(k)||null;},setItem(k,v){settings.set(k,String(v));},removeItem(k){settings.delete(k);}};}
class MockXHR {
  open(verb,url){this.url=url;assert.equal(verb,'GET');}
  setRequestHeader(){}
  send(){setImmediate(()=>{this.readyState=4;this.status=this.url.includes('/web/v1/calendar-ics/')?stableHttp:200;this.responseURL=this.url;this.responseText=this.url.includes('ballerwatch')?sportICS:(overlapGoogle?googleWithDuplicate:ics);this.onreadystatechange();});}
}
const qh={receiveCalendar(d){updates.push(d);},calendarSaveReady(...v){saved.push(v);}};
const ctx={
 window:{VelaPlatform:{kind:'tizen'},QuietTV:{},crypto:webcrypto,TextEncoder,TextDecoder,QH:qh},
 crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,Intl,URL,Promise,
 btoa(s){return Buffer.from(s,'binary').toString('base64');},
 atob(s){return Buffer.from(s,'base64').toString('binary');},
 localStorage:memoryStorage(),XMLHttpRequest:MockXHR,
 tizen:{keymanager:{getData({name}){return vault.get(name)||'';},saveData(name,value,password,onSuccess){assert.equal(password,null);vault.set(name,value);onSuccess();}}}
};
vm.createContext(ctx);
for(const file of ['tizen-calendar.js','tizen-private-calendar.js'])
 vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),ctx,{filename:file});
const calendar=ctx.window.VelaTizenCalendar;
const today=new Date('2026-10-25T15:00:00Z').getTime();
const events=calendar.parseToday(ics,today);
assert.equal(events.length,3,'daily recurrence, UTC time and all-day event');
assert.equal(events.find(x=>x.title==='Standup').start,new Date('2026-10-25T16:00:00Z').getTime());
assert.equal(events.find(x=>x.title==='UTC test').start,new Date('2026-10-25T17:30:00Z').getTime());
assert.equal(events.find(x=>x.title==='All day').allDay,true);
assert.equal(calendar.parseToday(ics,new Date('2026-10-24T16:00:00Z').getTime()).filter(x=>x.title==='Standup').length,0,'EXDATE excludes one occurrence');
assert.equal(calendar.parseToday(ics,new Date('2026-10-28T16:00:00Z').getTime()).filter(x=>x.title==='Standup').length,0,'COUNT prevents extra recurrences');
const sports=calendar.parseWindow(sportICS,Date.now(),7);
assert.equal(sports.length,2,'BallerWatch includes upcoming playing and watching fixtures');
assert.equal(sports.find(e=>e.kind==='play').location,'Jefferson Park Playfield');
assert.equal(sports.find(e=>e.kind==='watch').channel,'Drogon Sports HD');
assert.match(sports.find(e=>e.kind==='play').description,/Wear red/);
const fallIcs='BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:fall-dst\nSUMMARY:Fall game\nDTSTART;TZID=America/Los_Angeles:20261025T013000\nDTEND;TZID=America/Los_Angeles:20261025T023000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nBEGIN:VEVENT\nUID:cancelled\nSUMMARY:Cancelled game\nSTATUS:CANCELLED\nDTSTART:20261101T190000Z\nDTEND:20261101T210000Z\nEND:VEVENT\nEND:VCALENDAR';
const fallEvents=calendar.parseWindow(fallIcs,new Date('2026-10-25T12:00:00Z').getTime(),21);
assert.equal(fallEvents.length,3,'cancelled fixture suppressed across fall DST');
assert.deepEqual(Array.from(fallEvents,e=>e.start),[
 new Date('2026-10-25T08:30:00Z').getTime(),new Date('2026-11-01T08:30:00Z').getTime(),
 new Date('2026-11-08T09:30:00Z').getTime()],'source-local 1:30 AM honors fall offset change');
assert.equal(ctx.window.VelaCalendarSecurity.approved('http://calendar.google.com/calendar/ical/secret/basic.ics'),false);
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://evil.com/calendar/ical/secret/basic.ics'),false);
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://calendar.google.com.evil.com/calendar/ical/a.ics'),false);
const secret='https://calendar.google.com/calendar/ical/SECRET-ID/private-SECRET/basic.ics';
const baller='https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics?teams=sea&pickup=1&watch=all';
const stable='https://ballerwatch-web.vudhone.workers.dev/web/v1/calendar-ics/'+('x'.repeat(42))+'_.ics';
assert.ok(ctx.window.VelaCalendarSecurity.approved(secret));
assert.ok(ctx.window.VelaCalendarSecurity.approved(baller));
assert.ok(ctx.window.VelaCalendarSecurity.approved(stable),'Optional stable BallerWatch v1 read link is allowed');
assert.equal(ctx.window.VelaCalendarSecurity.approved(stable+'?token=another'),false);
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics?leak=1'),false);
function spinUntil(predicate){return new Promise((resolve,reject)=>{
 let count=0;function next(){if(predicate())resolve();else if(++count>100)reject(Error('Calendar callback timeout: '+updates.slice(-3).map(x=>x.profile+':'+x.status+':'+JSON.stringify(x.sources)).join(' | ')));else setTimeout(next,10);}next();
});}
(async()=>{
 ctx.window.QuietTV.saveCalendar('duong',secret,'Home');
 await spinUntil(()=>updates.some(v=>v.connected&&v.verified));
 assert.equal(saved.length,1);
 assert.equal(saved[0][1],true);
 ctx.window.QuietTV.saveCalendar('duong',baller,'BallerWatch');
 await spinUntil(()=>updates.some(v=>v.sources&&v.sources.length===2&&v.sources.every(s=>s.verified)));
 const both=updates.findLast(v=>v.sources&&v.sources.length===2&&v.sources.every(s=>s.verified));
 assert.equal(both.sources.length,2,'Google and BallerWatch are subscribed independently');
 assert.ok(both.events.some(e=>e.kind==='play'&&e.location==='Jefferson Park Playfield'));
 assert.ok(both.events.some(e=>e.kind==='watch'&&e.channel==='Drogon Sports HD'));
 assert.ok(vault.has('vela-calendar-aes-key-v1'));
 assert.ok(settings.size>=2,'URL and events are saved');
 for(const [k,v] of settings){assert.ok(!v.includes('SECRET-ID')&&!v.includes('ballerwatch-web'),'source URLs never saved in plaintext: '+k);}
 updates.length=0;
 ctx.window.QuietTV.loadCalendar('duong',false);
 await spinUntil(()=>updates.some(v=>v.connected&&v.verified&&v.sources&&v.sources.length===2));
 updates.length=0;
 ctx.window.QuietTV.removeCalendarSource('duong','sport');
 await spinUntil(()=>updates.some(v=>v.sources&&v.sources.length===1));
 assert.equal(updates.at(-1).sources[0].kind,'google','removing BallerWatch preserves Google');
 assert.ok(!settings.has('vela_private_calendar_secret_sport_duong'),'sport secret was deleted');
 ctx.window.QuietTV.removeCalendar('duong');
 assert.ok(!Array.from(settings.keys()).some(x=>x.includes('duong')),'disconnect clears encrypted local data');
 ctx.window.QuietTV.saveCalendar('guest',secret,'Home');
 assert.equal(saved.at(-1)[1],false,'Guest cannot save secrets');
 // A stable sports link is strictly per display profile and does not need the
 // still-disabled BallerWatch D1 service to stage consumer behavior.
 updates.length=0;
 ctx.window.QuietTV.saveCalendar('duong',secret,'Google');
 await spinUntil(()=>updates.some(v=>v.profile==='duong'&&v.sources?.some(s=>s.kind==='google'&&s.verified)));
 updates.length=0;
 ctx.window.QuietTV.saveCalendar('duong',stable,'BallerWatch stable');
 await spinUntil(()=>updates.some(v=>v.profile==='duong'&&v.sources?.length===2&&v.sources.every(s=>s.verified)));
 const previous=updates.at(-1).events.length;
 assert.ok(previous>=2,'Stable feed coexists with Google');
 overlapGoogle=true;updates.length=0;
 ctx.window.QuietTV.loadCalendar('duong',true);
 await spinUntil(()=>updates.some(v=>v.profile==='duong'&&v.sources?.length===2&&v.status==='Verified · updated just now'));
 assert.equal(updates.at(-1).events.filter(e=>e.uid==='pickup@ballerwatch').length,1,
  'Same UID and occurrence from Google plus BallerWatch is shown only once');
 overlapGoogle=false;
 // Temporary 503/quota outage retains encrypted last-good events.
 stableHttp=503;updates.length=0;
 ctx.window.QuietTV.loadCalendar('duong',true);
 await spinUntil(()=>updates.some(v=>v.profile==='duong'&&v.sources?.length===2&&v.status.includes('unavailable')));
 assert.ok(updates.at(-1).events.length>=previous,'Offline source retained last-good cache');
 // Definitive 404 from the stable read capability means rotate/delete: purge
 // sports secret and cached events, but keep Google and its existing data.
 stableHttp=404;updates.length=0;
 ctx.window.QuietTV.loadCalendar('duong',true);
 await spinUntil(()=>updates.some(v=>v.profile==='duong'&&v.status.includes('revoked')));
 assert.equal(updates.at(-1).sources.length,1);
 assert.equal(updates.at(-1).sources[0].kind,'google');
 assert.ok(!updates.at(-1).events.some(e=>e.uid==='pickup@ballerwatch'));
 assert.ok(!settings.has('vela_private_calendar_secret_sport_duong'));
 assert.ok(!settings.has('vela_private_calendar_cache_sport_duong'));
 stableHttp=200;updates.length=0;
 ctx.window.QuietTV.saveCalendar('tram',stable,'Private sports');
 await spinUntil(()=>updates.some(v=>v.profile==='tram'&&v.sources?.some(s=>s.kind==='sport'&&s.verified)));
 assert.ok(!updates.at(-1).events.some(e=>e.title==='Standup'),'Other profile Google events never leak into Tram');
 assert.ok(settings.has('vela_private_calendar_secret_google_duong'),'Tram sports changes do not alter Duong Google');
 assert.ok(!settings.has('vela_private_calendar_secret_google_tram'));
 console.log('PASS Samsung multi-source private ICS, event types/channel/field, recurrence, AES-GCM/KeyManager and independent removal');
 console.log('PASS staged stable profile ICS, revocation purge, temporary-offline cache and cross-profile isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
