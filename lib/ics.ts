/**
 * 最小 .ics 解析器：只读 VEVENT。
 *
 * 设计取舍（P0）：
 * - 不展开重复事件：含 RRULE 的事件直接跳过并计数，展开留给后续阶段。
 * - 不处理 VTODO / VJOURNAL / VTIMEZONE。
 * - 时间语义：带 TZID 的时间直接取其书写 wall time（清单是按本地规划时间看的，
 *   跨时区换算反而会把“当地 9 点”变成另一个数字）；带 Z 的 UTC 时间换算到
 *   defaultTimeZone（默认 Asia/Shanghai）的 wall time；无时区信息的浮动时间
 *   按书写值原样取用。
 * - DESCRIPTION / SUMMARY / LOCATION 做 ICS 转义还原。
 */

export type ParsedCalendarEvent = {
  uid: string;
  title: string;
  /** yyyy-MM-dd（事件本地日期） */
  date: string;
  /** HH:mm；null 表示全天 */
  time: string | null;
  allDay: boolean;
  location: string;
  description: string;
};

export type IcsSkipped = {
  recurring: number;
  cancelled: number;
  transparent: number;
  noUid: number;
  invalid: number;
};

export type IcsParseResult = {
  events: ParsedCalendarEvent[];
  skipped: IcsSkipped;
};

type Prop = { params: Record<string, string>; value: string };

function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (out.length > 0) out[out.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      out.push(line);
    }
  }
  return out;
}

function parseProperty(line: string): { name: string; prop: Prop } | null {
  const idx = line.indexOf(':');
  if (idx === -1) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(';');
  const name = (parts[0] ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  if (!name) return null;
  return { name, prop: { params, value } };
}

function unescapeText(s: string): string {
  const PH = '￿';
  return s
    .replace(/\\\\/g, PH)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(new RegExp(PH, 'g'), '\\')
    .trim();
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把一个 UTC instant 换算成目标时区的 wall time，返回 { date, time }。 */
function utcToZoned(utcMs: number, timeZone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * 解析 DTSTART，返回本地日期与时间。
 * - VALUE=DATE 或纯 8 位数字 → 全天。
 * - 以 Z 结尾 → UTC instant，换算到 defaultTimeZone。
 * - 带 TZID 或浮动 → 直接取书写 wall time。
 */
function parseDtstart(
  prop: Prop,
  defaultTimeZone: string
): { date: string; time: string | null; allDay: boolean } | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (prop.params.VALUE === 'DATE' || dateOnly) {
    if (!dateOnly) return null;
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (!validDate(y, m, d)) return null;
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, time: null, allDay: true };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  const y = Number(dt[1]);
  const m = Number(dt[2]);
  const d = Number(dt[3]);
  const hh = Number(dt[4]);
  const mm = Number(dt[5]);
  const ss = Number(dt[6]);
  if (!validDate(y, m, d) || hh > 23 || mm > 59 || ss > 60) return null;
  if (dt[7] === 'Z') {
    const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
    const zoned = utcToZoned(utcMs, defaultTimeZone);
    return { date: zoned.date, time: zoned.time, allDay: false };
  }
  // TZID 或浮动：取书写 wall time
  return { date: `${dt[1]}-${dt[2]}-${dt[3]}`, time: `${pad(hh)}:${pad(mm)}`, allDay: false };
}

export function parseIcs(text: string, opts?: { defaultTimeZone?: string }): IcsParseResult {
  const defaultTimeZone = opts?.defaultTimeZone || process.env.CALENDAR_TZ || 'Asia/Shanghai';
  const lines = unfoldLines(text);
  const events: ParsedCalendarEvent[] = [];
  const skipped: IcsSkipped = { recurring: 0, cancelled: 0, transparent: 0, noUid: 0, invalid: 0 };

  let inEvent = false;
  let props: Map<string, Prop> = new Map();

  const flush = () => {
    if (!inEvent) return;
    inEvent = false;
    const uid = (props.get('UID')?.value ?? '').trim();
    if (!uid) {
      skipped.noUid += 1;
      return;
    }
    if (props.has('RRULE')) {
      skipped.recurring += 1;
      return;
    }
    if ((props.get('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED') {
      skipped.cancelled += 1;
      return;
    }
    if ((props.get('TRANSP')?.value ?? '').trim().toUpperCase() === 'TRANSPARENT') {
      skipped.transparent += 1;
      return;
    }
    const dtProp = props.get('DTSTART');
    if (!dtProp) {
      skipped.invalid += 1;
      return;
    }
    const dt = parseDtstart(dtProp, defaultTimeZone);
    if (!dt) {
      skipped.invalid += 1;
      return;
    }
    const title = unescapeText(props.get('SUMMARY')?.value ?? '') || '未命名事项';
    events.push({
      uid,
      title,
      date: dt.date,
      time: dt.time,
      allDay: dt.allDay,
      location: unescapeText(props.get('LOCATION')?.value ?? ''),
      description: unescapeText(props.get('DESCRIPTION')?.value ?? ''),
    });
  };

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      props = new Map();
      continue;
    }
    if (upper === 'END:VEVENT') {
      flush();
      props = new Map();
      continue;
    }
    if (!inEvent) continue;
    const parsed = parseProperty(line);
    if (parsed && !props.has(parsed.name)) props.set(parsed.name, parsed.prop);
  }
  // 文件末尾未闭合的 VEVENT 也算一次
  flush();

  return { events, skipped };
}
