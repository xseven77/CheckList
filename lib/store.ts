import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  type Change,
  type ChangeInput,
  type Checklist,
  type Day,
  type Event,
  type Item,
  eventGroups,
  findEvent,
  findEventByGroup,
  findGroup,
} from './types';
import type { IcsSkipped, ParsedCalendarEvent } from './ics';
import { dayNumberOf, dedupeByUid, sortParsed, timeLabel, toChecklistEvent } from './calendarSync';
import { parseNoteItems } from './noteItems';

// 数据目录：state.json 是实时数据；第一次启动时从 seed.json 复制一份
const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SEED_FILE = path.resolve(/*turbopackIgnore: true*/ process.env.SEED_FILE || path.join(process.cwd(), 'data', 'seed.json'));

type Store = {
  doc: Checklist | null;
  mtimeMs: number;
  queue: Promise<unknown>;
  bus: EventEmitter;
};

// 挂在 globalThis 上，开发模式热更新时不会丢
const g = globalThis as unknown as { __checklistStore?: Store };
const store: Store = (g.__checklistStore ??= { doc: null, mtimeMs: 0, queue: Promise.resolve(), bus: new EventEmitter() });
store.bus.setMaxListeners(0);

export class NotFoundError extends Error {}

/**
 * 迁移：丢弃无日期的旧天。
 * 老 seed 里写死的天（第3天、第4天……）没有 date 字段；现在的清单只认带日期的天，
 * 且应用已不再提供新建无日期天的入口，所以这类天只可能是历史残留，加载时直接丢弃并写回。
 * 这样无论 state.json 从哪来（老部署、备份恢复），旧数据都不会再冒出来。
 */
function dropDatelessDays(doc: Checklist): boolean {
  const days = Array.isArray(doc.days) ? doc.days : [];
  const kept = days.filter((d) => d && d.date);
  if (kept.length === days.length) return false;
  doc.days = kept;
  return true;
}

export async function readState(): Promise<Checklist> {
  let stat;
  try {
    stat = await fs.stat(STATE_FILE);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const seed = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ SEED_FILE, 'utf8')) as Checklist;
    dropDatelessDays(seed);
    await writeState(seed);
    return seed;
  }
  // 文件被手动改过（mtime 变了）就重新读
  if (!store.doc || stat.mtimeMs !== store.mtimeMs) {
    const raw = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as Checklist;
    if (dropDatelessDays(raw)) {
      // 迁移写回：下次加载就是干净的；写回走原子替换，与正常写入同一路径
      await writeState(raw);
      return raw;
    }
    store.doc = raw;
    store.mtimeMs = stat.mtimeMs;
  }
  return store.doc;
}

async function writeState(doc: Checklist) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, STATE_FILE); // 原子替换，写到一半断电也不会坏
  store.doc = doc;
  store.mtimeMs = (await fs.stat(STATE_FILE)).mtimeMs;
}

/** 所有读写排队执行，避免并发写同一个文件 */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = store.queue.then(fn);
  store.queue = run.catch(() => {});
  return run;
}

async function commit(doc: Checklist, change: ChangeInput): Promise<Change> {
  doc.rev += 1;
  doc.updatedAt = new Date().toISOString();
  await writeState(doc);
  const full = { ...change, rev: doc.rev } as Change;
  store.bus.emit('change', full);
  return full;
}

export function getChecklist(): Promise<Checklist> {
  return serial(readState);
}


export function setTaskDone(id: string, done: boolean): Promise<Change> {
  return serial(async () => {
    const doc = await readState();
    const ev = findEvent(doc, id);
    if (!ev) throw new NotFoundError(id);
    ev.done = done;

    // 联动：大标题勾选/取消勾选，同步级联更新所属的所有小标题
    const updatedGroups: { id: string; items: Item[] }[] = [];
    for (const g of eventGroups(ev)) {
      g.items = g.items.map((i) => ({ ...i, done }));
      updatedGroups.push({ id: g.id, items: g.items });
    }

    return commit(doc, { type: 'task', id, done, groups: updatedGroups });
  });
}
















export type CalendarImportSummary = {
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  skipped: IcsSkipped;
};

/**
 * 日历导入（单向）：解析得到的日历事件合并进清单。
 * - 按 calUid 匹配已有事项：只更新时间/标题/备注/地点，done 与明细原样保留；
 * - 日期变了则把事项搬到对应日期下（空了的同步日期随之删除）；
 * - 未匹配的建新事项；无 date 的旧天在 readState 加载时已丢弃，同步只处理带日期的天。
 * 提交走一次 doc 变更，SSE 会把整份新文档推给所有在线设备。
 */
