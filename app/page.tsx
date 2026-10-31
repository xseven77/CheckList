import type { Metadata } from 'next';
import Checklist from '@/components/Checklist';
import { getChecklist } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getChecklist();
  return { title: doc.title };
}

export default async function Page() {
  const doc = await getChecklist();
  return <Checklist initial={doc} />;
}
