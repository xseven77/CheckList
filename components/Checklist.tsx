'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { drawChecklist } from '@/lib/exportImage';
import { type Change, type Checklist as Doc, type Event, type Group, type Item, LIMITS, eventGroups, findGroup } from '@/lib/types';

type SyncState = { s: 'wait' | 'ok' | 'err'; text: string };
const SYNC_OK: SyncState = { s: 'ok', text: '已同步 · 打开这个页面的人看到同一份清单' };
const OPEN_KEY = 'checklist-open-v1';

const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
  const [editing, setEditing] = useState(false);
  const [sync, setSync] = useState<SyncState>({ s: 'wait', text: '正在连接…' });
  const [writer] = useState(() => createWriter(setSync));
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // ---------- 实时同步 ----------
  useEffect(() => {
    // 用服务器的整份数据，但保留本机还没保存完的修改
    const refetch = async () => {
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
    };
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
      if (c.type === 'group' && !writer.pending('groups/' + c.id)) commit(mapGroup(docRef.current, c.id, () => c.items));
      if (c.type === 'task' && !writer.pending('tasks/' + c.id)) commit(mapEvent(docRef.current, c.id, c.done));
    };
    return () => es.close();
  }, [writer]);

  useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'));
    } catch {}
  }, []);
  const toggleSection = (id: string, value: boolean) => {
    setOpen((o) => {
      const next = { ...o, [id]: value };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // ---------- 修改 ----------
  const updateGroup = (gid: string, fn: (items: Item[]) => Item[]) => {
    const next = mapGroup(docRef.current, gid, fn);
    commit(next);
    writer.send('groups/' + gid, { items: findGroup(next, gid)!.items });
  };
  const toggleTask = (eid: string, done: boolean) => {
    commit(mapEvent(docRef.current, eid, done));
    writer.send('tasks/' + eid, { done });
  };
  const deleteItem = (gid: string, item: Item) => {
    const index = findGroup(docRef.current, gid)?.items.findIndex((i) => i.id === item.id) ?? -1;
    if (index < 0) return;
    updateGroup(gid, (items) => items.filter((i) => i.id !== item.id));
    setToast({
      text: `已删除“${item.text}”`,
      undo: () =>
        updateGroup(gid, (items) => {
          if (items.some((i) => i.id === item.id)) return items;
          const copy = items.slice();
          copy.splice(Math.min(index, copy.length), 0, item);
          return copy;
        }),
    });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- 进度 ----------
  const counts = useMemo(() => {
    let ti = 0, td = 0, ii = 0, id = 0;
    const perDay: Record<number, [number, number]> = {};
    const perSec: Record<string, [number, number]> = {};
    for (const d of doc.days) {
      const pd = (perDay[d.day] = [0, 0]);
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

  // ---------- 导出长图 ----------
  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await drawChecklist(docRef.current);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setSync({ s: 'err', text: e instanceof Error && e.message === 'too-long' ? '清单太长，删掉一些明细后再导出' : '长图生成失败，请再试一次' });
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

  const groupProps = { editing, onUpdate: updateGroup, onDelete: deleteItem };

  return (
    <>
      <div className="wrap">
        <header className="top">
          <div className="seal" aria-hidden="true">囍</div>
          <div>
            <h1>{doc.title}</h1>
            <p className="lede">{doc.subtitle}</p>
          </div>
        </header>

        <div className="bar">
          <div className="prog">
            <div className="track">
              <div className="fill" style={{ width: counts.pct + '%' }} />
            </div>
            <div className="prog-text">
              <span>事项 <b>{counts.td}/{counts.ti}</b></span>
              <span>明细 <b>{counts.id}/{counts.ii}</b></span>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
              {editing ? '完成' : '编辑'}
            </button>
            <button type="button" className="btn" onClick={doExport} disabled={exporting}>
              {exporting ? '正在生成…' : '导出长图'}
            </button>
          </div>
          <div className="sync" data-s={sync.s} role="status">{sync.text}</div>
        </div>

        {editing && <div className="edit-banner">编辑中：可以增加、修改、删除明细。改完点“完成”回到查看状态。</div>}

        <main>
          {doc.days.map((d) => (
            <section className="day" key={d.day} aria-label={`${d.day} 号`}>
              <div className="date">
                {d.day}
                <span className="unit">号</span>
                <small>{counts.perDay[d.day]?.[0] ?? 0}/{counts.perDay[d.day]?.[1] ?? 0}</small>
              </div>
              <div className="events">
                {d.events.map((ev) => (
                  <EventBlock key={ev.id} ev={ev} onTask={toggleTask} open={open} onSection={toggleSection} perSec={counts.perSec} {...groupProps} />
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              toast.undo();
              setToast(null);
            }}
          >
            撤销
          </button>
        </div>
      )}

      {preview && (
        <div className="preview" role="dialog" aria-modal="true" aria-label="长图预览">
          <div className="preview-bar">
            <a className="btn primary" href={preview} download={`${doc.title}.png`}>保存图片</a>
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

type GroupProps = {
  editing: boolean;
  onUpdate: (gid: string, fn: (items: Item[]) => Item[]) => void;
  onDelete: (gid: string, item: Item) => void;
};

function EventBlock({
  ev, onTask, open, onSection, perSec, ...gp
}: GroupProps & {
  ev: Event;
  onTask: (eid: string, done: boolean) => void;
  open: Record<string, boolean>;
  onSection: (id: string, value: boolean) => void;
  perSec: Record<string, [number, number]>;
}) {
  return (
    <div className={'event' + (ev.done ? ' done' : '')}>
      <span className="time">{ev.time}</span>
      <label className="task">
        <input type="checkbox" id={'task-' + ev.id} checked={ev.done} onChange={(e) => onTask(ev.id, e.target.checked)} />
        <span className="title">{ev.title}</span>
      </label>
      {ev.note && <p className="note">{ev.note}</p>}
      {ev.groups.length > 0 && (
        <div className="direct">
          {ev.groups.map((g) => (
            <GroupBlock key={g.id} group={g} {...gp} />
          ))}
        </div>
      )}
      {ev.sections.map((s) => {
        const [a, b] = perSec[s.id] ?? [0, 0];
        return (
          <details
            key={s.id}
            className="sec"
            open={open[s.id] !== false}
            onToggle={(e) => {
              const v = (e.currentTarget as HTMLDetailsElement).open;
              if (v !== (open[s.id] !== false)) onSection(s.id, v);
            }}
          >
            <summary>
              <span className="name">{s.title}</span>
              <span className={'count' + (b > 0 && a === b ? ' full' : '')}>{a}/{b}</span>
              <span className="chev" />
            </summary>
            <div className="sec-body">
              {s.groups.map((g) => (
                <GroupBlock key={g.id} group={g} {...gp} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function GroupBlock({ group, editing, onUpdate, onDelete }: GroupProps & { group: Group }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder = group.label ? `增加到「${group.label}」` : '增加一条明细';
  if (!editing && !group.items.length) return null;
  return (
    <div className="grp">
      {group.label && <div className="grp-label">{group.label}</div>}
      <div className="items">
        {group.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            editing={editing}
            onToggle={(done) => onUpdate(group.id, (items) => items.map((i) => (i.id === item.id ? { ...i, done } : i)))}
            onRename={(text) => onUpdate(group.id, (items) => items.map((i) => (i.id === item.id ? { ...i, text } : i)))}
            onDelete={() => onDelete(group.id, item)}
          />
        ))}
      </div>
      {editing && (
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return inputRef.current?.focus();
            if (group.items.length >= LIMITS.items) return;
            onUpdate(group.id, (items) => [...items, { id: newId(), text, done: false }]);
            setDraft('');
            inputRef.current?.focus();
          }}
        >
          <input
            ref={inputRef}
            className="field"
            id={'add-' + group.id}
            type="text"
            maxLength={LIMITS.text}
            enterKeyHint="done"
            placeholder={placeholder}
            aria-label={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn sm">＋ 增加</button>
        </form>
      )}
    </div>
  );
}

function ItemRow({
  item, editing, onToggle, onRename, onDelete,
}: {
  item: Item;
  editing: boolean;
  onToggle: (done: boolean) => void;
  onRename: (text: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm'>('idle');
  const [draft, setDraft] = useState(item.text);
  useEffect(() => {
    if (!editing) setMode('idle');
  }, [editing]);

  if (editing && mode === 'edit') {
    const save = () => {
      const t = draft.trim();
      if (!t) return;
      if (t !== item.text) onRename(t);
      setMode('idle');
    };
    return (
      <div className="item">
        <input
          className="field editor"
          id={'edit-' + item.id}
          type="text"
          value={draft}
          maxLength={LIMITS.text}
          enterKeyHint="done"
          aria-label="修改明细内容"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') setMode('idle');
          }}
        />
        <button type="button" className="btn sm primary" onClick={save}>保存</button>
        <button type="button" className="btn sm quiet" onClick={() => setMode('idle')}>取消</button>
      </div>
    );
  }

  return (
    <div className="item">
      <label>
        <input type="checkbox" id={'cb-' + item.id} checked={item.done} onChange={(e) => onToggle(e.target.checked)} />
        <span className="t">{item.text}</span>
      </label>
      {editing && (
        <div className="ops">
          <button
            type="button"
            className="btn sm quiet"
            aria-label={`修改 ${item.text}`}
            onClick={() => {
              setDraft(item.text);
              setMode('edit');
            }}
          >
            修改
          </button>
          <button type="button" className="btn sm quiet" aria-label={`删除 ${item.text}`} onClick={() => setMode('confirm')}>
            删除
          </button>
        </div>
      )}
      {editing && mode === 'confirm' && (
        <div className="confirm" role="group" aria-label="删除确认">
          <p>确定删除“{item.text}”吗？</p>
          <button type="button" className="btn sm danger" onClick={onDelete}>确认删除</button>
          <button type="button" className="btn sm" onClick={() => setMode('idle')} autoFocus>取消</button>
        </div>
      )}
    </div>
  );
}
