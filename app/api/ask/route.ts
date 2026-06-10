import askHandler from '@/lib/oge/ask';

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
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const responseHeaders = new Headers();
  let statusCode = 200;
  let payload: unknown;
  let ended = false;

  const body = req.method === 'OPTIONS' ? undefined : await req.text();

  await askHandler(
    {
      method: req.method,
      headers,
      body,
    },
    {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        responseHeaders.set(name, value);
      },
      json(bodyValue: unknown) {
        payload = bodyValue;
      },
      end() {
        ended = true;
      },
    }
  );

  if (payload === undefined && ended) {
    return new Response(null, { status: statusCode, headers: responseHeaders });
  }

  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(payload ?? {}), {
    status: statusCode,
    headers: responseHeaders,
  });
}
