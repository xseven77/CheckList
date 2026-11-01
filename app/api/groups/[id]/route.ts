import { NotFoundError, setItemDone } from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 切换组内某明细的勾选态：{ itemId: string; done: boolean }（明细内容归日历所有，不可在此修改） */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  try {
    if (typeof body?.itemId === 'string' && typeof body?.done === 'boolean') {
      return Response.json(await setItemDone(id, body.itemId, body.done));
    }
    return Response.json({ error: '无效的更新参数' }, { status: 400 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: '没有这个分组或明细' }, { status: 404 });
    throw e;
  }
}
