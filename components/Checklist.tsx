'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawChecklist } from '@/lib/exportImage';
import { type Change, type Checklist as Doc, type Event, type Group, type Item, type Section, LIMITS, eventGroups, findEventByGroup, findGroup } from '@/lib/types';
import VoiceModal from '@/components/VoiceModal';
import { AlertIcon, CheckIcon, CrossIcon, EditPencilIcon, InfoIcon, MicIcon, PlusIcon, SparklesIcon, TrashIcon } from '@/components/Icons';

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
  const [editing, setEditing] = useState(false);
  const [sync, setSync] = useState<SyncState>({ s: 'wait', text: '正在连接…' });
  const [writer] = useState(() => createWriter(setSync));
  const [toast, setToast] = useState<{
    text: string;
    type?: 'success' | 'info' | 'warn' | 'err';
    undo?: () => void;
  } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback(
    (text: string, type: 'success' | 'info' | 'warn' | 'err' = 'info', undo?: () => void, duration = 2800) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ text, type, undo });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
      }, undo ? 8000 : duration);
    },
    []
  );

  const [preview, setPreview] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showAddDay, setShowAddDay] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  const earliestDay = useMemo(() => {
    const days = doc.days.map((d) => d.day);
    return days.length ? Math.min(...days) : 3;
  }, [doc.days]);

  const latestDay = useMemo(() => {
    const days = doc.days.map((d) => d.day);
    return days.length ? Math.max(...days) : 7;
  }, [doc.days]);

  const [addDayDefault, setAddDayDefault] = useState<number>(8);

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

  // ---------- 日期拓展 ----------
  const handleAddDay = async (day: number, title?: string, time?: string) => {
    const res = await fetch('/api/days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, title, time }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '添加失败');
    }
    const data = await res.json();
    if (data.doc) {
      commit(data.doc);
    }
    showToast(`已成功新增 ${day} 号日程！`, 'success');
    setShowAddDay(false);
    setTimeout(() => {
      const el = document.getElementById(`day-${day}`);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // ---------- AI 语音配置转换 ----------
  const handleApplyAI = async (text: string) => {
    const res = await fetch('/api/ai/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'AI 解析失败');
    }
    const data = await res.json();
    if (data.doc) {
      commit(data.doc);
    }
    return data;
  };

  // ---------- 编辑事项标题与时间小标题 ----------
  const handleUpdateEvent = async (eid: string, updates: { time?: string; title?: string }) => {
    try {
      const res = await fetch('/api/tasks/' + eid, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        showToast('修改失败，请重试', 'err');
        return;
      }
      const data = await res.json();
      if (data.doc) commit(data.doc);
      else {
        commit({
          ...docRef.current,
          days: docRef.current.days.map((d) => ({
            ...d,
            events: d.events.map((ev) => (ev.id === eid ? { ...ev, ...updates } : ev)),
          })),
        });
      }
      if (updates.time) showToast(`已将时间修改为“${updates.time}”`, 'success');
      if (updates.title) showToast(`已将标题修改为“${updates.title}”`, 'success');
    } catch {
      showToast('网络异常，修改未保存', 'err');
    }
  };

  // ---------- 全层级节点管理 (增删改查) ----------
  const mutateNode = useCallback(
    async (payload: { action: string; [key: string]: unknown }) => {
      try {
        const res = await fetch('/api/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || '操作失败，请重试', 'err');
          return false;
        }
        const data = await res.json();
        if (data.doc) commit(data.doc);
        return true;
      } catch {
        showToast('网络异常，操作未保存', 'err');
        return false;
      }
    },
    [showToast]
  );

  const handleAddEvent = async (day: number, title: string, time?: string) => {
    const ok = await mutateNode({ action: 'add_event', day, title, time });
    if (ok) showToast(`已新增事项「${title}」`, 'success');
    return ok;
  };

  const handleDeleteEvent = async (id: string, title: string) => {
    const ok = await mutateNode({ action: 'delete_event', id });
    if (ok) showToast(`已删除事项「${title}」`, 'info');
    return ok;
  };

  const handleAddSection = async (eventId: string, title: string) => {
    const ok = await mutateNode({ action: 'add_section', eventId, title });
    if (ok) showToast(`已增加分类卡片「${title}」`, 'success');
    return ok;
  };

  const handleUpdateSection = async (id: string, title: string) => {
    const ok = await mutateNode({ action: 'update_section', id, title });
    if (ok) showToast(`已将分类修改为“${title}”`, 'success');
    return ok;
  };

  const handleDeleteSection = async (id: string, title: string) => {
    const ok = await mutateNode({ action: 'delete_section', id });
    if (ok) showToast(`已删除分类卡片「${title}」`, 'info');
    return ok;
  };

  const handleAddGroup = async (parent: { eventId?: string; sectionId?: string }, label: string) => {
    const ok = await mutateNode({ action: 'add_group', ...parent, label });
    if (ok) showToast(`已增加分组「${label}」`, 'success');
    return ok;
  };

  const handleUpdateGroupLabel = async (id: string, label: string) => {
    const ok = await mutateNode({ action: 'update_group_label', id, label });
    if (ok) showToast(`已修改分组为“${label}”`, 'success');
    return ok;
  };

  const handleDeleteGroup = async (id: string, label: string) => {
    const ok = await mutateNode({ action: 'delete_group', id });
    if (ok) showToast(`已删除分组「${label || '待办分组'}」`, 'info');
    return ok;
  };

  const handleDeleteDay = async (day: number) => {
    const ok = await mutateNode({ action: 'delete_day', day });
    if (ok) showToast(`已删除 ${day} 号日程`, 'info');
    return ok;
  };

  const [confirmDeleteDay, setConfirmDeleteDay] = useState<number | null>(null);
  const [addingEventDay, setAddingEventDay] = useState<number | null>(null);
  const [draftEventTime, setDraftEventTime] = useState('');
  const [draftEventTitle, setDraftEventTitle] = useState('');

  // ---------- 修改 ----------
  const updateGroup = (gid: string, fn: (items: Item[]) => Item[]) => {
    let next = mapGroup(docRef.current, gid, fn);
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
    writer.send('groups/' + gid, { items: findGroup(next, gid)!.items });
  };
  const toggleTask = (eid: string, done: boolean) => {
    // 联动检查：勾选大标题，同步将对应所有小标题都勾上或取消
    const next = mapEventCascade(docRef.current, eid, done);
    commit(next);
    writer.send('tasks/' + eid, { done });
    showToast(done ? '已完成该事项及所属全部明细' : '已取消勾选事项', 'info');
  };
  const deleteItem = (gid: string, item: Item) => {
    const index = findGroup(docRef.current, gid)?.items.findIndex((i) => i.id === item.id) ?? -1;
    if (index < 0) return;
    updateGroup(gid, (items) => items.filter((i) => i.id !== item.id));
    showToast(
      `已删除“${item.text}”`,
      'info',
      () => {
        updateGroup(gid, (items) => {
          if (items.some((i) => i.id === item.id)) return items;
          const copy = items.slice();
          copy.splice(Math.min(index, copy.length), 0, item);
          return copy;
        });
        showToast(`已恢复“${item.text}”`, 'success');
      },
      8000
    );
  };

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
    showToast('正在生成长图…', 'info', undefined, 1500);
    try {
      const blob = await drawChecklist(docRef.current);
      setPreview(URL.createObjectURL(blob));
      showToast('长图已生成并开启预览', 'success');
    } catch (e) {
      showToast(
        e instanceof Error && e.message === 'too-long' ? '清单太长，删掉一些明细后再导出' : '长图生成失败，请再试一次',
        'err'
      );
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

  const nodeProps = {
    editing,
    onUpdate: updateGroup,
    onDelete: deleteItem,
    onUpdateEvent: handleUpdateEvent,
    onDeleteEvent: handleDeleteEvent,
    onAddSection: handleAddSection,
    onUpdateSection: handleUpdateSection,
    onDeleteSection: handleDeleteSection,
    onAddGroup: handleAddGroup,
    onUpdateGroupLabel: handleUpdateGroupLabel,
    onDeleteGroup: handleDeleteGroup,
    showToast,
  };


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
            <button
              type="button"
              className="btn primary"
              aria-pressed={editing}
              onClick={() => {
                setEditing((v) => {
                  const next = !v;
                  showToast(next ? '已开启编辑模式（可增删改明细与小标题）' : '已退出编辑模式', 'info');
                  return next;
                });
              }}
            >
              {editing ? '完成' : '编辑'}
            </button>
            <button type="button" className="btn" onClick={doExport} disabled={exporting}>
              {exporting ? '正在生成…' : '导出长图'}
            </button>
          </div>
          <div className="sync" data-s={sync.s} role="status">{sync.text}</div>
        </div>

        {editing && <div className="edit-banner">编辑模式已开启：可对日期、事项、分类卡片、分组及明细全层级进行增删改查。完成后点击“完成”。</div>}

        <main>
          {/* 顶部快捷往前新增一天日程 */}
          <div className="add-day-top-wrap">
            <button
              type="button"
              className="add-day-top-btn"
              onClick={() => {
                setAddDayDefault(Math.max(1, earliestDay - 1));
                setShowAddDay(true);
              }}
            >
              <PlusIcon size={13} />
              <span>往前新增一天日程（如 {Math.max(1, earliestDay - 1)} 号）</span>
            </button>
          </div>

          {doc.days.map((d) => (
            <section className="day" id={'day-' + d.day} key={d.day} aria-label={`${d.day} 号`}>
              <div className="date">
                <div className="day-header">
                  <div>
                    {d.day}
                    <span className="unit">号</span>
                  </div>
                  <small>{counts.perDay[d.day]?.[0] ?? 0}/{counts.perDay[d.day]?.[1] ?? 0}</small>
                  {editing && (
                    <button
                      type="button"
                      className="day-delete-btn"
                      title={`删除 ${d.day} 号日程`}
                      onClick={() => setConfirmDeleteDay(d.day)}
                    >
                      删除此日
                    </button>
                  )}
                </div>
              </div>

              {confirmDeleteDay === d.day && (
                <div className="confirm day-confirm">
                  <p>确定删除 {d.day} 号日程及其全部事项与明细吗？</p>
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={async () => {
                      await handleDeleteDay(d.day);
                      setConfirmDeleteDay(null);
                    }}
                  >
                    确认删除
                  </button>
                  <button type="button" className="btn sm" onClick={() => setConfirmDeleteDay(null)}>
                    取消
                  </button>
                </div>
              )}

              <div className="events">
                {d.events.map((ev) => (
                  <EventBlock
                    key={ev.id}
                    ev={ev}
                    onTask={toggleTask}
                    open={open}
                    onSection={toggleSection}
                    perSec={counts.perSec}
                    {...nodeProps}
                  />
                ))}

                {editing && (
                  <div className="add-event-wrap">
                    {addingEventDay === d.day ? (
                      <div className="add-event-form">
                        <input
                          type="text"
                          className="field add-event-time"
                          placeholder="时间（如：上午、15:00）"
                          value={draftEventTime}
                          maxLength={20}
                          onChange={(e) => setDraftEventTime(e.target.value)}
                        />
                        <input
                          type="text"
                          className="field add-event-title"
                          placeholder="事项标题（如：婚礼彩排、迎宾晚宴）"
                          value={draftEventTitle}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setDraftEventTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const t = draftEventTitle.trim();
                              if (t) {
                                handleAddEvent(d.day, t, draftEventTime);
                                setAddingEventDay(null);
                                setDraftEventTitle('');
                                setDraftEventTime('');
                              }
                            }
                            if (e.key === 'Escape') setAddingEventDay(null);
                          }}
                        />
                        <div className="add-event-actions">
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={() => {
                              const t = draftEventTitle.trim();
                              if (t) {
                                handleAddEvent(d.day, t, draftEventTime);
                                setAddingEventDay(null);
                                setDraftEventTitle('');
                                setDraftEventTime('');
                              }
                            }}
                          >
                            添加事项
                          </button>
                          <button
                            type="button"
                            className="btn sm quiet"
                            onClick={() => setAddingEventDay(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="add-event-btn"
                        onClick={() => {
                          setAddingEventDay(d.day);
                          setDraftEventTime('');
                          setDraftEventTitle('');
                        }}
                      >
                        <PlusIcon size={13} />
                        <span>新增事项（在 {d.day} 号）</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          ))}


          {/* 底部往后新增一天日程 */}
          <div className="add-day-wrap">
            <button
              type="button"
              className="add-day-btn"
              onClick={() => {
                setAddDayDefault(latestDay + 1);
                setShowAddDay(true);
              }}
            >
              <PlusIcon size={14} />
              <span>往后新增一天日程（如 {latestDay + 1} 号）</span>
            </button>
          </div>
        </main>
      </div>

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
          {toast.undo && (
            <button
              type="button"
              className="btn sm toast-undo-btn"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}

      {showAddDay && (
        <AddDayModal
          defaultDay={addDayDefault}
          existingDays={doc.days.map((d) => d.day)}
          onClose={() => setShowAddDay(false)}
          onAdd={handleAddDay}
        />
      )}

      {/* 手机端/页面浮动 AI 助手按钮 */}
      <button
        type="button"
        className="ai-voice-fab"
        onClick={() => setShowVoiceModal(true)}
        aria-label="打开 AI 语音口述助手"
      >
        <span className="ai-voice-fab-icon" aria-hidden="true">
          <SparklesIcon size={18} />
        </span>
        <span>AI 语音口述</span>
      </button>

      <VoiceModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        onApplyAI={handleApplyAI}
        showToast={showToast}
      />

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

function AddDayModal({
  defaultDay,
  existingDays,
  onClose,
  onAdd,
}: {
  defaultDay: number;
  existingDays: number[];
  onClose: () => void;
  onAdd: (day: number, title?: string, time?: string) => Promise<void>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setErr('请输入 1 到 31 之间的有效数字');
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      await onAdd(day, title, time);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '新增失败，请稍后重试';
      setErr(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="新增日期日程">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>新增日期日程</h2>
        <p className="sub">为清单增加新的日程（例如 8 号、9 号），自动实时同步给所有人。</p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="modal-field">
            <label htmlFor="modal-day">几号 (1-31 日)</label>
            <input
              id="modal-day"
              type="number"
              min={1}
              max={31}
              className="field"
              value={day}
              onChange={(e) => setDay(parseInt(e.target.value, 10))}
              required
              autoFocus
            />
            {existingDays.includes(day) && (
              <small style={{ color: 'var(--gold)', marginTop: 4, display: 'block' }}>
                提示：当前清单已存在 {day} 号，提交将在该日期下新增一个事项段落。
              </small>
            )}
          </div>
          <div className="modal-field">
            <label htmlFor="modal-title">主要事项标题（可选）</label>
            <input
              id="modal-title"
              type="text"
              className="field"
              placeholder="如：全天安排、归还礼服、答谢宴"
              value={title}
              maxLength={40}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label htmlFor="modal-time">时间段（可选）</label>
            <input
              id="modal-time"
              type="text"
              className="field"
              placeholder="如：全天、上午、10:00 出发"
              value={time}
              maxLength={20}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? '正在添加…' : '确认新增'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type NodeProps = {
  editing: boolean;
  onUpdate: (gid: string, fn: (items: Item[]) => Item[]) => void;
  onDelete: (gid: string, item: Item) => void;
  onUpdateEvent: (eid: string, updates: { time?: string; title?: string }) => void;
  onDeleteEvent: (eid: string, title: string) => void;
  onAddSection: (eventId: string, title: string) => void;
  onUpdateSection: (id: string, title: string) => void;
  onDeleteSection: (id: string, title: string) => void;
  onAddGroup: (parent: { eventId?: string; sectionId?: string }, label: string) => void;
  onUpdateGroupLabel: (id: string, label: string) => void;
  onDeleteGroup: (id: string, label: string) => void;
  showToast: (text: string, type?: 'success' | 'info' | 'warn' | 'err', undo?: () => void, duration?: number) => void;
};

function EventBlock({
  ev,
  onTask,
  open,
  onSection,
  perSec,
  onUpdateEvent,
  onDeleteEvent,
  onAddSection,
  onUpdateSection,
  onDeleteSection,
  onAddGroup,
  onUpdateGroupLabel,
  onDeleteGroup,
  showToast,
  ...gp
}: NodeProps & {
  ev: Event;
  onTask: (eid: string, done: boolean) => void;
  open: Record<string, boolean>;
  onSection: (id: string, value: boolean) => void;
  perSec: Record<string, [number, number]>;
}) {
  const [editingTime, setEditingTime] = useState(false);
  const [draftTime, setDraftTime] = useState(ev.time);

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(ev.title);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [draftSectionTitle, setDraftSectionTitle] = useState('');

  const [addingDirectGroup, setAddingDirectGroup] = useState(false);
  const [draftDirectGroupLabel, setDraftDirectGroupLabel] = useState('');

  useEffect(() => {
    if (!gp.editing) {
      setEditingTime(false);
      setEditingTitle(false);
      setConfirmDelete(false);
      setAddingSection(false);
      setAddingDirectGroup(false);
    }
  }, [gp.editing]);

  useEffect(() => {
    setDraftTime(ev.time);
  }, [ev.time]);

  useEffect(() => {
    setDraftTitle(ev.title);
  }, [ev.title]);

  const saveTime = () => {
    const t = draftTime.trim();
    if (!t) return;
    if (t !== ev.time) {
      onUpdateEvent(ev.id, { time: t });
    }
    setEditingTime(false);
  };

  const saveTitle = () => {
    const t = draftTitle.trim();
    if (!t) return;
    if (t !== ev.title) {
      onUpdateEvent(ev.id, { title: t });
    }
    setEditingTitle(false);
  };

  const handleSaveSection = () => {
    const t = draftSectionTitle.trim();
    if (!t) return;
    onAddSection(ev.id, t);
    setDraftSectionTitle('');
    setAddingSection(false);
  };

  const handleSaveDirectGroup = () => {
    const l = draftDirectGroupLabel.trim();
    if (!l) return;
    onAddGroup({ eventId: ev.id }, l);
    setDraftDirectGroupLabel('');
    setAddingDirectGroup(false);
  };

  const allItems = useMemo(() => eventGroups(ev).flatMap((g) => g.items), [ev]);
  const hasItems = allItems.length > 0;
  const doneCount = useMemo(() => allItems.filter((i) => i.done).length, [allItems]);
  const isPartial = hasItems && doneCount > 0 && doneCount < allItems.length;

  return (
    <div className={'event' + (ev.done ? ' done' : '')}>
      {/* 时间小标题行 */}
      <div className="time-row">
        {editingTime ? (
          <div className="time-editor">
            <input
              type="text"
              className="field"
              value={draftTime}
              maxLength={20}
              placeholder="如：上午、17:30 出发"
              autoFocus
              onChange={(e) => setDraftTime(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTime();
                if (e.key === 'Escape') setEditingTime(false);
              }}
            />
            <button type="button" className="btn sm primary" onClick={saveTime}>
              保存
            </button>
            <button type="button" className="btn sm quiet" onClick={() => setEditingTime(false)}>
              取消
            </button>
          </div>
        ) : (
          <span
            className={'time' + (gp.editing ? ' editable' : '')}
            title={gp.editing ? '点击修改小标题/时间' : undefined}
            onClick={() => {
              if (gp.editing) {
                setDraftTime(ev.time);
                setEditingTime(true);
              }
            }}
          >
            {ev.time || (gp.editing ? '设置时间' : '')}
            {gp.editing && <EditPencilIcon size={12} className="edit-hint-icon" />}
          </span>
        )}
      </div>

      {/* 大标题行 */}
      <div className="task-wrap">
        {editingTitle ? (
          <div className="task-editor">
            <input
              type="text"
              className="field"
              value={draftTitle}
              maxLength={40}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
            />
            <button type="button" className="btn sm primary" onClick={saveTitle}>
              保存
            </button>
            <button type="button" className="btn sm quiet" onClick={() => setEditingTitle(false)}>
              取消
            </button>
          </div>
        ) : (
          <>
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
            {gp.editing && (
              <div className="ops">
                <button
                  type="button"
                  className="btn sm quiet"
                  onClick={() => {
                    setDraftTitle(ev.title);
                    setEditingTitle(true);
                  }}
                  title="修改标题"
                >
                  修改
                </button>
                <button
                  type="button"
                  className="btn sm quiet danger-hover"
                  onClick={() => setConfirmDelete(true)}
                  title="删除事项"
                >
                  删除
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="confirm" style={{ margin: '8px 0' }}>
          <p>确定删除事项「{ev.title}」及其下所有明细与分类卡片吗？</p>
          <button
            type="button"
            className="btn sm danger"
            onClick={() => onDeleteEvent(ev.id, ev.title)}
          >
            确认删除
          </button>
          <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)}>
            取消
          </button>
        </div>
      )}

      {ev.note && <p className="note">{ev.note}</p>}

      {/* 直属分组（若有） */}
      {ev.groups.length > 0 && (
        <div className="direct">
          {ev.groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={g}
              onUpdateGroupLabel={onUpdateGroupLabel}
              onDeleteGroup={onDeleteGroup}
              showToast={showToast}
              onUpdateEvent={onUpdateEvent}
              onDeleteEvent={onDeleteEvent}
              onAddSection={onAddSection}
              onUpdateSection={onUpdateSection}
              onDeleteSection={onDeleteSection}
              onAddGroup={onAddGroup}
              {...gp}
            />
          ))}
        </div>
      )}

      {/* 块级分类卡片 */}
      {ev.sections.map((s) => (
        <SectionBlock
          key={s.id}
          s={s}
          counts={perSec[s.id] ?? [0, 0]}
          open={open[s.id] !== false}
          onToggle={(v) => onSection(s.id, v)}
          onUpdateSection={onUpdateSection}
          onDeleteSection={onDeleteSection}
          onAddGroup={onAddGroup}
          onUpdateGroupLabel={onUpdateGroupLabel}
          onDeleteGroup={onDeleteGroup}
          onUpdateEvent={onUpdateEvent}
          onDeleteEvent={onDeleteEvent}
          onAddSection={onAddSection}
          showToast={showToast}
          {...gp}
        />
      ))}

      {/* 事项底部操作：增加分类卡片或分组 */}
      {gp.editing && (
        <div className="event-bottom-ops">
          {addingSection ? (
            <div className="add-sub-form" style={{ width: '100%' }}>
              <input
                type="text"
                className="field"
                value={draftSectionTitle}
                placeholder="分类卡片名称，如：新郎用品、现场物资"
                maxLength={40}
                autoFocus
                onChange={(e) => setDraftSectionTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSection();
                  if (e.key === 'Escape') setAddingSection(false);
                }}
              />
              <button type="button" className="btn sm primary" onClick={handleSaveSection}>
                添加卡片
              </button>
              <button type="button" className="btn sm quiet" onClick={() => setAddingSection(false)}>
                取消
              </button>
            </div>
          ) : addingDirectGroup ? (
            <div className="add-sub-form" style={{ width: '100%' }}>
              <input
                type="text"
                className="field"
                value={draftDirectGroupLabel}
                placeholder="分组名称，如：待办事项、随身物品"
                maxLength={30}
                autoFocus
                onChange={(e) => setDraftDirectGroupLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveDirectGroup();
                  if (e.key === 'Escape') setAddingDirectGroup(false);
                }}
              />
              <button type="button" className="btn sm primary" onClick={handleSaveDirectGroup}>
                添加分组
              </button>
              <button type="button" className="btn sm quiet" onClick={() => setAddingDirectGroup(false)}>
                取消
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="add-sub-btn"
                onClick={() => {
                  setDraftSectionTitle('');
                  setAddingSection(true);
                }}
              >
                <PlusIcon size={12} />
                <span>增加分类卡片（如：新娘用品、现场物资）</span>
              </button>
              {ev.sections.length === 0 && (
                <button
                  type="button"
                  className="add-sub-btn"
                  onClick={() => {
                    setDraftDirectGroupLabel('');
                    setAddingDirectGroup(true);
                  }}
                >
                  <PlusIcon size={12} />
                  <span>增加分组</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  s,
  counts,
  open,
  onToggle,
  onUpdateSection,
  onDeleteSection,
  onAddGroup,
  onUpdateGroupLabel,
  onDeleteGroup,
  showToast,
  ...gp
}: NodeProps & {
  s: Section;
  counts: [number, number];
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(s.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [draftGroupLabel, setDraftGroupLabel] = useState('');

  useEffect(() => {
    if (!gp.editing) {
      setEditingTitle(false);
      setConfirmDelete(false);
      setAddingGroup(false);
    }
  }, [gp.editing]);

  useEffect(() => {
    setDraftTitle(s.title);
  }, [s.title]);

  const saveTitle = () => {
    const t = draftTitle.trim();
    if (!t) return;
    if (t !== s.title) {
      onUpdateSection(s.id, t);
    }
    setEditingTitle(false);
  };

  const handleSaveGroup = () => {
    const l = draftGroupLabel.trim();
    if (!l) return;
    onAddGroup({ sectionId: s.id }, l);
    setDraftGroupLabel('');
    setAddingGroup(false);
  };

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
        {editingTitle ? (
          <div className="sec-title-editor" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              className="field"
              value={draftTitle}
              maxLength={40}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveTitle();
                }
                if (e.key === 'Escape') setEditingTitle(false);
              }}
            />
            <button type="button" className="btn sm primary" onClick={saveTitle}>
              保存
            </button>
            <button type="button" className="btn sm quiet" onClick={() => setEditingTitle(false)}>
              取消
            </button>
          </div>
        ) : (
          <>
            <span className="name">{s.title}</span>
            <span className={'count' + (b > 0 && a === b ? ' full' : '')}>{a}/{b}</span>
            {gp.editing && (
              <div className="sec-ops" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="btn sm quiet"
                  onClick={(e) => {
                    e.preventDefault();
                    setDraftTitle(s.title);
                    setEditingTitle(true);
                  }}
                  title="修改分类卡片名称"
                >
                  修改
                </button>
                <button
                  type="button"
                  className="btn sm quiet danger-hover"
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirmDelete(true);
                  }}
                  title="删除分类卡片"
                >
                  删除卡片
                </button>
              </div>
            )}
          </>
        )}
        <span className="chev" />
      </summary>

      {confirmDelete && (
        <div className="sec-confirm" onClick={(e) => e.stopPropagation()}>
          <p>确定删除分类卡片「{s.title}」及其包含的所有分组与明细吗？</p>
          <button
            type="button"
            className="btn sm danger"
            onClick={() => onDeleteSection(s.id, s.title)}
          >
            确认删除
          </button>
          <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)}>
            取消
          </button>
        </div>
      )}

      <div className="sec-body">
        {s.groups.map((g) => (
          <GroupBlock
            key={g.id}
            group={g}
            {...gp}
            onUpdateGroupLabel={onUpdateGroupLabel}
            onDeleteGroup={onDeleteGroup}
            onAddGroup={onAddGroup}
            onUpdateSection={onUpdateSection}
            onDeleteSection={onDeleteSection}
            showToast={showToast}
          />
        ))}

        {gp.editing && (
          <div className="add-sub-block-wrap">
            {addingGroup ? (
              <div className="add-sub-form">
                <input
                  type="text"
                  className="field"
                  value={draftGroupLabel}
                  placeholder="新分组名称，如：服装配饰、急救用品"
                  maxLength={30}
                  autoFocus
                  onChange={(e) => setDraftGroupLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveGroup();
                    if (e.key === 'Escape') setAddingGroup(false);
                  }}
                />
                <button type="button" className="btn sm primary" onClick={handleSaveGroup}>
                  添加分组
                </button>
                <button type="button" className="btn sm quiet" onClick={() => setAddingGroup(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="add-sub-btn"
                onClick={() => {
                  setDraftGroupLabel('');
                  setAddingGroup(true);
                }}
              >
                <PlusIcon size={12} />
                <span>在「{s.title}」中增加分组</span>
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function GroupBlock({
  group,
  editing,
  onUpdate,
  onDelete,
  onUpdateGroupLabel,
  onDeleteGroup,
  showToast,
}: NodeProps & {
  group: Group;
}) {
  const [draft, setDraft] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(group.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setEditingLabel(false);
      setConfirmDelete(false);
    }
  }, [editing]);

  useEffect(() => {
    setDraftLabel(group.label);
  }, [group.label]);

  const saveLabel = () => {
    const l = draftLabel.trim();
    if (!l) return;
    if (l !== group.label) {
      onUpdateGroupLabel(group.id, l);
    }
    setEditingLabel(false);
  };

  const placeholder = group.label ? `增加到「${group.label}」` : '增加一条明细';
  if (!editing && !group.items.length) return null;

  return (
    <div className="grp">
      {editingLabel ? (
        <div className="grp-label-editor">
          <input
            type="text"
            className="field"
            value={draftLabel}
            placeholder="分组名称，如：个人准备"
            maxLength={30}
            autoFocus
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLabel();
              if (e.key === 'Escape') setEditingLabel(false);
            }}
          />
          <button type="button" className="btn sm primary" onClick={saveLabel}>
            保存
          </button>
          <button type="button" className="btn sm quiet" onClick={() => setEditingLabel(false)}>
            取消
          </button>
        </div>
      ) : (
        (group.label || editing) && (
          <div className="grp-header">
            <div className="grp-label">{group.label || (editing ? '（默认分组）' : '')}</div>
            {editing && (
              <div className="grp-ops">
                <button
                  type="button"
                  className="btn sm quiet"
                  onClick={() => {
                    setDraftLabel(group.label);
                    setEditingLabel(true);
                  }}
                  title="修改分组名称"
                >
                  修改
                </button>
                <button
                  type="button"
                  className="btn sm quiet danger-hover"
                  onClick={() => setConfirmDelete(true)}
                  title="删除此分组"
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )
      )}

      {confirmDelete && (
        <div className="confirm">
          <p>确定删除分组「{group.label || '此分组'}」及其所属全部明细吗？</p>
          <button
            type="button"
            className="btn sm danger"
            onClick={() => onDeleteGroup(group.id, group.label)}
          >
            确认删除
          </button>
          <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)}>
            取消
          </button>
        </div>
      )}

      <div className="items">
        {group.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            editing={editing}
            onToggle={(done) => {
              onUpdate(group.id, (items) => items.map((i) => (i.id === item.id ? { ...i, done } : i)));
              showToast(done ? `已完成「${item.text}」` : `已取消勾选「${item.text}」`, 'info');
            }}
            onRename={(text) => {
              onUpdate(group.id, (items) => items.map((i) => (i.id === item.id ? { ...i, text } : i)));
              showToast(`已更新为“${text}”`, 'success');
            }}
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
            showToast(`已增加明细「${text}」`, 'success');
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
        <input
          type="checkbox"
          className="item-checkbox"
          id={'cb-' + item.id}
          checked={item.done}
          onChange={(e) => onToggle(e.target.checked)}
        />
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
