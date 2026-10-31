import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { type AIAction, type Change, type ChangeInput, type Checklist, type Event, type Item, eventGroups, findEvent, findEventByGroup, findGroup } from './types';

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

export async function readState(): Promise<Checklist> {
  let stat;
  try {
    stat = await fs.stat(STATE_FILE);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const seed = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ SEED_FILE, 'utf8')) as Checklist;
    await writeState(seed);
    return seed;
  }
  // 文件被手动改过（mtime 变了）就重新读
  if (!store.doc || stat.mtimeMs !== store.mtimeMs) {
    store.doc = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as Checklist;
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

export function setGroupItems(id: string, items: Item[]): Promise<Change> {
  return serial(async () => {
    const doc = await readState();
    const group = findGroup(doc, id);
    if (!group) throw new NotFoundError(id);
    group.items = items;

    // 联动：检查所属事项的所有小标题是否已全部勾选
    const ev = findEventByGroup(doc, id);
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

    return commit(doc, { type: 'group', id, items, eventDone });
  });
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

export function updateEvent(id: string, updates: { time?: string; title?: string; note?: string }): Promise<Change> {
  return serial(async () => {
    const doc = await readState();
    const ev = findEvent(doc, id);
    if (!ev) throw new NotFoundError(id);
    if (typeof updates.time === 'string') ev.time = updates.time.trim();
    if (typeof updates.title === 'string' && updates.title.trim()) ev.title = updates.title.trim();
    if (typeof updates.note === 'string') ev.note = updates.note.trim();
    return commit(doc, { type: 'doc', doc });
  });
}

export function addDay(day: number, initialEvent?: { title?: string; time?: string }): Promise<Change> {
  return serial(async () => {
    const doc = await readState();
    let targetDay = doc.days.find((d) => d.day === day);
    const evTitle = initialEvent?.title?.trim() || '全天安排';
    const evTime = initialEvent?.time?.trim() || '全天';
    const newEvent: Event = {
      id: 'e' + day + '_' + Math.random().toString(36).slice(2, 7),
      time: evTime,
      title: evTitle,
      note: '',
      done: false,
      groups: [
        {
          id: 'g' + day + '_' + Math.random().toString(36).slice(2, 7),
          label: '待办明细',
          items: [],
        },
      ],
      sections: [],
    };

    if (targetDay) {
      targetDay.events.push(newEvent);
    } else {
      targetDay = {
        day,
        events: [newEvent],
      };
      doc.days.push(targetDay);
      doc.days.sort((a, b) => a.day - b.day);
    }

    return commit(doc, { type: 'doc', doc });
  });
}

export function applyAIActions(actions: AIAction[], summary: string): Promise<{ doc: Checklist; summary: string }> {
  return serial(async () => {
    const doc = await readState();
    let modified = false;

    for (const action of actions) {
      if (action.type === 'add_event') {
        const day = action.day;
        let targetDay = doc.days.find((d) => d.day === day);
        if (!targetDay) {
          targetDay = { day, events: [] };
          doc.days.push(targetDay);
          doc.days.sort((a, b) => a.day - b.day);
        }

        const items: Item[] = (action.items || [])
          .map((t) => ({
            id: 'i_' + Math.random().toString(36).slice(2, 8),
            text: t.trim(),
            done: false,
          }))
          .filter((i) => i.text.length > 0);

        const newEvent: Event = {
          id: 'e' + day + '_' + Math.random().toString(36).slice(2, 7),
          time: action.time?.trim() || '全天',
          title: action.title?.trim() || '新增日程',
          note: action.note?.trim() || '',
          done: false,
          groups: [
            {
              id: 'g' + day + '_' + Math.random().toString(36).slice(2, 7),
              label: action.groupLabel?.trim() || '待办明细',
              items,
            },
          ],
          sections: [],
        };
        targetDay.events.push(newEvent);
        modified = true;
      } else if (action.type === 'add_items') {
        let targetEvent: Event | undefined;
        if (action.day !== undefined) {
          const d = doc.days.find((day) => day.day === action.day);
          if (d) {
            if (action.eventTitle) {
              const q = action.eventTitle.trim().toLowerCase();
              targetEvent = d.events.find((e) => e.title.toLowerCase().includes(q) || q.includes(e.title.toLowerCase()));
            }
            if (!targetEvent && d.events.length > 0) {
              targetEvent = d.events[0];
            }
          }
        }
        if (!targetEvent && action.eventTitle) {
          const q = action.eventTitle.trim().toLowerCase();
          for (const d of doc.days) {
            targetEvent = d.events.find((e) => e.title.toLowerCase().includes(q) || q.includes(e.title.toLowerCase()));
            if (targetEvent) break;
          }
        }
        if (!targetEvent && doc.days.length > 0) {
          const lastDay = doc.days[doc.days.length - 1];
          targetEvent = lastDay.events[lastDay.events.length - 1];
        }

        if (targetEvent) {
          let targetGroup = targetEvent.groups[0];
          if (!targetGroup) {
            targetGroup = {
              id: 'g_' + Math.random().toString(36).slice(2, 7),
              label: action.groupLabel || '待办明细',
              items: [],
            };
            targetEvent.groups.push(targetGroup);
          }
          for (const t of action.items) {
            const trimmed = t.trim();
            if (trimmed) {
              targetGroup.items.push({
                id: 'i_' + Math.random().toString(36).slice(2, 8),
                text: trimmed,
                done: false,
              });
            }
          }
          modified = true;
        }
      } else if (action.type === 'set_done') {
        const query = action.target.trim().toLowerCase();
        for (const d of doc.days) {
          if (action.day !== undefined && d.day !== action.day) continue;
          for (const ev of d.events) {
            if (ev.title.toLowerCase().includes(query) || query.includes(ev.title.toLowerCase())) {
              ev.done = action.done;
              for (const g of eventGroups(ev)) {
                for (const it of g.items) {
                  it.done = action.done;
                }
              }
              modified = true;
            }
            for (const g of eventGroups(ev)) {
              for (const it of g.items) {
                if (it.text.toLowerCase().includes(query) || query.includes(it.text.toLowerCase())) {
                  it.done = action.done;
                  modified = true;
                }
              }
            }
          }
        }
      }
    }

    if (modified) {
      commit(doc, { type: 'doc', doc });
    }
    return { doc, summary };
  });
}

export function onChange(fn: (c: Change) => void): () => void {
  store.bus.on('change', fn);
  return () => store.bus.off('change', fn);
}
