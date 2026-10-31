import {
  NotFoundError,
  addEvent,
  deleteEvent,
  addSection,
  updateSection,
  deleteSection,
  addGroup,
  updateGroupLabel,
  deleteGroup,
  deleteDay,
} from '@/lib/store';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body.action !== 'string') {
    return Response.json({ error: '缺少 action 参数' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'add_event': {
        const { day, title, time, note } = body;
        if (typeof day !== 'number' || typeof title !== 'string') {
          return Response.json({ error: '参数不正确' }, { status: 400 });
        }
        return Response.json(
          await addEvent(day, {
            title,
            time: typeof time === 'string' ? time : undefined,
            note: typeof note === 'string' ? note : undefined,
          })
        );
      }
      case 'delete_event': {
        const { id } = body;
        if (typeof id !== 'string') return Response.json({ error: '缺少 id' }, { status: 400 });
        return Response.json(await deleteEvent(id));
      }
      case 'add_section': {
        const { eventId, title } = body;
        if (typeof eventId !== 'string' || typeof title !== 'string') {
          return Response.json({ error: '参数不正确' }, { status: 400 });
        }
        return Response.json(await addSection(eventId, title));
      }
      case 'update_section': {
        const { id, title } = body;
        if (typeof id !== 'string' || typeof title !== 'string') {
          return Response.json({ error: '参数不正确' }, { status: 400 });
        }
        return Response.json(await updateSection(id, title));
      }
      case 'delete_section': {
        const { id } = body;
        if (typeof id !== 'string') return Response.json({ error: '缺少 id' }, { status: 400 });
        return Response.json(await deleteSection(id));
      }
      case 'add_group': {
        const { eventId, sectionId, label } = body;
        if (typeof label !== 'string' || (!eventId && !sectionId)) {
          return Response.json({ error: '参数不正确' }, { status: 400 });
        }
        return Response.json(
          await addGroup(
            {
              eventId: typeof eventId === 'string' ? eventId : undefined,
              sectionId: typeof sectionId === 'string' ? sectionId : undefined,
            },
            label
          )
        );
      }
      case 'update_group_label': {
        const { id, label } = body;
        if (typeof id !== 'string' || typeof label !== 'string') {
          return Response.json({ error: '参数不正确' }, { status: 400 });
        }
        return Response.json(await updateGroupLabel(id, label));
      }
      case 'delete_group': {
        const { id } = body;
        if (typeof id !== 'string') return Response.json({ error: '缺少 id' }, { status: 400 });
        return Response.json(await deleteGroup(id));
      }
      case 'delete_day': {
        const { day } = body;
        if (typeof day !== 'number') return Response.json({ error: '缺少 day' }, { status: 400 });
        return Response.json(await deleteDay(day));
      }
      default:
        return Response.json({ error: `未知 action: ${body.action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof NotFoundError) {
      return Response.json({ error: '目标节点不存在' }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : '服务器内部错误';
    return Response.json({ error: msg }, { status: 500 });
  }
}
