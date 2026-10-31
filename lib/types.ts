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
};

export type Day = { day: number; events: Event[] };

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
  | { type: 'task'; id: string; done: boolean; groups?: { id: string; items: Item[] }[]; rev: number };

export type ChangeInput =
  | { type: 'group'; id: string; items: Item[]; eventDone?: { id: string; done: boolean } }
  | { type: 'task'; id: string; done: boolean; groups?: { id: string; items: Item[] }[] };

export const LIMITS = { items: 200, text: 160 } as const;

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

/** 校验并整理客户端提交的明细列表，不合法时返回 null */
export function cleanItems(raw: unknown): Item[] | null {
  if (!Array.isArray(raw) || raw.length > LIMITS.items) return null;
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null;
    const { id, text, done } = it as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id) || seen.has(id)) return null;
    if (typeof text !== 'string') return null;
    const t = text.trim().slice(0, LIMITS.text);
    if (!t) return null;
    seen.add(id);
    out.push({ id, text: t, done: done === true });
  }
  return out;
}
