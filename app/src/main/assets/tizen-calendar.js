/* Shared read-only iCalendar reader for Samsung Tizen; no third-party parser or secrets. */
(function(root){
'use strict';
function icsDate(prop,displayDate){
 if(!prop)return null;
 var value=prop.value||'',a=prop.attrs||'';
 var match=/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?)?(Z)?$/.exec(value.trim());
 if(!match)return null;
 var y=+match[1],m=+match[2]-1,d=+match[3],hh=+(match[4]||0),mm=+(match[5]||0),ss=+(match[6]||0);
 var allDay=!match[4]||/VALUE=DATE(?:;|$)/i.test(a);
 var timestamp=match[7]?Date.UTC(y,m,d,hh,mm,ss):new Date(y,m,d,hh,mm,ss).getTime();
 var tzMatch=/TZID="?([^";]+)"?/i.exec(a);
 if(!match[7]&&tzMatch&&typeof Intl!=='undefined'&&Intl.DateTimeFormat) {
  try {
   // Convert the requested wall clock time in the feed's zone to an instant.
   var formatter=new Intl.DateTimeFormat('en-US',{timeZone:tzMatch[1],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
   var goal=Date.UTC(y,m,d,hh,mm,ss),instant=goal;
   for(var attempt=0;attempt<3;attempt++){
    var p=formatter.formatToParts(new Date(instant)),fields={};
    p.forEach(function(v){fields[v.type]=v.value;});
    var observed=Date.UTC(+fields.year,+fields.month-1,+fields.day,(+fields.hour)%24,+fields.minute,+fields.second);
    instant+=goal-observed;
   }
   timestamp=instant;
  }catch(e){} // Invalid TZID: use the TV's timezone, as for floating ICS dates.
 }
 return {ms:timestamp,allDay:allDay,utc:!!match[7],local:{y:y,m:m,d:d,hh:hh,mm:mm,ss:ss},attrs:a};
}
function rule(text){var result={};(text||'').split(';').forEach(function(v){var at=v.indexOf('=');if(at>0)result[v.slice(0,at).toUpperCase()]=v.slice(at+1).toUpperCase();});return result;}
function serial(y,m,d){return Math.floor(Date.UTC(y,m,d)/86400000);}
function dayCode(y,m,d){return ['SU','MO','TU','WE','TH','FR','SA'][new Date(Date.UTC(y,m,d)).getUTCDay()];}
function occurrenceMatches(original,candidate,r){
 var a=original,b=candidate,dist=serial(b.y,b.m,b.d)-serial(a.y,a.m,a.d);
 if(dist<0)return false;
 var interval=Math.max(1,Math.min(10000,Number(r.INTERVAL)||1));
 function contains(csv,x){return !!csv&&csv.split(',').indexOf(String(x))>=0;}
 if(r.FREQ==='DAILY')return dist%interval===0&&(!r.BYDAY||contains(r.BYDAY,dayCode(b.y,b.m,b.d)));
 if(r.FREQ==='WEEKLY'){
  var aMon=serial(a.y,a.m,a.d)-(new Date(Date.UTC(a.y,a.m,a.d)).getUTCDay()+6)%7;
  var bMon=serial(b.y,b.m,b.d)-(new Date(Date.UTC(b.y,b.m,b.d)).getUTCDay()+6)%7;
  return Math.floor((bMon-aMon)/7)%interval===0&&(r.BYDAY?contains(r.BYDAY,dayCode(b.y,b.m,b.d)):dayCode(a.y,a.m,a.d)===dayCode(b.y,b.m,b.d));
 }
 if(r.FREQ==='MONTHLY')return ((b.y-a.y)*12+b.m-a.m)%interval===0&&(r.BYMONTHDAY?contains(r.BYMONTHDAY,b.d):a.d===b.d)&&(!r.BYDAY||contains(r.BYDAY,dayCode(b.y,b.m,b.d)));
 if(r.FREQ==='YEARLY')return (b.y-a.y)%interval===0&&(r.BYMONTH?contains(r.BYMONTH,b.m+1):a.m===b.m)&&(r.BYMONTHDAY?contains(r.BYMONTHDAY,b.d):a.d===b.d);
 return false;
}
function eventItems(ics){
 if(typeof ics!=='string'||ics.length>2000000||!/(?:^|\n)BEGIN:VCALENDAR/i.test(ics))throw Error('Invalid iCalendar');
 var lines=ics.replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'').split('\n');
 var entries=[],item=null;
 for(var i=0;i<lines.length&&i<30000;i++){
  var line=lines[i];
  if(line.toUpperCase()==='BEGIN:VEVENT'){item={};continue;}
  if(line.toUpperCase()==='END:VEVENT'){if(item&&entries.length<5000)entries.push(item);item=null;continue;}
  if(!item)continue;
  var colon=line.indexOf(':');if(colon<1)continue;
  var head=line.slice(0,colon),key=head.split(';')[0].toUpperCase(),p={attrs:head,value:line.slice(colon+1)};
  if(!item[key])item[key]=[];item[key].push(p);
 }
 return entries;
}
function first(item,key){return item[key]&&item[key][0]||null;}
function value(item,key){var v=first(item,key);return v?v.value:'';}
function parseToday(ics,now) {
 var time=Number(now)||Date.now(),day=new Date(time),start=new Date(day.getFullYear(),day.getMonth(),day.getDate()).getTime(),end=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1).getTime();
 var entries=eventItems(ics),overrides={},events=[];
 entries.forEach(function(item){var rid=icsDate(first(item,'RECURRENCE-ID'));if(rid)overrides[value(item,'UID')+'|'+rid.ms]=true;});
 entries.forEach(function(item){
  if(value(item,'STATUS').toUpperCase()==='CANCELLED')return;
  var origin=icsDate(first(item,'DTSTART'));if(!origin)return;
  var final=icsDate(first(item,'DTEND'));
  var duration=final?final.ms-origin.ms:(origin.allDay?86400000:3600000);
  if(duration<=0||duration>7*86400000)duration=origin.allDay?86400000:3600000;
  var r=rule(value(item,'RRULE')),override=!!first(item,'RECURRENCE-ID');
  var title=value(item,'SUMMARY').replace(/\\[nN]/g,' ').replace(/\\([,;\\])/g,'$1').replace(/[\r\n]/g,' ').trim().slice(0,120)||'Untitled event';
  // Day candidates include overnight events beginning on the previous days.
  var candidateStart=new Date(start-duration-86400000);
  var candidateEnd=new Date(end+86400000);
  for(var dt=new Date(candidateStart.getFullYear(),candidateStart.getMonth(),candidateStart.getDate());dt<=candidateEnd;dt.setDate(dt.getDate()+1)){
   var b={y:dt.getFullYear(),m:dt.getMonth(),d:dt.getDate()};
   var candidateRule=Object.keys(r).length&&!override;
   if(candidateRule&&!occurrenceMatches(origin.local,b,r))continue;
   if(!candidateRule&&(b.y!==origin.local.y||b.m!==origin.local.m||b.d!==origin.local.d))continue;
   var candidate=icsDate({value:String(b.y)+('0'+(b.m+1)).slice(-2)+('0'+b.d).slice(-2)+'T'+('0'+origin.local.hh).slice(-2)+('0'+origin.local.mm).slice(-2)+('0'+origin.local.ss).slice(-2)+(origin.utc?'Z':''),attrs:origin.attrs});
   if(!candidate)continue;
   var st=candidate.ms,en=st+duration;
   if(st>=end||en<=start)continue;
   if(candidateRule&&r.UNTIL){var until=icsDate({value:r.UNTIL,attrs:origin.attrs});if(until&&st>until.ms)continue;}
   if(candidateRule&&r.COUNT){
    var cap=Math.min(20000,serial(b.y,b.m,b.d)-serial(origin.local.y,origin.local.m,origin.local.d));
    var count=0;
    for(var n=0;n<=cap;n++){
     var x=new Date(Date.UTC(origin.local.y,origin.local.m,origin.local.d+n));
     if(occurrenceMatches(origin.local,{y:x.getUTCFullYear(),m:x.getUTCMonth(),d:x.getUTCDate()},r))count++;
     if(count>+r.COUNT)break;
    }
    if(count>+r.COUNT)continue;
   }
   if(!override&&overrides[value(item,'UID')+'|'+st])continue;
   var except=item.EXDATE||[],excluded=false;
   except.forEach(function(ex){
    ex.value.split(',').forEach(function(raw){
     var xd=icsDate({value:raw,attrs:ex.attrs});if(xd&&(xd.allDay?b.y===xd.local.y&&b.m===xd.local.m&&b.d===xd.local.d:Math.abs(xd.ms-st)<60000))excluded=true;
    });
   });
   if(excluded)continue;
   events.push({title:title,start:st,end:en,allDay:origin.allDay});
  }
 });
 events.sort(function(a,b){return a.start-b.start;});
 return events.slice(0,60);
}
root.VelaTizenCalendar={parseToday:parseToday};
})(window);
