import { handleAskRequest } from '@/lib/oge/ask';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return invokeAskHandler(req);
}

export async function OPTIONS(req: Request) {
  return invokeAskHandler(req);
}

export async function GET() {
  return jsonResponse(405, { error: 'Use POST.' });
}

async function invokeAskHandler(req: Request): Promise<Response> {
  try {
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const result = await handleAskRequest({
      method: req.method,
      headers,
      body: req.method === 'OPTIONS' ? undefined : await req.text(),
    });

    return new Response(result.empty ? null : JSON.stringify(result.body ?? {}), {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Ask API failed before producing a response.',
    });
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.OPENARENA_CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
