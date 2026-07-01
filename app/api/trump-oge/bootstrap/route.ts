import { NextResponse } from 'next/server';
import { loadTrumpOgeBootstrap, ogeCacheHeaders } from '@/lib/oge/data';
import {
  loadTrumpOgeBootstrapFromPostgres,
  postgresCacheHeaders,
} from '@/lib/oge/postgres';

// Allow caching of bootstrap data since OGE filings update infrequently
// This improves cold-start performance significantly
export const dynamic = 'force-static';
export const revalidate = 3600; // Revalidate every hour
export const runtime = 'nodejs';

export async function GET() {
  try {
    const postgresBootstrap = await loadTrumpOgeBootstrapFromPostgres();
    if (postgresBootstrap) {
      return NextResponse.json(postgresBootstrap, { headers: postgresCacheHeaders(postgresBootstrap.cacheMeta) });
    }
    const bootstrap = await loadTrumpOgeBootstrap();
    return NextResponse.json(bootstrap, { headers: ogeCacheHeaders(bootstrap.cacheMeta) });
  } catch (error) {
    console.error('[Trump OGE bootstrap API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
