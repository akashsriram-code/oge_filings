import { NextResponse } from 'next/server';
import { buildApiResponse, loadTrumpOgeDataset } from '@/lib/oge/data';
import { filtersFromSearchParams } from '@/lib/oge/filter';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
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
