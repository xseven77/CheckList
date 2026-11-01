import { type Checklist, eventGroups } from './types';

const P = {
  bg: '#fbf8f6',
  card: '#ffffff',
  ink: '#23181a',
  muted: '#85777a',
  strike: '#b84d53',
  line: '#eadcda',
  lineLight: '#f3e9e8',
  red: '#b0262f',
  redSoft: '#fbf0ee',
  redBorder: '#f2d5d2',
  gold: '#946a1e',
  checkboxBorder: '#cdbcbb',
  okGreen: '#2e7d32',
  okGreenBg: '#eaf6ed',
  okGreenBorder: '#c3e8ca',
};

const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

type Op =
  | { k: 't'; s: string; x: number; y: number; font: string; color: string; strike?: boolean; strikeColor?: string }
  | { k: 'hr'; y: number; x: number; w: number; color?: string }
  | { k: 'dot'; x: number; y: number; filled: boolean }
  | { k: 'box'; x: number; y: number; w: number; h: number; bg?: string; border?: string; r?: number }
  | { k: 'vline'; x: number; y1: number; y2: number }
  | { k: 'checkbox'; x: number; y: number; size: number; checked: boolean; indeterminate?: boolean; isCircle?: boolean }
  | { k: 'tag'; s: string; x: number; y: number; w: number; h: number; bg: string; color: string; border?: string }
  | { k: 'pill'; text: string; x: number; y: number; w: number; h: number; bg: string; color: string; border?: string }
  | { k: 'bar'; x: number; y: number; w: number; h: number; pct: number };

