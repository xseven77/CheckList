import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  // 未设置密码时完全开放
  if (!password) {
    return NextResponse.next();
  }

  const auth = req.headers.get('authorization');
  if (auth) {
    const [, encoded] = auth.split(' ');
    if (encoded) {
      try {
        const decoded = atob(encoded);
        const parts = decoded.split(':');
        const pass = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
        if (pass === password) {
          return NextResponse.next();
        }
      } catch {}
    }
  }

  return new NextResponse('访问需要密码', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CheckList"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
