import { getChecklist } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** 整份清单（也可以用来备份：curl 这个地址存成文件） */
export async function GET() {
  return Response.json(await getChecklist(), { headers: { 'Cache-Control': 'no-store' } });
}
