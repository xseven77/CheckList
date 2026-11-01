import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseIcs } from '@/lib/ics';
import { importCalendarEvents, type CalendarImportSummary } from '@/lib/store';

/**
 * 日历订阅（单向）：配好订阅链接后，按刷新间隔在后台静默同步；
 * 设置里另有手动刷新按钮。同步逻辑复用单向导入（按 UID 匹配，勾选保留）。
 */

export const SUBSCRIPTION_INTERVALS = [5, 15, 30, 60] as const;
export const DEFAULT_INTERVAL_MINUTES = 15;

export type SubscriptionConfig = {
  url: string;
  intervalMinutes: number;
  lastSyncAt: string | null;
  lastSummary: CalendarImportSummary | null;
  lastError: string | null;
};

const SUBSCRIPTION_FILE = path.join(process.cwd(), 'data', 'subscription.json');
const MAX_ICS_BYTES = 2 * 1024 * 1024;

export function normalizeSubscriptionUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const https = /^webcal:\/\//i.test(url) ? 'https://' + url.slice('webcal://'.length) : url;
  return /^https?:\/\//i.test(https) ? https : null;
}

export function intervalLabel(minutes: number): string {
  return minutes >= 60 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
}

export async function loadSubscription(): Promise<SubscriptionConfig | null> {
  try {
    const text = await fs.readFile(SUBSCRIPTION_FILE, 'utf-8');
    const v = JSON.parse(text) as Partial<SubscriptionConfig>;
    if (!v || typeof v.url !== 'string') return null;
    const interval =
      typeof v.intervalMinutes === 'number' &&
      (SUBSCRIPTION_INTERVALS as readonly number[]).includes(v.intervalMinutes)
        ? v.intervalMinutes
        : DEFAULT_INTERVAL_MINUTES;
    return {
      url: v.url,
      intervalMinutes: interval,
      lastSyncAt: typeof v.lastSyncAt === 'string' ? v.lastSyncAt : null,
      lastSummary: v.lastSummary ?? null,
      lastError: typeof v.lastError === 'string' ? v.lastError : null,
    };
  } catch {
    return null;
  }
}

export async function saveSubscription(sub: SubscriptionConfig): Promise<void> {
  const tmp = SUBSCRIPTION_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(sub, null, 2), 'utf-8');
  await fs.rename(tmp, SUBSCRIPTION_FILE);
}

export async function deleteSubscription(): Promise<void> {
  try {
    await fs.unlink(SUBSCRIPTION_FILE);
  } catch {
    // 不存在也算删干净了
  }
}

/** 从一条订阅链接拉取并导入，返回摘要或错误（不写订阅状态，调用方写）。 */
export async function syncFromUrl(
  url: string
): Promise<{ ok: boolean; summary?: CalendarImportSummary; error?: string }> {
  const normalized = normalizeSubscriptionUrl(url);
  if (!normalized) return { ok: false, error: '订阅链接必须是 http(s) 或 webcal 地址' };
  let res: Response;
  try {
    res = await fetch(normalized, { headers: { Accept: 'text/calendar, */*' } });
  } catch {
    return { ok: false, error: '拉取订阅链接失败，请检查链接与网络' };
  }
  if (!res.ok) return { ok: false, error: `订阅链接返回 ${res.status}` };
  const icsText = await res.text();
  if (!icsText.trim()) return { ok: false, error: '订阅链接内容为空' };
  if (icsText.length > MAX_ICS_BYTES) return { ok: false, error: '日历内容过大（上限约 2MB）' };
  let parsed;
  try {
    parsed = parseIcs(icsText);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `解析 .ics 失败：${e.message}` : '解析 .ics 失败' };
  }
  const { summary } = await importCalendarEvents(parsed.events, parsed.skipped);
  return { ok: true, summary };
}

let syncing = false;

/** 按已存订阅配置同步一次（手动刷新与定时调度共用），并写回同步状态。 */
export async function runSubscriptionSync(): Promise<{
  ok: boolean;
  summary?: CalendarImportSummary;
  error?: string;
}> {
  if (syncing) return { ok: false, error: '同步进行中' };
  syncing = true;
  try {
    const sub = await loadSubscription();
    if (!sub || !sub.url) return { ok: false, error: '未配置订阅' };
    const result = await syncFromUrl(sub.url);
    await saveSubscription({
      ...sub,
      lastSyncAt: new Date().toISOString(),
      lastSummary: result.ok ? (result.summary ?? null) : sub.lastSummary,
      lastError: result.ok ? null : (result.error ?? '同步失败'),
    });
    return result;
  } finally {
    syncing = false;
  }
}

let schedulerStarted = false;

/** 后台静默刷新：每分钟检查一次，到达刷新间隔就同步。服务启动时调用一次即可。 */
export function startSubscriptionScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  console.log('[subscription] scheduler started');
  const tick = async () => {
    try {
      const sub = await loadSubscription();
      if (!sub || !sub.url) return;
      const parsed = sub.lastSyncAt ? Date.parse(sub.lastSyncAt) : 0;
      const lastMs = Number.isNaN(parsed) ? 0 : parsed;
      if (Date.now() - lastMs < sub.intervalMinutes * 60_000) return;
      const result = await runSubscriptionSync();
      console.log('[subscription] scheduled sync', result.ok ? 'ok' : `failed: ${result.error}`);
    } catch (e) {
      console.error('[subscription] scheduled sync error', e);
    }
  };
  // 启动后不久先检查一次（重启后到期的订阅不用等满一分钟）
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
