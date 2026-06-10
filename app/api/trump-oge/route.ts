import { NextResponse } from 'next/server';
import { buildApiResponse, loadTrumpOgeCacheMeta, loadTrumpOgeDataset } from '@/lib/oge/data';
import { filtersFromSearchParams } from '@/lib/oge/filter';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('full') !== 'true') {
      const cacheMeta = await loadTrumpOgeCacheMeta();
      return NextResponse.json({
        cacheMeta,
        note: 'The static dashboard loads versioned JSON cache chunks client-side. Use ?full=true in a runtime Next/Vercel environment for the full API response.',
        files: [
          'historical-sources.json',
          'source-filings.json',
          'transactions.json',
          'baseline-holdings.json',
          'financial-disclosure-reports.json',
          'asset-income-holdings.json',
          'liabilities.json',
          'yearly-exposure-summaries.json',
          'review-queue.json',
          'events.json',
          'security-enrichment.json',
          'cache-meta.json',
        ].map((file) => `data/oge/trump/${file}`),
      });
    }
    const dataset = await loadTrumpOgeDataset();
    const response = buildApiResponse(dataset, filtersFromSearchParams(url.searchParams));
    return NextResponse.json(response);
  } catch (error) {
    console.error('[Trump OGE API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
