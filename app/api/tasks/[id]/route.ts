import { NotFoundError, setTaskDone, updateEvent } from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 更新事项：勾选 { done: boolean } 或修改标题/时间 { time?: string; title?: string; note?: string } */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);

  try {
    if (typeof body?.done === 'boolean') {
      return Response.json(await setTaskDone(id, body.done));
    }
    if (body?.time !== undefined || body?.title !== undefined || body?.note !== undefined) {
      return Response.json(
        await updateEvent(id, {
          time: typeof body.time === 'string' ? body.time : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        })
      );
    }
    return Response.json({ error: '无效的更新参数' }, { status: 400 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: '没有这个事项' }, { status: 404 });
    throw e;
  }
}
