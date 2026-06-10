import { NextResponse } from 'next/server';
import {
  buildPageResponse,
  isTrumpOgePageName,
  loadTrumpOgeDataset,
  ogeCacheHeaders,
} from '@/lib/oge/data';
import { filtersFromSearchParams } from '@/lib/oge/filter';
import {
  buildPageResponseFromPostgres,
  postgresCacheHeaders,
} from '@/lib/oge/postgres';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = url.searchParams.get('name');
    if (!isTrumpOgePageName(page)) {
      return NextResponse.json(
        { error: 'Missing or invalid page name.' },
        { status: 400 }
      );
    }

    const filters = filtersFromSearchParams(url.searchParams);
    const postgresResponse = await buildPageResponseFromPostgres(page, filters);
    if (postgresResponse) {
      return NextResponse.json(postgresResponse, { headers: postgresCacheHeaders(postgresResponse.cacheMeta) });
    }

    const dataset = await loadTrumpOgeDataset();
    const response = buildPageResponse(dataset, page, filters);
    return NextResponse.json(response, { headers: ogeCacheHeaders(response.cacheMeta) });
  } catch (error) {
    console.error('[Trump OGE page API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