/** 把整份清单画成一张高清长图，分行优雅展示所有事项与复选状态；accent 不传则用默认红 */
export function drawChecklist(doc: Checklist, accent?: { red: string; soft: string; border: string }, title?: string): Promise<Blob> {
  const W = 1080;
  const PAL = accent ? { ...P, red: accent.red, redSoft: accent.soft, redBorder: accent.border } : P;
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
      } else {
        line += ch;
      }
    }
    if (line) rows.push(line);
    return rows.length ? rows : [''];
  };

  const text = (
    value: string,
    x: number,
    width: number,
    size: number,
    color: string,
    weight = 400,
    family = SANS,
    lh = 1.45,
    strike = false,
    strikeColor?: string
  ): number => {
    const font = `${weight} ${size}px ${family}`;
    const rows = wrap(value, width, font);
    const lineH = Math.round(size * lh);
    for (const s of rows) {
      ops.push({ k: 't', s, x, y, font, color, strike, strikeColor });
      y += lineH;
    }
    return rows.length * lineH;
  };

  const L = 56;
  const LINE_X = 160;
  const CX = 196;
  const CW = W - CX - 56;

  // ---------------- 1. 顶部 Header（无喜字、无副标题，标题由导出人定） ----------------
  y = 56;
  const headTitle = title?.trim() ? title : doc.title;
  text(headTitle, L, W - 2 * L, 44, P.ink, 700, SANS, 1.3);
  y += 20;

  // ---------------- 2. 进度统计卡片 ----------------
  let ti = 0, td = 0, ii = 0, id = 0;
  const dayStats: Record<number, [number, number]> = {};
  for (const d of doc.days) {
    const ds = (dayStats[d.day] = [0, 0]);
    for (const ev of d.events) {
      ti++;
      ds[1]++;
      if (ev.done) {
        td++;
        ds[0]++;
      }
      for (const g of eventGroups(ev)) {
        ii += g.items.length;
        ds[1] += g.items.length;
        const k = g.items.filter((i) => i.done).length;
        id += k;
        ds[0] += k;
      }
    }
  }

  const totalAll = ti + ii;
  const doneAll = td + id;
  const pct = totalAll > 0 ? (doneAll / totalAll) * 100 : 0;

  const cardW = W - 2 * L;
  const cardBox: Op = { k: 'box', x: L, y, w: cardW, h: 0, bg: P.card, border: P.line, r: 16 };
  ops.push(cardBox);
  const cardTop = y;
  y += 20;

  // 统计数值行
  const statTextY = y;
  meas.font = `600 22px ${SANS}`;
  ops.push({ k: 't', s: `事项 ${td}/${ti} · 明细 ${id}/${ii}`, x: L + 22, y: statTextY, font: `600 22px ${SANS}`, color: P.ink });

  const pctLabel = `完成度 ${Math.round(pct)}%`;
  meas.font = `600 18px ${SANS}`;
  const pillW = Math.ceil(meas.measureText(pctLabel).width) + 24;
  ops.push({
    k: 'pill',
    text: pctLabel,
    x: L + cardW - 22 - pillW,
    y: statTextY - 3,
    w: pillW,
    h: 30,
    bg: pct >= 100 ? P.okGreenBg : PAL.redSoft,
    color: pct >= 100 ? P.okGreen : PAL.red,
    border: pct >= 100 ? P.okGreenBorder : PAL.redBorder,
  });
  y += 36;

  // 进度条
  ops.push({ k: 'bar', x: L + 22, y, w: cardW - 44, h: 8, pct });
  y += 18;
  y += 8;
  cardBox.h = y - cardTop;
  y += 34;

  // ---------------- 3. 日程主体 ----------------
  const drawItemRow = (item: { text: string; done: boolean }, itemX: number, itemW: number) => {
    const boxSize = 20;
    const cbY = y + 5;
    ops.push({ k: 'checkbox', x: itemX, y: cbY, size: boxSize, checked: item.done });

    const textX = itemX + boxSize + 12;
    const textW = itemW - boxSize - 12;
    const itemColor = item.done ? P.muted : P.ink;
    const strikeColor = P.strike;

    text(item.text, textX, textW, 23, itemColor, 400, SANS, 1.45, item.done, strikeColor);
    y += 10;
  };

  for (const d of doc.days) {
    const dayStart = y;
    const [dDone, dTotal] = dayStats[d.day] ?? [0, 0];

    // 左侧日期列
    ops.push({ k: 't', s: String(d.day), x: L + 4, y: y - 2, font: `700 54px ${SANS}`, color: PAL.red });
    ops.push({ k: 't', s: '号', x: L + 4 + (d.day >= 10 ? 64 : 34), y: y + 22, font: `700 22px ${SANS}`, color: PAL.red });

    // 日期进度小胶囊
    const dayPillText = `${dDone}/${dTotal}`;
    meas.font = `600 17px ${SANS}`;
    const dayPillW = Math.max(68, Math.ceil(meas.measureText(dayPillText).width) + 16);
    ops.push({
      k: 'pill',
      text: dayPillText,
      x: L + 2,
      y: y + 66,
      w: dayPillW,
      h: 24,
      bg: dTotal > 0 && dDone === dTotal ? P.okGreenBg : PAL.redSoft,
      color: dTotal > 0 && dDone === dTotal ? P.okGreen : PAL.red,
      border: dTotal > 0 && dDone === dTotal ? P.okGreenBorder : PAL.redBorder,
    });

    // 右侧事件流
    for (const ev of d.events) {
      const evTop = y;

      // 时间线节点
      ops.push({ k: 'dot', x: LINE_X, y: evTop + 24, filled: ev.done });

      // 时间
      text(ev.time, CX, CW, 20, P.gold, 600);

      // 事件标题（自身也可勾选，联动计算完成/半选状态）
      const evBoxSize = 22;
      const allEvItems = eventGroups(ev).flatMap((g) => g.items);
      const evHasItems = allEvItems.length > 0;
      const evDoneCount = allEvItems.filter((i) => i.done).length;
      const evPartial = evHasItems && evDoneCount > 0 && evDoneCount < allEvItems.length;

      ops.push({ k: 'checkbox', x: CX, y: y + 4, size: evBoxSize, checked: ev.done, indeterminate: evPartial, isCircle: true });
      text(ev.title, CX + 34, CW - 34, 28, ev.done ? P.muted : P.ink, 600, SANS, 1.35, ev.done, P.strike);

      // 备注
      if (ev.note) {
        y += 2;
        text('说明：' + ev.note, CX + 34, CW - 34, 20, P.muted, 400, SANS, 1.4);
      }

      // 直接挂在事项下的明细（例如 确认宾客名单、婚纱照等）
      if (ev.groups.length > 0) {
        y += 8;
        for (const g of ev.groups) {
          if (!g.items.length) continue;
          if (g.label) {
            y += 4;
            ops.push({ k: 'box', x: CX + 34, y: y + 3, w: 4, h: 20, bg: PAL.red, r: 2 });
            text(g.label, CX + 46, CW - 46, 21, P.gold, 600, SANS, 1.3);
            y += 8;
          }
          for (const item of g.items) {
            drawItemRow(item, CX + 34, CW - 34);
          }
          y += 6;
        }
      }

      // 卡片式分区（例如 伴手礼、桌糖与现场物资 等）
      for (const s of ev.sections) {
        if (!s.groups.some((g) => g.items.length)) continue;

        let sDone = 0, sTotal = 0;
        for (const g of s.groups) {
          for (const i of g.items) {
            sTotal++;
            if (i.done) sDone++;
          }
        }

        y += 12;
        const secBox: Op = { k: 'box', x: CX, y, w: CW, h: 0, bg: P.card, border: P.line, r: 16 };
        ops.push(secBox);
        const secTop = y;
        y += 18;

        // 分区标题与完成胶囊
        const secTitleW = CW - 40 - 86;
        text(s.title, CX + 20, secTitleW, 25, P.ink, 600, SANS);

        const secPillText = `${sDone}/${sTotal}`;
        const secPillW = 76;
        ops.push({
          k: 'pill',
          text: secPillText,
          x: CX + CW - 20 - secPillW,
          y: secTop + 16,
          w: secPillW,
          h: 28,
          bg: sTotal > 0 && sDone === sTotal ? P.okGreenBg : PAL.redSoft,
          color: sTotal > 0 && sDone === sTotal ? P.okGreen : PAL.red,
          border: sTotal > 0 && sDone === sTotal ? P.okGreenBorder : PAL.redBorder,
        });

        // 卡片内部细分割线
        y += 10;
        ops.push({ k: 'hr', y, x: CX + 20, w: CW - 40, color: P.lineLight });
        y += 16;

        // 分区内的每个分组及明细
        for (const g of s.groups) {
          if (!g.items.length) continue;
          if (g.label) {
            meas.font = `600 19px ${SANS}`;
            const tagW = Math.ceil(meas.measureText(g.label).width) + 20;
            ops.push({
              k: 'tag',
              s: g.label,
              x: CX + 20,
              y,
              w: tagW,
              h: 28,
              bg: PAL.redSoft,
              color: PAL.red,
              border: PAL.redBorder,
            });
            y += 36;
          }
          for (const item of g.items) {
            drawItemRow(item, CX + 20, CW - 40);
          }
          y += 8;
        }

        y += 6;
        secBox.h = y - secTop;
        y += 18;
      }

      y += 28;
    }

    // 连接全天事项的时间线
    ops.push({ k: 'vline', x: LINE_X, y1: dayStart + 24, y2: y - 24 });
    y += 24;
  }

  // ---------------- 4. 底部 Footer ----------------
  y += 12;
  ops.push({ k: 'hr', y, x: L, w: W - 2 * L, color: P.line });
  y += 28;

  const timeStr = '导出时间：' + new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  text(timeStr + ' · CheckList', L, W - 2 * L, 20, P.muted, 400, SANS, 1.5);
  y += 96;

  // ---------------- 5. Canvas 渲染生成 ----------------
  // 动态选择缩放比例：确保在不超过 iOS Safari 16384px 限制的同时具备高清分辨率
  const S = Math.min(2, Math.max(1.2, Math.floor((15000 / y) * 10) / 10));

  const c = document.createElement('canvas');
  c.width = Math.ceil(W * S);
  c.height = Math.ceil(y * S);
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas'));

  ctx.scale(S, S);
  ctx.textBaseline = 'top';
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, y);

  const roundPath = (x: number, yy: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, yy);
    ctx.arcTo(x + w, yy, x + w, yy + h, r);
    ctx.arcTo(x + w, yy + h, x, yy + h, r);
    ctx.arcTo(x, yy + h, x, yy, r);
    ctx.arcTo(x, yy, x + w, yy, r);
    ctx.closePath();
  };

  const drawCheckmark = (x: number, yy: number, size: number, color: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.24, yy + size * 0.52);
    ctx.lineTo(x + size * 0.44, yy + size * 0.72);
    ctx.lineTo(x + size * 0.76, yy + size * 0.28);
    ctx.stroke();
    ctx.restore();
  };

  // 第一层：卡片背景与分割线
  for (const o of ops) {
    if (o.k === 'box') {
      roundPath(o.x, o.y, o.w, o.h, o.r ?? 14);
      ctx.fillStyle = o.bg ?? P.card;
      ctx.fill();
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else if (o.k === 'vline') {
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y1);
      ctx.lineTo(o.x, o.y2);
      ctx.stroke();
    } else if (o.k === 'hr') {
      ctx.fillStyle = o.color ?? P.line;
      ctx.fillRect(o.x, o.y, o.w, 1.5);
    }
  }

  // 第二层：图元与控件（复选框、节点、进度条、徽章）
  for (const o of ops) {
    if (o.k === 'checkbox') {
      if (o.isCircle) {
        ctx.beginPath();
        ctx.arc(o.x + o.size / 2, o.y + o.size / 2, o.size / 2, 0, Math.PI * 2);
        if (o.checked) {
          ctx.fillStyle = PAL.red;
          ctx.fill();
          drawCheckmark(o.x, o.y, o.size, '#ffffff');
        } else if (o.indeterminate) {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = P.gold;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.save();
          ctx.strokeStyle = P.gold;
          ctx.lineWidth = 2.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(o.x + o.size * 0.28, o.y + o.size * 0.5);
          ctx.lineTo(o.x + o.size * 0.72, o.y + o.size * 0.5);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = P.gold;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        roundPath(o.x, o.y, o.size, o.size, 4);
        if (o.checked) {
          ctx.fillStyle = PAL.red;
          ctx.fill();
          drawCheckmark(o.x, o.y, o.size, '#ffffff');
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = P.checkboxBorder;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
    } else if (o.k === 'dot') {
      ctx.beginPath();
      ctx.arc(o.x, o.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = o.filled ? PAL.red : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = PAL.red;
      ctx.stroke();
      if (o.filled) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    } else if (o.k === 'bar') {
      // 轨道
      roundPath(o.x, o.y, o.w, o.h, o.h / 2);
      ctx.fillStyle = '#f0e3e2';
      ctx.fill();
      // 填充
      const fillW = Math.max(0, Math.min(o.w, o.w * (o.pct / 100)));
      if (fillW > 0) {
        const fr = Math.min(o.h / 2, fillW / 2);
        roundPath(o.x, o.y, fillW, o.h, fr);
        ctx.fillStyle = PAL.red;
        ctx.fill();
      }
    } else if (o.k === 'pill' || o.k === 'tag') {
      const r = o.k === 'pill' ? o.h / 2 : 6;
      roundPath(o.x, o.y, o.w, o.h, r);
      ctx.fillStyle = o.bg;
      ctx.fill();
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.font = `600 17px ${SANS}`;
      ctx.fillStyle = o.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = o.k === 'pill' ? o.text : o.s;
      ctx.fillText(label, o.x + o.w / 2, o.y + o.h / 2 + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'top';
    }
  }

  // 第三层：文本与划线
  for (const o of ops) {
    if (o.k === 't') {
      ctx.font = o.font;
      ctx.fillStyle = o.color;
      ctx.fillText(o.s, o.x, o.y);

      if (o.strike) {
        const tw = ctx.measureText(o.s).width;
        ctx.save();
        ctx.strokeStyle = o.strikeColor ?? P.strike;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const m = o.font.match(/(\d+)px/);
        const fs = m ? parseInt(m[1], 10) : 22;
        const sy = Math.round(o.y + fs * 0.58);
        ctx.moveTo(o.x, sy);
        ctx.lineTo(o.x + tw, sy);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png')
  );
}
