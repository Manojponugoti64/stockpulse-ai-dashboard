import sys
import json
import yfinance as yf
import requests

def normalize_symbol(symbol):
    sym = symbol.strip().upper()
    if sym.endswith('.NS') or sym.endswith('.BO'):
        return sym
    return f"{sym}.NS"

def run_search(query):
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={requests.utils.quote(query)}&quotesCount=15&newsCount=0&listsCount=0"
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
        }
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code != 200:
            raise Exception(f"HTTP {r.status_code}: {r.text}")
        
        data = r.json()
        quotes = data.get('quotes', [])
        # Filter for Indian stocks
        indian_stocks = [q for q in quotes if (q.get('symbol') or '').endswith('.NS') or (q.get('symbol') or '').endswith('.BO')]
        return indian_stocks
    except Exception as e:
        return {"error": str(e)}

def run_quote(symbol):
    symbol = normalize_symbol(symbol)
    try:
        # Try using ticker.info first for rich metadata
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        # Extract fields
        price = info.get('regularMarketPrice') or info.get('currentPrice')
        prev_close = info.get('regularMarketPreviousClose') or info.get('previousClose')
        
        # If ticker.info returned empty or failed fields, fall back to yf.download (highly robust)
        if price is None or prev_close is None:
            raise ValueError("Incomplete info data, falling back to download")
            
        change = price - prev_close
        pct = (change / prev_close * 100) if prev_close else 0.0
        
        return {
            "symbol": symbol,
            "shortName": info.get('shortName') or info.get('longName') or symbol.replace('.NS', '').replace('.BO', ''),
            "regularMarketPrice": price,
            "regularMarketChange": change,
            "regularMarketChangePercent": pct,
            "regularMarketDayHigh": info.get('regularMarketDayHigh') or info.get('dayHigh') or price,
            "regularMarketDayLow": info.get('regularMarketDayLow') or info.get('dayLow') or price,
            "regularMarketVolume": info.get('regularMarketVolume') or info.get('volume') or 0,
            "regularMarketPreviousClose": prev_close,
            "fiftyTwoWeekHigh": info.get('fiftyTwoWeekHigh') or price,
            "fiftyTwoWeekLow": info.get('fiftyTwoWeekLow') or price,
            "currency": info.get('currency') or 'INR'
        }
    except Exception as e:
        # Robust fallback using yf.download
        try:
            df = yf.download(symbol, period="2d", interval="1d", progress=False)
            if df.empty or len(df) < 1:
                raise Exception(f"No price data found for {symbol}")
            
            # If 2 days of data are available, compute changes
            if len(df) >= 2:
                prev_close = float(df['Close'].iloc[-2])
                price = float(df['Close'].iloc[-1])
                high = float(df['High'].iloc[-1])
                low = float(df['Low'].iloc[-1])
                volume = int(df['Volume'].iloc[-1])
            else:
                price = float(df['Close'].iloc[-1])
                prev_close = float(df['Open'].iloc[-1]) # Fallback
                high = float(df['High'].iloc[-1])
                low = float(df['Low'].iloc[-1])
                volume = int(df['Volume'].iloc[-1])
                
            change = price - prev_close
            pct = (change / prev_close * 100) if prev_close else 0.0
            
            return {
                "symbol": symbol,
                "shortName": symbol.replace('.NS', '').replace('.BO', ''),
                "regularMarketPrice": price,
                "regularMarketChange": change,
                "regularMarketChangePercent": pct,
                "regularMarketDayHigh": high,
                "regularMarketDayLow": low,
                "regularMarketVolume": volume,
                "regularMarketPreviousClose": prev_close,
                "fiftyTwoWeekHigh": price,
                "fiftyTwoWeekLow": price,
                "currency": 'INR'
            }
        except Exception as ex:
            return {"error": f"Failed to fetch quote for {symbol}: {str(e)} -> fallback error: {str(ex)}"}

def run_quotes(symbols_str):
    symbols = [normalize_symbol(s) for s in symbols_str.split(',') if s.strip()]
    if not symbols:
        return []
    
    try:
        # Download last 5 days of data to guarantee we have at least 2 trading days
        df = yf.download(symbols, period="5d", interval="1d", progress=False, group_by="ticker")
        
        results = []
        for symbol in symbols:
            try:
                # If single symbol download, pandas structure is slightly different than multi-symbol
                if len(symbols) == 1:
                    ticker_df = df
                else:
                    ticker_df = df[symbol]
                
                # Filter out rows with NaN in Close
                ticker_df = ticker_df.dropna(subset=['Close'])
                
                if ticker_df.empty:
                    # Try single quote lookup as fallback
                    single = run_quote(symbol)
                    if "error" not in single:
                        results.append(single)
                    continue
                
                if len(ticker_df) >= 2:
                    prev_close = float(ticker_df['Close'].iloc[-2])
                    price = float(ticker_df['Close'].iloc[-1])
                else:
                    price = float(ticker_df['Close'].iloc[-1])
                    prev_close = float(ticker_df['Open'].iloc[-1])
                
                high = float(ticker_df['High'].iloc[-1])
                low = float(ticker_df['Low'].iloc[-1])
                volume = int(ticker_df['Volume'].iloc[-1])
                
                change = price - prev_close
                pct = (change / prev_close * 100) if prev_close else 0.0
                
                results.append({
                    "symbol": symbol,
                    "shortName": symbol.replace('.NS', '').replace('.BO', ''),
                    "regularMarketPrice": price,
                    "regularMarketChange": change,
                    "regularMarketChangePercent": pct,
                    "regularMarketDayHigh": high,
                    "regularMarketDayLow": low,
                    "regularMarketVolume": volume,
                    "regularMarketPreviousClose": prev_close,
                    "fiftyTwoWeekHigh": price, # fallback
                    "fiftyTwoWeekLow": price,  # fallback
                    "currency": 'INR'
                })
            except Exception as e:
                # Fallback to single quote for this ticker
                single = run_quote(symbol)
                if "error" not in single:
                    results.append(single)
                    
        return results
    except Exception as e:
        # If batch download fails completely, do them one by one
        results = []
        for symbol in symbols:
            single = run_quote(symbol)
            if "error" not in single:
                results.append(single)
        return results

