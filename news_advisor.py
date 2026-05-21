import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import json
import re
import os

# Custom financial sentiment glossary tailored to Indian and global markets
POSITIVE_WORDS = {
    'growth', 'rise', 'surge', 'bullish', 'recovery', 'boost', 'profit', 'positive', 
    'reforms', 'investment', 'expansion', 'gains', 'outperforming', 'high', 'rate cut', 
    'upgrade', 'buying', 'gdp', 'earnings', 'demand', 'momentum', 'rally', 'beat', 
    'strong', 'adoption', 'innovation', 'advances', 'incentive', 'pli scheme', 'jump'
}

NEGATIVE_WORDS = {
    'war', 'conflict', 'tension', 'escalation', 'inflation', 'rate hike', 'bearish', 
    'fall', 'drop', 'crash', 'recession', 'warning', 'red', 'sell-off', 'downgrade', 
    'deficit', 'loss', 'dip', 'slow', 'correction', 'outflow', 'selling', 'slippage', 
    'crisis', 'concerns', 'risks', 'weak', 'drag', 'fears', 'contraction', 'tariffs'
}

def clean_title(title):
    # Remove news source at the end (e.g., " - The Economic Times")
    return re.sub(r'\s-\s[^-]+$', '', title).strip()

def calculate_text_sentiment(text):
    words = re.findall(r'\b\w+\b', text.lower())
    pos_count = sum(1 for w in words if w in POSITIVE_WORDS)
    neg_count = sum(1 for w in words if w in NEGATIVE_WORDS)
    
    # Check for phrases like "rate cut" or "rate hike"
    text_lower = text.lower()
    if "rate cut" in text_lower or "interest rate cut" in text_lower:
        pos_count += 1
    if "rate hike" in text_lower or "interest rate hike" in text_lower:
        neg_count += 1
        
    total = pos_count + neg_count
    if total == 0:
        return 50.0  # Neutral
    
    # Calculate score between 0 (fully bearish) and 100 (fully bullish)
    # score = 50 + (pos - neg) / total * 50
    return 50.0 + ((pos_count - neg_count) / total) * 50.0

def fetch_feed_news(query):
    # Google News RSS search
    encoded_query = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    articles = []
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
        root = ET.fromstring(xml_data)
        
        for item in root.findall('.//item')[:6]:
            title = item.find('title').text or ''
            link = item.find('link').text or ''
            pub_date = item.find('pubDate').text or ''
            
            clean_t = clean_title(title)
            sentiment_score = calculate_text_sentiment(clean_t)
            
            articles.append({
                "title": clean_t,
                "link": link,
                "date": pub_date,
                "score": sentiment_score
            })
    except Exception as e:
        # Fallback empty list if connection issues
        pass
    return articles

