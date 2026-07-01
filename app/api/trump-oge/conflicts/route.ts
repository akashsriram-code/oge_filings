import { NextResponse } from 'next/server';
import { analyzeConflicts, type ConflictAnalysis } from '@/lib/oge/conflict-analyzer';
import { loadTrumpOgeDataset, ogeCacheHeaders } from '@/lib/oge/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const dataset = await loadTrumpOgeDataset();
    
    const analysis: ConflictAnalysis = analyzeConflicts({
      holdings: dataset.trumpIndex,
      transactions: dataset.transactions,
      events: dataset.events,
    });
    
    return NextResponse.json(analysis, {
      headers: {
        ...ogeCacheHeaders(dataset.cacheMeta),
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[Trump OGE Conflicts API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}