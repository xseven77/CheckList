export type Item = { id: string; text: string; done: boolean };

export type Group = { id: string; label: string; items: Item[] };

export type Section = { id: string; title: string; groups: Group[] };

export type Event = {
  id: string;
  time: string;
  title: string;
  note: string;
  done: boolean;
  groups: Group[];
  sections: Section[];
  /** 日历事件 UID（日历同步时写入，用于跨次同步匹配，保留勾选态） */
  calUid?: string;
  /** 日历事件地点 */
  location?: string;
};

export type Day = {
  day: number;
  /** 完整日期 yyyy-MM-dd；无 date 的旧天在加载时会被丢弃（见 readState 迁移） */
  date?: string;
  events: Event[];
};

export type Checklist = {
  version: 1;
  rev: number;
  updatedAt: string | null;
  title: string;
  subtitle: string;
  days: Day[];
};

/** 服务端推送给页面的单条变更 */
export type Change =
  | { type: 'group'; id: string; items: Item[]; eventDone?: { id: string; done: boolean }; rev: number }
  | { type: 'task'; id: string; done: boolean; groups?: { id: string; items: Item[] }[]; rev: number }
  | { type: 'doc'; doc: Checklist; rev: number };

export type ChangeInput =
  | { type: 'group'; id: string; items: Item[]; eventDone?: { id: string; done: boolean } }
  | { type: 'task'; id: string; done: boolean; groups?: { id: string; items: Item[] }[] }
  | { type: 'doc'; doc: Checklist };



export function eventGroups(ev: Event): Group[] {
  return [...ev.groups, ...ev.sections.flatMap((s) => s.groups)];
}

export function findGroup(doc: Checklist, id: string): Group | undefined {
  for (const d of doc.days) for (const ev of d.events) for (const g of eventGroups(ev)) if (g.id === id) return g;
}

export function findEvent(doc: Checklist, id: string): Event | undefined {
  for (const d of doc.days) for (const ev of d.events) if (ev.id === id) return ev;
}

export function findEventByGroup(doc: Checklist, gid: string): Event | undefined {
  for (const d of doc.days) {
    for (const ev of d.events) {
      for (const g of eventGroups(ev)) {
        if (g.id === gid) return ev;
      }
    }
  }
}




