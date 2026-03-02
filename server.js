const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Редирект с thinkingtrader.com на www.thinkingtrader.com
app.use((req, res, next) => {
    const host = req.headers.host;
    if (host === 'thinkingtrader.com') {
        return res.redirect(301, `https://www.thinkingtrader.com${req.originalUrl}`);
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
    PRICE:      30  * 1000,    // 30 сек
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
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
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
        proxyFetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub'),
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
        proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`),
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

// ── Запуск ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Thinking Trader server running on http://localhost:${PORT}`);
    console.log(`📦 Cache: prices 30s · charts 5m · news 15m · feargreed 30m · translate 24h`);
});
