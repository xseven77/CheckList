/**
 * 日历备注 → 可勾选条目：把备注里的条例行拆成清单明细。
 * 识别的行首格式：中文序号（1、 2、）、数字序号（1. 1)）、
 * 括号序号（(1) （1））、项目符号（• · ●，以及后跟空格的 - *）。
 *
 * 分段：备注里的小标题行（例如“新娘：”“布置用道具：”“第一件事”）
 * 会把其后的条例行收进同名分组，而不是全部摊平成一列。
 * 小标题的判定：非条例行、长度 ≤ 12 字，且以 ：/ : 结尾，
 * 或完全不含标点；并且其后（到下一个小标题或文末之间）至少有一条例行。
 * 没有条例行跟随的小标题、以及其他非空行，保留为备注正文。
 * 空行跳过。单行一条。
 */
const ITEM_RE = /^\s*(?:\d+[.、)]|\(\d+\)|（\d+）|[•·●]|[-*]\s+)\s*(.+?)\s*$/;

/** 小标题行尾的冒号（全角/半角），解析成组名时去掉 */
const HEADER_COLON = /[：:]$/;
/** 小标题里不该出现的标点（出现在行中说明它是正文句子，不是小标题） */
const HEADER_PUNCT = /[、。！？；：:·•●()（）]/;

export type NoteSection = { title: string; items: string[] };

function isHeaderCandidate(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 12) return false;
  if (ITEM_RE.test(line)) return false;
  if (HEADER_COLON.test(t)) return true;
  return !HEADER_PUNCT.test(t);
}

export function parseNoteItems(note: string): { items: string[]; rest: string; sections: NoteSection[] } {
  const lines = note.split('\n');
  const items: string[] = [];
  const restLines: string[] = [];
  const sections: NoteSection[] = [];
  // 当前分组：小标题出现后，其后的条例行都归入该组，直到下一个小标题
  let current: NoteSection | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = ITEM_RE.exec(line);
    if (m && m[1].trim()) {
      const text = m[1].trim();
      if (current) current.items.push(text);
      else items.push(text);
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    if (isHeaderCandidate(line)) {
      // 向前看：到下一个小标题或文末之间有没有条例行；没有则当正文处理
      let hasItem = false;
      for (let j = i + 1; j < lines.length; j++) {
        const l2 = lines[j];
        const m2 = ITEM_RE.exec(l2);
        if (m2 && m2[1].trim()) {
          hasItem = true;
          break;
        }
        if (!l2.trim()) continue;
        break;
      }
      if (hasItem) {
        current = { title: line.trim().replace(HEADER_COLON, ''), items: [] };
        sections.push(current);
        i++;
        continue;
      }
      // 空小标题：当正文保留，并断开当前分组
      current = null;
    }
    restLines.push(line.trim());
    i++;
  }
  return { items, rest: restLines.join('\n'), sections };
}
