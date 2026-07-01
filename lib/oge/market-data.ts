/**
 * Market data service for fetching real-time stock prices
 * Uses Yahoo Finance API (free tier) as primary source
 */

export interface MarketQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap: number | null;
  volume: number | null;
  previousClose: number;
  timestamp: string;
  source: 'yahoo' | 'cached' | 'unavailable';
}

export interface PortfolioMarketData {
  quotes: Map<string, MarketQuote>;
  fetchedAt: string;
  successCount: number;
  failedTickers: string[];
  totalMarketValue: number;
  totalUnrealizedGain: number;
  totalUnrealizedGainPct: number | null;
}

export interface HoldingWithMarketData {
  ticker: string;
  displayName: string;
  shares: number | null; // Estimated from midpoint / price
  costBasis: number; // From OGE midpoint
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
}

// In-memory cache with TTL
const quoteCache = new Map<string, { quote: MarketQuote; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch quotes from Yahoo Finance API
 * Uses the free v8 API endpoint
 */
export async function fetchYahooQuotes(tickers: string[]): Promise<Map<string, MarketQuote>> {
  const results = new Map<string, MarketQuote>();
  
  if (tickers.length === 0) return results;
  
  // Check cache first
  const now = Date.now();
  const uncachedTickers: string[] = [];
  
  for (const ticker of tickers) {
    const cached = quoteCache.get(ticker);
    if (cached && cached.expiresAt > now) {
      results.set(ticker, cached.quote);
    } else {
      uncachedTickers.push(ticker);
    }
  }
  
  if (uncachedTickers.length === 0) return results;
  
  // Batch into chunks of 10 to avoid rate limits
  const chunks = chunkArray(uncachedTickers, 10);
  
  for (const chunk of chunks) {
    try {
      const symbols = chunk.join(',');
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TrumpIndexBot/1.0)',
        },
        next: { revalidate: 300 }, // Next.js cache for 5 minutes
      });
      
      if (!response.ok) {
        console.warn(`[Market Data] Yahoo API returned ${response.status}`);
        continue;
      }
      
      const data = await response.json() as YahooQuoteResponse;
      
      for (const quote of data?.quoteResponse?.result || []) {
        const marketQuote: MarketQuote = {
          ticker: quote.symbol,
          price: quote.regularMarketPrice ?? 0,
          change: quote.regularMarketChange ?? 0,
          changePercent: quote.regularMarketChangePercent ?? 0,
          marketCap: quote.marketCap ?? null,
          volume: quote.regularMarketVolume ?? null,
          previousClose: quote.regularMarketPreviousClose ?? quote.regularMarketPrice ?? 0,
          timestamp: new Date().toISOString(),
          source: 'yahoo',
        };
        
        results.set(quote.symbol, marketQuote);
        quoteCache.set(quote.symbol, {
          quote: marketQuote,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
    } catch (error) {
      console.warn(`[Market Data] Error fetching chunk: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return results;
}

/**
 * Calculate portfolio market data for Trump Index entries
 */
export async function calculatePortfolioMarketData(
  entries: Array<{ ticker: string | null; displayName: string; currentMidpoint: number }>
): Promise<PortfolioMarketData> {
  const tickers = entries
    .map(e => e.ticker)
    .filter((t): t is string => t !== null && t.length > 0 && t.length <= 5);
  
  const uniqueTickers = Array.from(new Set(tickers));
  const quotes = await fetchYahooQuotes(uniqueTickers);
  
  const failedTickers = uniqueTickers.filter(t => t !== null && !quotes.has(t));
  
  // Calculate totals
  let totalMarketValue = 0;
  let totalCostBasis = 0;
  
  for (const entry of entries) {
    if (entry.ticker && quotes.has(entry.ticker)) {
      const quote = quotes.get(entry.ticker)!;
      // Estimate shares from cost basis / previous close (when they likely valued it)
      const estimatedShares = entry.currentMidpoint / quote.previousClose;
      totalMarketValue += estimatedShares * quote.price;
      totalCostBasis += entry.currentMidpoint;
    } else {
      // Use OGE-reported value for non-quoted holdings
      totalMarketValue += entry.currentMidpoint;
      totalCostBasis += entry.currentMidpoint;
    }
  }
  
  const totalUnrealizedGain = totalMarketValue - totalCostBasis;
  const totalUnrealizedGainPct = totalCostBasis > 0 
    ? (totalUnrealizedGain / totalCostBasis) * 100 
    : null;
  
  return {
    quotes,
    fetchedAt: new Date().toISOString(),
    successCount: quotes.size,
    failedTickers,
    totalMarketValue,
    totalUnrealizedGain,
    totalUnrealizedGainPct,
  };
}

/**
 * Enrich a single holding with market data
 */
export function enrichHoldingWithMarketData(
  holding: { ticker: string | null; displayName: string; currentMidpoint: number },
  quote: MarketQuote | undefined
): HoldingWithMarketData {
  if (!quote || !holding.ticker) {
    return {
      ticker: holding.ticker || '',
      displayName: holding.displayName,
      shares: null,
      costBasis: holding.currentMidpoint,
      currentPrice: null,
      currentValue: null,
      unrealizedGain: null,
      unrealizedGainPct: null,
      dayChange: null,
      dayChangePct: null,
    };
  }
  
  // Estimate shares from reported value / previous close
  const estimatedShares = holding.currentMidpoint / quote.previousClose;
  const currentValue = estimatedShares * quote.price;
  const unrealizedGain = currentValue - holding.currentMidpoint;
  const unrealizedGainPct = holding.currentMidpoint > 0 
    ? (unrealizedGain / holding.currentMidpoint) * 100 
    : null;
  
  return {
    ticker: holding.ticker,
    displayName: holding.displayName,
    shares: estimatedShares,
    costBasis: holding.currentMidpoint,
    currentPrice: quote.price,
    currentValue,
    unrealizedGain,
    unrealizedGainPct,
    dayChange: quote.change * estimatedShares,
    dayChangePct: quote.changePercent,
  };
}

/**
 * Compare portfolio performance to S&P 500
 */
export async function getSpyBenchmark(): Promise<MarketQuote | null> {
  const quotes = await fetchYahooQuotes(['SPY']);
  return quotes.get('SPY') || null;
}

// Helper types
interface YahooQuoteResponse {
  quoteResponse?: {
    result?: Array<{
      symbol: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketPreviousClose?: number;
      regularMarketVolume?: number;
      marketCap?: number;
    }>;
  };
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Clear the quote cache (useful for testing)
 */
export function clearMarketDataCache(): void {
  quoteCache.clear();
}