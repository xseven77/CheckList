'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawChecklist } from '@/lib/exportImage';
import { type Change, type Checklist as Doc, type Day, type Event, type Group, type Item, type Section, eventGroups, findEventByGroup, findGroup } from '@/lib/types';
import { AlertIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CrossIcon, GearIcon, InfoIcon, ShareIcon } from '@/components/Icons';

type SyncState = { s: 'wait' | 'ok' | 'err'; text: string };
const SYNC_OK: SyncState = { s: 'ok', text: '已同步' };
const OPEN_KEY = 'checklist-open-v1';
const THEME_KEY = 'checklist-theme-v1';
/** 重点色预设（顺序与 iOS 日历颜色一致）：accent 进 CSS --red，imgSoft/imgBorder 进导出长图 */
const THEMES: Record<string, { name: string; accent: string; soft: string; imgSoft: string; imgBorder: string }> = {
  red: { name: '红色', accent: '#b0262f', soft: '#f8e5e5', imgSoft: '#fbf0ee', imgBorder: '#f2d5d2' },
  orange: { name: '橙色', accent: '#d9480f', soft: '#fff1e6', imgSoft: '#fff1e6', imgBorder: '#f5c9a8' },
  yellow: { name: '黄色', accent: '#d9a400', soft: '#fdf6d8', imgSoft: '#fdf6d8', imgBorder: '#e8d488' },
  green: { name: '绿色', accent: '#2e7d32', soft: '#eaf6ed', imgSoft: '#eaf6ed', imgBorder: '#c3e8ca' },
  blue: { name: '蓝色', accent: '#1971c2', soft: '#e7f1fa', imgSoft: '#e7f1fa', imgBorder: '#b8d4f0' },
  purple: { name: '紫色', accent: '#7048e8', soft: '#f1eaff', imgSoft: '#f1eaff', imgBorder: '#d0c2f5' },
  brown: { name: '褐色', accent: '#8b5e3c', soft: '#f5ebe2', imgSoft: '#f5ebe2', imgBorder: '#d8c0a8' },
};
/** hex → rgb */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** 与白色混合，得到浅色底 / 边框色 */
function mixWithWhite(hex: string, white: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number) => Math.round(c + (255 - c) * white);
  return `#${[m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
/** 相对亮度 */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** 主题值（预设 id 或自定义 #rrggbb）→ 实际用色：重点色上的文字取对比度更高的一方 */
function resolveTheme(value: string): { accent: string; soft: string; on: string; bg: string; line: string; imgSoft: string; imgBorder: string } {
  const preset = THEMES[value];
  const accent = preset ? preset.accent : value;
  const lum = luminance(accent);
  // 深色字 #2a0b0e 的相对亮度约 0.0076；与白字对比，取对比度更高的一方
  const on = 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0576 ? '#ffffff' : '#2a0b0e';
  const bg = mixWithWhite(accent, 0.965);
  const line = mixWithWhite(accent, 0.85);
  if (preset) return { accent: preset.accent, soft: preset.soft, on, bg, line, imgSoft: preset.imgSoft, imgBorder: preset.imgBorder };
  return {
    accent,
    soft: mixWithWhite(accent, 0.92),
    on,
    bg,
    line,
    imgSoft: mixWithWhite(accent, 0.9),
    imgBorder: mixWithWhite(accent, 0.75),
  };
}
/** HSL → #rrggbb（取色板用） */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
/** 取色板：首行灰阶 + 5 档明暗 × 12 色相 */
function buildPickerColors(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 12; i++) colors.push(hslToHex(0, 0, 100 - (100 / 11) * i));
  for (const l of [25, 40, 55, 70, 85]) {
    for (let h = 0; h < 360; h += 30) colors.push(hslToHex(h, 85, l));
  }
  return colors;
}
const PICKER_COLORS = buildPickerColors();
/** 导出标题默认：单日 = 当天日期，多日 = 日期区间；非日期键回退为“清单” */
function defaultExportTitle(dayKeys: string[]): string {
  const dates = dayKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  if (!dates.length) return '清单';
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  };
  if (dates.length === 1) return fmt(dates[0]);
  const [y1, m1, d1] = dates[0].split('-').map(Number);
  const [y2, m2, d2] = dates[dates.length - 1].split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `${y1}年${m1}月${d1}日—${d2}日`;
  if (y1 === y2) return `${y1}年${m1}月${d1}日—${m2}月${d2}日`;
  return `${fmt(dates[0])}—${fmt(dates[dates.length - 1])}`;
}
/** 把主题色写进 CSS 变量（内联变量优先于样式表，预设与自定义统一走这里） */
function setThemeVars(t: { accent: string; soft: string; on: string; bg: string; line: string }) {
  const root = document.documentElement.style;
  root.setProperty('--red', t.accent);
  root.setProperty('--red-soft', t.soft);
  root.setProperty('--on-red', t.on);
  // 背景与边框只在浅色模式下跟随主题；深色模式下撤掉内联值、交还给深色默认值，避免浅底刺眼
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.removeProperty('--bg');
    root.removeProperty('--line');
  } else {
    root.setProperty('--bg', t.bg);
    root.setProperty('--line', t.line);
  }
}

/** 日期键：同步日期用完整日期，手工日期用几号（避免跨月同号冲突） */
function dayKey(d: { day: number; date?: string }): string {
  return d.date ?? String(d.day);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** 本地日期 → yyyy-MM-dd（不用 toISOString，避免 UTC 偏移） */
function toDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}
/** 所在周（周日开头）的 7 天 */
function weekOf(key: string): string[] {
  const d = parseDateKey(key);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(start);
    t.setDate(start.getDate() + i);
    return toDateKey(t);
  });
}
/** 农历日：1→初一 … 10→初十，11→十一 … 20→二十，21→廿一 … 30→三十 */
function lunarDayChar(n: number): string {
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n >= 1 && n <= 9) return '初' + digits[n - 1];
  if (n === 10) return '初十';
  if (n >= 11 && n <= 19) return '十' + digits[n - 11];
  if (n === 20) return '二十';
  if (n >= 21 && n <= 29) return '廿' + digits[n - 21];
  if (n === 30) return '三十';
  return '';
}
const LUNAR_DAY_NAMES: Record<string, number> = {
  初一: 1, 初二: 2, 初三: 3, 初四: 4, 初五: 5, 初六: 6, 初七: 7, 初八: 8, 初九: 9, 初十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17, 十八: 18, 十九: 19, 二十: 20,
  廿一: 21, 廿二: 22, 廿三: 23, 廿四: 24, 廿五: 25, 廿六: 26, 廿七: 27, 廿八: 28, 廿九: 29,
  二十一: 21, 二十二: 22, 二十三: 23, 二十四: 24, 二十五: 25, 二十六: 26, 二十七: 27, 二十八: 28, 二十九: 29,
  三十: 30,
};
const LUNAR_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
/** 农历日文本 → 数字：阿拉伯数字与中文日名都接受（不同浏览器返回格式不同） */
function parseLunarDay(s: string): number {
  const t = s.trim().replace(/日$/, '');
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 30) return n;
  return LUNAR_DAY_NAMES[t] ?? 0;
}
/** 农历月文本 → 中文月名：中文月名直接用，数字月按农历映射（闰月原样保留） */
function normalizeLunarMonth(s: string): string {
  const t = s.trim();
  if (!t) return '';
  if (t.startsWith('闰')) return t;
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 12) return LUNAR_MONTH_NAMES[n - 1];
  return t.endsWith('月') ? t : '';
}
/** 农历信息：先确认浏览器确实在用中文历法（否则是公历回退，不能当农历显示）；取不到则返回 null，调用方隐藏农历行 */
function lunarParts(d: Date): { yearName: string; month: string; day: number } | null {
  try {
    const dtf = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' });
    if (dtf.resolvedOptions().calendar !== 'chinese') return null;
    const parts = dtf.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const day = parseLunarDay(get('day'));
    const month = normalizeLunarMonth(get('month'));
    const yearName = get('yearName');
    if (!month || !(day >= 1 && day <= 30)) return null;
    return { yearName, month, day };
  } catch {
    return null;
  }
}
function lunarDayLabel(d: Date): string {
  const p = lunarParts(d);
  return p ? lunarDayChar(p.day) : '';
}
function lunarFullLabel(d: Date): string {
  const p = lunarParts(d);
  if (!p) return '';
  return p.yearName ? `${p.yearName}年${p.month}${lunarDayChar(p.day)}` : `${p.month}${lunarDayChar(p.day)}`;
}

function mapGroup(doc: Doc, gid: string, fn: (items: Item[]) => Item[]): Doc {
  const mg = (g: Group) => (g.id === gid ? { ...g, items: fn(g.items) } : g);
  return {
    ...doc,
    days: doc.days.map((d) => ({
      ...d,
      events: d.events.map((ev) => ({ ...ev, groups: ev.groups.map(mg), sections: ev.sections.map((s) => ({ ...s, groups: s.groups.map(mg) })) })),
    })),
  };
}

function mapEvent(doc: Doc, eid: string, done: boolean): Doc {
  return { ...doc, days: doc.days.map((d) => ({ ...d, events: d.events.map((ev) => (ev.id === eid ? { ...ev, done } : ev)) })) };
}

function mapEventCascade(doc: Doc, eid: string, done: boolean): Doc {
  return {
    ...doc,
    days: doc.days.map((d) => ({
      ...d,
      events: d.events.map((ev) => {
        if (ev.id !== eid) return ev;
        const setDone = (items: Item[]) => items.map((i) => ({ ...i, done }));
        return {
          ...ev,
          done,
          groups: ev.groups.map((g) => ({ ...g, items: setDone(g.items) })),
          sections: ev.sections.map((s) => ({
            ...s,
            groups: s.groups.map((g) => ({ ...g, items: setDone(g.items) })),
          })),
        };
      }),
    })),
  };
}

/** 每个接口地址同一时间只发一个请求；排队期间只保留最新的一次 */
function createWriter(onStatus: (s: SyncState) => void) {
  const queues = new Map<string, { running: boolean; next: unknown }>();
  const send = (path: string, body: unknown) => {
    const q = queues.get(path) ?? { running: false, next: undefined };
    queues.set(path, q);
    if (q.running) {
      q.next = body;
      return;
    }
    q.running = true;
    onStatus({ s: 'wait', text: '保存中…' });
    fetch('/api/' + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        onStatus(SYNC_OK);
      })
      .catch(() => onStatus({ s: 'err', text: '保存失败，请检查网络后刷新页面' }))
      .finally(() => {
        q.running = false;
        if (q.next !== undefined) {
          const b = q.next;
          q.next = undefined;
          send(path, b);
        } else queues.delete(path);
      });
  };
  return { send, pending: (path: string) => queues.has(path), paths: () => [...queues.keys()] };
}

export default function Checklist({ initial }: { initial: Doc }) {
  const [doc, setDoc] = useState(initial);
  const docRef = useRef(initial);
  const commit = (next: Doc) => {
    docRef.current = next;
    setDoc(next);
  };
  const [sync, setSync] = useState<SyncState>({ s: 'wait', text: '正在连接…' });
  const [writer] = useState(() => createWriter(setSync));
  const [toast, setToast] = useState<{ text: string; type?: 'success' | 'info' | 'warn' | 'err' } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback(
    (text: string, type: 'success' | 'info' | 'warn' | 'err' = 'info', duration = 2800) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ text, type });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
      }, duration);
    },
    []
  );

  const [preview, setPreview] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<string>('red');

  // ---------- 单日视图 ----------
  const [selected, setSelected] = useState<string>(() => toDateKey(new Date()));
  const todayKey = toDateKey(new Date());
  const selectedDate = parseDateKey(selected);
  const weekKeys = weekOf(selected);

  // ---------- 轮播轨道：左右切换按轮播图实现 ----------
  // 平时轨道只有三页（前一天 / 当天 / 后一天），旧页和新页在一条轨道上一起平移；
  // 跨多天时临时展开起止之间的所有页，轨道一次滑过中间页。
  const trackRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [slideTo, setSlideTo] = useState<0 | 2 | null>(null);
  const [jump, setJump] = useState<{ days: string[]; from: number; to: number; go: boolean } | null>(null);
  const [animating, setAnimating] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (animating || jump || slideTo !== null) return;
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const start = touchRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) setDragX(dx);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      // 滑过阈值：轨道带过渡滑到相邻页，结束后再提交日期
      setDragX(null);
      setSlideTo(dx < 0 ? 2 : 0);
      setAnimating(true);
    } else if (dragX !== null && dragX !== 0) {
      // 没滑过阈值：轨道弹回当前页
      setDragX(null);
      setAnimating(true);
    } else {
      setDragX(null);
    }
  };
  /** 切到某天：相邻页轨道滑过去；跨多天轨道一次滑过中间页；跨 14 天以上直接跳（滑过整段没有意义） */
  const goToDay = (key: string) => {
    if (key === selected || animating || jump || slideTo !== null) return;
    if (key === addDays(selected, 1)) {
      setSlideTo(2);
      setAnimating(true);
    } else if (key === addDays(selected, -1)) {
      setSlideTo(0);
      setAnimating(true);
    } else {
      const lo = key < selected ? key : selected;
      const hi = key < selected ? selected : key;
      const days: string[] = [];
      for (let k = lo; ; k = addDays(k, 1)) {
        days.push(k);
        if (k === hi) break;
      }
      if (days.length > 15) {
        setSelected(key);
        return;
      }
      setJump({ days, from: days.indexOf(selected), to: days.indexOf(key), go: false });
    }
  };
  // 跳转轨道：先让起始页落位并强制重排，再开过渡滑向目标页（否则浏览器会跳过起始帧）
  useEffect(() => {
    if (!jump || jump.go) return;
    void trackRef.current?.offsetWidth;
    setJump({ ...jump, go: true });
    setAnimating(true);
  }, [jump]);
  /** 轨道过渡结束：提交新日期，轨道回到以新日期为中心的三页（视觉上与过渡终点完全一致） */
  const onTrackTransitionEnd = () => {
    if (jump) {
      const target = jump.days[jump.to];
      setJump(null);
      setAnimating(false);
      setSelected(target);
    } else if (slideTo !== null) {
      const target = addDays(selected, slideTo === 2 ? 1 : -1);
      setSlideTo(null);
      setAnimating(false);
      setSelected(target);
    } else {
      setAnimating(false);
    }
  };

  // ---------- 实时同步 ----------
  // 用服务器的整份数据，但保留本机还没保存完的修改
  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/checklist', { cache: 'no-store' });
      if (!r.ok) return;
      let next = (await r.json()) as Doc;
      for (const p of writer.paths()) {
        const [kind, id] = p.split('/');
        if (kind === 'groups') {
          const local = findGroup(docRef.current, id);
          if (local) next = mapGroup(next, id, () => local.items);
        } else {
          const local = docRef.current.days.flatMap((d) => d.events).find((e) => e.id === id);
          if (local) next = mapEvent(next, id, local.done);
        }
      }
      commit(next);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writer]);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => {
      setSync(SYNC_OK);
      refetch(); // 断线重连后补上错过的修改
    };
    es.onerror = () => setSync({ s: 'err', text: '连接断开，正在重连…' });
    es.onmessage = (e) => {
      let c: Change;
      try {
        c = JSON.parse(e.data);
      } catch {
        return;
      }
      if (c.type === 'group' && !writer.pending('groups/' + c.id)) {
        let next = mapGroup(docRef.current, c.id, () => c.items);
        if (c.eventDone) {
          next = mapEvent(next, c.eventDone.id, c.eventDone.done);
        }
        commit(next);
      }
      if (c.type === 'task' && !writer.pending('tasks/' + c.id)) {
        let next = mapEvent(docRef.current, c.id, c.done);
        if (c.groups) {
          for (const g of c.groups) {
            next = mapGroup(next, g.id, () => g.items);
          }
        }
        commit(next);
      }
      if (c.type === 'doc' && c.doc) {
        commit(c.doc);
      }
    };
    return () => es.close();
  }, [writer, refetch]);

  useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'));
    } catch {}
  }, []);
  // 主题色：只存在这台设备（不进服务器数据，换设备互不影响）
  useEffect(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v && (v in THEMES || /^#[0-9a-fA-F]{6}$/.test(v))) {
        setTheme(v);
        setThemeVars(resolveTheme(v));
      }
    } catch {}
  }, []);
  const applyTheme = (value: string) => {
    setTheme(value);
    setThemeVars(resolveTheme(value));
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {}
  };
  // 系统深浅模式切换时，背景与边框要重新按当前主题取舍（浅色跟随、深色交还默认值）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeVars(resolveTheme(theme));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  const toggleSection = (id: string, value: boolean) => {
    setOpen((o) => {
      const next = { ...o, [id]: value };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // ---------- 打勾 ----------
  const toggleTask = (eid: string, done: boolean) => {
    // 联动检查：勾选大标题，同步将对应所有小标题都勾上或取消
    const next = mapEventCascade(docRef.current, eid, done);
    commit(next);
    writer.send('tasks/' + eid, { done });
    showToast(done ? '已完成该事项及所属全部明细' : '已取消勾选事项', 'info');
  };

  const toggleItem = (gid: string, itemId: string, done: boolean) => {
    let next = mapGroup(docRef.current, gid, (items) => items.map((i) => (i.id === itemId ? { ...i, done } : i)));
    // 联动检查：所属大标题的所有小标题是否已全部勾选
    const ev = findEventByGroup(next, gid);
    if (ev) {
      const allItems = eventGroups(ev).flatMap((g) => g.items);
      if (allItems.length > 0) {
        const allDone = allItems.every((i) => i.done);
        if (ev.done !== allDone) {
          next = mapEvent(next, ev.id, allDone);
        }
      }
    }
    commit(next);
    writer.send('groups/' + gid, { itemId, done });
  };

  // ---------- 进度 ----------
  const counts = useMemo(() => {
    let ti = 0, td = 0, ii = 0, id = 0;
    const perDay: Record<string, [number, number]> = {};
    const perSec: Record<string, [number, number]> = {};
    for (const d of doc.days) {
      const pd = (perDay[dayKey(d)] = [0, 0]);
      for (const ev of d.events) {
        ti++;
        pd[1]++;
        if (ev.done) {
          td++;
          pd[0]++;
        }
        for (const g of eventGroups(ev)) {
          const k = g.items.filter((i) => i.done).length;
          ii += g.items.length;
          id += k;
          pd[0] += k;
          pd[1] += g.items.length;
        }
        for (const s of ev.sections) {
          perSec[s.id] = [0, 0];
          for (const g of s.groups) {
            perSec[s.id][0] += g.items.filter((i) => i.done).length;
            perSec[s.id][1] += g.items.length;
          }
        }
      }
    }
    return { ti, td, ii, id, perDay, perSec, pct: ti + ii ? ((td + id) / (ti + ii)) * 100 : 0 };
  }, [doc]);

  // 进度条与计数只表现当前页：当前这一天的事项 / 明细
  const dayCounts = useMemo(() => {
    const d = doc.days.find((x) => x.date === selected);
    if (!d) return { ti: 0, td: 0, ii: 0, id: 0, pct: 0 };
    let ti = 0, td = 0, ii = 0, id = 0;
    for (const ev of d.events) {
      ti++;
      if (ev.done) td++;
      for (const g of eventGroups(ev)) {
        ii += g.items.length;
        id += g.items.filter((i) => i.done).length;
      }
    }
    return { ti, td, ii, id, pct: ti + ii ? ((td + id) / (ti + ii)) * 100 : 0 };
  }, [doc, selected]);

  // ---------- 导出长图 ----------
  /** 按勾选的日期导出长图；返回是否成功（成功后由调用方关闭选择框） */
  const doExport = async (dayKeys: string[], title: string): Promise<boolean> => {
    setExporting(true);
    showToast('正在生成长图…', 'info', 1500);
    try {
      const full = docRef.current;
      const filtered: Doc = { ...full, days: full.days.filter((d) => dayKeys.includes(dayKey(d))) };
      const t = resolveTheme(theme);
      const blob = await drawChecklist(filtered, { red: t.accent, soft: t.imgSoft, border: t.imgBorder }, title);
      setPreview(URL.createObjectURL(blob));
      showToast('长图已生成并开启预览', 'success');
      return true;
    } catch (e) {
      showToast(
        e instanceof Error && e.message === 'too-long' ? '清单太长，删掉一些明细后再导出' : '长图生成失败，请再试一次',
        'err'
      );
      return false;
    } finally {
      setExporting(false);
    }
  };
  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };
  useEffect(() => {
    if (!preview) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePreview();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  /** 轨道里某一页：有事项就列出来，没有就显示空态 */
  const renderDay = (key: string) => {
    const day = doc.days.find((d) => d.date === key);
    if (!day) {
      return (
        <div className="empty">
          <p>这一天没有事项</p>
          <p className="sub">左右滑动切换日期，或点上方周视图选一天</p>
        </div>
      );
    }
    return (
      <section className="day single" id={'day-' + key} aria-label={key}>
        <div className="events">
          {day.events.map((ev) => (
            <EventBlock
              key={ev.id}
              ev={ev}
              onTask={toggleTask}
              onToggleItem={toggleItem}
              open={open}
              onSection={toggleSection}
              perSec={counts.perSec}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <>
      <div className="wrap" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <header className="cal-top">
          <div className="cal-nav">
            <div className="pill">
              <button type="button" className="pill-btn" aria-label="上一周" onClick={() => goToDay(addDays(selected, -7))}>
                ‹
              </button>
              <span className="pill-month">{MONTH_CN[selectedDate.getMonth()]}月</span>
              <button type="button" className="pill-btn" aria-label="下一周" onClick={() => goToDay(addDays(selected, 7))}>
                ›
              </button>
            </div>
            <div className="pill">
              <button type="button" className="pill-btn" title="设置" onClick={() => setShowSettings(true)}>
                <GearIcon />
              </button>
            </div>
          </div>

          <div className="week-strip">
            {weekKeys.map((key) => {
              const dt = parseDateKey(key);
              const isSel = key === selected;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={'wday' + (isSel ? ' sel' : '') + (isToday && !isSel ? ' today' : '')}
                  onClick={() => goToDay(key)}
                  aria-label={`${dt.getMonth() + 1}月${dt.getDate()}日`}
                >
                  <span className="wd">{WEEKDAYS[dt.getDay()]}</span>
                  <span className="wnum-wrap">
                    <span className="wnum">{dt.getDate()}</span>
                    <span className="wlun">{lunarDayLabel(dt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="day-head">
          <div className="day-title">
            {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 – 周{WEEKDAYS[selectedDate.getDay()]}
          </div>
          {(() => {
            const full = lunarFullLabel(selectedDate);
            return full ? <div className="day-lunar">{full}</div> : null;
          })()}
        </div>

        <div className="bar">
          <div className="prog">
            <div className="track">
              <div className="fill" style={{ width: dayCounts.pct + '%' }} />
            </div>
            <div className="prog-row">
              <div className="prog-text">
                <span>事项 <b>{dayCounts.td}/{dayCounts.ti}</b></span>
                <span>明细 <b>{dayCounts.id}/{dayCounts.ii}</b></span>
              </div>
              <div className="sync" data-s={sync.s} role="status">{sync.text}</div>
            </div>
          </div>
        </div>

        <main>
          <div
            ref={trackRef}
            className="carousel"
            style={{
              transform: jump
                ? `translateX(${-100 * (jump.go ? jump.to : jump.from)}%)`
                : dragX !== null
                  ? `translateX(calc(-100% + ${dragX}px))`
                  : slideTo !== null
                    ? `translateX(${-100 * slideTo}%)`
                    : 'translateX(-100%)',
              transition: animating
                ? `transform ${jump ? Math.min(0.25 + 0.07 * Math.abs(jump.to - jump.from), 0.6) : 0.3}s ease`
                : 'none',
            }}
            onTransitionEnd={onTrackTransitionEnd}
          >
            {(jump ? jump.days : [addDays(selected, -1), selected, addDays(selected, 1)]).map((key) => (
              <div className="carousel-slide" key={key}>
                {renderDay(key)}
              </div>
            ))}
          </div>
        </main>
      </div>

      {selected !== todayKey && (
        <button type="button" className="today-fab" onClick={() => goToDay(todayKey)}>
          今天
        </button>
      )}

      {toast && (
        <div className={'toast ' + (toast.type || 'info')} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">
            {toast.type === 'success' ? (
              <CheckIcon size={12} />
            ) : toast.type === 'err' ? (
              <CrossIcon size={12} />
            ) : toast.type === 'warn' ? (
              <AlertIcon size={12} />
            ) : (
              <InfoIcon size={12} />
            )}
          </span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          theme={theme}
          onTheme={applyTheme}
          onClose={() => setShowSettings(false)}
          days={doc.days}
          currentKey={selected}
          exporting={exporting}
          onExport={doExport}
          onImported={refetch}
          showToast={showToast}
        />
      )}

      {preview && (
        <div className="preview" role="dialog" aria-modal="true" aria-label="长图预览">
          <div className="preview-bar">
            <a
              className="btn primary"
              href={preview}
              download={`${doc.title}.png`}
              onClick={() => showToast('正在保存长图…', 'success')}
            >
              保存图片
            </a>
            <button type="button" className="btn" onClick={closePreview} autoFocus>关闭</button>
            <p>手机上也可以长按图片保存到相册。</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`${doc.title}长图`} />
        </div>
      )}
    </>
  );
}

function EventBlock({
  ev,
  onTask,
  onToggleItem,
  open,
  onSection,
  perSec,
}: {
  ev: Event;
  onTask: (eid: string, done: boolean) => void;
  onToggleItem: (gid: string, itemId: string, done: boolean) => void;
  open: Record<string, boolean>;
  onSection: (id: string, value: boolean) => void;
  perSec: Record<string, [number, number]>;
}) {
  const allItems = useMemo(() => eventGroups(ev).flatMap((g) => g.items), [ev]);
  const hasItems = allItems.length > 0;
  const doneCount = useMemo(() => allItems.filter((i) => i.done).length, [allItems]);
  const isPartial = hasItems && doneCount > 0 && doneCount < allItems.length;

  return (
    <div className={'event' + (ev.done ? ' done' : '')}>
      <div className="time-row">
        <span className="time">{ev.time}</span>
      </div>

      <div className="task-wrap">
        <label className="task">
          <input
            type="checkbox"
            className="task-checkbox"
            id={'task-' + ev.id}
            checked={ev.done}
            ref={(el) => {
              if (el) el.indeterminate = isPartial;
            }}
            onChange={() => {
              const nextDone = isPartial ? true : !ev.done;
              onTask(ev.id, nextDone);
            }}
          />
          <span className="title">{ev.title}</span>
        </label>
      </div>

      {ev.location && <p className="note">📍 {ev.location}</p>}
      {ev.note && <p className="note">{ev.note}</p>}

      {ev.groups.length > 0 && (
        <div className="direct">
          {ev.groups.map((g) => (
            <GroupBlock key={g.id} group={g} onToggleItem={onToggleItem} />
          ))}
        </div>
      )}

      {ev.sections.map((s) => (
        <SectionBlock
          key={s.id}
          s={s}
          counts={perSec[s.id] ?? [0, 0]}
          open={open[s.id] !== false}
          onToggle={(v) => onSection(s.id, v)}
          onToggleItem={onToggleItem}
        />
      ))}
    </div>
  );
}

function SectionBlock({
  s,
  counts,
  open,
  onToggle,
  onToggleItem,
}: {
  s: Section;
  counts: [number, number];
  open: boolean;
  onToggle: (open: boolean) => void;
  onToggleItem: (gid: string, itemId: string, done: boolean) => void;
}) {
  const [a, b] = counts;

  return (
    <details
      className="sec"
      open={open}
      onToggle={(e) => {
        const v = (e.currentTarget as HTMLDetailsElement).open;
        if (v !== open) onToggle(v);
      }}
    >
      <summary>
        <span className="name">{s.title}</span>
        <span className={'count' + (b > 0 && a === b ? ' full' : '')}>{a}/{b}</span>
        <span className="chev" />
      </summary>

      <div className="sec-body">
        {s.groups.map((g) => (
          <GroupBlock key={g.id} group={g} onToggleItem={onToggleItem} />
        ))}
      </div>
    </details>
  );
}

function GroupBlock({
  group,
  onToggleItem,
}: {
  group: Group;
  onToggleItem: (gid: string, itemId: string, done: boolean) => void;
}) {
  if (!group.items.length) return null;

  return (
    <div className="grp">
      {group.label && (
        <div className="grp-header">
          <div className="grp-label">{group.label}</div>
        </div>
      )}

      <div className="items">
        {group.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onToggle={(done) => onToggleItem(group.id, item.id, done)}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
}: {
  item: Item;
  onToggle: (done: boolean) => void;
}) {
  return (
    <div className="item">
      <label>
        <input
          type="checkbox"
          className="item-checkbox"
          id={'cb-' + item.id}
          checked={item.done}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="t">{item.text}</span>
      </label>
    </div>
  );
}

type SyncSummary = {
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  skipped: { recurring: number; cancelled: number; transparent: number; noUid: number; invalid: number };
};

type SubscriptionInfo = {
  url: string;
  intervalMinutes: number;
  lastSyncAt: string | null;
  lastSummary: SyncSummary | null;
  lastError: string | null;
};

const INTERVAL_OPTIONS = [5, 15, 30, 60];

function intervalLabel(minutes: number): string {
  return minutes >= 60 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function skippedTotalOf(s: SyncSummary): number {
  return s.skipped.recurring + s.skipped.cancelled + s.skipped.transparent + s.skipped.noUid + s.skipped.invalid;
}

function SettingsModal({
  theme,
  onTheme,
  onClose,
  days,
  currentKey,
  exporting,
  onExport,
  onImported,
  showToast,
}: {
  theme: string;
  onTheme: (value: string) => void;
  onClose: () => void;
  days: Day[];
  currentKey: string;
  exporting: boolean;
  onExport: (keys: string[], title: string) => Promise<boolean>;
  onImported: () => Promise<void>;
  showToast: (text: string, type?: 'success' | 'info' | 'warn' | 'err') => void;
}) {
  // 关闭时先播滑出动画，动画结束后再真正卸载
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => setClosing(true), []);
  // 设置页分层（参考 Muse 设置页）：主页选项 → 重点色列表 → 自定义取色板 / 日历订阅 / 刷新间隔 / 导出
  const [view, setView] = useState<'main' | 'colors' | 'custom' | 'subscription' | 'interval' | 'export'>('main');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const isCustom = /^#[0-9a-fA-F]{6}$/.test(theme);
  const customHex = isCustom ? theme : '#7c5cff';
  const currentName = isCustom ? '自定义' : (THEMES[theme]?.name ?? '红色');
  const currentDot = isCustom ? theme : (THEMES[theme]?.accent ?? '#b0262f');

  // 日历订阅：打开设置时读一次配置，主页的订阅行与订阅页共用
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [subUrl, setSubUrl] = useState('');
  const [subLoading, setSubLoading] = useState(true);
  const [subSaving, setSubSaving] = useState(false);
  const [subSyncing, setSubSyncing] = useState(false);
  const [subErr, setSubErr] = useState('');
  const [subResult, setSubResult] = useState<SyncSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/calendar/subscription');
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data.subscription) {
          setSub(data.subscription as SubscriptionInfo);
          setSubUrl(data.subscription.url ?? '');
        }
      } catch {
        // 订阅配置读不到时当作未配置，不阻塞设置页
      } finally {
        if (!cancelled) setSubLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存并同步：存下链接与间隔，立即同步一次
  const handleSaveSubscription = async () => {
    setSubErr('');
    setSubResult(null);
    if (!subUrl.trim()) {
      setSubErr('请填写订阅链接');
      return;
    }
    setSubSaving(true);
    try {
      const res = await fetch('/api/calendar/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subUrl.trim(), intervalMinutes: sub?.intervalMinutes ?? 15 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubErr(data.error || '保存失败，请稍后重试');
        return;
      }
      if (data.subscription) {
        setSub(data.subscription as SubscriptionInfo);
        setSubUrl(data.subscription.url ?? subUrl.trim());
      }
      if (data.sync?.summary) {
        setSubResult(data.sync.summary as SyncSummary);
        showToast(`同步完成：新增 ${data.sync.summary.added}，更新 ${data.sync.summary.updated}`, 'success');
        await onImported();
      } else if (data.sync && !data.sync.ok) {
        setSubErr(data.sync.error || '同步失败');
      }
    } catch {
      setSubErr('网络异常，保存未完成');
    } finally {
      setSubSaving(false);
    }
  };

  // 手动刷新：不改配置，立即同步一次
  const handleManualSync = async () => {
    setSubErr('');
    setSubResult(null);
    setSubSyncing(true);
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubErr(data.error || '同步失败，请稍后重试');
        return;
      }
      if (data.subscription) setSub(data.subscription as SubscriptionInfo);
      if (data.sync?.summary) {
        setSubResult(data.sync.summary as SyncSummary);
        showToast(`同步完成：新增 ${data.sync.summary.added}，更新 ${data.sync.summary.updated}`, 'success');
        await onImported();
      } else if (data.sync && !data.sync.ok) {
        setSubErr(data.sync.error || '同步失败');
      }
    } catch {
      setSubErr('网络异常，同步未完成');
    } finally {
      setSubSyncing(false);
    }
  };

  const handleInterval = async (minutes: number) => {
    setSubErr('');
    try {
      const res = await fetch('/api/calendar/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubErr(data.error || '保存失败，请稍后重试');
        return;
      }
      if (data.subscription) setSub(data.subscription as SubscriptionInfo);
    } catch {
      setSubErr('网络异常，保存未完成');
    }
  };

  const handleCancelSubscription = async () => {
    try {
      await fetch('/api/calendar/subscription', { method: 'DELETE' });
      setSub(null);
      setSubUrl('');
      setSubResult(null);
      setSubErr('');
      showToast('已取消订阅', 'info');
    } catch {
      setSubErr('网络异常，取消未完成');
    }
  };

  // 导出（原独立弹窗的逻辑，搬进设置；导出成功后关掉设置，露出长图预览）
  const exportKeys = days.map((d) => dayKey(d));
  const [sel, setSel] = useState<string[]>(() => (exportKeys.includes(currentKey) ? [currentKey] : exportKeys));
  const [exportTitle, setExportTitle] = useState<string | null>(null);
  const effTitle = exportTitle !== null && exportTitle.trim() ? exportTitle : defaultExportTitle(sel);
  const toggleSel = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const currentInList = exportKeys.includes(currentKey);

  return (
    <div
      className={'sheet-backdrop' + (closing ? ' closing' : '')}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <div
        className={'sheet' + (closing ? ' closing' : '')}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClose();
        }}
      >
        {view === 'main' && (
          <>
            <div className="sheet-head">
              <div className="sheet-title">设置</div>
              <button type="button" className="sheet-close" onClick={close} aria-label="关闭">
                <CrossIcon size={16} />
              </button>
            </div>
            <div className="sheet-card">
              <button type="button" className="sheet-row" onClick={() => setView('colors')} aria-label="重点色">
                <span className="sheet-dot" style={{ background: currentDot }} />
                <span>重点色</span>
                <span className="sheet-value">{currentName}</span>
                <ChevronRightIcon size={18} className="sheet-chev" />
              </button>
            </div>
            <div className="sheet-card">
              <button type="button" className="sheet-row" onClick={() => setView('subscription')} aria-label="日历订阅">
                <span className="sheet-icon">
                  <CalendarIcon size={20} />
                </span>
                <span>日历订阅</span>
                <span className="sheet-value">
                  {subLoading ? '…' : sub && sub.url ? intervalLabel(sub.intervalMinutes) : '未配置'}
                </span>
                <ChevronRightIcon size={18} className="sheet-chev" />
              </button>
            </div>
            <div className="sheet-card">
              <button type="button" className="sheet-row" onClick={() => setView('export')} aria-label="导出">
                <span className="sheet-icon">
                  <ShareIcon size={20} />
                </span>
                <span>导出</span>
                <ChevronRightIcon size={18} className="sheet-chev" />
              </button>
            </div>
            <p className="sheet-foot">只保存在这台设备上，导出长图也会用同一个重点色。</p>
          </>
        )}
        {view === 'colors' && (
          <>
            <div className="sheet-head">
              <button type="button" className="sheet-back" onClick={() => setView('main')} aria-label="返回">
                <ChevronLeftIcon size={20} />
              </button>
              <div className="sheet-title">重点色</div>
            </div>
            <div className="sheet-card">
              {Object.keys(THEMES).map((id) => {
                const t = THEMES[id];
                const sel = theme === id;
                return (
                  <button key={id} type="button" className="sheet-row" onClick={() => onTheme(id)} aria-label={t.name}>
                    <span className="sheet-dot" style={{ background: t.accent }}>
                      {sel && <CheckIcon size={10} />}
                    </span>
                    <span>{t.name}</span>
                  </button>
                );
              })}
              <button type="button" className="sheet-row" onClick={() => setView('custom')} aria-label="自定义颜色">
                <span
                  className="sheet-dot"
                  style={{ background: isCustom ? theme : 'conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
                >
                  {isCustom && <CheckIcon size={10} />}
                </span>
                <span>自定义...</span>
                <ChevronRightIcon size={18} className="sheet-chev" />
              </button>
            </div>
            <p className="sheet-foot">点一个颜色立即应用；自定义颜色在下一层选。</p>
          </>
        )}
        {view === 'custom' && (
          <>
            <div className="sheet-head">
              <button type="button" className="sheet-back" onClick={() => setView('colors')} aria-label="返回">
                <ChevronLeftIcon size={20} />
              </button>
              <div className="sheet-title">颜色</div>
            </div>
            <div className="picker-preview">
              <span className="picker-swatch" style={{ background: customHex }} />
              <span className="picker-hex">{customHex.toUpperCase()}</span>
            </div>
            <div className="picker-grid">
              {PICKER_COLORS.map((hex) => {
                const sel = theme === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    className={'picker-cell' + (sel ? ' sel' : '')}
                    style={{ background: hex, color: luminance(hex) > 0.6 ? 'rgba(0,0,0,.65)' : '#fff' }}
                    onClick={() => onTheme(hex)}
                    aria-label={hex}
                  >
                    {sel && <CheckIcon size={12} />}
                  </button>
                );
              })}
            </div>
            <p className="sheet-foot">点色块立即应用；返回后在“自定义...”能看到它。</p>
          </>
        )}
        {view === 'subscription' && (
          <>
            <div className="sheet-head">
              <button type="button" className="sheet-back" onClick={() => setView('main')} aria-label="返回">
                <ChevronLeftIcon size={20} />
              </button>
              <div className="sheet-title">日历订阅</div>
            </div>
            <p className="sheet-foot" style={{ margin: '0 4px 16px' }}>
              配好订阅链接后，会按刷新间隔在后台静默同步；也可以随时点手动刷新。同步是单向的，日历只读，不回写；按事件 UID 匹配已有事项，勾选状态原样保留。
            </p>
            <div className="sheet-field">
              <label htmlFor="sub-url">订阅链接</label>
              <input
                id="sub-url"
                type="url"
                className="field"
                placeholder="https://…/calendar.ics"
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
              />
              <small style={{ color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                支持 iOS 日历分享的 webcal:// 链接，会自动按 https 拉取。
              </small>
            </div>
            <div className="sheet-card">
              <button type="button" className="sheet-row" onClick={() => setView('interval')} aria-label="刷新间隔">
                <span>刷新间隔</span>
                <span className="sheet-value">{intervalLabel(sub?.intervalMinutes ?? 15)}</span>
                <ChevronRightIcon size={18} className="sheet-chev" />
              </button>
            </div>
            {sub && sub.url && (
              <div style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 4px 0' }}>
                {sub.lastSyncAt ? (
                  <>
                    上次同步：{formatSyncTime(sub.lastSyncAt)}
                    {sub.lastSummary && (
                      <>
                        {' '}· 新增 {sub.lastSummary.added} · 更新 {sub.lastSummary.updated} · 删除 {sub.lastSummary.deleted} · 未变{' '}
                        {sub.lastSummary.unchanged} · 跳过 {skippedTotalOf(sub.lastSummary)}
                      </>
                    )}
                    {sub.lastError && <> · 上次失败：{sub.lastError}</>}
                  </>
                ) : (
                  '尚未同步'
                )}
              </div>
            )}
            {subErr && <div style={{ color: 'var(--red)', fontSize: 13, margin: '12px 4px 0' }}>{subErr}</div>}
            {subResult && (
              <div style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 4px 0' }}>
                同步完成：新增 {subResult.added} · 更新 {subResult.updated} · 删除 {subResult.deleted} · 未变 {subResult.unchanged} · 跳过{' '}
                {skippedTotalOf(subResult)}
              </div>
            )}
            <button type="button" className="sheet-action" disabled={subSaving} onClick={handleSaveSubscription}>
              {subSaving ? '正在保存…' : '保存并同步'}
            </button>
            {sub && sub.url && (
              <button type="button" className="sheet-action secondary" disabled={subSyncing} onClick={handleManualSync}>
                {subSyncing ? '正在同步…' : '手动刷新'}
              </button>
            )}
            {sub && sub.url && (
              <button type="button" className="sheet-danger" onClick={handleCancelSubscription}>
                取消订阅
              </button>
            )}
          </>
        )}
        {view === 'interval' && (
          <>
            <div className="sheet-head">
              <button type="button" className="sheet-back" onClick={() => setView('subscription')} aria-label="返回">
                <ChevronLeftIcon size={20} />
              </button>
              <div className="sheet-title">刷新间隔</div>
            </div>
            <div className="sheet-card">
              {INTERVAL_OPTIONS.map((m) => {
                const sel = (sub?.intervalMinutes ?? 15) === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className="sheet-row"
                    onClick={() => handleInterval(m)}
                    aria-label={intervalLabel(m)}
                  >
                    <span>{intervalLabel(m)}</span>
                    {sel && (
                      <span className="sheet-check">
                        <CheckIcon size={16} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="sheet-foot">按这个间隔在后台静默同步；也可以随时手动刷新。</p>
          </>
        )}
        {view === 'export' && (
          <>
            <div className="sheet-head">
              <button type="button" className="sheet-back" onClick={() => setView('main')} aria-label="返回">
                <ChevronLeftIcon size={20} />
              </button>
              <div className="sheet-title">导出</div>
            </div>
            <p className="sheet-foot" style={{ margin: '0 4px 16px' }}>
              默认只导出当前页；也可以全选或勾选部分日期，再生成长图。
            </p>
            <div className="sheet-field">
              <label htmlFor="export-title">标题</label>
              <input
                id="export-title"
                type="text"
                className="field"
                value={exportTitle ?? defaultExportTitle(sel)}
                onChange={(e) => setExportTitle(e.target.value)}
                placeholder={defaultExportTitle(sel)}
              />
            </div>
            <div className="sheet-shortcuts">
              <button type="button" className="btn sm" onClick={() => setSel(exportKeys)}>
                全选
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => setSel(currentInList ? [currentKey] : [])}
                disabled={!currentInList}
              >
                仅当前
              </button>
              <button type="button" className="btn sm quiet" onClick={() => setSel([])}>
                全不选
              </button>
            </div>
            <div className="sheet-card">
              <div className="export-days">
                {days.map((d) => {
                  const k = dayKey(d);
                  const dt = d.date ? parseDateKey(d.date) : null;
                  const label = dt ? `${dt.getMonth() + 1}月${dt.getDate()}日 周${WEEKDAYS[dt.getDay()]}` : `第${d.day}天`;
                  return (
                    <label key={k} className="export-day">
                      <input type="checkbox" checked={sel.includes(k)} onChange={() => toggleSel(k)} />
                      <span>
                        {label}
                        {k === currentKey ? ' · 当前' : ''}
                      </span>
                      <small>{d.events.length} 个事项</small>
                    </label>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className="sheet-action"
              disabled={sel.length === 0 || exporting}
              onClick={async () => {
                if (await onExport(sel, effTitle)) close();
              }}
            >
              {exporting ? '正在生成…' : `导出图片${sel.length ? `（${sel.length} 天）` : ''}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
