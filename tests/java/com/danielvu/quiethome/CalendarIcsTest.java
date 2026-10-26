package com.danielvu.quiethome;
import java.time.*;
import java.util.*;
public class CalendarIcsTest {
 public static void main(String[] args){
  String i="BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nSUMMARY:Team sync\r\nDTSTART;TZID=America/Los_Angeles:20261019T100000\r\nDTEND;TZID=America/Los_Angeles:20261019T103000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,SA\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:two\r\nSUMMARY:Doctor\\, dentist\r\nDTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261025\r\nEND:VEVENT\r\nEND:VCALENDAR";
  java.util.List<CalendarIcs.Event> r=CalendarIcs.today(i,ZoneId.of("America/Los_Angeles"),LocalDate.of(2026,10,24));
  if(r.size()!=2)throw new RuntimeException("Expected 2 weekly/all-day events, got " + r.size());
  if(!r.get(0).allDay||!r.get(1).title.equals("Team sync"))throw new RuntimeException("Wrong event order/content");
  String excl="BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:one\nSUMMARY:Team sync\nDTSTART;TZID=America/Los_Angeles:20261019T100000\nDTEND;TZID=America/Los_Angeles:20261019T103000\nRRULE:FREQ=WEEKLY;BYDAY=MO,SA\nEXDATE;TZID=America/Los_Angeles:20261024T100000\nEND:VEVENT\nEND:VCALENDAR";
  if(!CalendarIcs.today(excl,ZoneId.of("America/Los_Angeles"),LocalDate.of(2026,10,24)).isEmpty())throw new RuntimeException("EXDATE not honored");
  String sports="BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:pickup@ballerwatch\nSUMMARY:Pickup football\nDTSTART:20261026T020000Z\nDTEND:20261026T040000Z\nLOCATION:Jefferson Park Playfield\nDESCRIPTION:Playing · BallerWatch\\nWear orange\nEND:VEVENT\nBEGIN:VEVENT\nUID:match@ballerwatch-watch\nSUMMARY:Sounders match\nDTSTART:20261026T030000Z\nDTEND:20261026T050000Z\nDESCRIPTION:Watching · professional sports\nX-VELA-CHANNEL:Drogon Sports HD\nEND:VEVENT\nEND:VCALENDAR";
  java.util.List<CalendarIcs.Event> game=CalendarIcs.upcoming(sports,ZoneId.of("America/Los_Angeles"),LocalDate.of(2026,10,24),7);
  if(game.size()!=2)throw new RuntimeException("Expected two seven-day sports events, got "+game.size());
  if(!"play".equals(game.get(0).kind)||!"Jefferson Park Playfield".equals(game.get(0).location)||!game.get(0).description.contains("Wear orange"))throw new RuntimeException("Playing metadata missing");
  if(!"watch".equals(game.get(1).kind)||!"Drogon Sports HD".equals(game.get(1).channel))throw new RuntimeException("Watching/channel metadata missing");
  String dst="BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:fall\nSUMMARY:Fall transition\nDTSTART;TZID=America/Los_Angeles:20261025T013000\nDTEND;TZID=America/Los_Angeles:20261025T023000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nBEGIN:VEVENT\nUID:cancel\nSUMMARY:Cancelled sports\nDTSTART:20261101T190000Z\nDTEND:20261101T210000Z\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR";
  java.util.List<CalendarIcs.Event> across=CalendarIcs.upcoming(dst,ZoneId.of("America/Los_Angeles"),LocalDate.of(2026,10,25),21);
  if(across.size()!=3)throw new RuntimeException("Cancelled or recurring DST events mishandled: "+across.size());
  if(across.get(0).start!=Instant.parse("2026-10-25T08:30:00Z").toEpochMilli()||
     across.get(1).start!=Instant.parse("2026-11-01T08:30:00Z").toEpochMilli()||
     across.get(2).start!=Instant.parse("2026-11-08T09:30:00Z").toEpochMilli())
    throw new RuntimeException("Fall DST transitions must retain source wall time");
  String future="BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:future\nSUMMARY:Game next month\nDTSTART:20261203T040000Z\nDTEND:20261203T060000Z\nEND:VEVENT\nEND:VCALENDAR";
  if(CalendarIcs.upcoming(future,ZoneId.of("America/Los_Angeles"),LocalDate.of(2026,10,25),120).size()!=1)
    throw new RuntimeException("120-day source cache silently truncated to two weeks");
  System.out.println("PASS ICS playing/watching, all-day, timezone/DST, cancelled events, 120-day cache, RRULE/EXDATE");
 }
}