export function importCalendarEvents(
  parsed: ParsedCalendarEvent[],
  skipped: IcsSkipped
): Promise<{ summary: CalendarImportSummary; rev: number }> {
  return serial(async () => {
    const doc = await readState();
    const summary: CalendarImportSummary = { added: 0, updated: 0, unchanged: 0, deleted: 0, skipped };

    const byUid = new Map<string, { ev: Event; day: Day }>();
    for (const d of doc.days) {
      for (const ev of d.events) {
        if (ev.calUid && !byUid.has(ev.calUid)) byUid.set(ev.calUid, { ev, day: d });
      }
    }

    const findOrCreateDay = (date: string): Day => {
      let target = doc.days.find((d) => d.date === date);
      if (!target) {
        target = { day: dayNumberOf(date), date, events: [] };
        doc.days.push(target);
      }
      return target;
    };

    const feedList = sortParsed(dedupeByUid(parsed));
    for (const p of feedList) {
      const found = byUid.get(p.uid);
      if (found) {
        const { ev, day: oldDay } = found;
        let changed = false;
        const nextTime = timeLabel(p);
        if (ev.time !== nextTime) {
          ev.time = nextTime;
          changed = true;
        }
        if (ev.title !== p.title) {
          ev.title = p.title;
          changed = true;
        }
        const { items: noteItems, rest: noteRest } = parseNoteItems(p.description);
        if (ev.note !== noteRest) {
          ev.note = noteRest;
          changed = true;
        }
        if (noteItems.length > 0) {
          // 按文本匹配旧明细，勾选态原样保留；新增条例默认未勾选
          const oldDone = new Map<string, boolean>();
          for (const g of ev.groups) {
            for (const it of g.items) {
              if (!oldDone.has(it.text)) oldDone.set(it.text, it.done);
            }
          }
          const nextItems = noteItems.map((text, i) => ({ id: `n${i + 1}`, text, done: oldDone.get(text) ?? false }));
          const oldTexts = ev.groups.flatMap((g) => g.items.map((it) => it.text));
          const same = oldTexts.length === nextItems.length && oldTexts.every((t, i) => t === nextItems[i].text);
          if (!same) {
            const gid = ev.groups[0]?.id ?? `g_${ev.id}`;
            ev.groups = [{ id: gid, label: '', items: nextItems }];
            changed = true;
          }
        }
        const nextLoc = p.location || undefined;
        if (ev.location !== nextLoc) {
          ev.location = nextLoc;
          changed = true;
        }
        if (oldDay.date !== p.date) {
          const idx = oldDay.events.findIndex((e) => e === ev);
          if (idx !== -1) oldDay.events.splice(idx, 1);
          if (oldDay.events.length === 0 && oldDay.date) {
            doc.days = doc.days.filter((d) => d !== oldDay);
          }
          const targetDay = findOrCreateDay(p.date);
          targetDay.events.push(ev);
          found.day = targetDay;
          changed = true;
        }
        if (changed) summary.updated += 1;
        else summary.unchanged += 1;
      } else {
        findOrCreateDay(p.date).events.push(toChecklistEvent(p));
        summary.added += 1;
      }
    }

    // 删除：在订阅源里已经没有的同步事项（按 calUid 判断），在系统里也删掉；
    // 只动带 calUid 的同步事项，手工事项（无 calUid）永不被触碰
    const feedUids = new Set(feedList.map((p) => p.uid));
    for (const d of doc.days) {
      const kept = d.events.filter((ev) => !ev.calUid || feedUids.has(ev.calUid));
      const removed = d.events.length - kept.length;
      if (removed > 0) {
        d.events = kept;
        summary.deleted += removed;
      }
    }
    // 删空了的日期随之删除；无日期的旧天在 readState 加载时已丢弃，到这里只剩带日期的天
    doc.days = doc.days
      .filter((d) => d.date && d.events.length > 0)
      .sort((a, b) => (a.date as string) < (b.date as string) ? -1 : 1);

    // 同步日期内事项按时间排（全天在前）
    for (const d of doc.days) {
      d.events.sort((a, b) => {
        const ta = a.time === '全天' ? '' : a.time;
        const tb = b.time === '全天' ? '' : b.time;
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
      });
    }

    const change = await commit(doc, { type: 'doc', doc });
    return { summary, rev: change.rev };
  });
}

/** 切换组内某明细的勾选态（明细内容归日历所有，此处只改 done） */
export function setItemDone(groupId: string, itemId: string, done: boolean): Promise<Change> {
  return serial(async () => {
    const doc = await readState();
    const group = findGroup(doc, groupId);
    if (!group) throw new NotFoundError(groupId);
    const item = group.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundError(itemId);
    item.done = done;

    // 联动：所属事项的所有明细是否已全部勾选
    const ev = findEventByGroup(doc, groupId);
    let eventDone: { id: string; done: boolean } | undefined;
    if (ev) {
      const allItems = eventGroups(ev).flatMap((g) => g.items);
      if (allItems.length > 0) {
        const allDone = allItems.every((i) => i.done);
        if (ev.done !== allDone) {
          ev.done = allDone;
          eventDone = { id: ev.id, done: allDone };
        }
      }
    }

    return commit(doc, { type: 'group', id: groupId, items: group.items, eventDone });
  });
}

export function onChange(fn: (c: Change) => void): () => void {
  store.bus.on('change', fn);
  return () => store.bus.off('change', fn);
}
