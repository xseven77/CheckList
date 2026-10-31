import { onChange } from '@/lib/store';
import type { Change } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Server-Sent Events：有人改了清单就推给所有打开页面的人 */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      push('retry: 3000\n\n');
      const off = onChange((c: Change) => push(`data: ${JSON.stringify(c)}\n\n`));
      const ping = setInterval(() => push(': ping\n\n'), 25_000); // 防止代理断开空闲连接
      cleanup = () => {
        clearInterval(ping);
        off();
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 不缓冲
    },
  });
}