def generate_report():
    print("[News Advisor] Scraping Indian and Global financial feeds...")
    
    # Fetch 7 custom feeds mapping the user's specific targets including startups & short-term picks
    feeds = {
        "global_impact": fetch_feed_news("FII DII Indian stock market global markets US inflation Fed Nifty"),
        "politics_finance": fetch_feed_news("Indian politics economic reforms budget industrial growth GDP"),
        "tech_ai": fetch_feed_news("AI technology sector India stocks TCS Infosys Wipro"),
        "pharma": fetch_feed_news("pharma sector India stocks Sun Pharma Cipla Lupin PHARMABEES"),
        "general_nse": fetch_feed_news("NSE Indian stock market corporate earnings business headlines"),
        "growth_startups": fetch_feed_news("upcoming IPO India startup growth funding SME IPO valuation unicorn"),
        "momentum_picks": fetch_feed_news("NSE stock breakout momentum short term buy call target share price")
    }
    
    # Calculate average scores for each sector
    scores = {}
    for sector, articles in feeds.items():
        if articles:
            scores[sector] = sum(a['score'] for a in articles) / len(articles)
        else:
            scores[sector] = 50.0  # Neutral fallback
            
    # Calculate overall weighted Global Sentiment Index (now covering startups and momentum picks)
    # Weights: Global Impact (10%), Politics/Finance (15%), Tech/AI (15%), Pharma (15%), General NSE (15%), Startups (15%), Momentum (15%)
    overall_sentiment = (
        scores["global_impact"] * 0.10 +
        scores["politics_finance"] * 0.15 +
        scores["tech_ai"] * 0.15 +
        scores["pharma"] * 0.15 +
        scores["general_nse"] * 0.15 +
        scores["growth_startups"] * 0.15 +
        scores["momentum_picks"] * 0.15
    )
    
    # Classify overall sentiment direction
    if overall_sentiment >= 56:
        outlook = "BULLISH"
        color_class = "bullish"
        commentary = "Indian markets are experiencing strong tailwinds driven by local economic reforms, robust industrial expansion, high-growth startup funding news, and positive global macro signals."
    elif overall_sentiment <= 44:
        outlook = "BEARISH"
        color_class = "bearish"
        commentary = "Geopolitical concerns, startup valuation corrections, and FII sell-offs are weighing down the NSE. Local industrial metrics are consolidating. Caution is advised for high-multiple growth entries."
    else:
        outlook = "NEUTRAL / CONSOLIDATING"
        color_class = "neutral"
        commentary = "The Indian stock market is trading in a consolidated range. Strong tech and healthcare startup performance, plus local corporate earnings are balancing global rate uncertainties."
        
    recommendations = []
    
    # 1. Broad Market Index (NEXT50IETF / NIFTYBEES)
    nifty_score = (scores["politics_finance"] + scores["general_nse"]) / 2
    if nifty_score >= 54:
        nifty_rec = "BUY / ACCUMULATE"
        nifty_txt = "Broad market indicators show strong industrial and economic support. Direct systematic weekly investments into NEXT50IETF or NIFTYBEES to capture this growth."
    elif nifty_score <= 45:
        nifty_rec = "HOLD / SIP BLOCK"
        nifty_txt = "Local indices are consolidating. Do not dump your units; instead, continue low-cost SIP accumulation to average out index buying price."
    else:
        nifty_rec = "HOLD"
        nifty_txt = "Economic and corporate earnings indicators are in equilibrium. Keep holding your broad index units as stable core portfolio anchors."
        
    recommendations.append({
        "asset": "Broad Market Index (NEXT50IETF / NIFTYBEES)",
        "score": nifty_score,
        "recommendation": nifty_rec,
        "guidance": nifty_txt
    })
    
    # 2. Tech / AI Sector (TCS / MON100)
    tech_score = scores["tech_ai"]
    if tech_score >= 54:
        tech_rec = "BUY / ACCUMULATE"
        tech_txt = "AI adoption rates and technological modernization in Indian software majors (like TCS) are driving positive re-ratings. Accumulation is technically sound."
    elif tech_score <= 45:
        tech_rec = "HOLD / CAUTION"
        tech_txt = "US tech corrections and IT outsourcing budgets are facing pressure. Hold your active tech exposure and wait for stabilized support."
    else:
        tech_rec = "HOLD"
        tech_txt = "The Technology & AI sector is trading sideways. Keep holding your positions. AI developments provide long-term compound growth."
        
    recommendations.append({
        "asset": "Tech & AI Sector (TCS.NS / MON100)",
        "score": tech_score,
        "recommendation": tech_rec,
        "guidance": tech_txt
    })
    
    # 3. Pharma Sector (PHARMABEES / Sun Pharma)
    pharma_score = scores["pharma"]
    if pharma_score >= 54:
        pharma_rec = "ACCUMULATE ON DIPS"
        pharma_txt = "Pharma earnings reports and global generic drug demand remain solid. Since your portfolio is already heavy in PHARMABEES (~83%), accumulate strictly on sharp market corrections."
    elif pharma_score <= 45:
        pharma_rec = "HOLD / NO SELLING"
        pharma_txt = "Pharma sector is under short-term margin pressure. Do NOT panic-sell your units, as defensive health ETFs protect against market volatility."
    else:
        pharma_rec = "HOLD"
        pharma_txt = "Pharma index is moving in a consolidated defensive channel. Excellent stability support for your portfolio. Hold existing units."
        
    recommendations.append({
        "asset": "Defensive Pharma (PHARMABEES.NS)",
        "score": pharma_score,
        "recommendation": pharma_rec,
        "guidance": pharma_txt
    })
    
    # 4. Safe Haven (GOLDBEES)
    # Gold thrives when geopolitics is negative and global impact is unstable
    gold_score = 100.0 - ((scores["global_impact"] + scores["politics_finance"]) / 2)
    if gold_score >= 55:
        gold_rec = "BUY / SAFE HAVEN"
        gold_txt = "Geopolitical volatility and global macroeconomic uncertainty are rising. Adding small units of GOLDBEES serves as an excellent safe-haven hedge."
    else:
        gold_rec = "HOLD / WATCH"
        gold_txt = "Global indices are stable and local markets are growing. Gold is trading sideways. Hold your existing units and prioritize index equities."
        
    recommendations.append({
        "asset": "Safe-Haven Hedge (GOLDBEES.NS)",
        "score": gold_score,
        "recommendation": gold_rec,
        "guidance": gold_txt
    })

    # 5. Evolving Growth Startups (ZOMATO / JIOFIN / SME IPOs)
    startup_score = scores["growth_startups"]
    if startup_score >= 54:
        startup_rec = "BUY / ACCUMULATE"
        startup_txt = "Indian startup ecosystem shows strong funding rebounds and robust growth in quick-commerce (Zomato) and digital lending (Jio Financial). Excellent for long-term compound growth."
    elif startup_score <= 45:
        startup_rec = "AVOID / AWAIT CORRECTION"
        startup_txt = "Startups are experiencing cash-burn issues or inflated IPO valuations. Avoid entering new startup stocks at high multiples. Wait for a 15-20% correction."
    else:
        startup_rec = "ACCUMULATE ON DIP"
        startup_txt = "Startups are trading at fair valuations. Buy emerging winners like ZOMATO.NS or JIOFIN.NS during minor pullbacks. Watch primary markets for highly-oversubscribed SME IPOs."

    recommendations.append({
        "asset": "Evolving Growth Startups (ZOMATO.NS / JIOFIN.NS)",
        "score": startup_score,
        "recommendation": startup_rec,
        "guidance": startup_txt
    })

    # 6. Short-Term Tactical Breakout (IREDA / Defence Breakouts)
    momentum_score = scores["momentum_picks"]
    if momentum_score >= 54:
        momentum_rec = "BUY / BREAKOUT PLAY"
        momentum_txt = "Strong momentum in clean energy financing (IREDA) and defence (HAL/BEL) due to high volume breakout cues. Ideal for quick short-term tactical swing returns (1-4 weeks)."
    elif momentum_score <= 45:
        momentum_rec = "AVOID / PROFIT BOOKING"
        momentum_txt = "Momentum indicators show short-term exhaustions and high-risk overbought levels. Book partial profits on recent swings and wait for support retests."
    else:
        momentum_rec = "HOLD / WATCH BREAKOUT"
        momentum_txt = "Several mid-caps are consolidating at resistance levels. Put IREDA.NS and BHEL.NS on watch. Initiate trades only when a clear daily volume breakout occurs."

    recommendations.append({
        "asset": "Short-Term Tactical Breakout (IREDA.NS / HAL.NS)",
        "score": momentum_score,
        "recommendation": momentum_rec,
        "guidance": momentum_txt
    })
    
    # Compile a flat list of parsed headlines to show in the UI dashboard
    all_headlines = []
    for sector, articles in feeds.items():
        sector_name = sector.replace('_', ' ').title()
        for a in articles[:3]:  # Top 3 headlines from each
            all_headlines.append({
                "sector": sector_name,
                "title": a["title"],
                "link": a["link"],
                "date": a["date"]
            })
            
    # Structure the final report
    report = {
        "timestamp": os.popen("date").read().strip(),
        "overall_sentiment": overall_sentiment,
        "outlook": outlook,
        "color_class": color_class,
        "commentary": commentary,
        "sector_scores": scores,
        "recommendations": recommendations,
        "headlines": all_headlines[:21]  # Support up to 21 top headlines (3 from each of 7 feeds)
    }
    
    # Save to JSON file
    output_path = "/Users/manojkumar/.gemini/antigravity/scratch/stock-dashboard/news_sentiment.json"
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
        
    print(f"[News Advisor] Sentiment report generated successfully at {output_path}")
    return report

if __name__ == "__main__":
    generate_report()
