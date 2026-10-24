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
  System.out.println("PASS ICS all-day, timezone, recurring weekly and EXDATE");
 }
}
