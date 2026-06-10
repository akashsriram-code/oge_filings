import { handleAskRequest } from '@/lib/oge/ask';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return invokeAskHandler(req);
}

export async function OPTIONS(req: Request) {
  return invokeAskHandler(req);
}

export async function GET() {
  return Response.json({ error: 'Use POST.' }, { status: 405 });
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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Ask API failed before producing a response.' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.OPENARENA_CORS_ORIGIN || '*',
        },
      }
    );
  }
}
