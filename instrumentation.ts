/**
 * 服务启动时注册一次：启动日历订阅的后台静默刷新调度器。
 * 自托管的 next start 是常驻进程，进程内的定时器会一直跑；
 * 服务重启后，调度器随服务一起重启，到期的订阅会在启动后不久补同步。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSubscriptionScheduler } = await import('@/lib/subscription');
    startSubscriptionScheduler();
  }
}
