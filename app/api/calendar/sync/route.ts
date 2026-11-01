import { loadSubscription, runSubscriptionSync } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

/** 手动刷新：按已存订阅配置立即同步一次（不改配置）。 */
export async function POST() {
  const sub = await loadSubscription();
  if (!sub || !sub.url) {
    return Response.json({ error: '未配置订阅' }, { status: 400 });
  }
  const result = await runSubscriptionSync();
  const updated = await loadSubscription();
  return Response.json({ ok: result.ok, subscription: updated, sync: result });
}
