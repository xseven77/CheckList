/**
 * 日历事件 → 清单事项的纯映射逻辑（不碰文件与 store，方便单测）。
 * 合并语义（保留勾选态）由 lib/store.ts 的 importCalendarEvents 实现。
 */
import type { ParsedCalendarEvent } from './ics';
import { parseNoteItems } from './noteItems';
import type { Event } from './types';

const rand = () => Math.random().toString(36).slice(2, 7);

/** yyyy-MM-dd → 几号（兼容旧 Day.day 字段） */
export function dayNumberOf(date: string): number {
  const n = parseInt(date.slice(8, 10), 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 1;
}

/** 清单里展示的时间文案：全天 → 全天，定时 → HH:mm */
export function timeLabel(ev: ParsedCalendarEvent): string {
  return ev.allDay || !ev.time ? '全天' : ev.time;
}

/** 解析事件 → 新清单事项（done 恒为 false；已存在事项的合并在 store 层做）。
 * 备注里的条例行拆成一组可勾选明细，剩余正文留在 note 里。 */
export function toChecklistEvent(parsed: ParsedCalendarEvent): Event {
  const day = dayNumberOf(parsed.date);
  const id = `e${day}_${rand()}`;
  const { items, rest } = parseNoteItems(parsed.description);
  return {
    id,
    time: timeLabel(parsed),
    title: parsed.title,
    note: rest,
    done: false,
    groups:
      items.length > 0
        ? [
            {
              id: `g_${id}`,
              label: '',
              items: items.map((text, i) => ({ id: `n${i + 1}`, text, done: false })),
            },
          ]
        : [],
    sections: [],
    calUid: parsed.uid,
    location: parsed.location || undefined,
  };
}

/** 按 UID 去重（同一 .ics 里重复 UID 只保留第一个） */
export function dedupeByUid(events: ParsedCalendarEvent[]): ParsedCalendarEvent[] {
  const seen = new Set<string>();
  const out: ParsedCalendarEvent[] = [];
  for (const e of events) {
    if (seen.has(e.uid)) continue;
    seen.add(e.uid);
    out.push(e);
  }
  return out;
}

/** 按日期、时间、标题排序，保证多次导入的落盘顺序稳定 */
export function sortParsed(events: ParsedCalendarEvent[]): ParsedCalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.allDay || !a.time ? '' : a.time;
    const tb = b.allDay || !b.time ? '' : b.time;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}
