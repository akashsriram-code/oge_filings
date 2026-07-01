import { NextResponse } from 'next/server';
import { 
  fetchYahooQuotes, 
  getSpyBenchmark,
  type MarketQuote 
} from '@/lib/oge/market-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MarketApiResponse {
  quotes: Record<string, MarketQuote>;
  benchmark: MarketQuote | null;
  fetchedAt: string;
  successCount: number;
  failedTickers: string[];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tickersParam = url.searchParams.get('tickers');
    
    if (!tickersParam) {
      return NextResponse.json(
        { error: 'Missing tickers parameter' },
        { status: 400 }
      );
    }
    
    const tickers = tickersParam
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0 && t.length <= 6);
    
    if (tickers.length === 0) {
      return NextResponse.json(
        { error: 'No valid tickers provided' },
        { status: 400 }
      );
    }
    
    // Limit to 50 tickers per request
    const limitedTickers = tickers.slice(0, 50);
    
    const [quotesMap, benchmark] = await Promise.all([
      fetchYahooQuotes(limitedTickers),
      getSpyBenchmark(),
    ]);
    
    // Convert Map to object for JSON serialization
    const quotes: Record<string, MarketQuote> = {};
    for (const [ticker, quote] of quotesMap) {
      quotes[ticker] = quote;
    }
    
    const failedTickers = limitedTickers.filter(t => !quotesMap.has(t));
    
    const response: MarketApiResponse = {
      quotes,
      benchmark,
      fetchedAt: new Date().toISOString(),
      successCount: quotesMap.size,
      failedTickers,
    };
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('[Trump OGE Market API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}