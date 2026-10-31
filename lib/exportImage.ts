import { type Checklist, eventGroups } from './types';

const P = { bg: '#fbf7f5', ink: '#2b1f21', muted: '#85777a', line: '#e8dad9', red: '#b0262f', gold: '#946a1e', card: '#ffffff' };
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif';

type Op =
  | { k: 't'; s: string; x: number; y: number; font: string; color: string }
  | { k: 'hr'; y: number }
  | { k: 'dot'; x: number; y: number; filled: boolean }
  | { k: 'seal'; x: number; y: number }
  | { k: 'box'; x: number; y: number; w: number; h: number }
  | { k: 'vline'; x: number; y1: number; y2: number };

/** 把整份清单画成一张长图（✓ 表示已完成），总是用浅色，方便转发 */
export function drawChecklist(doc: Checklist): Promise<Blob> {
  const W = 1080;
  const S = 2; // 2 倍像素，手机上看清楚
  const meas = document.createElement('canvas').getContext('2d')!;
  const ops: Op[] = [];
  let y = 0;

  const wrap = (value: string, width: number, font: string) => {
    meas.font = font;
    const rows: string[] = [];
    let line = '';
    for (const ch of value) {
      if (line && meas.measureText(line + ch).width > width) {
        rows.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) rows.push(line);
    return rows;
  };
  const text = (value: string, x: number, width: number, size: number, color: string, weight = 400, family = SANS, lh = 1.5) => {
    const font = `${weight} ${size}px ${family}`;
    for (const s of wrap(value, width, font)) {
      ops.push({ k: 't', s, x, y, font, color });
      y += size * lh;
    }
  };

  const L = 64, LINE_X = L + 96, CX = LINE_X + 32, CW = W - CX - 64;

  y = 64;
  ops.push({ k: 'seal', x: L, y });
  const top = y;
  y += 6;
  text(doc.title, L + 92, W - L - 156, 44, P.ink, 700, SERIF, 1.3);
  text(doc.subtitle, L + 92, W - L - 156, 22, P.muted);
  y = Math.max(y, top + 76) + 18;

  let ti = 0, td = 0, ii = 0, id = 0;
  for (const d of doc.days)
    for (const ev of d.events) {
      ti++;
      if (ev.done) td++;
      for (const g of eventGroups(ev)) {
        ii += g.items.length;
        id += g.items.filter((i) => i.done).length;
      }
    }
  text(`事项 ${td}/${ti} · 明细 ${id}/${ii} · ✓ 表示已完成`, L, W - 2 * L, 22, P.muted);
  y += 10;
  ops.push({ k: 'hr', y });
  y += 34;

  for (const d of doc.days) {
    const start = y;
    ops.push({ k: 't', s: String(d.day), x: L + 6, y: y - 4, font: `700 52px ${SERIF}`, color: P.red });
    ops.push({ k: 't', s: '号', x: L + 6 + (d.day >= 10 ? 60 : 32), y: y + 20, font: `700 22px ${SERIF}`, color: P.red });
    for (const ev of d.events) {
      const evTop = y;
      ops.push({ k: 'dot', x: LINE_X, y: evTop + 34, filled: ev.done });
      text(ev.time, CX, CW, 20, P.gold, 600);
      text((ev.done ? '✓ ' : '') + ev.title, CX, CW, 30, ev.done ? P.muted : P.ink, 600);
      if (ev.note) text(ev.note, CX, CW, 22, P.muted);
      const drawGroup = (g: { label: string; items: { text: string; done: boolean }[] }, x: number, w: number) => {
        if (!g.items.length) return;
        const value = g.items.map((i) => (i.done ? '✓ ' : '') + i.text).join(' · ');
        if (g.label) {
          const t0 = y;
          text(g.label, x, 130, 22, P.muted);
          const end = y;
          y = t0;
          text(value, x + 140, w - 140, 24, P.ink, 400, SANS, 1.55);
          y = Math.max(y, end);
        } else text(value, x, w, 24, P.ink, 400, SANS, 1.55);
        y += 8;
      };
      if (ev.groups.length) {
        y += 4;
        ev.groups.forEach((g) => drawGroup(g, CX, CW));
      }
      for (const s of ev.sections) {
        if (!s.groups.some((g) => g.items.length)) continue;
        y += 10;
        const box: Op = { k: 'box', x: CX - 4, y, w: CW + 8, h: 0 };
        ops.push(box);
        y += 18;
        text(s.title, CX + 18, CW - 36, 24, P.ink, 600);
        y += 6;
        s.groups.forEach((g) => drawGroup(g, CX + 18, CW - 36));
        y += 8;
        box.h = y - box.y;
      }
      y += 30;
    }
    ops.push({ k: 'vline', x: LINE_X, y1: start + 30, y2: y - 30 });
    y += 22;
  }
  y += 10;
  text('导出于 ' + new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), L, W - 2 * L, 20, P.muted);
  y += 40;
  if (y * S > 32000) return Promise.reject(new Error('too-long'));

  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = Math.ceil(y * S);
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas'));
  ctx.scale(S, S);
  ctx.textBaseline = 'top';
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, y);
  const round = (x: number, yy: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, yy);
    ctx.arcTo(x + w, yy, x + w, yy + h, r);
    ctx.arcTo(x + w, yy + h, x, yy + h, r);
    ctx.arcTo(x, yy + h, x, yy, r);
    ctx.arcTo(x, yy, x + w, yy, r);
    ctx.closePath();
  };
  // 先画底层的卡片和竖线，再画文字和圆点
  for (const o of ops) {
    if (o.k === 'box') {
      round(o.x, o.y, o.w, o.h, 14);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (o.k === 'vline') {
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y1);
      ctx.lineTo(o.x, o.y2);
      ctx.stroke();
    }
  }
  for (const o of ops) {
    if (o.k === 't') {
      ctx.font = o.font;
      ctx.fillStyle = o.color;
      ctx.fillText(o.s, o.x, o.y);
    } else if (o.k === 'hr') {
      ctx.fillStyle = P.line;
      ctx.fillRect(L, o.y, W - 2 * L, 2);
    } else if (o.k === 'dot') {
      ctx.beginPath();
      ctx.arc(o.x, o.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = o.filled ? P.red : P.bg;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.red;
      ctx.stroke();
    } else if (o.k === 'seal') {
      round(o.x, o.y, 72, 72, 14);
      ctx.fillStyle = P.red;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 44px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillText('囍', o.x + 36, o.y + 13);
      ctx.textAlign = 'start';
    }
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
}
