require('dotenv').config();
const express = require('express');
const path    = require('path');
const ClusterAnalyzer = require('./cluster-analyzer');

// ── Firebase Admin (для серверной проверки алертов) ────────────
let adminDb   = null;
let adminMsg  = null;
let adminApp  = null;

try {
    const admin = require('firebase-admin');
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : null;
    if (serviceAccount) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    if (serviceAccount && !admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: 'thinking-trader',
        });
        adminDb  = admin.firestore();
        adminMsg = admin.messaging();
        adminApp = admin;
        console.log('✅ Firebase Admin инициализирован');
    } else if (!serviceAccount) {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT не задан — серверные алерты отключены');
    }
} catch(e) {
    console.warn('⚠️ Firebase Admin недоступен:', e.message);
}

const app  = express();

app.use((req, res, next) => {
    const allowed = ["https://www.thinkingtrader.com", "capacitor://localhost", "http://localhost:3000"];
    const origin = req.headers.origin;
    if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Редирект: http→https и thinkingtrader.com→www.thinkingtrader.com
app.use((req, res, next) => {
    const host = req.headers.host || '';
    const proto = req.headers['x-forwarded-proto'] || req.protocol;

    if (host === 'thinkingtrader.com') {
        return res.redirect(301, `https://www.thinkingtrader.com${req.originalUrl}`);
    }
    if (proto === 'http' && host !== 'localhost' && !host.startsWith('localhost')) {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
});

// ── Страницы ───────────────────────────────────────────────────
// Лендинг (приветственная страница)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'indexsite.html'));
});

// Дашборд (основное приложение)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── Статика (после явных роутов) ──────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════
// КЭШ
// ══════════════════════════════════════════════════════════════
const cache = new Map();

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { cache.delete(key); return null; }
    return entry.data;
}

function cacheSet(key, data, ttlMs) {
    cache.set(key, { data, expires: Date.now() + ttlMs });
}

const TTL = {
    PRICE:      10  * 1000,    // 10 сек
    TICKER:     30  * 1000,    // 30 сек
    CHART:      30  * 1000,    // 30 сек
    OHLC:       30  * 1000,    // 30 сек
    INDICATORS: 30  * 1000,    // 30 сек
    FEARGREED:  30  * 60000,   // 30 мин
    NEWS:       15  * 60000,   // 15 мин
    TRANSLATE:  24  * 3600000  // 24 часа
};

// ── Хелпер fetch ───────────────────────────────────────────────
async function proxyFetch(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error(`❌ proxyFetch ${res.status} ${url} — ${body.slice(0, 200)}`);
            throw new Error(`HTTP ${res.status} from ${url}`);
        }
        return res.json();
    } catch (e) {
        if (e.message?.includes('HTTP')) throw e;
        console.error(`❌ proxyFetch NETWORK ERROR ${url} — ${e.message}`);
        throw e;
    }
}

// ── Хелпер: отдать из кэша или загрузить ──────────────────────
async function withCache(key, ttl, loader, res) {
    try {
        const cached = cacheGet(key);
        if (cached) return res.json(cached);
        const data = await loader();
        cacheSet(key, data, ttl);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

// ══════════════════════════════════════════════════════════════
// ЭНДПОИНТЫ
// ══════════════════════════════════════════════════════════════

// 1. Курс USDT/RUB
app.get('/api/rub', (req, res) => {
    withCache('rub', TTL.PRICE, () =>
        proxyFetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTRUB'),
    res);
});

// 2. Текущая цена
app.get('/api/price', (req, res) => {
    const { symbol, id } = req.query;
    if (symbol) {
        return withCache(`price:${symbol}`, TTL.PRICE, () =>
            proxyFetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`),
        res);
    }
    if (id) {
        return withCache(`price:${id}`, TTL.PRICE, () =>
            proxyFetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`),
        res);
    }
    res.status(400).json({ error: 'symbol or id required' });
});

// 3. График (line chart)
app.get('/api/chart', (req, res) => {
    const { symbol, interval, limit, id, days } = req.query;
    if (symbol && interval && limit) {
        return withCache(`chart:${symbol}:${interval}:${limit}`, TTL.CHART, () =>
            proxyFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
        res);
    }
    if (id && days) {
        return withCache(`chart:${id}:${days}`, TTL.CHART, () =>
            proxyFetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`),
        res);
    }
    res.status(400).json({ error: 'params required' });
});

// 4. OHLC свечи
app.get('/api/ohlc', (req, res) => {
    const { symbol, interval, limit, id, days } = req.query;
    if (symbol && interval && limit) {
        return withCache(`ohlc:${symbol}:${interval}:${limit}`, TTL.OHLC, () =>
            proxyFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
        res);
    }
    if (id && days) {
        const allowed = [1, 7, 14, 30, 90, 180, 365];
        const d = allowed.includes(parseInt(days)) ? days : 7;
        return withCache(`ohlc:${id}:${d}`, TTL.OHLC, () =>
            proxyFetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${d}`),
        res);
    }
    res.status(400).json({ error: 'params required' });
});

// 5. Индикаторы страницы 2
app.get('/api/indicators', (req, res) => {
    const { symbol, id } = req.query;
    if (symbol) {
        return withCache(`indicators:${symbol}`, TTL.INDICATORS, () =>
            proxyFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=90`),
        res);
    }
    if (id) {
        return withCache(`indicators:${id}`, TTL.INDICATORS, async () => {
            const [chart, ohlc] = await Promise.all([
                proxyFetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90&interval=daily`),
                proxyFetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=30`)
            ]);
            return { chart, ohlc };
        }, res);
    }
    res.status(400).json({ error: 'symbol or id required' });
});

// 6. Тикер 24h
app.get('/api/ticker', (req, res) => {
    const { symbols } = req.query;
    withCache(`ticker:${symbols}`, TTL.TICKER, () =>
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`),
    res);
});

// 7. Fear & Greed
app.get('/api/feargreed', (req, res) => {
    withCache('feargreed', TTL.FEARGREED, () =>
        proxyFetch('https://api.alternative.me/fng/?limit=2'),
    res);
});

