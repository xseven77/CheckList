import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: '我的清单',
  description: '日程清单，可多人同步勾选、导出长图',
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
      <body>
        <Script id="checklist-mode-init" strategy="beforeInteractive">
          {`try{var m=localStorage.getItem('checklist-mode-v1');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.mode=d?'dark':'light';}catch(e){}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