def run_history(symbol, period):
    symbol = normalize_symbol(symbol)
    
    # yfinance periods
    valid_periods = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','ytd','max']
    if period not in valid_periods:
        period = '1mo'
        
    # Determine interval based on period
    map_interval = {
        '1d': '5m',
        '5d': '15m',
        '1mo': '1d',
        '3mo': '1d',
        '6mo': '1wk',
        '1y': '1wk',
        '2y': '1mo',
        '5y': '1mo',
        'ytd': '1d',
        'max': '1mo'
    }
    interval = map_interval.get(period, '1d')
    
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval, keepna=False)
        
        if df.empty:
            raise Exception("No historical data found")
            
        quotes = []
        for timestamp, row in df.iterrows():
            # timestamp is pandas Timestamp
            quotes.append({
                "date": timestamp.isoformat(),
                "open": float(row['Open']) if 'Open' in row else None,
                "high": float(row['High']) if 'High' in row else None,
                "low": float(row['Low']) if 'Low' in row else None,
                "close": float(row['Close']) if 'Close' in row else None,
                "volume": int(row['Volume']) if 'Volume' in row else None
            })
            
        # Extract meta info
        meta = {
            "symbol": symbol,
            "currency": ticker.info.get('currency', 'INR') if hasattr(ticker, 'info') else 'INR',
            "regularMarketPrice": quotes[-1]['close'] if quotes else 0,
            "regularMarketPreviousClose": float(df['Close'].iloc[-2]) if len(df) >= 2 else 0
        }
        
        return {
            "meta": meta,
            "quotes": quotes
        }
    except Exception as e:
        return {"error": str(e)}