// 8. Новости RSS
app.get('/api/news', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    withCache(`news:${url}`, TTL.NEWS, () =>
        proxyFetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`),
    res);
});

// 9. Перевод — унифицированный формат { translation, responseData }
app.get('/api/translate', async (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: 'text required' });
    const cacheKey = `translate:${text.slice(0, 80)}`;
    try {
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const data = await proxyFetch(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=en|ru`
        );
        const translatedText = data?.responseData?.translatedText || text;

        // Возвращаем оба формата: MyMemory и Lingva — чтобы обе функции работали
        const result = {
            translation: translatedText,           // формат Lingva (translateViaLingva)
            responseData: { translatedText },      // формат MyMemory (translateText)
        };
        cacheSet(cacheKey, result, TTL.TRANSLATE);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// AI SCANNER — анализ рынка через DeepSeek (OpenRouter)
// ══════════════════════════════════════════════════════════════
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
console.log('OPENROUTER_KEY:', OPENROUTER_KEY ? 'loaded ✅' : 'MISSING ❌');
const AI_MODEL = 'openai/gpt-5.4';
function getAiCacheTtl(timeframe) {
    if (timeframe === '1H') return 10 * 60 * 1000;   // 10 минут
    if (timeframe === '4H') return 30 * 60 * 1000;   // 30 минут
    return 60 * 60 * 1000;                             // 1D → 1 час
}

app.post('/api/ai-scan', async (req, res) => {
    try {
        // ── Авторизация ──
        const token = getToken(req);
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        let uid;
        try {
            const parts = token.split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            uid = payload.sub || payload.user_id;
            if (!uid) throw new Error('no uid');
        } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

        // ── Проверка лимитов (пропускаем для админа и PRO) ──
        const isAdminReq = uid === ADMIN_UID;
        const proUser = isAdminReq ? true : await _isPro(uid);

        if (!isAdminReq && !proUser) {
            const limits = _getFreeLimits(uid);
            if (limits.scanCount >= FREE_SCAN_LIMIT) {
                return res.status(429).json({ error: 'limit', type: 'scan_limit', used: limits.scanCount, max: FREE_SCAN_LIMIT });
            }
        }

        const ctx = req.body;
        if (!ctx || !ctx.coin || !ctx.currentPrice) {
            return res.status(400).json({ error: 'Missing context data' });
        }

        // ── Серверный кэш: ключ = монета + таймфрейм + язык ──
        const cacheKey = `ai:v2:${ctx.coin}:${ctx.timeframe}:${ctx.lang || 'ru'}`;
        const cached = cacheGet(cacheKey);
        if (cached) {
            console.log(`✅ AI Scanner cache hit: ${cacheKey}`);
            return res.json(cached);
        }

        const lang = ctx.lang === 'en' ? 'en' : 'ru';

        // ── Кластерный анализ объёмов возле уровней ──
        let clusterDebug = null;
        try {
            if (ctx.levels && ctx.levels.support && ctx.levels.resistance) {
                const binanceSymbol = ctx.coin.replace('/', '');

                const clusterResult = await ClusterAnalyzer.analyze({
                    symbol: binanceSymbol,
                    timeframe: ctx.timeframe,
                    support: ctx.levels.support,
                    resistance: ctx.levels.resistance,
                    currentPrice: ctx.currentPrice,
                    fetchCandles: async (sym, interval, limit) => {
                        const clusterCacheKey = `cluster-candles:${sym}:${interval}:${limit}`;
                        const cachedCandles = cacheGet(clusterCacheKey);
                        if (cachedCandles) {
                            console.log(`  ♻️ Cluster candles from cache: ${clusterCacheKey}`);
                            return cachedCandles;
                        }
                        const data = await proxyFetch(
                            `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`
                        );
                        const candleTtl = interval === '4h' ? 15*60*1000
                                        : interval === '1h' ? 5*60*1000
                                        : 3*60*1000;
                        cacheSet(clusterCacheKey, data, candleTtl);
                        console.log(`  📥 Cluster candles loaded: ${sym} ${interval} x${data.length} (TTL ${candleTtl/1000}s)`);
                        return data;
                    },
                });

                if (clusterResult && clusterResult.scenario !== 'no_level_nearby') {
                    ctx.clusterAnalysis = clusterResult;
                    clusterDebug = clusterResult;
                    console.log(`📊 Cluster analysis:`);
                    console.log(`   Level: ${clusterResult.nearLevel} @ $${clusterResult.levelPrice}`);
                    console.log(`   Scenario: ${clusterResult.scenario}`);
                    console.log(`   Candles in zone: ${clusterResult.candlesInZone} / ${clusterResult.totalCandlesLoaded} loaded`);
                    console.log(`   Volume: bottom ${clusterResult.bottomVolumeAvg}% | mid ${clusterResult.middleVolumeAvg}% | top ${clusterResult.topVolumeAvg}%`);
                    console.log(`   Concentration: ${clusterResult.concentration}`);
                    console.log(`   Volume trend: ${clusterResult.volumeTrend}`);
                    console.log(`   Interpretation: ${clusterResult.interpretation}`);
                    console.log(`   Consecutive at level: ${clusterResult.consecutiveNearLevel}`);
                }
            }
        } catch (e) {
            console.warn('⚠️ Cluster analysis error (non-fatal):', e.message);
        }

        // Собираем системный промпт (v3 — enriched data)
        const systemPrompt = lang === 'en'
            ? `You are a crypto trader analyst. User sends enriched market data. Give a SPECIFIC analysis.

Data includes:
- keyPoints — key prices at different horizons (30/90/180/365/900 days ago), yearly and all-time highs/lows, position in ranges
- priceProfile — ~30 segments of ~33 days each: open, close, high, low, change%, avgVolume, avgBodySize. This is the SHAPE of the trend — study it carefully, find phases of growth, peaks, declines, consolidations
- heavyZones — top 5 price zones by trading volume across all history. These are REAL levels confirmed by money. Zone below price = potential support, above = potential resistance
- volatility — average candle size over 10/30/100 candles and volatility trend (compression/expansion/normal)
- suggestedLevels — mathematically calculated entry/stop/target via average volatility. Use as BASE but adjust by levels and context
- levels — THE MAIN support/resistance levels (daily channel). This is the CORRIDOR where price moves. These levels are MORE IMPORTANT than heavyZones, patterns, or trend.
- pricePosition — where price is relative to the channel. THIS IS THE MOST IMPORTANT FIELD:
  * "inside_channel_middle" — price is in the middle of the channel (20-80%). NO SIGNAL. longPct and shortPct must be 50/50 (maximum ±5%). Do NOT try to find a direction — there is none.
  * "inside_near_resistance" — price is in the top 20% of the channel, near resistance. SHORT zone, shortPct minimum 60%
  * "inside_near_support" — price is in the bottom 20% of the channel, near support. LONG zone, longPct minimum 60%
  * "above_resistance_not_confirmed" — price is CURRENTLY above resistance but less than 3 candles closed above. Likely false breakout — SHORT preferred, shortPct minimum 60%
  * "above_resistance_confirmed" — price is CURRENTLY above resistance AND 3+ candles closed above. Real breakout — LONG valid, longPct minimum 65%
  * "below_support_not_confirmed" — price is CURRENTLY below support but less than 3 candles closed below. Likely false breakdown — LONG preferred, longPct minimum 60%
  * "below_support_confirmed" — price is CURRENTLY below support AND 3+ candles closed below. Real breakdown — SHORT valid, shortPct minimum 65%
  * "failed_breakout_up" — price WAS above resistance but RETURNED inside the channel. BULL TRAP — buyers got trapped. SHORT signal, shortPct minimum 60%
  * "failed_breakout_down" — price WAS below support but RETURNED inside the channel. BEAR TRAP — sellers got trapped. LONG signal, longPct minimum 60%
- last20candles — last 20 candles in detail
- patterns — candlestick patterns from last 20 candles with winRate and result
- anchorData (for 4H/1H only) — 1D levels, keyPoints, priceProfile, heavyZones. 1D data shows the BIG picture; local TF shows the current move
- btcAnchor (for altcoins only) — BTC 1D data: price, levels, keyPoints, volatility, top heavyZones. BTC is the ANCHOR ASSET for the entire crypto market. If BTC is falling or breaking support — altcoins will likely follow DOWN regardless of their own technicals. If BTC is rising or breaking resistance — altcoins get a tailwind. ALWAYS factor BTC state into your altcoin analysis. If BTC signals conflict with the altcoin's own signals — BTC takes priority.
- clusterAnalysis (if present) — VOLUME CLUSTER ANALYSIS near the nearest level. Distribution of volume INSIDE candles of the lower timeframe near support/resistance. VERY IMPORTANT for breakout/rejection prediction:
  * "nearLevel" — which level is analyzed (resistance or support)
  * "concentration" — where volume is concentrated: "bottom" (lower 30% of candles), "top" (upper 30%), "mixed" (no clear bias)
  * "interpretation" — ready verdict:
    AT RESISTANCE: concentration="bottom" → buyers pushing → breakout likely. concentration="top" → sellers holding → rejection likely.
    AT SUPPORT: concentration="bottom" → buyers holding → bounce likely. concentration="top" → sellers pushing → breakdown likely.
  * "volumeTrend" — "buyers_increasing" = buying pressure growing. "buyers_decreasing" = weakening.
  * "consecutiveNearLevel" — how many recent candles stuck at the level. More = stronger test.
  * "scenario" — testing_from_below, testing_from_above, breakout_not_confirmed, breakout_confirmed
  USE clusterAnalysis to ADJUST longPct/shortPct by ±5-10%. If it confirms pricePosition — strengthen. If contradicts — weaken. Describe cluster findings in "situation" using HUMAN LANGUAGE (e.g. "volume clusters show buyers pushing at resistance"), NEVER use field names.

Answer format — 3 parts:

1. "situation" — What is ACTUALLY happening (2-3 sentences).
   Describe: cycle phase (growth/peak/decline/bottom), specific prices (where price came from, where it is now), what volume zones tell us (price in accumulation zone or not), volatility compression/expansion, and where price is relative to the channel (near support, near resistance, middle, breakout etc). If cluster analysis data is present — describe what buyers/sellers are doing near the level.
   Good: "BTC completed a cycle: from $28K to ATH $126K, then crashed 47% to $67K. Price is trapped inside the heaviest volume zone $65.4K-$70.5K (13.8% of all volume), volatility compressing — average candle shrinking from 4% to 3.2%. Volume clusters show buyers actively supporting price below resistance."
   Bad: "Price in range, weak trend."

2. "verdict" — What it means (1 sentence).
   If Long and Short are close (difference less than 15%) — write "Uncertainty — better not to enter".
   If one direction is clearly stronger — explain why.

3. Probabilities and levels — Long %, Short %, entry/target/stop for both.

Rules:
- CRITICAL — HUMAN LANGUAGE ONLY: NEVER use internal field names, variable names, or technical identifiers in "situation", "verdict", "trendLabel", "trendDetail", "holdAdvice" or ANY user-facing text. Forbidden examples: "pricePosition = inside_near_resistance", "clusterAnalysis", "heavyZones", "priceProfile", "anchorData", "suggestedLevels", "inside_channel_middle", "failed_breakout_up", "buyers_pushing_breakout_likely". Instead write in natural trader language: "price is near resistance", "volume clusters show buyers pushing", "major volume zone at $65K-$70K". The user must NEVER see code or JSON field names.
- ANALYSIS HIERARCHY — follow this order strictly:
  LEVEL 1 (KING): pricePosition determines the direction. The percentages above are HARD MINIMUMS. If pricePosition = "inside_channel_middle" — you MUST set longPct=50, shortPct=50, signalStrength="neutral". No patterns, volumes, or trends can override this. The trader should NOT enter.
  LEVEL 2: Global context (keyPoints, 900-day history) can STRENGTHEN or WEAKEN a signal from Level 1, but NEVER flip it. Example: "inside_near_support" gives longPct=60%, but global downtrend weakens it to 55%. It can NEVER turn it into shortPct>50%.
  LEVEL 3: Patterns, heavyZones — only confirmation or slight adjustment (±5%) of the signal from Level 1-2.
- ENTRY RULE: entry for the dominant direction must ALWAYS be within 1% of currentPrice. Never place entry far from the current price — the trader enters NOW, not after a 5% move.
- entry/stop/target: take suggestedLevels as base, but ADJUST by nearest heavyZones and levels. Stop should not be behind a heavy volume zone (it will hold price). Target — to the next heavy zone (it will stop the move).
- MINIMUM STOP-LOSS: stop must be at least 1.5 × suggestedLevels.avgCandleSize away from entry. If the calculated stop is closer — widen it. A stop that is too tight will be hit by normal noise.
- MAXIMUM STOP-LOSS: stop must NEVER be more than 2-3% away from entry. If a volume zone boundary is further than 3% — ignore it for stop placement and use 2-3% from entry instead. Trader's capital protection is the priority.
- MAXIMUM TARGET: target must NEVER be more than 12% away from entry. Realistic targets are 3-8%. Only set target at 10-12% if ALL signals align (trend, pricePosition, heavyZones, patterns all confirm the same direction). 15%+ targets are FORBIDDEN — they are unrealistic and mislead the trader.
- For 4H and 1H: use anchorData (1D levels, priceProfile, heavyZones) as the BIG picture. 1D levels are more important than local ones. If local support coincides with 1D resistance — it's a trap.
- winRate is the GLOBAL historical success rate of this pattern. If bullish pattern failed (workedOut: false) — bearish signal.
- If difference Long/Short less than 15% — uncertainty, say it directly.
- Specific prices. No fluff. No disclaimers.
- entry/target/stop must be NUMBERS ONLY.

4. NEW FIELDS for improved UI:
- "trendLabel" — short label (2-3 words) that describes the current situation. CRITICAL: trendLabel MUST match the dominant direction (longPct vs shortPct).
  If shortPct > longPct — trendLabel must sound BEARISH: "Rejection from resistance", "Overbought at ceiling", "Failed breakout", "Selling pressure", "Distribution at top"
  If longPct > shortPct — trendLabel must sound BULLISH: "Bounce from support", "Accumulation at bottom", "Confirmed breakout", "Recovery from lows", "Buying pressure"
  If neutral (50/50) — trendLabel must sound NEUTRAL: "Consolidation in range", "Between levels", "No clear direction"
  NEVER use bullish words ("breakout up", "pробой вверх") when shortPct > longPct. NEVER use bearish words when longPct > shortPct.
- "trendDetail" — short context (max 6 words) that matches the direction. If SHORT: "Under resistance $73.5K", "Rejected from $76K". If LONG: "Above support $65K", "Bounced from $60K". If NEUTRAL: "Middle of $65K-$74K range".
- "signalStrength" — "strong" if |longPct - shortPct| >= 20, "weak" if 10-19, "neutral" if < 10. This determines how the UI displays the result.
- "activation" — ONLY when signalStrength is "neutral" or "weak": describe what must happen for a clear signal. CRITICAL: activation must match the dominant direction. If shortPct > longPct, the SHORT activation condition comes first and is more prominent. Example for short-dominant: {"short": "Price must close below $70,000", "long": "Price must close above $74,145 (3+ candles)"}. When signalStrength is "strong", set activation to null.

5. TRADE HORIZON — determined by timeframe, MANDATORY:
The timeframe defines the trading horizon. This MUST affect your target/stop/hold recommendations:
- 1H = SCALP: target 1-2% from entry, stop 0.5-1%. Hold time: 1-4 hours. If price doesn't move toward target within 1-2 hours — exit at breakeven.
- 4H = INTRADAY: target 2-4% from entry, stop 1-2%. Hold time: 4-24 hours. If price doesn't move within 6-8 hours — exit at breakeven.
- 1D = SWING: target 3-8% from entry, stop 2-3%. Hold time: 2-7 days. If price doesn't move within 3 days — exit at breakeven or small loss.
Return these fields:
- "horizon" — "scalp" for 1H, "intraday" for 4H, "swing" for 1D
- "holdTime" — specific expected hold duration. Examples: "1-2 hours", "8-12 hours", "3-5 days"
- "holdAdvice" — one sentence: what to do if price doesn't move. Example: "If price hasn't reached $68,000 within 2 hours — close at breakeven, don't wait for stop"

JSON format:
{"situation": "what is happening", "verdict": "what it means", "trendLabel": "Bearish impulse", "trendDetail": "-26.6% from ATH", "signalStrength": "strong", "activation": null, "horizon": "swing", "holdTime": "3-5 days", "holdAdvice": "If no move above $70K in 3 days — exit at breakeven", "longPct": 35, "shortPct": 65, "long": {"entry": "69000", "target": "74000", "stop": "64000"}, "short": {"entry": "64000", "target": "60000", "stop": "68000"}}`

            : `Ты криптотрейдер-аналитик. Пользователь шлёт расширенные рыночные данные. Дай КОНКРЕТНЫЙ анализ.

Данные включают:
- keyPoints — ключевые цены на разных горизонтах (30/90/180/365/900 дней назад), годовые и исторические хай/лоу, позиция в диапазонах
- priceProfile — ~30 отрезков по ~33 дня: open, close, high, low, change%, avgVolume, avgBodySize. Это ФОРМА тренда — изучи её внимательно, найди фазы роста, пиков, падений, боковиков
- heavyZones — 5 ценовых зон с максимальным объёмом торгов за всю историю. Это РЕАЛЬНЫЕ уровни, подтверждённые деньгами. Зона ниже цены = потенциальная поддержка, выше = потенциальное сопротивление
- volatility — средний размер свечи за 10/30/100 свечей и тренд волатильности (сжатие/расширение/норма)
- suggestedLevels — математически рассчитанные entry/stop/target через среднюю волатильность. Используй как БАЗУ, но корректируй по уровням и контексту
- levels — ГЛАВНЫЕ уровни поддержки/сопротивления (дневной коридор). Это КОРИДОР движения цены. Эти уровни ВАЖНЕЕ чем heavyZones, паттерны или тренд.
- pricePosition — где цена относительно коридора. ЭТО САМОЕ ВАЖНОЕ ПОЛЕ:
  * "inside_channel_middle" — цена в середине коридора (20-80%). СИГНАЛА НЕТ. longPct и shortPct ДОЛЖНЫ быть 50/50 (максимум ±5%). НЕ пытайся найти направление — его нет. Трейдер НЕ должен входить.
  * "inside_near_resistance" — цена в верхних 20% коридора, у сопротивления. Зона ШОРТА, shortPct минимум 60%
  * "inside_near_support" — цена в нижних 20% коридора, у поддержки. Зона ЛОНГА, longPct минимум 60%
  * "above_resistance_not_confirmed" — цена СЕЙЧАС выше сопротивления, но менее 3 свечей закрылись выше. Скорее всего ложный пробой — ШОРТ, shortPct минимум 60%
  * "above_resistance_confirmed" — цена СЕЙЧАС выше сопротивления И 3+ свечей закрылись выше. Реальный пробой — ЛОНГ, longPct минимум 65%
  * "below_support_not_confirmed" — цена СЕЙЧАС ниже поддержки, но менее 3 свечей закрылись ниже. Скорее всего ложный пробой — ЛОНГ, longPct минимум 60%
  * "below_support_confirmed" — цена СЕЙЧАС ниже поддержки И 3+ свечей закрылись ниже. Реальный пробой вниз — ШОРТ, shortPct минимум 65%
  * "failed_breakout_up" — цена БЫЛА выше сопротивления, но ВЕРНУЛАСЬ обратно в коридор. ЛОВУШКА ДЛЯ ПОКУПАТЕЛЕЙ. ШОРТ сигнал, shortPct минимум 60%
  * "failed_breakout_down" — цена БЫЛА ниже поддержки, но ВЕРНУЛАСЬ обратно в коридор. ЛОВУШКА ДЛЯ ПРОДАВЦОВ. ЛОНГ сигнал, longPct минимум 60%
- last20candles — последние 20 свечей детально
- patterns — свечные паттерны за последние 20 свечей с winRate и результатом
- anchorData (только для 4H/1H) — 1D уровни, keyPoints, priceProfile, heavyZones. 1D данные показывают ГЛОБАЛЬНУЮ картину; локальный TF показывает текущее движение
- btcAnchor (только для альткоинов) — 1D данные BTC: цена, уровни, keyPoints, волатильность, топ объёмных зон. BTC — ЯКОРНЫЙ АКТИВ для всего крипторынка. Если BTC падает или пробивает поддержку — альткоины скорее всего пойдут ВНИЗ вне зависимости от своих собственных технических данных. Если BTC растёт или пробивает сопротивление — альткоины получают попутный ветер. ВСЕГДА учитывай состояние BTC при анализе альткоинов. Если сигналы BTC противоречат сигналам альткоина — BTC имеет приоритет.
- clusterAnalysis (если есть) — КЛАСТЕРНЫЙ АНАЛИЗ ОБЪЁМОВ возле ближайшего уровня. Распределение объёма ВНУТРИ свечей младшего таймфрейма возле поддержки/сопротивления. ОЧЕНЬ ВАЖНО для прогноза пробоя/отскока:
  * "nearLevel" — какой уровень анализируется (resistance или support)
  * "concentration" — где сконцентрирован объём: "bottom" (нижние 30% свечей), "top" (верхние 30%), "mixed" (нет перевеса)
  * "interpretation" — готовый вердикт:
    У СОПРОТИВЛЕНИЯ: concentration="bottom" → покупатели давят → пробой вероятен. concentration="top" → продавцы держат → отскок вероятен.
    У ПОДДЕРЖКИ: concentration="bottom" → покупатели удерживают → отскок вверх. concentration="top" → продавцы давят → пробой вниз.
  * "volumeTrend" — "buyers_increasing" = давление покупателей нарастает. "buyers_decreasing" = ослабевает.
  * "consecutiveNearLevel" — сколько последних свечей подряд у уровня. Больше = сильнее тест.
  * "scenario" — testing_from_below, testing_from_above, breakout_not_confirmed, breakout_confirmed
  ИСПОЛЬЗУЙ clusterAnalysis для КОРРЕКТИРОВКИ longPct/shortPct на ±5-10%. Если подтверждает сигнал — усиль. Если противоречит — ослабь. Описывай выводы кластеров в "situation" ЧЕЛОВЕЧЕСКИМ ЯЗЫКОМ (напр. "объёмы у сопротивления показывают давление покупателей"), НИКОГДА не используй названия полей.

Формат ответа — 3 части:

1. "situation" — Что РЕАЛЬНО происходит (2-3 предложения).
   Опиши: фазу цикла (рост/пик/падение/дно), конкретные цены (откуда пришла цена, где сейчас), что говорят объёмные зоны (цена в зоне накопления или нет), волатильность сжимается или расширяется, и где цена относительно коридора (у поддержки, у сопротивления, в середине, пробой и т.д.). Если есть данные кластерного анализа — опиши что делают покупатели/продавцы возле уровня.
   Пример хорошо: "BTC завершил цикл: с $28K до ATH $126K, затем обвал на 47% до $67K. Цена зажата внутри самой тяжёлой объёмной зоны $65.4K-$70.5K (13.8% всего объёма), волатильность сжимается. Объёмы у сопротивления показывают давление покупателей — пробой вероятен."
   Пример плохо: "Цена в диапазоне, тренд слабый."

2. "verdict" — Что это значит (1 предложение).
   Если Long и Short близки (разница меньше 15%) — прямо пиши "Неопределённость — лучше не входить".
   Если одно направление явно сильнее — объясни почему.

3. Вероятности и уровни — Long %, Short %, вход/цель/стоп для обоих.

Правила:
- КРИТИЧНО — ТОЛЬКО ЧЕЛОВЕЧЕСКИЙ ЯЗЫК: НИКОГДА не используй в "situation", "verdict", "trendLabel", "trendDetail", "holdAdvice" или ЛЮБОМ тексте для пользователя названия полей, переменных или технических идентификаторов. Запрещённые примеры: "pricePosition = inside_near_resistance", "clusterAnalysis", "heavyZones", "priceProfile", "anchorData", "suggestedLevels", "inside_channel_middle", "failed_breakout_up", "buyers_pushing_breakout_likely". Вместо этого пиши на нормальном языке трейдера: "цена у сопротивления", "кластеры объёмов показывают давление покупателей", "крупная зона объёмов на $65K-$70K". Пользователь НИКОГДА не должен видеть код или имена полей JSON.
- ИЕРАРХИЯ АНАЛИЗА — следуй этому порядку строго:
  УРОВЕНЬ 1 (ГЛАВНЫЙ): pricePosition определяет направление. Проценты выше — это ЖЁСТКИЕ МИНИМУМЫ. Если pricePosition = "inside_channel_middle" — ты ОБЯЗАН поставить longPct=50, shortPct=50, signalStrength="neutral". Никакие паттерны, объёмы или тренды не могут это изменить. Трейдер НЕ должен входить.
  УРОВЕНЬ 2: Глобальный контекст (keyPoints, история 900 дней) может УСИЛИТЬ или ОСЛАБИТЬ сигнал уровня 1, но НИКОГДА не перевернуть его. Пример: "inside_near_support" даёт longPct=60%, но глобальный нисходящий тренд ослабляет до 55%. Но НИКОГДА не превращает в shortPct>50%.
  УРОВЕНЬ 3: Паттерны, heavyZones — только подтверждение или лёгкая корректировка (±5%) сигнала уровней 1-2.
- ПРАВИЛО ВХОДА: entry для основного направления ВСЕГДА должен быть в пределах 1% от currentPrice. Никогда не ставь entry далеко от текущей цены — трейдер входит СЕЙЧАС, а не после движения на 5%.
- entry/stop/target: бери suggestedLevels как базу, но КОРРЕКТИРУЙ по ближайшим heavyZones и levels. Стоп не должен быть за сильной объёмной зоной (она удержит цену). Тейк — до следующей тяжёлой зоны (она остановит движение).
- МИНИМАЛЬНЫЙ СТОП-ЛОСС: стоп должен быть минимум 1.5 × suggestedLevels.avgCandleSize от entry. Если расчётный стоп ближе — расширь его. Слишком узкий стоп выбьет обычным шумом.
- МАКСИМАЛЬНЫЙ СТОП-ЛОСС: стоп НИКОГДА не должен быть дальше 2-3% от entry. Если граница объёмной зоны дальше 3% — игнорируй её для стопа и ставь стоп на 2-3% от entry. Защита капитала трейдера — приоритет.
- МАКСИМАЛЬНЫЙ ТЕЙК-ПРОФИТ: цель НИКОГДА не должна быть дальше 12% от entry. Реалистичные цели — 3-8%. Ставь цель 10-12% только если ВСЕ сигналы совпадают (тренд, pricePosition, heavyZones, паттерны — всё подтверждает одно направление). Цели 15%+ ЗАПРЕЩЕНЫ — они нереалистичны и вводят трейдера в заблуждение.
- Для 4H и 1H: используй anchorData (1D уровни, priceProfile, heavyZones) как ГЛОБАЛЬНУЮ картину. 1D уровни важнее локальных. Если локальный support совпадает с 1D resistance — это ловушка.
- winRate — ГЛОБАЛЬНЫЙ исторический процент успешности паттерна. Если бычий паттерн не отработал (workedOut: false) — медвежий сигнал.
- Если разница Long/Short меньше 15% — неопределённость, скажи прямо.
- Конкретные цены. Без воды. Без дисклеймеров.
- entry/target/stop — ТОЛЬКО ЧИСЛА.

4. НОВЫЕ ПОЛЯ для улучшенного UI:
- "trendLabel" — короткий ярлык (2-3 слова) описывающий текущую ситуацию. КРИТИЧНО: trendLabel ОБЯЗАН соответствовать доминирующему направлению (longPct vs shortPct).
  Если shortPct > longPct — trendLabel МЕДВЕЖИЙ: "Отбой от сопротивления", "Перекупленность у потолка", "Ложный пробой вверх", "Давление продавцов", "Распределение наверху"
  Если longPct > shortPct — trendLabel БЫЧИЙ: "Отскок от поддержки", "Накопление на дне", "Подтверждённый пробой", "Восстановление от лоев", "Давление покупателей"
  Если нейтральный (50/50) — trendLabel НЕЙТРАЛЬНЫЙ: "Консолидация в коридоре", "Между уровнями", "Нет направления"
  НИКОГДА не используй бычьи слова ("пробой вверх", "рост") когда shortPct > longPct. НИКОГДА не используй медвежьи слова когда longPct > shortPct.
- "trendDetail" — короткий контекст (максимум 6 слов) соответствующий направлению. Если ШОРТ: "Под сопротивлением $73.5K", "Отбой от $76K". Если ЛОНГ: "Над поддержкой $65K", "Отскок от $60K". Если НЕЙТРАЛЬНЫЙ: "Середина коридора $65K-$74K".
- "signalStrength" — "strong" если |longPct - shortPct| >= 20, "weak" если 10-19, "neutral" если < 10. Определяет как UI показывает результат.
- "activation" — ТОЛЬКО когда signalStrength = "neutral" или "weak": опиши что должно случиться для чёткого сигнала. КРИТИЧНО: activation должен соответствовать доминирующему направлению. Если shortPct > longPct, условие для ШОРТА идёт первым. Пример при шорт-доминанте: {"short": "Цена должна уйти ниже $70,000", "long": "Цена должна закрепиться выше $74,145 (3+ свечи)"}. Когда signalStrength = "strong", ставь activation = null.

5. ГОРИЗОНТ СДЕЛКИ — определяется таймфреймом, ОБЯЗАТЕЛЬНО:
Таймфрейм определяет горизонт торговли. Это ДОЛЖНО влиять на target/stop/hold:
- 1H = СКАЛЬПИНГ: цель 1-2% от entry, стоп 0.5-1%. Удержание: 1-4 часа. Если за 1-2 часа цена не двинулась к цели — выходи в ноль.
- 4H = ИНТРАДЕЙ: цель 2-4% от entry, стоп 1-2%. Удержание: 4-24 часа. Если за 6-8 часов нет движения — выходи в ноль.
- 1D = СВИНГ: цель 3-8% от entry, стоп 2-3%. Удержание: 2-7 дней. Если за 3 дня нет движения — выходи в ноль или небольшой минус.
Верни эти поля:
- "horizon" — "scalp" для 1H, "intraday" для 4H, "swing" для 1D
- "holdTime" — конкретное ожидаемое время удержания. Примеры: "1-2 часа", "8-12 часов", "3-5 дней"
- "holdAdvice" — одно предложение: что делать если цена не движется. Пример: "Если цена не дошла до $68,000 за 2 часа — закрой в ноль, не жди стоп"

JSON формат:
{"situation": "что происходит", "verdict": "что это значит", "trendLabel": "Медвежий импульс", "trendDetail": "–26.6% от ATH", "signalStrength": "strong", "activation": null, "horizon": "swing", "holdTime": "3-5 дней", "holdAdvice": "Если за 3 дня нет движения выше $70K — выходи в ноль", "longPct": 35, "shortPct": 65, "long": {"entry": "69000", "target": "74000", "stop": "64000"}, "short": {"entry": "64000", "target": "60000", "stop": "68000"}}`;

        // ── Admin context передаётся с фронта (загружен из Firebase клиентом) ──
        let adminContextBlock = '';
        if (ctx.adminContext) {
            adminContextBlock = lang === 'en'
                ? '\n\nANALYST CONTEXT (written by professional trader, HIGH PRIORITY):\n' + ctx.adminContext + '\n\nIMPORTANT: Check currentPrice against the breakout levels and determine current status automatically.'
                : '\n\nКОНТЕКСТ АНАЛИТИКА (профессиональный трейдер, ВЫСОКИЙ ПРИОРИТЕТ):\n' + ctx.adminContext + '\n\nВАЖНО: Сопоставь currentPrice с уровнями пробоя и определи текущий статус.';
            console.log('📌 Admin context received: ' + ctx.adminContext.slice(0, 80));
            delete ctx.adminContext;
        }

        // Собираем пользовательское сообщение — передаём данные как JSON
        const userMsg = JSON.stringify(ctx, null, 0) + adminContextBlock + '\n\nЧто делать прямо сейчас? Ответь в JSON.';

        // Запрос к OpenRouter
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'HTTP-Referer': 'https://www.thinkingtrader.com',
                'X-Title': 'Thinking Trader Scanner',
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMsg },
                ],
                temperature: 0.3,
            }),
            signal: AbortSignal.timeout(35000),
        });

        if (!aiRes.ok) {
            const errBody = await aiRes.text().catch(() => '');
            console.error(`❌ AI Scanner error ${aiRes.status}: ${errBody.slice(0, 300)}`);
            return res.status(502).json({ error: 'AI service error' });
        }

        const aiData = await aiRes.json();
        const raw = aiData.choices?.[0]?.message?.content || '';

        // Парсим JSON из ответа
        let parsed;
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (e) {
            parsed = null;
        }

        let result;
        if (parsed && parsed.situation && parsed.longPct != null && parsed.shortPct != null) {
            const lp = parseInt(parsed.longPct) || 50;
            const sp = parseInt(parsed.shortPct) || 50;
            const diff = Math.abs(lp - sp);
            const strength = parsed.signalStrength || (diff >= 20 ? 'strong' : diff >= 10 ? 'weak' : 'neutral');
            result = {
                situation: parsed.situation,
                verdict: parsed.verdict || '',
                trendLabel: parsed.trendLabel || '',
                trendDetail: parsed.trendDetail || '',
                signalStrength: strength,
                activation: parsed.activation || null,
                horizon: parsed.horizon || null,
                holdTime: parsed.holdTime || null,
                holdAdvice: parsed.holdAdvice || null,
                longPct: lp,
                shortPct: sp,
                long: parsed.long || { entry: null, target: null, stop: null },
                short: parsed.short || { entry: null, target: null, stop: null },
            };
        } else if (parsed && (parsed.situation || parsed.text)) {
            const lp = parseInt(parsed.longPct) || 50;
            const sp = parseInt(parsed.shortPct) || 50;
            const diff = Math.abs(lp - sp);
            result = {
                situation: parsed.situation || parsed.text || '',
                verdict: parsed.verdict || '',
                trendLabel: parsed.trendLabel || '',
                trendDetail: parsed.trendDetail || '',
                signalStrength: parsed.signalStrength || (diff >= 20 ? 'strong' : diff >= 10 ? 'weak' : 'neutral'),
                activation: parsed.activation || null,
                horizon: parsed.horizon || null,
                holdTime: parsed.holdTime || null,
                holdAdvice: parsed.holdAdvice || null,
                longPct: lp,
                shortPct: sp,
                long: parsed.long || { entry: null, target: null, stop: null },
                short: parsed.short || { entry: null, target: null, stop: null },
            };
        } else {
            result = {
                situation: raw.slice(0, 200),
                verdict: '',
                trendLabel: '',
                trendDetail: '',
                signalStrength: 'neutral',
                activation: null,
                horizon: null,
                holdTime: null,
                holdAdvice: null,
                longPct: 50,
                shortPct: 50,
                long: { entry: null, target: null, stop: null },
                short: { entry: null, target: null, stop: null },
            };
        }

        // Сохраняем в кэш
        const aiCacheTtl = getAiCacheTtl(ctx.timeframe);
        result.cachedAt = Date.now();
        if (clusterDebug) result._cluster = clusterDebug; // для отладки в консоли браузера
        cacheSet(cacheKey, result, aiCacheTtl);
        console.log(`💾 AI Scanner cached: ${cacheKey} (TTL ${aiCacheTtl / 1000}s)`);

        // ── Увеличиваем счётчик сканов для Free-пользователей ──
        if (uid && uid !== ADMIN_UID && !proUser) {
            const limits = _getFreeLimits(uid);
            limits.scanCount++;
            console.log(`📊 Free scan used: ${uid} → ${limits.scanCount}/${FREE_SCAN_LIMIT}`);
        }

        res.json(result);

    } catch (e) {
        console.error('❌ AI Scanner exception:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ADMIN CONTEXT — контекст аналитика для AI-сканера
// ══════════════════════════════════════════════════════════════
const ADMIN_UID = process.env.ADMIN_UID;

// ══════════════════════════════════════════════════════════════
// ПОДПИСКА PRO — лимиты и NOWPayments
// ══════════════════════════════════════════════════════════════
const NOWPAY_API_KEY  = process.env.NOWPAY_API_KEY;
const NOWPAY_IPN_SECRET = process.env.NOWPAY_IPN_SECRET;

// Дневные лимиты Free-пользователей (хранятся в памяти, сбрасываются при рестарте)
// Структура: uid → { scanCount, scanDate, chatSessions: { sessionKey → count } }
const _freeLimits = new Map();

const FREE_SCAN_LIMIT = 3;
const FREE_CHAT_LIMIT = 3;
const PRO_CHAT_LIMIT  = 7;

function _todayUtc() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function _getFreeLimits(uid) {
    const today = _todayUtc();
    let entry = _freeLimits.get(uid);
    if (!entry || entry.scanDate !== today) {
        entry = { scanCount: 0, scanDate: today, chatSessions: {} };
        _freeLimits.set(uid, entry);
    }
    return entry;
}

// Проверка подписки PRO через Firestore Admin SDK
async function _isPro(uid) {
    if (!adminDb) return false;
    try {
        const doc = await adminDb.collection('subscriptions').doc(uid).get();
        if (!doc.exists) return false;
        const data = doc.data();
        return data.proUntil && data.proUntil > Date.now();
    } catch(e) {
        // Если Firestore недоступен — не ломаем, просто возвращаем false
        console.warn('_isPro Firestore error (treating as Free):', e.message.slice(0, 60));
        return false;
    }
}

// Middleware: верифицировать токен и вернуть uid
async function requireAuth(req, res, next) {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        // Всегда декодируем JWT напрямую (быстро, без сетевых запросов)
        const parts = token.split('.');
        if (parts.length !== 3) return res.status(401).json({ error: 'Invalid token' });
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        const uid = payload.sub || payload.user_id;
        if (!uid) return res.status(401).json({ error: 'Invalid token' });
        // Проверяем expiry
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return res.status(401).json({ error: 'Token expired' });
        }
        req.uid = uid;
        next();
    } catch(e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

function verifyAdmin(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return false;
    try {
        const token = auth.split('Bearer ')[1];
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return (payload.sub || payload.user_id) === ADMIN_UID;
    } catch { return false; }
}

async function translateToEn(text) {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                max_tokens: 1000,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional financial translator. Translate the following crypto trading analyst context from Russian to English. Preserve all numbers, price levels ($), and technical terms exactly. Return ONLY the translated text, nothing else.'
                    },
                    { role: 'user', content: text }
                ]
            }),
            signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || text;
    } catch (e) {
        console.error('❌ translateToEn error:', e.message);
        return text;
    }
}

