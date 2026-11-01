/**
 * 日历备注 → 可勾选条目：把备注里的条例行拆成清单明细。
 * 识别的行首格式：中文序号（1、 2、）、数字序号（1. 1)）、
 * 括号序号（(1) （1））、项目符号（• · ●，以及后跟空格的 - *）。
 * 其余非空行保留为备注正文；空行跳过。单行一条。
 */
const ITEM_RE = /^\s*(?:\d+[.、)]|\(\d+\)|（\d+）|[•·●]|[-*]\s+)\s*(.+?)\s*$/;

export function parseNoteItems(note: string): { items: string[]; rest: string } {
  const items: string[] = [];
  const restLines: string[] = [];
  for (const line of note.split('\n')) {
    const m = ITEM_RE.exec(line);
    if (m && m[1].trim()) items.push(m[1].trim());
    else if (line.trim()) restLines.push(line.trim());
  }
  return { items, rest: restLines.join('\n') };
}
