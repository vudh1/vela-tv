#!/usr/bin/env node
'use strict';
// Run Vela's actual Home calendar utility functions against synthetic events.
// No private feed, browser session, Google connection or real notifications.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/app.js'),'utf8');
const start=source.indexOf('function calendarTime(ms,allDay){');
const end=source.indexOf('function updateCalendarView(){',start);
assert.ok(start>=0&&end>start,'calendar utility section present');
const fixed=new Date(2026,9,24,12,0,0).getTime();
class FakeDate extends Date {
  constructor(...args){super(...(args.length?args:[fixed]));}
  static now(){return fixed;}
}
const values={};
function element(id){
  if(!values[id]){
    const names=new Set();
    values[id]={
      textContent:'',
      attrs:{},
      setAttribute(k,v){this.attrs[k]=v;},
      classList:{
        add(k){names.add(k);},remove(k){names.delete(k);},contains(k){return names.has(k);}
      }
    };
  }
  return values[id];
}
let calls=[],cleared=[];
const context={
  Date:FakeDate,console,Math,Number,String,Object,
  document:{hidden:false},
  screen:'',profileId:'duong',calConnected:true,calVerified:true,calEvents:[],
  reminderTimer:null,remindedEvents:{},reminderWindowMs:15*60000,reminderVisibleMs:7000,
  $:element,
  setTimeout(fn,ms){calls.push({fn,ms});return calls.length;},
  clearTimeout(id){cleared.push(id);},
  esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');},
  row(act,title){return '<button data-act="'+act+'">'+title+'</button>';}
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context,{filename:'calendar.js'});
function event(offset,title,allDay=false){
  return {title,start:fixed+offset*60000,end:fixed+(offset+30)*60000,allDay};
}
context.calEvents=[
  event(7,'Reminder event'),
  event(12,'Another soon'),
  event(31,'Too distant'),
  event(5,'All-day',true),
  event(-45,'Already started')
];
const connected=context.calendarEventList();
assert.equal((connected.match(/data-act="eventInfo"/g)||[]).length,4, 'completed events are hidden; ongoing ones remain');
assert.ok(!connected.includes('data-act="calendarSettings"'), 'connected view does not expose settings');
assert.ok(connected.includes('focusable'), 'events are D-pad navigable');
context.calConnected=false;
assert.ok(context.calendarEventList().includes('data-act="calendarSettings"'), 'disconnected users can set up calendar');
context.calConnected=true;
context.calVerified=false;
context.maybeShowUpcomingReminder();
assert.equal(calls.length,0,'unverified feed cannot alert');
context.calVerified=true;
context.screen='settings';
context.maybeShowUpcomingReminder();
assert.equal(calls.length,0,'drawer prevents reminders');
context.screen='';
context.document.hidden=true;
context.maybeShowUpcomingReminder();
assert.equal(calls.length,0,'streaming app / hidden WebView prevents reminder');
context.document.hidden=false;
context.profileId='guest';
context.maybeShowUpcomingReminder();
assert.equal(calls.length,0,'guest cannot alert');
context.profileId='duong';
context.maybeShowUpcomingReminder();
assert.equal(calls.length,1,'nearest valid event alerts once');
assert.equal(calls[0].ms,7000);
assert.match(element('#reminderTitle').textContent,/Reminder event/);
assert.match(element('#reminderWhen').textContent,/STARTS IN 7 MIN/);
assert.ok(element('#eventReminder').classList.contains('visible'));
context.maybeShowUpcomingReminder();
assert.equal(calls.length,1,'no overlapping alerts');
calls[0].fn();
assert.ok(!element('#eventReminder').classList.contains('visible'));
context.maybeShowUpcomingReminder();
assert.equal(calls.length,2,'a distinct upcoming event can alert after the first ends');
assert.match(element('#reminderTitle').textContent,/Another soon/);
calls[1].fn();
context.maybeShowUpcomingReminder();
assert.equal(calls.length,2,'deduplicate alert per event per profile');
context.calEvents=[event(8,'<script>alert(1)</script>')];
assert.ok(context.calendarEventList().includes('&lt;script>'),'event titles are HTML escaped');
assert.ok(!context.calendarEventList().includes('<script>'),'event titles are never injected as markup');
console.log('PASS calendar viewer settings, navigable events, 15-minute reminder, 7-second dismissal, dedup, profile scoping, escaping');