function invalidateContextCache(coinId) {
    ['1D', '4H', '1H'].forEach(tf => {
        ['ru', 'en'].forEach(lang => {
            const key = `ai:v3:${symbol}:${tf}:${lang}`;
            cache.delete(key);
            console.log(`🗑️ Cache invalidated: ${key}`);
        });
    });
}

// POST /api/admin/context/translate — перевести текст контекста и сохранить EN версию
app.post('/api/admin/context/translate', async (req, res) => {
    try {
        const { coinId, itemId, text } = req.body;
        if (!coinId || !itemId || !text) return res.status(400).json({ error: 'Missing params' });
        const text_en = await translateToEn(text);
        // Обновляем text_en в Firebase
        if (adminDb) {
            const docRef = adminDb.collection('admin_context').doc(coinId);
            const doc = await docRef.get();
            if (doc.exists) {
                const items = (doc.data().items || []).map(i =>
                    i.id === itemId ? { ...i, text_en } : i
                );
                await docRef.set({ items });
            }
        }
        // Инвалидируем кэш
        invalidateContextCache(coinId);
        console.log(`✅ Context translated: ${coinId}/${itemId}`);
        res.json({ ok: true, text_en });
    } catch(e) {
        console.error('❌ translate error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/context — сохранить новый контекст
app.post('/api/admin/context', async (req, res) => {
    console.log(`[admin/context POST] auth: ${req.headers.authorization ? 'present' : 'missing'}, ADMIN_UID: ${ADMIN_UID ? 'set' : 'NOT SET'}, adminDb: ${adminDb ? 'ok' : 'null'}`);
    if (!verifyAdmin(req)) {
        console.log('[admin/context POST] verifyAdmin FAILED');
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!adminDb) return res.status(503).json({ error: 'Firebase not available' });
    try {
        const { coinId, text } = req.body;
        console.log(`[admin/context POST] coinId=${coinId}, text length=${text?.length}`);
        if (!coinId || !text || !text.trim()) {
            return res.status(400).json({ error: 'coinId and text required' });
        }
        const text_en = await translateToEn(text.trim());
        const item = {
            id: `ctx_${Date.now()}`,
            text_ru: text.trim(),
            text_en,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            active: true,
        };
        const docRef = adminDb.collection('admin_context').doc(coinId);
        const doc = await docRef.get();
        const existing = doc.exists ? (doc.data().items || []) : [];
        await docRef.set({ items: [...existing, item] });
        invalidateContextCache(coinId);
        console.log(`✅ Admin context saved: ${coinId} / ${item.id}`);
        res.json({ ok: true, item });
    } catch (e) {
        console.error('❌ admin/context POST error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/context/:coinId — получить все активные контексты
app.get('/api/admin/context/:coinId', async (req, res) => {
    if (!verifyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!adminDb) return res.status(503).json({ error: 'Firebase not available' });
    try {
        const { coinId } = req.params;
        const doc = await adminDb.collection('admin_context').doc(coinId).get();
        const items = doc.exists ? (doc.data().items || []) : [];
        const active = items.filter(i => i.active !== false);
        res.json({ items: active });
    } catch (e) {
        console.error('❌ admin/context GET error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/admin/context/:coinId/:id — обновить контекст
app.put('/api/admin/context/:coinId/:id', async (req, res) => {
    if (!verifyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!adminDb) return res.status(503).json({ error: 'Firebase not available' });
    try {
        const { coinId, id } = req.params;
        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
        const text_en = await translateToEn(text.trim());
        const docRef = adminDb.collection('admin_context').doc(coinId);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Not found' });
        const items = (doc.data().items || []).map(i =>
            i.id === id ? { ...i, text_ru: text.trim(), text_en, updatedAt: Date.now() } : i
        );
        await docRef.set({ items });
        invalidateContextCache(coinId);
        console.log(`✅ Admin context updated: ${coinId} / ${id}`);
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ admin/context PUT error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/admin/context/:coinId/:id — удалить контекст
app.delete('/api/admin/context/:coinId/:id', async (req, res) => {
    if (!verifyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!adminDb) return res.status(503).json({ error: 'Firebase not available' });
    try {
        const { coinId, id } = req.params;
        const docRef = adminDb.collection('admin_context').doc(coinId);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Not found' });
        const items = (doc.data().items || []).filter(i => i.id !== id);
        await docRef.set({ items });
        invalidateContextCache(coinId);
        console.log(`✅ Admin context deleted: ${coinId} / ${id}`);
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ admin/context DELETE error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── AI Chat — диалог на основе анализа ──────────────────────
app.post('/api/ai-chat', async (req, res) => {
    try {
        // ── Авторизация ──
        const token = getToken(req);
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        let uid;
        try {
            const parts = token.split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            uid = payload.sub || payload.user_id;
            if (!uid) throw new Error('no uid');
        } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

        // ── Проверка лимитов чата ──
        const isAdminReq = uid === ADMIN_UID;
        const proUser = isAdminReq ? true : await _isPro(uid);
        const chatLimit = proUser ? PRO_CHAT_LIMIT : FREE_CHAT_LIMIT;

        if (!isAdminReq && !proUser) {
            const { sessionKey } = req.body;
            if (sessionKey) {
                const limits = _getFreeLimits(uid);
                const chatCount = limits.chatSessions[sessionKey] || 0;
                if (chatCount >= FREE_CHAT_LIMIT) {
                    return res.status(429).json({ error: 'limit', type: 'chat_limit', used: chatCount, max: FREE_CHAT_LIMIT });
                }
                // Увеличиваем счётчик
                limits.chatSessions[sessionKey] = chatCount + 1;
            }
        }

        const { messages, lang } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Missing messages' });
        }

        const isEn = lang === 'en';
        const systemPrompt = isEn
            ? `You are a crypto trading assistant. The user has already received a market analysis. Answer follow-up questions concisely and specifically based on the context of the analysis. Maximum 2-3 sentences. No disclaimers. No generic phrases. Specific prices and levels only. Plain text only — no markdown, no asterisks, no bullet points.`
            : `Ты ассистент криптотрейдера. Пользователь уже получил анализ рынка. Отвечай на уточняющие вопросы кратко и конкретно, опираясь на контекст анализа. Максимум 2-3 предложения. Без дисклеймеров. Без общих фраз. Только конкретные цены и уровни. Только plain text — без markdown, без звёздочек, без маркированных списков.`;

        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'HTTP-Referer': 'https://thinkingtrader.app',
                'X-Title': 'Thinking Trader Chat'
            },
            body: JSON.stringify({
                model: AI_MODEL,
                max_tokens: 1000,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages
                ]
            })
        });

        if (!aiRes.ok) throw new Error('Chat error ' + aiRes.status);
        const data = await aiRes.json();
        const text = data.choices?.[0]?.message?.content || '';
        res.json({ text });
    } catch (e) {
        console.error('❌ AI Chat exception:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// TELEGRAM BOT
// ══════════════════════════════════════════════════════════════
const TG_TOKEN      = process.env.TG_TOKEN;
const TG_CHAT_ID    = process.env.TG_CHAT_ID;
const TG_CHAT_ID_EN = process.env.TG_CHAT_ID_EN;
const TG_API        = `https://api.telegram.org/bot${TG_TOKEN}`;

let _tgSendCounter = 0;
async function tgSend(text, chatId = TG_CHAT_ID) {
    _tgSendCounter++;
    const sendId = `S${_tgSendCounter}-${Date.now()}`;
    console.log(`📨 tgSend #${sendId} → chat_id: ${chatId}, text length: ${text.length}, time: ${new Date().toISOString()}`);
    const r = await fetch(`${TG_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(`Telegram: ${data.description}`);
    return data;
}

async function tgSendBoth(textRu, textEn) {
    // Retry до 3 раз при ошибке
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const results = await Promise.allSettled([
                tgSend(textRu, TG_CHAT_ID),
                TG_CHAT_ID_EN ? tgSend(textEn || textRu, TG_CHAT_ID_EN) : Promise.resolve(),
            ]);
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
                throw new Error(failed.map(f => f.reason.message).join('; '));
            }
            return; // успех
        } catch (e) {
            console.warn(`⚠️ tgSendBoth попытка ${attempt}/3 ошибка: ${e.message}`);
            if (attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

async function tgSendPhotoBuffer(buffer, filename, caption) {
    const { FormData: FD, Blob: BL } = require('node:buffer') && { FormData, Blob };
    const form = new FormData();
    form.append('chat_id', TG_CHAT_ID);
    form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), filename);
    if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
    const r = await fetch(`${TG_API}/sendPhoto`, { method: 'POST', body: form });
    const data = await r.json();
    if (!data.ok) throw new Error(`Telegram photo: ${data.description}`);
    return data;
}

// ── Форматирование постов ──────────────────────────────────────
const RSS_FEEDS = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
    'https://www.theblock.co/rss.xml',
    'https://ambcrypto.com/feed/',
    'https://cryptoslate.com/feed/',
];
const BULL_KW = ['surge','rally','bull','soar','gain','rise','ath','record','adoption','etf','approve','launch','upgrade','buy'];
const BEAR_KW = ['crash','drop','fall','hack','exploit','ban','lawsuit','sec','penalty','bear','liquidat','outflow','scam','fraud','warning','risk'];

function classifySentiment(text) {
    const t = text.toLowerCase();
    let b = 0, br = 0;
    BULL_KW.forEach(w => { if (t.includes(w)) b++; });
    BEAR_KW.forEach(w => { if (t.includes(w)) br++; });
    return b > br ? 'bull' : br > b ? 'bear' : 'neutral';
}

function textBar(pct) {
    const filled = Math.round(pct / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function fgLabel(v) {
    const n = parseInt(v);
    if (n <= 24) return 'Экстремальный страх 😱';
    if (n <= 44) return 'Страх 😨';
    if (n <= 55) return 'Нейтрально 😐';
    if (n <= 74) return 'Жадность 😏';
    return 'Экстремальная жадность 🤑';
}

function fgEmoji(v) {
    const n = parseInt(v);
    if (n <= 24) return '😱';
    if (n <= 44) return '😨';
    if (n <= 55) return '😐';
    if (n <= 74) return '😏';
    return '🤑';
}

function arrow(pct) {
    return parseFloat(pct) >= 0 ? '📈' : '📉';
}

function fmt(price, dec = 0) {
    return parseFloat(price).toLocaleString('en', { maximumFractionDigits: dec, minimumFractionDigits: dec });
}

function pctFmt(v) {
    const n = parseFloat(v);
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function todayStr() {
    return new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}

function todayStrEn() {
    return new Date().toLocaleDateString('en', { day: 'numeric', month: 'long' });
}

function fgLabelEn(v) {
    const n = parseInt(v);
    if (n <= 24) return 'Extreme Fear 😱';
    if (n <= 44) return 'Fear 😨';
    if (n <= 55) return 'Neutral 😐';
    if (n <= 74) return 'Greed 😏';
    return 'Extreme Greed 🤑';
}

async function fetchAllNews() {
    const allItems = [];
    await Promise.allSettled(RSS_FEEDS.map(async (url) => {
        try {
            const data = await proxyFetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
            if (data.items) {
                data.items.forEach(item => {
                    const sentiment = classifySentiment(item.title + ' ' + (item.description || ''));
                    allItems.push({ title: item.title, link: item.link, sentiment, date: item.pubDate, source: data.feed?.title || '' });
                });
            }
        } catch (e) { /* пропускаем упавший фид */ }
    }));
    return allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function translateTitle(text) {
    try {
        const data = await proxyFetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=en|ru`);
        return data?.responseData?.translatedText || text;
    } catch { return text; }
}

// ── Утренний пост 07:00 ────────────────────────────────────────
async function buildMorningPost() {
    const [tickerRaw, fgRaw, newsItems] = await Promise.all([
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT","SOLUSDT"]')}`),
        proxyFetch('https://api.alternative.me/fng/?limit=2'),
        fetchAllNews(),
    ]);

    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const eth = tickerRaw.find(t => t.symbol === 'ETHUSDT');
    const sol = tickerRaw.find(t => t.symbol === 'SOLUSDT');
    const fg  = fgRaw?.data?.[0]?.value || '—';
    const top3 = newsItems.slice(0, 3);

    const titles = await Promise.all(top3.map(n => translateTitle(n.title)));

    return `☀️ <b>Утренний дайджест · ${todayStr()}</b>
━━━━━━━━━━━━━━━━━━━━━━

🟠 <b>BTC</b>   $${fmt(btc.lastPrice)}   ${pctFmt(btc.priceChangePercent)} ${arrow(btc.priceChangePercent)}
🔷 <b>ETH</b>   $${fmt(eth.lastPrice)}   ${pctFmt(eth.priceChangePercent)} ${arrow(eth.priceChangePercent)}
🟣 <b>SOL</b>   $${fmt(sol.lastPrice, 2)}   ${pctFmt(sol.priceChangePercent)} ${arrow(sol.priceChangePercent)}

${fgEmoji(fg)} <b>Fear &amp; Greed:</b> ${fg} — ${fgLabel(fg)}

📰 <b>Топ новости</b>
🔥 ${titles[0] || '—'}
▪️ ${titles[1] || '—'}
▫️ ${titles[2] || '—'}

━━━━━━━━━━━━━━━━━━━━━━
👉 thinkingtrader.com`;
}

// ── Утренний пост EN ──────────────────────────────────────────
async function buildMorningPostEN() {
    const [tickerRaw, fgRaw, newsItems] = await Promise.all([
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT","SOLUSDT"]')}`),
        proxyFetch('https://api.alternative.me/fng/?limit=2'),
        fetchAllNews(),
    ]);
    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const eth = tickerRaw.find(t => t.symbol === 'ETHUSDT');
    const sol = tickerRaw.find(t => t.symbol === 'SOLUSDT');
    const fg  = fgRaw?.data?.[0]?.value || '—';
    const top3 = newsItems.slice(0, 3);
    return `☀️ <b>Morning Digest · ${todayStrEn()}</b>
━━━━━━━━━━━━━━━━━━━━━━

🟠 <b>BTC</b>   $${fmt(btc.lastPrice)}   ${pctFmt(btc.priceChangePercent)} ${arrow(btc.priceChangePercent)}
🔷 <b>ETH</b>   $${fmt(eth.lastPrice)}   ${pctFmt(eth.priceChangePercent)} ${arrow(eth.priceChangePercent)}
🟣 <b>SOL</b>   $${fmt(sol.lastPrice, 2)}   ${pctFmt(sol.priceChangePercent)} ${arrow(sol.priceChangePercent)}

${fgEmoji(fg)} <b>Fear &amp; Greed:</b> ${fg} — ${fgLabelEn(fg)}

📰 <b>Top News</b>
🔥 ${top3[0]?.title || '—'}
▪️ ${top3[1]?.title || '—'}
▫️ ${top3[2]?.title || '—'}

━━━━━━━━━━━━━━━━━━━━━━
👉 thinkingtrader.com`;
}

// ── Дневной пост 13:00 ────────────────────────────────────────
async function buildNoonPost() {
    const [newsItems, tickerRaw] = await Promise.all([
        fetchAllNews(),
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}`),
    ]);

    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const eth = tickerRaw.find(t => t.symbol === 'ETHUSDT');

    const top5 = newsItems.slice(0, 5);
    const titles = await Promise.all(top5.map(n => translateTitle(n.title)));
    const newsList = titles.map(t => `▸ ${t}`).join('\n');

    const sample = newsItems.slice(0, 30);
    const bull = Math.round(sample.filter(n => n.sentiment === 'bull').length / (sample.length || 1) * 100);
    const sentimentText = bull >= 60 ? 'бычий' : bull <= 30 ? 'медвежий' : bull >= 45 ? 'умеренно бычий' : 'неопределённый';

    return `📰  <b>Новости дня · ${todayStr()}</b>

<b>BTC</b> $${fmt(btc.lastPrice)} ${pctFmt(btc.priceChangePercent)}  ·  <b>ETH</b> $${fmt(eth.lastPrice)} ${pctFmt(eth.priceChangePercent)}

${newsList}

⚡ Рынок: <b>${sentimentText}</b> (${bull}%)

thinkingtrader.com`;
}

// ── Дневной пост EN ──────────────────────────────────────────
async function buildNoonPostEN() {
    const [newsItems, tickerRaw] = await Promise.all([
        fetchAllNews(),
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}`),
    ]);

    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const eth = tickerRaw.find(t => t.symbol === 'ETHUSDT');

    const top5 = newsItems.slice(0, 5);
    const newsList = top5.map(n => `▸ ${n.title}`).join('\n');

    const sample = newsItems.slice(0, 30);
    const bull = Math.round(sample.filter(n => n.sentiment === 'bull').length / (sample.length || 1) * 100);
    const sentimentText = bull >= 60 ? 'bullish' : bull <= 30 ? 'bearish' : bull >= 45 ? 'moderately bullish' : 'uncertain';

    return `📰  <b>News of the Day · ${todayStrEn()}</b>

<b>BTC</b> $${fmt(btc.lastPrice)} ${pctFmt(btc.priceChangePercent)}  ·  <b>ETH</b> $${fmt(eth.lastPrice)} ${pctFmt(eth.priceChangePercent)}

${newsList}

⚡ Market: <b>${sentimentText}</b> (${bull}%)

thinkingtrader.com`;
}

// ── Вечерний пост 19:00 ───────────────────────────────────────
async function buildEveningPost() {
    const [candles, tickerRaw] = await Promise.all([
        proxyFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90'),
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT"]')}`),
    ]);
    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const closes  = candles.map(k => parseFloat(k[4]));
    const volumes = candles.map(k => parseFloat(k[5]));

    // RSI(14)
    let gains = 0, losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
        const d = closes[i] - closes[i-1];
        if (d > 0) gains += d; else losses += Math.abs(d);
    }
    const rsiVal = 100 - (100 / (1 + (gains/14) / (losses/14 || 0.0001)));
    const rsi = rsiVal.toFixed(1);
    const rsiLabel = rsiVal > 70 ? 'перекупленность  ▼' : rsiVal < 30 ? 'перепроданность  ▲' : 'нейтрально';

    // MACD
    const ema = (arr, n) => arr.slice(-n).reduce((a,b) => a+b, 0) / n;
    const macdVal = parseFloat((ema(closes,12) - ema(closes,26)).toFixed(0));
    const macd = (macdVal >= 0 ? '+' : '') + macdVal;
    const macdLabel = macdVal >= 0 ? 'бычий  ▲' : 'медвежий  ▼';

    // EMA 50/200
    const ema50  = ema(closes, 50);
    const ema200 = closes.length >= 200 ? ema(closes, 200) : ema(closes, closes.length);
    const emaStr = ema50 >= ema200 ? 'выше 200  ▲' : 'ниже 200  ▼';

    // BB Width
    const slice = closes.slice(-20);
    const mean  = slice.reduce((a,b) => a+b, 0) / 20;
    const stddev = Math.sqrt(slice.reduce((s,v) => s+(v-mean)**2, 0) / 20);
    const bb = ((stddev * 4) / mean).toFixed(4);

    // Volume
    const volNow = volumes[volumes.length-1];
    const volAvg = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const volDiff = ((volNow - volAvg) / volAvg * 100);
    const vol = (volDiff >= 0 ? '+' : '') + volDiff.toFixed(1) + '%';
    const volLabel = volDiff >= 0 ? 'выше среднего  ▲' : 'ниже среднего  ▼';

    // Вердикт
    let bullSig = 0, bearSig = 0, neutSig = 0;
    if (rsiVal > 55) bullSig++; else if (rsiVal < 45) bearSig++; else neutSig++;
    if (macdVal >= 0) bullSig++; else bearSig++;
    if (ema50 >= ema200) bullSig++; else bearSig++;
    if (volDiff >= 0) bullSig++; else bearSig++;
    neutSig++;

    let verdict;
    if (bullSig >= 4)      verdict = 'бычий сигнал';
    else if (bearSig >= 4) verdict = 'медвежий сигнал';
    else if (bullSig >= 3) verdict = 'умеренно бычий';
    else if (bearSig >= 3) verdict = 'умеренно медвежий';
    else                   verdict = 'неопределённость';

    return `📊  <b>Технический срез · BTC · ${todayStr()}</b>

<b>$${fmt(btc.lastPrice)}</b>   ${pctFmt(btc.priceChangePercent)} за 24ч

<b>RSI (14)</b>       ${rsi}      ${rsiLabel}
<b>MACD</b>            ${macd}      ${macdLabel}
<b>BB Width</b>       ${bb}   сжатие
<b>EMA 50/200</b>   ${emaStr}
<b>Объём 24ч</b>    ${vol}      ${volLabel}

⚡ Сигнал: ${bullSig}▲  ${bearSig}▼  ${neutSig}◆  →  <b>${verdict}</b>

thinkingtrader.com`;
}

// ── Вечерний пост EN ─────────────────────────────────────────
async function buildEveningPostEN() {
    const [candles, tickerRaw] = await Promise.all([
        proxyFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90'),
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT"]')}`),
    ]);
    const btc = tickerRaw.find(t => t.symbol === 'BTCUSDT');
    const closes  = candles.map(k => parseFloat(k[4]));
    const volumes = candles.map(k => parseFloat(k[5]));
    let gains = 0, losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
        const d = closes[i] - closes[i-1];
        if (d > 0) gains += d; else losses += Math.abs(d);
    }
    const rsiVal = 100 - (100 / (1 + (gains/14) / (losses/14 || 0.0001)));
    const rsi = rsiVal.toFixed(1);
    const rsiLabel = rsiVal > 70 ? 'overbought  ▼' : rsiVal < 30 ? 'oversold  ▲' : 'neutral';
    const ema = (arr, n) => arr.slice(-n).reduce((a,b) => a+b, 0) / n;
    const macdVal = parseFloat((ema(closes,12) - ema(closes,26)).toFixed(0));
    const macd = (macdVal >= 0 ? '+' : '') + macdVal;
    const macdLabel = macdVal >= 0 ? 'bullish  ▲' : 'bearish  ▼';
    const ema50 = ema(closes, 50);
    const ema200 = closes.length >= 200 ? ema(closes, 200) : ema(closes, closes.length);
    const emaStr = ema50 >= ema200 ? 'above 200  ▲' : 'below 200  ▼';
    const slice = closes.slice(-20);
    const mean  = slice.reduce((a,b) => a+b, 0) / 20;
    const stddev = Math.sqrt(slice.reduce((s,v) => s+(v-mean)**2, 0) / 20);
    const bb = ((stddev * 4) / mean).toFixed(4);
    const volNow = volumes[volumes.length-1];
    const volAvg = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const volDiff = ((volNow - volAvg) / volAvg * 100);
    const vol = (volDiff >= 0 ? '+' : '') + volDiff.toFixed(1) + '%';
    const volLabel = volDiff >= 0 ? 'above avg  ▲' : 'below avg  ▼';

    let bullSig = 0, bearSig = 0, neutSig = 0;
    if (rsiVal > 55) bullSig++; else if (rsiVal < 45) bearSig++; else neutSig++;
    if (macdVal >= 0) bullSig++; else bearSig++;
    if (ema50 >= ema200) bullSig++; else bearSig++;
    if (volDiff >= 0) bullSig++; else bearSig++;
    neutSig++;

    let verdict;
    if (bullSig >= 4)      verdict = 'bullish signal';
    else if (bearSig >= 4) verdict = 'bearish signal';
    else if (bullSig >= 3) verdict = 'moderately bullish';
    else if (bearSig >= 3) verdict = 'moderately bearish';
    else                   verdict = 'uncertain';

    return `📊  <b>Technical Overview · BTC · ${todayStrEn()}</b>

<b>$${fmt(btc.lastPrice)}</b>   ${pctFmt(btc.priceChangePercent)} 24h

<b>RSI (14)</b>       ${rsi}      ${rsiLabel}
<b>MACD</b>            ${macd}      ${macdLabel}
<b>BB Width</b>       ${bb}   squeeze
<b>EMA 50/200</b>   ${emaStr}
<b>Volume 24h</b>   ${vol}      ${volLabel}

⚡ Signal: ${bullSig}▲  ${bearSig}▼  ${neutSig}◆  →  <b>${verdict}</b>

thinkingtrader.com`;
}

// ── История отправленных постов ───────────────────────────────
const postHistory = [];
function logPost(type, text) {
    postHistory.unshift({ type, text: text.slice(0, 100), time: new Date().toISOString() });
    if (postHistory.length > 50) postHistory.pop();
}

// ── CRON — автопостинг ────────────────────────────────────────
// Используем setInterval вместо setTimeout — переживает рестарты Railway
const TIMEZONE_OFFSET = 3; // МСК = UTC+3

const scheduledPosts = [];
const postSentToday = {}; // in-memory фоллбэк, если Firestore недоступен

// Проверка/установка флага отправки через файл (переживает рестарт и деплой через Railway Volume)
const fs = require('fs');
const LOCK_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH ? process.env.RAILWAY_VOLUME_MOUNT_PATH + '/tt-post-locks' : '/tmp/tt-post-locks';
try { fs.mkdirSync(LOCK_DIR, { recursive: true }); } catch {}
console.log(`🔒 Post locks dir: ${LOCK_DIR}`);

function lockFilePath(key) {
    return `${LOCK_DIR}/${key.replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
}

async function markPostSent(sentKey) {
    const filePath = lockFilePath(sentKey);
    try {
        // wx = exclusive create — атомарная операция
        const fd = fs.openSync(filePath, 'wx');
        fs.writeSync(fd, `${Date.now()}:${process.pid}`);
        fs.closeSync(fd);
        
        // Ждём 3 секунды и перечитываем — наш ли pid внутри?
        await new Promise(r => setTimeout(r, 3000));
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.includes(String(process.pid))) {
            console.log(`🔒 Lock перезаписан другим процессом: ${sentKey}`);
            return false;
        }
        
        console.log(`🔓 Lock создан и подтверждён: ${sentKey} (pid: ${process.pid})`);
        return true;
    } catch (e) {
        if (e.code === 'EEXIST') {
            console.log(`🔒 Пост уже отправлен (lock exists): ${sentKey}`);
            return false;
        }
        console.warn('⚠️ File lock error, falling back to memory:', e.message);
    }
    // Фоллбэк на in-memory
    if (postSentToday[sentKey]) return false;
    postSentToday[sentKey] = true;
    return true;
}

// Очистка старых локов (вчерашних)
function cleanOldPostLocks(dateKey) {
    try {
        const files = fs.readdirSync(LOCK_DIR);
        files.forEach(f => {
            if (!f.includes(dateKey)) {
                try { fs.unlinkSync(`${LOCK_DIR}/${f}`); } catch {}
            }
        });
    } catch {}
}

// ── Точное планирование через setTimeout (без setInterval race conditions) ──

function scheduleDaily(hour, minute, fn, label, fnEn = null) {
    scheduledPosts.push({ hour, minute, fn, label, fnEn });
    console.log(`⏰ ${label} запланирован на ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} МСК`);
}

function getMskNow() {
    const now = new Date();
    return {
        hour: (now.getUTCHours() + TIMEZONE_OFFSET) % 24,
        minute: now.getUTCMinutes(),
        second: now.getUTCSeconds(),
        dateKey: now.toISOString().slice(0, 10),
        ts: now.getTime(),
    };
}

function msUntilMsk(targetHour, targetMinute) {
    const now = new Date();
    const utcTarget = new Date(now);
    utcTarget.setUTCHours(targetHour - TIMEZONE_OFFSET, targetMinute, 0, 0);
    let diff = utcTarget.getTime() - now.getTime();
    if (diff < -30000) diff += 86400000; // уже прошло — следующий день
    return diff;
}

async function executeScheduledPost(job) {
    const { dateKey } = getMskNow();
    const sentKey = `${job.label}:${dateKey}`;
    const filePath = lockFilePath(sentKey);

    // Атомарный лок ДО отправки — wx гарантирует что только один процесс пройдёт
    try {
        const fd = fs.openSync(filePath, 'wx');
        fs.writeSync(fd, `${Date.now()}:${process.pid}`);
        fs.closeSync(fd);
        console.log(`🔓 Lock создан: ${sentKey} (pid: ${process.pid})`);
    } catch (e) {
        if (e.code === 'EEXIST') {
            console.log(`🔒 Пост уже отправлен: ${sentKey}`);
            scheduleNextRun(job);
            return;
        }
    }

    try {
        console.log(`📤 Отправка: ${job.label} (pid: ${process.pid}, ${new Date().toISOString()})`);
        const text = await job.fn();
        const textEn = job.fnEn ? await job.fnEn() : null;
        await tgSendBoth(text, textEn);
        logPost(job.label, text);
        console.log(`✅ ${job.label} отправлен (RU + EN)`);
    } catch (e) {
        // Удаляем лок при ошибке — чтобы retry мог отправить
        try { fs.unlinkSync(filePath); } catch {}
        console.error(`❌ ${job.label} ошибка (лок удалён):`, e.message);
    }

    scheduleNextRun(job);
}

function scheduleNextRun(job) {
    // Всегда планируем на следующий день
    const ms = msUntilMsk(job.hour, job.minute);
    const delay = ms + 86400000; // +24 часа от расчётного времени
    console.log(`⏱️ Следующий ${job.label}: через ${Math.round(delay / 60000)} мин`);
    setTimeout(() => executeScheduledPost(job), delay);
}

function startScheduler() {
    // Очищаем старые локи
    const { dateKey } = getMskNow();
    cleanOldPostLocks(dateKey);

    for (const job of scheduledPosts) {
        const ms = msUntilMsk(job.hour, job.minute);
        if (ms < -30000) {
            // Уже прошло сегодня — планируем на завтра
            const delay = ms + 86400000;
            console.log(`⏱️ ${job.label}: уже прошло, следующий через ${Math.round(delay / 60000)} мин`);
            setTimeout(() => executeScheduledPost(job), delay);
        } else {
            console.log(`⏱️ ${job.label}: через ${Math.round(ms / 60000)} мин`);
            setTimeout(() => executeScheduledPost(job), Math.max(ms, 1000));
        }
    }
}

// ── CRON — алерты каждые 5 минут ─────────────────────────────
const alertPrices = { BTCUSDT: [], ETHUSDT: [] };
const alertLastSent = { BTCUSDT: 0, ETHUSDT: 0 }; // in-memory фоллбэк
const alertSettings = { BTCUSDT: 3, ETHUSDT: 5 }; // пороги %

// Проверка/установка лока для алерта через файл
async function canSendAlert(sym) {
    const now = Date.now();
    const filePath = lockFilePath(`alert_${sym}`);
    try {
        if (fs.existsSync(filePath)) {
            const ts = parseInt(fs.readFileSync(filePath, 'utf8')) || 0;
            if (now - ts <= 7200000) return false;
        }
        fs.writeFileSync(filePath, String(now));
        return true;
    } catch (e) {
        console.warn('⚠️ Alert file lock error, fallback to memory:', e.message);
    }
    // Фоллбэк
    if (now - alertLastSent[sym] <= 7200000) return false;
    alertLastSent[sym] = now;
    return true;
}

async function checkPriceAlerts() {
    try {
        const tickers = await proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}`);
        const now = Date.now();
        for (const ticker of tickers) {
            const sym = ticker.symbol;
            const price = parseFloat(ticker.lastPrice);
            alertPrices[sym].push({ price, time: now });
            alertPrices[sym] = alertPrices[sym].filter(p => now - p.time < 3600000);

            if (alertPrices[sym].length < 2) continue;
            const oldest = alertPrices[sym][0];
            const change = ((price - oldest.price) / oldest.price) * 100;
            const threshold = alertSettings[sym] || 3;

            if (Math.abs(change) >= threshold && await canSendAlert(sym)) {
                const coin    = sym.replace('USDT','');
                const emoji   = coin === 'BTC' ? '🟠' : '🔷';
                const dir     = change > 0 ? '🚀 Резкий рост' : '🔴 Резкое падение';
                const sign    = change > 0 ? '+' : '';

                // Последняя новость
                let newsLine = '';
                try {
                    const news = await fetchAllNews();
                    if (news[0]) {
                        const titleRu = await translateTitle(news[0].title);
                        newsLine = `\n\n📰 <b>Последняя новость:</b>\n<i>${titleRu}</i>\n<code>${news[0].source}</code>`;
                    }
                } catch {}

                const text = `⚡️ <b>${coin} АЛЕРТ</b>\n\n${dir} за 1 час\n${emoji} <b>$${fmt(price)}</b>   <b>${sign}${change.toFixed(2)}%</b>${newsLine}\n\n👉 thinkingtrader.com`;
                const dirEn = change > 0 ? '🚀 Sharp Rise' : '🔴 Sharp Drop';
                const textEn = `⚡️ <b>${coin} ALERT</b>\n\n${dirEn} in 1 hour\n${emoji} <b>$${fmt(price)}</b>   <b>${sign}${change.toFixed(2)}%</b>${newsLine ? `\n\n📰 <b>Latest News:</b>\n<i>${newsItems[0]?.title || ''}</i>` : ''}\n\n👉 thinkingtrader.com`;
                await tgSendBoth(text, textEn);
                logPost('alert', text);
                console.log(`⚡️ Алерт ${coin} ${sign}${change.toFixed(2)}%`);
            }
        }
    } catch (e) {
        console.error('Алерт ошибка:', e.message);
    }
}

// ── Admin API ─────────────────────────────────────────────────
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Отправить пост вручную
app.post('/api/admin/send', async (req, res) => {
    const { type, text, textEn, channel } = req.body; // channel: 'ru'|'en'|'both' (default 'both')
    try {
        let postRu = text;
        let postEn = textEn;
        if (!postRu) {
            if (type === 'morning')      { postRu = await buildMorningPost(); postEn = await buildMorningPostEN(); }
            else if (type === 'noon')    { postRu = await buildNoonPost();    postEn = await buildNoonPostEN(); }
            else if (type === 'evening') { postRu = await buildEveningPost(); postEn = await buildEveningPostEN(); }
            else return res.status(400).json({ error: 'type or text required' });
        }
        const ch = channel || 'both';
        if (ch === 'ru')   await tgSend(postRu, TG_CHAT_ID);
        else if (ch === 'en' && TG_CHAT_ID_EN) await tgSend(postEn || postRu, TG_CHAT_ID_EN);
        else               await tgSendBoth(postRu, postEn);
        logPost(type || 'manual', postRu);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Отправить пост с фото
app.post('/api/admin/send-photo', upload.array('photos', 10), async (req, res) => {
    const { caption } = req.body;
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: 'no photos' });
    try {
        if (files.length === 1) {
            // Одно фото — sendPhoto
            const form = new FormData();
            form.append('chat_id', TG_CHAT_ID);
            form.append('photo', new Blob([files[0].buffer], { type: files[0].mimetype }), files[0].originalname);
            if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
            const r = await fetch(`${TG_API}/sendPhoto`, { method: 'POST', body: form });
            const data = await r.json();
            if (!data.ok) throw new Error(`Telegram: ${data.description}`);
        } else {
            // Несколько фото — sendMediaGroup
            const mediaGroup = files.map((f, i) => ({
                type: 'photo',
                media: `attach://photo${i}`,
                ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}),
            }));
            const form = new FormData();
            form.append('chat_id', TG_CHAT_ID);
            form.append('media', JSON.stringify(mediaGroup));
            files.forEach((f, i) => {
                form.append(`photo${i}`, new Blob([f.buffer], { type: f.mimetype }), f.originalname);
            });
            const r = await fetch(`${TG_API}/sendMediaGroup`, { method: 'POST', body: form });
            const data = await r.json();
            if (!data.ok) throw new Error(`Telegram: ${data.description}`);
        }
        // Also send to EN channel if available
        if (TG_CHAT_ID_EN) {
            try {
                if (files.length === 1) {
                    const form2 = new FormData();
                    form2.append('chat_id', TG_CHAT_ID_EN);
                    form2.append('photo', new Blob([files[0].buffer], { type: files[0].mimetype }), files[0].originalname);
                    const captionEn = req.body.captionEn || caption;
                    if (captionEn) { form2.append('caption', captionEn); form2.append('parse_mode', 'HTML'); }
                    await fetch(`${TG_API}/sendPhoto`, { method: 'POST', body: form2 });
                }
            } catch(e) { console.warn('EN photo send failed:', e.message); }
        }
        logPost('manual-photo', caption || '[фото]');
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Предпросмотр поста (без отправки)
app.get('/api/admin/preview/:type', async (req, res) => {
    try {
        let text, textEn;
        if (req.params.type === 'morning')      { text = await buildMorningPost(); textEn = await buildMorningPostEN(); }
        else if (req.params.type === 'noon')    { text = await buildNoonPost();    textEn = await buildNoonPostEN(); }
        else if (req.params.type === 'evening') { text = await buildEveningPost(); textEn = await buildEveningPostEN(); }
        else return res.status(400).json({ error: 'unknown type' });
        res.json({ ok: true, text, textEn });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Настройки алертов
app.post('/api/admin/alerts', (req, res) => {
    const { btc, eth } = req.body;
    if (btc > 0) alertSettings.BTCUSDT = btc;
    if (eth > 0) alertSettings.ETHUSDT = eth;
    res.json({ ok: true, settings: alertSettings });
});

// История постов
app.get('/api/admin/history', (req, res) => {
    res.json({ ok: true, history: postHistory });
});

// Статус бота
app.get('/api/admin/status', (req, res) => {
    res.json({
        ok: true,
        bot: `@ThinkingTraderBot`,
        channelRu: TG_CHAT_ID,
        channelEn: TG_CHAT_ID_EN || null,
        alertSettings,
        historyCount: postHistory.length,
    });
});


// ══════════════════════════════════════════════════════════════
// СЕРВЕРНЫЕ АЛЕРТЫ — проверка каждые 30 сек, push на все устройства
// ══════════════════════════════════════════════════════════════

async function sendPushToUser(userId, title, body) {
    if (!adminDb || !adminMsg) return;
    try {
        const tokensSnap = await adminDb
            .collection('users').doc(userId)
            .collection('fcmTokens').get();
        const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
        if (!tokens.length) return;

        const results = await Promise.allSettled(tokens.map(token =>
            adminMsg.send({
                token,
                webpush: {
                    notification: { title, body, icon: '/favicon-192.png', badge: '/favicon-192.png' },
                    data: { title, body },
                    fcmOptions: { link: '/app' }
                }
            })
        ));

        // Удаляем невалидные токены
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                adminDb.collection('users').doc(userId)
                    .collection('fcmTokens').doc(tokensSnap.docs[i].id)
                    .delete().catch(() => {});
            }
        });
    } catch(e) {}
}

async function checkUserAlerts() {
    if (!adminDb) return;
    try {
        // collectionGroup читает alerts у ВСЕХ пользователей сразу
        // даже если у документа пользователя нет полей (только подколлекции)
        const alertsSnap = await adminDb.collectionGroup('alerts').get();

        const coinAlerts = {}; // { 'BTCUSDT': [{userId, coin, items, docRef}] }

        alertsSnap.docs.forEach(doc => {
            const items = doc.data().items || [];
            if (!items.length) return;
            const coin   = doc.id; // BTC, ETH, etc
            const userId = doc.ref.parent.parent.id; // users/{userId}/alerts/{coin}
            const symbol = coin + 'USDT';
            if (!coinAlerts[symbol]) coinAlerts[symbol] = [];
            coinAlerts[symbol].push({ userId, coin, items, docRef: doc.ref });
        });

        const symbols = Object.keys(coinAlerts);
        if (!symbols.length) return;

        // Батч-запрос цен
        const enc = encodeURIComponent(JSON.stringify(symbols));
        const priceRes = await proxyFetch(`https://api.binance.com/api/v3/ticker/price?symbols=${enc}`);
        const priceMap = {};
        priceRes.forEach(p => { priceMap[p.symbol] = parseFloat(p.price); });

        // Проверяем алерты каждого пользователя
        await Promise.all(symbols.map(async symbol => {
            const price = priceMap[symbol];
            if (!price) return;

            await Promise.all(coinAlerts[symbol].map(async ({ userId, coin, items, docRef }) => {
                const triggered = [];
                const remaining = items.filter(a => {
                    const hit = (a.dir === 'up'   && price >= a.targetPrice) ||
                                (a.dir === 'down' && price <= a.targetPrice);
                    if (hit) triggered.push(a);
                    return !hit;
                });

                if (!triggered.length) return;

                // Обновляем Firestore
                await docRef.set({ items: remaining });

                // Шлём push для каждого сработавшего алерта
                for (const a of triggered) {
                    const title = '🔔 Thinking Trader';
                    const body  = a.label + ' — цель достигнута';
                    await sendPushToUser(userId, title, body);
                    console.log(`🔔 Алерт сработал: ${userId} / ${a.label}`);
                }
            }));
        }));

    } catch(e) {
        console.error('checkUserAlerts error:', e.message);
    }
}

// ── Custom Token для Capacitor ────────────────────────────────
app.post('/api/customtoken', async (req, res) => {
    try {
        const { idToken } = req.body;
        if (!adminApp) return res.status(503).json({ error: 'Firebase Admin not initialized' });
        const decoded = await adminApp.auth().verifyIdToken(idToken);
        const customToken = await adminApp.auth().createCustomToken(decoded.uid);
        res.json({ customToken });
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});


// ── User data endpoints для Capacitor ─────────────────────────
const PROJECT_ID = 'thinking-trader';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path, idToken) {
    const r = await fetch(`${FIRESTORE_BASE}/${path}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    return r.json();
}

async function firestoreSet(path, fields, idToken) {
    const r = await fetch(`${FIRESTORE_BASE}/${path}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    return r.json();
}

async function firestoreDelete(path, idToken) {
    const r = await fetch(`${FIRESTORE_BASE}/${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    return r.ok;
}

function fsValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'object') {
        const fields = {};
        for (const k in val) fields[k] = fsValue(val[k]);
        return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
}

function fromFsValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('mapValue' in v) {
        const obj = {};
        for (const k in v.mapValue.fields) obj[k] = fromFsValue(v.mapValue.fields[k]);
        return obj;
    }
    return null;
}

function fromFsDoc(doc) {
    if (!doc || !doc.fields) return null;
    const obj = {};
    for (const k in doc.fields) obj[k] = fromFsValue(doc.fields[k]);
    const id = doc.name?.split('/').pop();
    return { id, ...obj };
}

function getToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.split('Bearer ')[1];
}

app.get('/api/user/trades', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        // Decode uid from token (without verification for now - Firestore rules will enforce security)
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        const data = await firestoreGet(`users/${uid}/trades`, idToken);
        const trades = (data.documents || []).map(fromFsDoc).filter(Boolean);
        trades.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        res.json({ trades });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/trades', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        const { id, ...data } = req.body;
        const fields = {};
        for (const k in data) fields[k] = fsValue(data[k]);
        await firestoreSet(`users/${uid}/trades/${id}`, fields, idToken);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/user/trades/:id', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        await firestoreDelete(`users/${uid}/trades/${req.params.id}`, idToken);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/alerts', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        const data = await firestoreGet(`users/${uid}/alerts`, idToken);
        const alerts = {};
        (data.documents || []).forEach(doc => {
            const id = doc.name?.split('/').pop();
            alerts[id] = fromFsDoc(doc);
        });
        res.json({ alerts });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/alerts/:coin', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        const fields = {};
        for (const k in req.body) fields[k] = fsValue(req.body[k]);
        await firestoreSet(`users/${uid}/alerts/${req.params.coin}`, fields, idToken);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/user/alerts/:coin', async (req, res) => {
    const idToken = getToken(req);
    if (!idToken) return res.status(401).json({ error: 'No token' });
    try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const uid = payload.sub || payload.user_id;
        await firestoreDelete(`users/${uid}/alerts/${req.params.coin}`, idToken);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// ПЛАТЁЖНАЯ СИСТЕМА — NOWPayments
// ══════════════════════════════════════════════════════════════

// POST /api/pay/create — создать invoice через NOWPayments
app.post('/api/pay/create', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        if (!NOWPAY_API_KEY) return res.status(503).json({ error: 'Payment system not configured' });

        const body = {
            price_amount: 15,
            price_currency: 'usd',
            order_id: uid,
            order_description: 'Thinking Trader PRO — 30 days',
            ipn_callback_url: 'https://www.thinkingtrader.com/api/pay/webhook',
            success_url: 'https://www.thinkingtrader.com/app',
            cancel_url: 'https://www.thinkingtrader.com/app',
            is_fixed_rate: false,
            is_fee_paid_by_user: false,
        };

        const nowRes = await fetch('https://api.nowpayments.io/v1/invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': NOWPAY_API_KEY,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });

        if (!nowRes.ok) {
            const errBody = await nowRes.text();
            console.error('❌ NOWPayments invoice error:', nowRes.status, errBody);
            return res.status(502).json({ error: 'Payment provider error' });
        }

        const data = await nowRes.json();
        console.log(`💳 Invoice created for uid=${uid}: id=${data.id}`);
        res.json({ invoice_url: data.invoice_url, invoice_id: data.id });

    } catch(e) {
        console.error('❌ /api/pay/create error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/pay/webhook — колбэк от NOWPayments
// Используем raw body для верификации подписи
app.post('/api/pay/webhook', express.json({ type: '*/*' }), async (req, res) => {
    try {
        if (!NOWPAY_IPN_SECRET) {
            console.warn('⚠️ NOWPAY_IPN_SECRET не задан — webhook принят без верификации');
        } else {
            // Верифицируем HMAC-SHA512 подпись
            const sig = req.headers['x-nowpayments-sig'];
            if (!sig) return res.status(400).json({ error: 'Missing signature' });

            const crypto = require('crypto');
            // Сортируем ключи тела для HMAC
            const sortedBody = JSON.stringify(sortObjectKeys(req.body));
            const expected = crypto.createHmac('sha512', NOWPAY_IPN_SECRET)
                .update(sortedBody)
                .digest('hex');

            if (sig !== expected) {
                console.warn('⚠️ NOWPayments webhook: signature mismatch');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        const { payment_status, order_id, payment_id, pay_amount, pay_currency } = req.body;
        console.log(`💳 Webhook received: status=${payment_status}, order_id=${order_id}, payment_id=${payment_id}`);

        if (payment_status === 'finished' || payment_status === 'confirmed') {
            const uid = order_id;
            if (!uid) return res.status(400).json({ error: 'Missing order_id' });

            if (adminDb) {
                const proUntil = Date.now() + 30 * 24 * 60 * 60 * 1000; // +30 дней
                await adminDb.collection('subscriptions').doc(uid).set({
                    proUntil,
                    paymentId: String(payment_id || ''),
                    paidAt: Date.now(),
                    payAmount: pay_amount || null,
                    payCurrency: pay_currency || null,
                });
                console.log(`✅ PRO activated: uid=${uid}, proUntil=${new Date(proUntil).toISOString()}`);
            } else {
                console.warn('⚠️ adminDb not available — cannot save subscription');
            }
        }

        res.status(200).json({ ok: true });
    } catch(e) {
        console.error('❌ /api/pay/webhook error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

function sortObjectKeys(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    return Object.keys(obj).sort().reduce((acc, k) => {
        acc[k] = sortObjectKeys(obj[k]);
        return acc;
    }, {});
}

// GET /api/pay/status — статус подписки пользователя
app.get('/api/pay/status', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        let isPro = false;
        let proUntil = null;

        if (adminDb) {
            try {
                const doc = await adminDb.collection('subscriptions').doc(uid).get();
                if (doc.exists) {
                    const data = doc.data();
                    proUntil = data.proUntil || null;
                    isPro = proUntil && proUntil > Date.now();
                }
            } catch(e) {
                console.warn('pay/status Firestore error (continuing):', e.message.slice(0, 60));
                // Firestore недоступен — отдаём Free статус, не ломаем ответ
            }
        }

        const limits = _getFreeLimits(uid);
        const isAdm = uid === ADMIN_UID;

        res.json({
            isPro: isAdm || !!isPro,
            isAdmin: isAdm,
            proUntil: isPro ? proUntil : null,
            scansUsed: limits.scanCount,
            scansLimit: FREE_SCAN_LIMIT,
            chatLimit: (isAdm || isPro) ? PRO_CHAT_LIMIT : FREE_CHAT_LIMIT,
        });
    } catch(e) {
        console.error('❌ /api/pay/status error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Запуск ─────────────────────────────────────────────────────


app.listen(PORT, () => {
    console.log(`✅ Thinking Trader server running on http://localhost:${PORT}`);
    console.log(`📦 Cache: prices 30s · charts 5m · news 15m · feargreed 30m · translate 24h`);

    // Автопостинг ОТКЛЮЧЕН — отправка только вручную через админку
    // scheduleDaily(7,  0, buildMorningPost,  '☀️ Утренний дайджест', buildMorningPostEN);
    // scheduleDaily(13, 0, buildNoonPost,     '📰 Дневной срез',       buildNoonPostEN);
    // scheduleDaily(19, 0, buildEveningPost,  '📊 Вечерний срез',      buildEveningPostEN);
    // startScheduler();
    console.log('📭 Автопостинг отключён — используйте админку для ручной отправки');

    // Алерты каждые 5 минут
    setInterval(checkPriceAlerts, 5 * 60 * 1000);
    checkPriceAlerts(); // сразу при старте
    console.log(`🤖 Telegram bot активен · алерты каждые 5 мин`);

    // Серверная проверка пользовательских алертов каждые 30 сек
    if (adminDb) {
        setInterval(checkUserAlerts, 10 * 1000);
        checkUserAlerts();
        console.log('🔔 Серверные алерты активны · каждые 30 сек');
    }
});


