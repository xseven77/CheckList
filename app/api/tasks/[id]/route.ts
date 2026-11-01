import { NotFoundError, setTaskDone } from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 切换事项勾选态：{ done: boolean }（事项内容归日历所有，不可在此修改） */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  try {
    if (typeof body?.done === 'boolean') {
      return Response.json(await setTaskDone(id, body.done));
    }
    return Response.json({ error: '无效的更新参数' }, { status: 400 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: '没有这个事项' }, { status: 404 });
    throw e;
  }
}
