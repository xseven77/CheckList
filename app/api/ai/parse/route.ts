import { applyAIActions, readState } from '@/lib/store';
import { parseVoicePrompt } from '@/lib/aiParser';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await readJson(req);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';

  if (!text) {
    return Response.json({ error: '输入内容不能为空' }, { status: 400 });
  }

  const doc = await readState();
  const { summary, actions } = await parseVoicePrompt(text, doc);

  if (!actions.length) {
    return Response.json({ error: '未能理解该语音指令，请尝试更清晰地描述，例如：“8号下午加一个答谢宴，准备伴手礼”' }, { status: 422 });
  }

  const result = await applyAIActions(actions, summary);
  return Response.json(result);
}
