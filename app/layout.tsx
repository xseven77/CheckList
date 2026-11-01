import type { Metadata, Viewport } from 'next';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-sc/900.css';
import './globals.css';

export const metadata: Metadata = {
  title: '婚礼筹备清单',
  description: '3—7 号婚礼行程与物品清单，可多人同步勾选、编辑明细、导出长图',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf7f6' },
    { media: '(prefers-color-scheme: dark)', color: '#161112' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
