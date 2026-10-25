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
const settings=new Map(),vault=new Map(),updates=[],saved=[];
function memoryStorage(){return {getItem(k){return settings.get(k)||null;},setItem(k,v){settings.set(k,String(v));},removeItem(k){settings.delete(k);}};}
class MockXHR {
  open(verb,url){this.url=url;assert.equal(verb,'GET');}
  setRequestHeader(){}
  send(){setImmediate(()=>{this.readyState=4;this.status=200;this.responseURL=this.url;this.responseText=this.url.includes('ballerwatch')?sportICS:ics;this.onreadystatechange();});}
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
assert.equal(ctx.window.VelaCalendarSecurity.approved('http://calendar.google.com/calendar/ical/secret/basic.ics'),false);
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://evil.com/calendar/ical/secret/basic.ics'),false);
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://calendar.google.com.evil.com/calendar/ical/a.ics'),false);
const secret='https://calendar.google.com/calendar/ical/SECRET-ID/private-SECRET/basic.ics';
const baller='https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics?teams=sea&pickup=1&watch=all';
assert.ok(ctx.window.VelaCalendarSecurity.approved(secret));
assert.ok(ctx.window.VelaCalendarSecurity.approved(baller));
assert.equal(ctx.window.VelaCalendarSecurity.approved('https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics?leak=1'),false);
function spinUntil(predicate){return new Promise((resolve,reject)=>{
 let count=0;function next(){if(predicate())resolve();else if(++count>100)reject(Error('Calendar callback timeout'));else setTimeout(next,10);}next();
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
 console.log('PASS Samsung multi-source private ICS, event types/channel/field, recurrence, AES-GCM/KeyManager and independent removal');
})().catch(e=>{console.error(e);process.exitCode=1;});
