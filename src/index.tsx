import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { frame, ink, caps, Icon, I, Shape, sdk, useNow, dayKey, localHM, Fit } from './ui';
import { parseOff, parseOverrides, cycleDay, nextSchoolDay, isSchoolDay, addDays, parseSchedule, parseBring, bringFor, NO_SCHOOL, closure, CycleCfg } from './logic';

type Ev = { id: string; title: string; start: string; end?: string; allDay: boolean; sourceId?: string };
const C = (x: number, y: number, r: number): Shape => ({ c: [x, y, r] });
const X: Record<string, Shape[]> = {
  cap: ['M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'],
  bag: ['M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M8 10h8', 'M8 18h8', 'M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6', 'M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  pin: [C(12, 12, 1)],
};

export default function SchoolDay(props: PluginComponentProps & { events?: Ev[]; people?: { name: string; sourceIds?: string[] }[]; timeFormat?: string }) {
  const { config, style } = props; const tz = props.timezone;
  const now = useNow(60000);
  const accent = String(config.accentColor || '#db2777');
  const person = String(config.personName ?? '').trim().toLowerCase();
  const ids = person ? (props.people ?? []).find((p) => p.name.toLowerCase() === person)?.sourceIds ?? [] : null;
  const evs = ((props.events ?? []) as Ev[]).filter((e) => !ids || (e.sourceId && ids.includes(e.sourceId)));
  const evDay = (e: Ev) => dayKey(new Date(e.allDay ? e.start.slice(0, 10) + 'T12:00:00' : e.start), tz);

  // calendar "Ped day" / "No school" events count as days off
  const off = parseOff(String(config.offDays || ''));
  evs.filter((e) => NO_SCHOOL.test(e.title)).forEach((e) => off.add(evDay(e)));
  const cyc: CycleCfg = {
    anchorDate: String(config.anchorDate || '2026-08-31'), anchorDay: Number(config.anchorDay || 1), length: Number(config.cycleLength || 5),
    first: String(config.firstDay || '2000-01-01'), last: String(config.lastDay || '2999-12-31'), off, overrides: parseOverrides(String(config.overrides || '')),
  };
  const today = dayKey(now, tz);
  const minute = localHM(now, tz);
  const afterSwitch = minute >= Number(config.switchHour ?? 15) * 60;
  const target = afterSwitch ? addDays(today, 1) : today;
  const school = isSchoolDay(target, cyc) ? target : nextSchoolDay(target, cyc);
  const day = school ? cycleDay(school, cyc) : null;
  const sched = parseSchedule(String(config.schedule || ''));
  const classes = day ? sched.get(day) ?? [] : [];
  const bring = bringFor(classes, parseBring(String(config.bring || '')));

  const label = (d: string) => d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow'
    : new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const longDate = (d: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const gap = school && school !== target;
  const whyOff = !isSchoolDay(target, cyc) && target >= cyc.first && target <= cyc.last
    ? (evs.find((e) => evDay(e) === target && NO_SCHOOL.test(e.title))?.title ?? ([0, 6].includes(new Date(target + 'T12:00:00Z').getUTCDay()) ? 'Weekend' : 'No school'))
    : null;

  // reminders: keyword events in the next 10 days (from today)
  let kw: RegExp; try { kw = new RegExp(String(config.remindKeywords || 'test|library'), 'i'); } catch { kw = /test|library/i; }
  const soon = evs.filter((e) => kw.test(e.title) && !/lunch|d[îi]ner/i.test(e.title))
    .map((e) => ({ e, d: evDay(e) })).filter(({ d }) => d >= today && d <= addDays(today, 10))
    .sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
  // library-day style reminders from the schedule for the target day
  // (already in `bring`)

  // storm closures (only on school-day mornings)
  const [closed, setClosed] = React.useState<'closed' | 'transport' | null>(null);
  const checkNow = config.checkClosures !== false && isSchoolDay(today, cyc) && minute >= 5 * 60 && minute < 11 * 60;
  const tick = Math.floor(now.getTime() / 600000);
  React.useEffect(() => {
    if (!checkNow) { setClosed(null); return; }
    (async () => {
      try {
        const res: Response = await sdk().pluginFetch('school-day', { url: String(config.closureUrl || 'https://www.swlauriersb.qc.ca/en/'), cacheTtlMs: 600000 });
        if (!res.ok) return;
        const html = await res.text();
        const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<[^>]+>/g, ' ');
        setClosed(closure(text, String(config.schoolName || '')));
      } catch { /* keep last */ }
    })();
  }, [checkNow, tick]);  // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (t: string, strong = false) => (
    <span key={t} style={{ padding: '0.3em 0.75em', borderRadius: '999px', fontSize: '0.8em', fontWeight: 500, whiteSpace: 'nowrap',
      background: strong ? `color-mix(in srgb, ${accent} 14%, transparent)` : ink(style, 0.06) }}>{t}</span>
  );

  return (
    <div style={frame(style)}>
      <Fit max={1.9} min={0.55}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em' }}>
      {closed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', padding: '0.55em 0.8em', borderRadius: '0.7em', color: '#fff', background: closed === 'closed' ? '#dc2626' : '#d97706' }}>
          <Icon d={X.alert} size="1.3em" stroke={2.2} />
          <span style={{ fontWeight: 600 }}>{closed === 'closed' ? 'School closed today — classes suspended' : 'School buses cancelled today'}</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.7em', opacity: 0.85 }}>per the school board website</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9em' }}>
        <div style={{ width: '3.2em', height: '3.2em', borderRadius: '0.9em', background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>
          {day ? (<><span style={{ fontSize: '0.55em', fontWeight: 600, letterSpacing: '0.08em' }}>DAY</span><span style={{ fontSize: '1.6em', fontWeight: 600 }}>{day}</span></>) : <Icon d={X.cap} size="1.6em" stroke={1.8} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...caps, color: accent, opacity: 1 }}>{school ? `${label(school)} · ${longDate(school)}` : 'School'}</div>
          <div style={{ fontSize: '1.35em', fontWeight: 600, lineHeight: 1.2 }}>
            {!school ? 'No more school days this year' : gap ? `${label(target)}: ${whyOff ?? 'No school'} · back ${label(school).toLowerCase()} on Day ${day}` : `Day ${day} at school`}
          </div>
        </div>
      </div>

      {school && classes.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4em' }}>{classes.map((c) => chip(c))}</div>}

      {school && bring.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35em', fontSize: '0.75em', fontWeight: 600, color: accent }}><Icon d={X.bag} size="1.2em" stroke={2} />Bring</span>
          {bring.map((b) => chip(b, true))}
        </div>
      )}

      {soon.length > 0 && (
        <div style={{ marginTop: '0.3em', paddingTop: '0.6em', borderTop: `1px solid ${ink(style, 0.08)}`, display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
          <div style={caps}>Coming up</div>
          {soon.map(({ e, d }) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.85em' }}>
              <span style={{ width: '8em', flexShrink: 0, opacity: 0.6, fontSize: '0.85em', whiteSpace: 'nowrap' }}>{longDate(d)}{d === today ? ' (today)' : d === addDays(today, 1) ? ' (tomorrow)' : ''}</span>
              <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
            </div>
          ))}
        </div>
      )}
      {soon.length === 0 && <div style={{ marginTop: '0.3em', fontSize: '0.7em', opacity: 0.4 }}>No tests or library returns on the calendar in the next 10 days.</div>}
      </div>
      </Fit>
    </div>
  );
}
