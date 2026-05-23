import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export type ApiKeyAuthResult = Awaited<ReturnType<typeof auth>>;

export type ApiKeyAuthSuccess = ApiKeyAuthResult & {
  isAuthenticated: true;
};

export type ApiKeyAuthCheck =
  | {
      ok: true;
      auth: ApiKeyAuthSuccess;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireApiKeyAuth(): Promise<ApiKeyAuthCheck> {
  const authResult = await auth({ acceptsToken: 'api_key' });

  if (!authResult.isAuthenticated) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized', message: 'Missing or invalid API key.', hint: 'Use Authorization: Bearer <API_KEY>. Get a key from your profile > API Keys.', }, { status: 401 }),
    };
  }

  return {
    ok: true,
    auth: authResult as unknown as ApiKeyAuthSuccess,
  };
}

function getOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const originHeader = getOrigin(request.headers.get('origin'));
  const refererHeader = getOrigin(request.headers.get('referer'));
  const fetchSiteHeader = request.headers.get('sec-fetch-site');

  return (
    originHeader === requestOrigin ||
    refererHeader === requestOrigin ||
    fetchSiteHeader === 'same-origin'
  );
}

export function withApiKeyAuth<TArgs extends unknown[]>(
  handler: (auth: ApiKeyAuthSuccess | null, ...args: TArgs) => Response | Promise<Response>
) {
  return async (...args: TArgs): Promise<Response> => {
    const request = args[0] as Request | undefined;

    if (request && isSameOriginRequest(request)) {
      return handler(null, ...args);
    }

    const authCheck = await requireApiKeyAuth();

    if (!authCheck.ok) {
      return authCheck.response;
    }

    return handler(authCheck.auth, ...args);
  };
}