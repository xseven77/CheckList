import {
  DEFAULT_INTERVAL_MINUTES,
  SUBSCRIPTION_INTERVALS,
  deleteSubscription,
  loadSubscription,
  normalizeSubscriptionUrl,
  runSubscriptionSync,
  saveSubscription,
} from '@/lib/subscription';

export const dynamic = 'force-dynamic';

/** 读订阅配置（未配置时 subscription 为 null）。 */
export async function GET() {
  const sub = await loadSubscription();
  return Response.json({ subscription: sub });
}

/**
 * 保存订阅配置（url 与 intervalMinutes 可单独传，合并保存）。
 * 有订阅链接时，保存后立即同步一次，让用户马上看到数据。
 */
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    const v = (await req.json()) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bad body');
    body = v as Record<string, unknown>;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const prev = await loadSubscription();
  let url = prev?.url ?? '';
  if (body.url !== undefined) {
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return Response.json({ error: '请填写订阅链接' }, { status: 400 });
    }
    const normalized = normalizeSubscriptionUrl(body.url);
    if (!normalized) {
      return Response.json({ error: '订阅链接必须是 http(s) 或 webcal 地址' }, { status: 400 });
    }
    url = normalized;
  }
  let intervalMinutes = prev?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  if (body.intervalMinutes !== undefined) {
    if (
      typeof body.intervalMinutes !== 'number' ||
      !(SUBSCRIPTION_INTERVALS as readonly number[]).includes(body.intervalMinutes)
    ) {
      return Response.json({ error: '刷新间隔只能是 5 / 15 / 30 / 60 分钟' }, { status: 400 });
    }
    intervalMinutes = body.intervalMinutes;
  }
  const next = {
    url,
    intervalMinutes,
    lastSyncAt: prev?.lastSyncAt ?? null,
    lastSummary: prev?.lastSummary ?? null,
    lastError: prev?.lastError ?? null,
  };
  await saveSubscription(next);
  if (!url) {
    // 只改了刷新间隔、还没配链接：先存着，等配好链接再同步
    return Response.json({ ok: true, subscription: next, sync: null });
  }
  const sync = await runSubscriptionSync();
  const sub = await loadSubscription();
  return Response.json({ ok: sync.ok, subscription: sub, sync });
}

/** 取消订阅（删掉配置，后台不再同步）。 */
export async function DELETE() {
  await deleteSubscription();
  return Response.json({ ok: true });
}
