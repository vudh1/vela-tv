package com.danielvu.quiethome;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

/** Lightweight, read-only iCalendar feed reader; never evaluates embedded HTML/scripts.
 * Supports DTSTART/DTEND, VALUE=DATE, TZID/UTC, EXDATE, RECURRENCE-ID, daily/weekly/monthly/yearly
 * RRULE with INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, UNTIL, COUNT. Complex BYSETPOS/RDATE are not supported.
 */
final class CalendarIcs {
    static final class Event {
        final String title; final long start, end; final boolean allDay;
        Event(String t,long s,long e,boolean d){title=t;start=s;end=e;allDay=d;}
    }
    private static final class Prop {
        String value, attrs;
        Prop(String a,String v){attrs=a;value=v;}
    }
    private static final class Item {
        Map<String, List<Prop>> data=new HashMap<>();
        Prop first(String key){List<Prop> l=data.get(key);return l==null||l.isEmpty()?null:l.get(0);}
        String val(String key){Prop p=first(key);return p==null?"":p.value;}
    }
    private static final class When {
        final ZonedDateTime dt;final boolean allDay;
        When(ZonedDateTime d,boolean a){dt=d;allDay=a;}
    }
    private static ZoneId zone(Prop p,ZoneId def){
        if(p==null)return def;
        for(String a:p.attrs.split(";"))if(a.toUpperCase(Locale.ROOT).startsWith("TZID=")){
            String raw=a.substring(5).replace("\"","");
            try{return ZoneId.of(raw);}catch(Exception ignored){}
        }
        return def;
    }
    private static When date(Prop p,ZoneId home){
        if(p==null||p.value==null)return null;
        String v=p.value.trim();if(v.isEmpty())return null;
        try{
            boolean allDay=v.length()==8||p.attrs.toUpperCase(Locale.ROOT).contains("VALUE=DATE");
            ZoneId z=v.endsWith("Z")?ZoneOffset.UTC:zone(p,home);
            int year=Integer.parseInt(v.substring(0,4)),month=Integer.parseInt(v.substring(4,6)),day=Integer.parseInt(v.substring(6,8));
            LocalDate d=LocalDate.of(year,month,day);
            LocalTime t=LocalTime.MIDNIGHT;
            if(!allDay&&v.length()>=13){int hh=Integer.parseInt(v.substring(9,11)),mm=Integer.parseInt(v.substring(11,13)),ss=v.length()>=15?Integer.parseInt(v.substring(13,15)):0;t=LocalTime.of(hh,mm,ss);}
            return new When(ZonedDateTime.of(d,t,z),allDay);
        }catch(Exception ignored){return null;}
    }
    private static String unescape(String v){return v.replace("\\n","\n").replace("\\N","\n").replace("\\,",",").replace("\\;",";").replace("\\\\","\\").trim();}
    private static Map<String,String> rule(String v){Map<String,String> m=new HashMap<>();for(String part:v.split(";")){int x=part.indexOf('=');if(x>0)m.put(part.substring(0,x).toUpperCase(Locale.ROOT),part.substring(x+1).toUpperCase(Locale.ROOT));}return m;}
    private static boolean contains(String csv,String candidate){if(csv==null||csv.isEmpty())return false;return Arrays.asList(csv.split(",")).contains(candidate);}
    private static String dayCode(DayOfWeek d){return new String[]{"MO","TU","WE","TH","FR","SA","SU"}[d.getValue()-1];}
    private static boolean recurring(LocalDate orig, LocalDate candidate, Map<String,String> r){
        if(candidate.isBefore(orig))return false;
        int interval=1;try{interval=Math.max(1,Integer.parseInt(r.getOrDefault("INTERVAL","1")));}catch(Exception ignored){}
        String f=r.getOrDefault("FREQ","");long distance;
        switch(f){
            case "DAILY":
                distance=ChronoUnit.DAYS.between(orig,candidate);
                return distance%interval==0&&(!r.containsKey("BYDAY")||contains(r.get("BYDAY"),dayCode(candidate.getDayOfWeek())));
            case "WEEKLY":
                distance=ChronoUnit.WEEKS.between(orig.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)),candidate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)));
                return distance%interval==0&&(r.containsKey("BYDAY")?contains(r.get("BYDAY"),dayCode(candidate.getDayOfWeek())):candidate.getDayOfWeek()==orig.getDayOfWeek());
            case "MONTHLY":
                distance=ChronoUnit.MONTHS.between(orig.withDayOfMonth(1),candidate.withDayOfMonth(1));
                return distance%interval==0&&(r.containsKey("BYMONTHDAY")?contains(r.get("BYMONTHDAY"),String.valueOf(candidate.getDayOfMonth())):orig.getDayOfMonth()==candidate.getDayOfMonth())&&(!r.containsKey("BYDAY")||contains(r.get("BYDAY"),dayCode(candidate.getDayOfWeek())));
            case "YEARLY":
                distance=ChronoUnit.YEARS.between(orig.withDayOfYear(1),candidate.withDayOfYear(1));
                return distance%interval==0&&(r.containsKey("BYMONTH")?contains(r.get("BYMONTH"),String.valueOf(candidate.getMonthValue())):orig.getMonthValue()==candidate.getMonthValue())&&(r.containsKey("BYMONTHDAY")?contains(r.get("BYMONTHDAY"),String.valueOf(candidate.getDayOfMonth())):orig.getDayOfMonth()==candidate.getDayOfMonth());
            default:return false;
        }
    }
    private static int occurrenceIndex(LocalDate orig,LocalDate candidate,Map<String,String> r){
        // Count also works for BYDAY=MO,WE,FR by examining only matched days.
        long span=ChronoUnit.DAYS.between(orig,candidate);
        if(span>20000)return Integer.MAX_VALUE;
        int n=0;LocalDate d=orig;while(!d.isAfter(candidate)){if(recurring(orig,d,r))n++;d=d.plusDays(1);}return n;
    }
    static List<Event> today(String ics,ZoneId displayZone,LocalDate day){
        List<Item> items=new ArrayList<>();Item current=null;
        String unfolded=ics.replace("\r\n","\n").replace("\r","\n").replaceAll("\n[ \\t]","");
        for(String line:unfolded.split("\n")){
            if("BEGIN:VEVENT".equalsIgnoreCase(line)){current=new Item();continue;}
            if("END:VEVENT".equalsIgnoreCase(line)){if(current!=null)items.add(current);current=null;continue;}
            if(current==null)continue;int colon=line.indexOf(':');if(colon<1)continue;
            String head=line.substring(0,colon);String key=head.split(";",2)[0].toUpperCase(Locale.ROOT);
            current.data.computeIfAbsent(key,k->new ArrayList<>()).add(new Prop(head,line.substring(colon+1)));
            if(items.size()>10000)break;
        }
        long startDay=day.atStartOfDay(displayZone).toInstant().toEpochMilli(),endDay=day.plusDays(1).atStartOfDay(displayZone).toInstant().toEpochMilli();
        // RECURRENCE-ID overrides suppress the original master occurrence.
        Set<String> overridden=new HashSet<>();
        for(Item item:items){Prop rid=item.first("RECURRENCE-ID");When w=date(rid,displayZone);if(w!=null)overridden.add(item.val("UID")+"/"+w.dt.toInstant().toEpochMilli());}
        List<Event> out=new ArrayList<>();
        for(Item item:items){if("CANCELLED".equalsIgnoreCase(item.val("STATUS")))continue;
            When original=date(item.first("DTSTART"),displayZone);if(original==null)continue;
            When end=date(item.first("DTEND"),displayZone);
            long duration=end==null?(original.allDay?86400000L:3600000L):end.dt.toInstant().toEpochMilli()-original.dt.toInstant().toEpochMilli();
            if(duration<=0||duration>7L*86400000)duration=original.allDay?86400000L:3600000L;
            String title=unescape(item.val("SUMMARY"));if(title.isEmpty())title="Untitled event";if(title.length()>120)title=title.substring(0,120);
            Map<String,String> r=rule(item.val("RRULE"));boolean isOverride=item.first("RECURRENCE-ID")!=null;
            LocalDate begins=startDay>0?Instant.ofEpochMilli(startDay-duration).atZone(original.dt.getZone()).toLocalDate().minusDays(1):day.minusDays(2);
            LocalDate finishes=Instant.ofEpochMilli(endDay).atZone(original.dt.getZone()).toLocalDate().plusDays(1);
            for(LocalDate candidate=begins;!candidate.isAfter(finishes);candidate=candidate.plusDays(1)){
                if(!r.isEmpty()&&!isOverride){if(!recurring(original.dt.toLocalDate(),candidate,r))continue;
                    When until=date(new Prop("UNTIL",r.getOrDefault("UNTIL","")),original.dt.getZone());if(until!=null&&candidate.atTime(original.dt.toLocalTime()).atZone(original.dt.getZone()).toInstant().isAfter(until.dt.toInstant()))continue;
                    try{int count=Integer.parseInt(r.getOrDefault("COUNT","0"));if(count>0&&occurrenceIndex(original.dt.toLocalDate(),candidate,r)>count)continue;}catch(Exception ignored){}
                }else if(!candidate.equals(original.dt.toLocalDate()))continue;
                ZonedDateTime occurrence=candidate.atTime(original.dt.toLocalTime()).atZone(original.dt.getZone());long st=occurrence.toInstant().toEpochMilli(),en=st+duration;
                if(st>=endDay||en<=startDay)continue;
                if(!isOverride&&overridden.contains(item.val("UID")+"/"+st))continue;
                if(!isOverride&&item.data.containsKey("EXDATE")){
                    boolean excluded=false;
                    for(Prop ex:item.data.get("EXDATE"))for(String raw:ex.value.split(",")){
                        When e=date(new Prop(ex.attrs,raw),original.dt.getZone());if(e!=null&&(e.allDay?e.dt.toLocalDate().equals(candidate):Math.abs(e.dt.toInstant().toEpochMilli()-st)<60000))excluded=true;
                    }
                    if(excluded)continue;
                }
                out.add(new Event(title,st,en,original.allDay));if(out.size()>120)break;
            }
            if(out.size()>120)break;
        }
        out.sort((a,b)->Long.compare(a.start,b.start));if(out.size()>60)return new ArrayList<>(out.subList(0,60));return out;
    }
}
