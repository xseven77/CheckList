import { NotFoundError, setTaskDone } from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 勾选或取消事项：{ done: boolean } */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (typeof body?.done !== 'boolean') return Response.json({ error: 'done 必须是 true 或 false' }, { status: 400 });
  try {
    return Response.json(await setTaskDone(id, body.done));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: '没有这个事项' }, { status: 404 });
    throw e;
  }
}
