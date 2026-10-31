import { NotFoundError, setGroupItems } from '@/lib/store';
import { cleanItems } from '@/lib/types';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 整组替换明细：{ items: [{ id, text, done }] } */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const items = cleanItems(body?.items);
  if (!items) return Response.json({ error: '明细格式不对' }, { status: 400 });
  try {
    return Response.json(await setGroupItems(id, items));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: '没有这个分组' }, { status: 404 });
    throw e;
  }
}
