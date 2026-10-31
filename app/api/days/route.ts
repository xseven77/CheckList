import { NotFoundError, addDay, deleteDay } from '@/lib/store';
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

export async function DELETE(req: Request) {
  const body = await readJson(req);
  const dayNum = Number(body?.day);

  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
    return Response.json({ error: '缺少有效的 day 参数' }, { status: 400 });
  }

  try {
    const change = await deleteDay(dayNum);
    return Response.json(change);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return Response.json({ error: '未找到指定日期' }, { status: 404 });
    }
    throw e;
  }
}