def run_analyze(symbols_str):
    import pandas as pd
    import numpy as np
    
    symbols = [normalize_symbol(s) for s in symbols_str.split(',') if s.strip()]
    if not symbols:
        return []
        
    results = []
    
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period="3mo", interval="1d", keepna=False)
            if df.empty or len(df) < 22:
                df = yf.download(symbol, period="3mo", interval="1d", progress=False)
                
            if df.empty or len(df) < 14:
                results.append({
                    "symbol": symbol,
                    "error": f"Insufficient historical data to analyze {symbol}."
                })
                continue
                
            df = df.dropna(subset=['Close'])
            if len(df) < 14:
                results.append({
                    "symbol": symbol,
                    "error": f"Insufficient non-NaN price data for {symbol}."
                })
                continue
                
            price = float(df['Close'].iloc[-1])
            prev_close = float(df['Close'].iloc[-2]) if len(df) >= 2 else price
            change = price - prev_close
            pct = (change / prev_close * 100) if prev_close else 0.0
            
            # Indicators
            df['EMA9'] = df['Close'].ewm(span=9, adjust=False).mean()
            df['EMA21'] = df['Close'].ewm(span=21, adjust=False).mean()
            
            delta = df['Close'].diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
            avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()
            rs = avg_gain / (avg_loss + 1e-9)
            df['RSI'] = 100 - (100 / (1 + rs))
            
            df['EMA12'] = df['Close'].ewm(span=12, adjust=False).mean()
            df['EMA26'] = df['Close'].ewm(span=26, adjust=False).mean()
            df['MACD'] = df['EMA12'] - df['EMA26']
            df['Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
            df['Histogram'] = df['MACD'] - df['Signal']
            
            rsi = float(df['RSI'].iloc[-1])
            ema9 = float(df['EMA9'].iloc[-1])
            ema21 = float(df['EMA21'].iloc[-1])
            macd = float(df['MACD'].iloc[-1])
            signal = float(df['Signal'].iloc[-1])
            hist = float(df['Histogram'].iloc[-1])
            
            crossover = "none"
            if len(df) >= 4:
                for i in range(-3, 0):
                    prev_ema9 = float(df['EMA9'].iloc[i-1])
                    prev_ema21 = float(df['EMA21'].iloc[i-1])
                    curr_ema9 = float(df['EMA9'].iloc[i])
                    curr_ema21 = float(df['EMA21'].iloc[i])
                    
                    if prev_ema9 <= prev_ema21 and curr_ema9 > curr_ema21:
                        crossover = "bullish_ema"
                    elif prev_ema9 >= prev_ema21 and curr_ema9 < curr_ema21:
                        crossover = "bearish_ema"
                        
                for i in range(-3, 0):
                    prev_macd = float(df['MACD'].iloc[i-1])
                    prev_sig = float(df['Signal'].iloc[i-1])
                    curr_macd = float(df['MACD'].iloc[i])
                    curr_sig = float(df['Signal'].iloc[i])
                    
                    if prev_macd <= prev_sig and curr_macd > curr_sig:
                        if crossover == "none":
                            crossover = "bullish_macd"
                        else:
                            crossover = "bullish_both"
                    elif prev_macd >= prev_sig and curr_macd < curr_sig:
                        if crossover == "none":
                            crossover = "bearish_macd"
                        else:
                            crossover = "bearish_both"
                            
            # Scoring
            score = 0
            reasons = []
            
            if rsi < 35:
                score += 2
                reasons.append(f"RSI is extremely oversold at {rsi:.1f}, indicating a strong price reversal upwards is near.")
            elif rsi < 42:
                score += 1
                reasons.append(f"RSI is in the healthy accumulation zone at {rsi:.1f}.")
            elif rsi > 68:
                score -= 2
                reasons.append(f"RSI is overbought at {rsi:.1f}, warning that seller exhaustion is likely to trigger a pullback.")
            elif rsi > 60:
                score -= 1
                reasons.append(f"RSI is elevated at {rsi:.1f}, suggesting moderate profit-taking pressure.")
            else:
                reasons.append(f"RSI is at a healthy neutral of {rsi:.1f}.")
                
            if ema9 > ema21:
                score += 1
                if crossover in ["bullish_ema", "bullish_both"]:
                    score += 2
                    reasons.append("Bullish Trend Crossover: The short-term 9-day EMA has crossed above the 21-day EMA, signaling positive momentum.")
                else:
                    reasons.append("EMA Trend: The short-term 9-day EMA is trading above the 21-day EMA, confirming an active uptrend.")
            else:
                score -= 1
                if crossover in ["bearish_ema", "bearish_both"]:
                    score -= 2
                    reasons.append("Bearish Trend Crossover: The short-term 9-day EMA has crossed below the 21-day EMA, signaling short-term trend deterioration.")
                else:
                    reasons.append("EMA Trend: The 9-day EMA is below the 21-day EMA, showing active downward trend pressure.")
                    
            if macd > signal:
                score += 1
                if crossover in ["bullish_macd", "bullish_both"]:
                    score += 1
                    reasons.append("Bullish MACD Crossover: The MACD line crossed above the Signal line, indicating fresh buying volume.")
                else:
                    reasons.append("MACD Momentum: MACD is trading above the Signal line, confirming positive momentum.")
            else:
                score -= 1
                if crossover in ["bearish_macd", "bearish_both"]:
                    score -= 1
                    reasons.append("Bearish MACD Crossover: The MACD line crossed below the Signal line, signaling momentum loss.")
                else:
                    reasons.append("MACD Momentum: MACD is below the Signal line, showing bearish dominance.")
                    
            if score >= 3:
                rec = "STRONG BUY"
            elif score >= 1:
                rec = "BUY"
            elif score <= -3:
                rec = "STRONG SELL"
            elif score <= -1:
                rec = "SELL"
            else:
                rec = "HOLD"
                
            results.append({
                "symbol": symbol,
                "shortName": ticker.info.get('shortName') or symbol.replace('.NS', '').replace('.BO', ''),
                "price": price,
                "change": change,
                "changePercent": pct,
                "rsi": rsi,
                "ema9": ema9,
                "ema21": ema21,
                "macd": macd,
                "signal": signal,
                "hist": hist,
                "score": score,
                "recommendation": rec,
                "reasons": reasons
            })
            
        except Exception as e:
            results.append({
                "symbol": symbol,
                "error": f"Analysis failed: {str(e)}"
            })
            
    return results

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: yf_bridge.py [action] [arguments...]"}))
        sys.exit(1)
        
    action = sys.argv[1].lower()
    
    if action == "search":
        query = sys.argv[2]
        res = run_search(query)
        print(json.dumps(res))
        
    elif action == "quote":
        symbol = sys.argv[2]
        res = run_quote(symbol)
        print(json.dumps(res))
        
    elif action == "quotes":
        symbols_str = sys.argv[2]
        res = run_quotes(symbols_str)
        print(json.dumps(res))
        
    elif action == "history":
        symbol = sys.argv[2]
        period = sys.argv[3] if len(sys.argv) > 3 else '1mo'
        res = run_history(symbol, period)
        print(json.dumps(res))
        
    elif action == "analyze":
        symbols_str = sys.argv[2]
        res = run_analyze(symbols_str)
        print(json.dumps(res))
        
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()

