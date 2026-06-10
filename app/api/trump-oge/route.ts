import { NextResponse } from 'next/server';
import { buildApiResponse, loadTrumpOgeCacheMeta, loadTrumpOgeDataset, ogeCacheHeaders } from '@/lib/oge/data';
import { filtersFromSearchParams } from '@/lib/oge/filter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('full') !== 'true') {
      const cacheMeta = await loadTrumpOgeCacheMeta();
      return NextResponse.json({
        cacheMeta,
        note: 'Use /api/trump-oge/bootstrap for the first-screen payload, /api/trump-oge/page?name=index for page-scoped payloads, or ?full=true for the full export/debug response.',
      }, { headers: ogeCacheHeaders(cacheMeta) });
    }
    const dataset = await loadTrumpOgeDataset();
    const response = buildApiResponse(dataset, filtersFromSearchParams(url.searchParams));
    return NextResponse.json(response, { headers: ogeCacheHeaders(response.cacheMeta) });
  } catch (error) {
    console.error('[Trump OGE API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
