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
      textContent:'',innerHTML:'',
      attrs:{},
      setAttribute(k,v){this.attrs[k]=v;},
      classList:{
        add(k){names.add(k);},remove(k){names.delete(k);},contains(k){return names.has(k);},
        toggle(k,on){if(on===undefined?!names.has(k):on)names.add(k);else names.delete(k);}
      }
    };
  }
  return values[id];
}
let calls=[],cleared=[];
const context={
  Date:FakeDate,console,Math,Number,String,Object,
  document:{hidden:false},
  screen:'',profileId:'duong',calConnected:true,calVerified:true,calEvents:[],calendarFilter:'all',calendarViewEvents:[],
  reminderTimer:null,remindedEvents:{},reminderWindowMs:15*60000,reminderVisibleMs:7000,
  $:element,
  setTimeout(fn,ms){calls.push({fn,ms});return calls.length;},
  clearTimeout(id){cleared.push(id);},
  esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');},
  row(act,title){return '<button data-act="'+act+'">'+title+'</button>';}
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context,{filename:'calendar.js'});
const receiveStart=source.indexOf('function receiveCalendar(json){',end);
const receiveEnd=source.indexOf('function calendarSaveReady(',receiveStart);
assert.ok(receiveStart>end&&receiveEnd>receiveStart,'calendar display and profile receive handlers present');
vm.runInContext(source.slice(end,receiveEnd),context,{filename:'calendar-view.js'});
const detailsStart=source.indexOf('function eventKey(e){');
const detailsEnd=source.indexOf('function recentApps(){',detailsStart);
assert.ok(detailsStart>0&&detailsEnd>detailsStart,'event details functions present');
context.currentProfile=()=>context.profile;
context.persistProfiles=()=>{};
context.renderPanel=()=>{};
context.toast=()=>{};
context.profile={channels:{}};
vm.runInContext(source.slice(detailsStart,detailsEnd),context,{filename:'event-details.js'});
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
assert.ok(connected.includes('data-act="filterCalendar"'),'category filters are keyboard navigable');
assert.ok(connected.includes('Oct 24'),'events show a date even on the current day');
context.calEvents=[event(14*24*60,'Game in two weeks'),event(35*24*60,'Game in five weeks')];
const monthView=context.calendarEventList();
assert.ok(monthView.includes('Game in two weeks'),'fixtures beyond the old seven-day window appear');
assert.ok(!monthView.includes('Game in five weeks'),'calendar list remains bounded to one calendar month');
context.calEvents=[event(20,'Today'),event(24*60+20,'Tomorrow'),event(48*60+20,'Monday'),
  event(30*24*60,'Still this month'),event(32*24*60,'Outside the month')];
const divided=context.calendarEventList();
assert.match(divided,/event-day-divider[^>]*>.*Today/,'Today events have a quiet date heading');
assert.ok(divided.includes('Tomorrow</span>'),'Tomorrow has its own section');
assert.ok(divided.includes('Still this month')&&!divided.includes('Outside the month'),'one-month TV list bound');
assert.equal((divided.match(/class="event-day-divider"/g)||[]).length,4,'one divider for each day with events');
const playing={...event(40,'Pickup football'),kind:'play',uid:'play-1',location:'Jefferson Park Playfield',description:'RSVP to play'};
const watching={...event(60,'Sounders match'),kind:'watch',uid:'watch-1',description:'Watching · professional sports'};
const other={...event(90,'Family birthday'),kind:'other',uid:'other-1',description:'Bring cake'};
context.calEvents=[playing,watching,other];
const ongoing={...event(-20,'Match in progress'),uid:'ongoing',end:fixed+40*60000};
const nextMatch={...event(35,'Match next'),uid:'next'};
context.calEvents=[nextMatch,ongoing,playing];
context.updateCalendarView();
const preview=element('#calendarPeek').innerHTML;
assert.match(preview,/NOW \/ NEXT/,'Home offers a concise Now/Next grouping');
assert.ok(preview.indexOf('Match in progress')<preview.indexOf('Match next'),
  'ongoing sport comes before the next match even when provider order is unsorted');
assert.ok(!preview.includes('Jefferson Park Playfield'),'Home never exposes event private details');
context.calEvents=[playing,watching,other];
context.calendarFilter='play';
const playList=context.calendarEventList();
assert.ok(playList.includes('Pickup football')&&!playList.includes('Sounders match'),'play tab isolates playing events');
assert.ok(!playList.includes('Jefferson Park Playfield'),'the calendar listing hides field details');
context.calendarFilter='watch';
const watchList=context.calendarEventList();
assert.ok(watchList.includes('Sounders match')&&!watchList.includes('Family birthday'),'watch tab isolates watched fixtures');
assert.ok(!watchList.includes('professional sports'),'the calendar listing hides descriptions');
context.calendarFilter='other';
assert.ok(context.calendarEventList().includes('data-id="other">Life</button>'),'non-sports events use the Life label');
assert.ok(context.calendarEventList().includes('Family birthday'),'Life tab includes non-sports events');
context.selectedEvent=playing;
assert.ok(context.eventDetailsBody().includes('Jefferson Park Playfield'),'playing detail shows the field');
assert.ok(context.eventDetailsBody().includes('RSVP to play'),'playing detail shows notes');
context.selectedEvent=watching;
assert.ok(context.eventDetailsBody().includes('Assign Drogon TV channel'),'watched detail offers channel assignment');
assert.ok(context.eventDetailsBody().includes('Open Perfect Player'),'watched detail opens IPTV player');
context.watchChannelReady(context.eventKey(watching),'Drogon Sports HD');
assert.ok(context.eventDetailsBody().includes('Drogon Sports HD'),'saved channel appears in watched detail');
context.selectedEvent=other;
assert.ok(context.eventDetailsBody().includes('Bring cake'),'other detail shows freeform context');
assert.ok(!context.eventDetailsBody().includes('Perfect Player'),'other event does not show IPTV actions');
context.calEvents=[];
context.receiveCalendar({profile:'tram',connected:true,verified:true,events:[playing]});
assert.equal(context.calEvents.length,0,'another TV profile cannot inject its events');
context.profileId='guest';
context.receiveCalendar({profile:'duong',connected:true,verified:true,events:[playing]});
assert.equal(context.calEvents.length,0,'Guest never inherits a saved profile payload');
context.profileId='duong';
context.calEvents=[
  event(7,'Reminder event'),
  event(12,'Another soon'),
  event(31,'Too distant'),
  event(5,'All-day',true),
  event(-45,'Already started')
];
context.calendarFilter='all';
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
console.log('PASS calendar date, categories, private event details, saved TV channels, reminders, profile scoping and escaping');
