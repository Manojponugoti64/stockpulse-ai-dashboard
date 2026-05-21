import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
const cache = new Map();
const CACHE_TTL = 300_000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Python Bridge to yfinance
// ---------------------------------------------------------------------------
const BRIDGE_PATH = '/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard/yf_bridge.py';

async function invokeBridge(args) {
  try {
    const { stdout } = await execFileAsync('python3', [
      BRIDGE_PATH,
      ...args
    ], { 
      cwd: '/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard',
      timeout: 30000 
    });
    
    const parsed = JSON.parse(stdout);
    if (parsed && parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed;
  } catch (err) {
    console.error(`[Bridge Error] args=${JSON.stringify(args)}:`, err.message);
    throw err;
  }
}

function normalizeSymbol(symbol) {
  const s = symbol.trim().toUpperCase();
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;
  return `${s}.NS`;
}

// ---------------------------------------------------------------------------
// GET /api/quote/:symbol
// ---------------------------------------------------------------------------
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const cacheKey = `quote:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const result = await invokeBridge(['quote', symbol]);
    if (!result || result.error) throw new Error(result?.error || 'Failed to fetch quote');

    setCache(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error(`[quote/${req.params.symbol}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/quotes?symbols=RELIANCE,TCS,INFY
// ---------------------------------------------------------------------------
app.get('/api/quotes', async (req, res) => {
  try {
    const symbolsParam = req.query.symbols;
    if (!symbolsParam) return res.status(400).json({ error: 'Missing "symbols" query param' });

    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) return res.status(400).json({ error: 'No symbols provided' });

    const normalizedSymbols = symbols.map(normalizeSymbol);
    
    // Check cache for ALL symbols first
    const results = [];
    const missingSymbols = [];
    
    for (const sym of normalizedSymbols) {
      const cached = getCached(`quote:${sym}`);
      if (cached) {
        results.push(cached);
      } else {
        missingSymbols.push(sym);
      }
    }
    
    // If there are symbols not in cache, fetch them in a single batch request!
    if (missingSymbols.length > 0) {
      try {
        console.log(`[quotes] Batch fetching missing symbols from Python bridge: ${missingSymbols.join(',')}`);
        const batchResults = await invokeBridge(['quotes', missingSymbols.join(',')]);
        
        if (Array.isArray(batchResults)) {
          for (const item of batchResults) {
            if (item && item.symbol) {
              setCache(`quote:${item.symbol}`, item);
              results.push(item);
            }
          }
        }
      } catch (e) {
        console.error(`[quotes] Batch fetch error:`, e.message);
      }
    }

    // Return whatever we have (cached + batch fetched)
    return res.json(results);
  } catch (err) {
    console.error('[quotes]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/:query
// ---------------------------------------------------------------------------
app.get('/api/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const cacheKey = `search:${query}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const indianStocks = await invokeBridge(['search', query]);
    if (!Array.isArray(indianStocks)) {
      throw new Error(indianStocks?.error || 'Failed to perform search');
    }

    setCache(cacheKey, indianStocks);
    return res.json(indianStocks);
  } catch (err) {
    console.error(`[search/${req.params.query}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:symbol?period=1mo
// ---------------------------------------------------------------------------
app.get('/api/history/:symbol', async (req, res) => {
  try {
    const validPeriods = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','ytd','max'];
    const period = validPeriods.includes(req.query.period) ? req.query.period : '1mo';
    const symbol = normalizeSymbol(req.params.symbol);
    const cacheKey = `history:${symbol}:${period}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const result = await invokeBridge(['history', symbol, period]);
    if (!result || result.error) throw new Error(result?.error || 'Failed to fetch history');

    setCache(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error(`[history/${req.params.symbol}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
});
// ---------------------------------------------------------------------------
// GET /api/advisor/analyze?symbols=PHARMABEES,NEXT50IETF
// ---------------------------------------------------------------------------
app.get('/api/advisor/analyze', async (req, res) => {
  try {
    const symbolsParam = req.query.symbols;
    if (!symbolsParam) return res.status(400).json({ error: 'Missing "symbols" query param' });

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) return res.status(400).json({ error: 'No symbols provided' });

    const normalizedSymbols = symbols.map(normalizeSymbol);
    
    const results = [];
    const missingSymbols = [];
    const ADVISOR_CACHE_TTL = 900_000; // 15 minutes
    
    for (const sym of normalizedSymbols) {
      const cacheKey = `advisor:${sym}`;
      const entry = cache.get(cacheKey);
      if (entry && (Date.now() - entry.timestamp < ADVISOR_CACHE_TTL)) {
        results.push(entry.data);
      } else {
        missingSymbols.push(sym);
      }
    }
    
    if (missingSymbols.length > 0) {
      try {
        console.log(`[advisor] Analyzing missing symbols from Python bridge: ${missingSymbols.join(',')}`);
        const analysisResults = await invokeBridge(['analyze', missingSymbols.join(',')]);
        
        if (Array.isArray(analysisResults)) {
          for (const item of analysisResults) {
            if (item && item.symbol) {
              cache.set(`advisor:${item.symbol}`, { data: item, timestamp: Date.now() });
              results.push(item);
            }
          }
        }
      } catch (e) {
        console.error(`[advisor] Analysis fetch error:`, e.message);
      }
    }
    
    return res.json(results);
  } catch (err) {
    console.error('[advisor]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/advisor/news-sentiment?refresh=true
// ---------------------------------------------------------------------------
const NEWS_ADVISOR_PATH = '/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard/news_advisor.py';
const NEWS_SENTIMENT_JSON_PATH = '/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard/news_sentiment.json';

async function invokeNewsAdvisor() {
  try {
    console.log('[News Advisor] Running news_advisor.py to refresh sentiment index...');
    await execFileAsync('python3', [NEWS_ADVISOR_PATH], {
      cwd: '/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard',
      timeout: 35000
    });
    console.log('[News Advisor] news_advisor.py completed successfully.');
  } catch (err) {
    console.error('[News Advisor Error] Failed to execute news_advisor.py:', err.message);
    throw err;
  }
}

app.get('/api/advisor/news-sentiment', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    if (refresh) {
      await invokeNewsAdvisor();
    }
    
    try {
      const dataStr = await fs.readFile(NEWS_SENTIMENT_JSON_PATH, 'utf8');
      const data = JSON.parse(dataStr);
      return res.json(data);
    } catch (e) {
      console.log('[News Advisor] JSON file not found, running script...');
      await invokeNewsAdvisor();
      const dataStr = await fs.readFile(NEWS_SENTIMENT_JSON_PATH, 'utf8');
      const data = JSON.parse(dataStr);
      return res.json(data);
    }
  } catch (err) {
    console.error('[News Sentiment API Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------------------------
// GET /api/market-status
// ---------------------------------------------------------------------------
app.get('/api/market-status', (_req, res) => {
  const now = new Date();
  const istStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const ist = new Date(istStr);

  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && mins >= 555 && mins < 930; // 9:15–15:30

  const currentTime = now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long',
  });

  let nextOpen = null, nextClose = null;
  if (isOpen) {
    const ct = new Date(ist); ct.setHours(15, 30, 0, 0);
    nextClose = ct.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  } else {
    const nd = new Date(ist);
    if (isWeekday && mins < 555) { nd.setHours(9, 15, 0, 0); }
    else { nd.setDate(nd.getDate() + 1); while (nd.getDay() === 0 || nd.getDay() === 6) nd.setDate(nd.getDate() + 1); nd.setHours(9, 15, 0, 0); }
    nextOpen = nd.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  }

  return res.json({ isOpen, currentTime, nextOpen, nextClose });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => console.log(`🚀 Stock API proxy running on http://localhost:${PORT}`));
