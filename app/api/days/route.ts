import { addDay } from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await readJson(req);
  const dayNum = Number(body?.day);

  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
    return Response.json({ error: '日期格式不正确（必须是 1 到 31 的整数）' }, { status: 400 });
  }

  const title = typeof body?.title === 'string' ? body.title : undefined;
  const time = typeof body?.time === 'string' ? body.time : undefined;

  const change = await addDay(dayNum, { title, time });
  return Response.json(change);
}
