// Pure school-cycle logic. Dates are local "YYYY-MM-DD" strings.

const ms = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * 86400000).toISOString().slice(0, 10);
export const dow = (d: string) => new Date(ms(d)).getUTCDay();

/** "2026-09-07, 2026-12-21..2027-01-04" → Set of dates. */
export function parseOff(s: string): Set<string> {
  const out = new Set<string>();
  String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).forEach((p) => {
    const [a, b] = p.split('..').map((x) => x.trim());
    if (!/^\d{4}-\d\d-\d\d$/.test(a)) return;
    if (b && /^\d{4}-\d\d-\d\d$/.test(b)) { for (let d = a; d <= b; d = addDays(d, 1)) out.add(d); } else out.add(a);
  });
  return out;
}

export function parseOverrides(s: string): Map<string, number> {
  const m = new Map<string, number>();
  String(s || '').split(/[,\n]/).forEach((p) => { const [d, n] = p.split('=').map((x) => x.trim()); if (/^\d{4}-\d\d-\d\d$/.test(d) && Number(n) > 0) m.set(d, Number(n)); });
  return m;
}

export interface CycleCfg { anchorDate: string; anchorDay: number; length: number; first: string; last: string; off: Set<string>; overrides: Map<string, number> }

export const isSchoolDay = (d: string, c: CycleCfg) => d >= c.first && d <= c.last && dow(d) !== 0 && dow(d) !== 6 && !c.off.has(d);

/** Cycle day (1..length) for a school day, or null if no school. Overrides re-anchor the count. */
export function cycleDay(d: string, c: CycleCfg): number | null {
  if (!isSchoolDay(d, c)) return null;
  if (c.overrides.has(d)) return c.overrides.get(d)!;
  // nearest override before d acts as a new anchor
  let anchor = c.anchorDate, aDay = c.anchorDay;
  for (const [od, on] of c.overrides) if (od < d && od > anchor) { anchor = od; aDay = on; }
  let n = 0;
  // n = school days in [anchor, d)  (or minus those in [d, anchor) when d is earlier)
  if (d >= anchor) { for (let x = anchor; x < d; x = addDays(x, 1)) if (isSchoolDay(x, c)) n++; }
  else { for (let x = d; x < anchor; x = addDays(x, 1)) if (isSchoolDay(x, c)) n--; }
  const L = Math.max(1, c.length);
  return ((((aDay - 1 + n) % L) + L) % L) + 1;
}

export function nextSchoolDay(from: string, c: CycleCfg, limit = 120): string | null {
  for (let i = 0, d = from; i < limit; i++, d = addDays(d, 1)) if (isSchoolDay(d, c)) return d;
  return null;
}

/** "1: English, Math, Gym" lines → Map(day → classes). */
export function parseSchedule(s: string): Map<number, string[]> {
  const m = new Map<number, string[]>();
  String(s || '').split('\n').forEach((line) => {
    const mm = line.match(/^\s*(?:day\s*)?(\d+)\s*[:\-–]\s*(.+)$/i);
    if (mm) m.set(Number(mm[1]), mm[2].split(',').map((x) => x.trim()).filter(Boolean));
  });
  return m;
}

/** "Gym: running shoes" lines → [class, item]. */
export function parseBring(s: string): [string, string][] {
  return String(s || '').split('\n').map((l) => l.split(':')).filter((p) => p.length >= 2 && p[0].trim())
    .map((p) => [p[0].trim(), p.slice(1).join(':').trim()] as [string, string]);
}

export function bringFor(classes: string[], bring: [string, string][]): string[] {
  const low = classes.map((c) => c.toLowerCase());
  return bring.filter(([k]) => low.some((c) => c.includes(k.toLowerCase()))).map(([, v]) => v);
}

export const NO_SCHOOL = /ped(agogical)?\s*day|p[ée]dago|no school|pas d'?[ée]cole|cong[ée]|school closed/i;

/** Closure notice on the board's homepage text. */
export function closure(text: string, school: string): 'closed' | 'transport' | null {
  const t = text.replace(/\s+/g, ' ');
  const closedWords = /(classes (are )?suspended|suspension of classes|school(s)? (is |are )?closed|closure of|cours suspendus|fermée?s?)/i;
  const busWords = /(transportation|school buses?|transport scolaire).{0,40}(cancel|annul)/i;
  const near = (re: RegExp) => {
    if (!school) return re.test(t) && /today|aujourd|this morning|ce matin/i.test(t);
    const i = t.toLowerCase().indexOf(school.toLowerCase());
    if (i < 0) return /all (schools|establishments)|toutes les écoles/i.test(t) && re.test(t);
    return re.test(t.slice(Math.max(0, i - 600), i + 600));
  };
  if (near(closedWords)) return 'closed';
  if (near(busWords)) return 'transport';
  return null;
}
