import { importCalendarEvents } from '@/lib/store';
import { parseIcs } from '@/lib/ics';

export const dynamic = 'force-dynamic';

const MAX_ICS_BYTES = 2 * 1024 * 1024;

/**
 * 日历导入（单向，只读日历 → 写清单，不回写日历）。
 * POST { url: string }
 * 只支持订阅链接：服务器端拉取该链接的 .ics 内容后导入。
 */
export async function POST(req: Request) {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return Response.json({ error: '读取请求失败' }, { status: 400 });
  }
  if (bodyText.length > MAX_ICS_BYTES + 64 * 1024) {
    return Response.json({ error: '内容过大（上限约 2MB）' }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const v = JSON.parse(bodyText) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bad body');
    body = v as Record<string, unknown>;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  if (typeof body.url !== 'string' || !body.url.trim()) {
    return Response.json({ error: '请提供订阅链接' }, { status: 400 });
  }
  let url = body.url.trim();
  // iOS 日历分享出来的订阅链接常用 webcal://，等价于 https://
  if (/^webcal:\/\//i.test(url)) url = 'https://' + url.slice('webcal://'.length);
  if (!/^https?:\/\//i.test(url)) {
    return Response.json({ error: '订阅链接必须是 http(s) 或 webcal 地址' }, { status: 400 });
  }
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'text/calendar, */*' } });
  } catch {
    return Response.json({ error: '拉取订阅链接失败，请检查链接与网络' }, { status: 400 });
  }
  if (!res.ok) {
    return Response.json({ error: `订阅链接返回 ${res.status}` }, { status: 400 });
  }
  const icsText = await res.text();
  if (!icsText.trim()) {
    return Response.json({ error: '订阅链接内容为空' }, { status: 400 });
  }
  if (icsText.length > MAX_ICS_BYTES) {
    return Response.json({ error: '日历内容过大（上限约 2MB）' }, { status: 413 });
  }

  let parsed;
  try {
    parsed = parseIcs(icsText);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? `解析 .ics 失败：${e.message}` : '解析 .ics 失败' }, { status: 400 });
  }

  const { summary, rev } = await importCalendarEvents(parsed.events, parsed.skipped);
  return Response.json({ ok: true, summary, rev });
}
