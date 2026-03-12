require('dotenv').config();
const express = require('express');
const path    = require('path');

// ── Firebase Admin (для серверной проверки алертов) ────────────
let adminDb   = null;
let adminMsg  = null;

try {
    const admin = require('firebase-admin');
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : null;

    if (serviceAccount && !admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        adminDb  = admin.firestore();
        adminMsg = admin.messaging();
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
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
// TELEGRAM BOT
// ══════════════════════════════════════════════════════════════
const TG_TOKEN      = process.env.TG_TOKEN;
const TG_CHAT_ID    = process.env.TG_CHAT_ID;
const TG_CHAT_ID_EN = process.env.TG_CHAT_ID_EN;
const TG_API        = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text, chatId = TG_CHAT_ID) {
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
    const results = await Promise.allSettled([
        tgSend(textRu, TG_CHAT_ID),
        TG_CHAT_ID_EN ? tgSend(textEn || textRu, TG_CHAT_ID_EN) : Promise.resolve(),
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length === 2) throw new Error(failed[0].reason.message);
    if (failed.length === 1) console.warn('⚠️ Один канал не получил пост:', failed[0].reason.message);
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
const postSentToday = {}; // ключ "label:YYYY-MM-DD" → true

function scheduleDaily(hour, minute, fn, label, fnEn = null) {
    scheduledPosts.push({ hour, minute, fn, label, fnEn });
    console.log(`⏰ ${label} запланирован на ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} МСК`);
}

// Проверяем каждые 30 секунд — пора ли отправить пост
setInterval(async () => {
    const now = new Date();
    // Текущее время в МСК
    const mskHour   = (now.getUTCHours() + TIMEZONE_OFFSET) % 24;
    const mskMinute = now.getUTCMinutes();
    const dateKey   = now.toISOString().slice(0, 10); // "2026-03-10"

    for (const job of scheduledPosts) {
        if (mskHour === job.hour && mskMinute === job.minute) {
            const sentKey = `${job.label}:${dateKey}`;
            if (postSentToday[sentKey]) continue; // уже отправлено сегодня

            postSentToday[sentKey] = true; // Ставим флаг ДО отправки и НЕ сбрасываем при ошибке
            try {
                console.log(`📤 Отправка: ${job.label}`);
                const text = await job.fn();
                const textEn = job.fnEn ? await job.fnEn() : null;
                await tgSendBoth(text, textEn);
                logPost(job.label, text);
                console.log(`✅ ${job.label} отправлен (RU + EN)`);
            } catch (e) {
                console.error(`❌ ${job.label} ошибка:`, e.message);
                // НЕ сбрасываем флаг — лучше пропустить, чем дублировать
            }
        }
    }

    // Очищаем старые записи (вчерашние)
    for (const key of Object.keys(postSentToday)) {
        if (!key.endsWith(dateKey)) delete postSentToday[key];
    }
}, 30 * 1000);

// ── CRON — алерты каждые 5 минут ─────────────────────────────
const alertPrices = { BTCUSDT: [], ETHUSDT: [] };
const alertLastSent = { BTCUSDT: 0, ETHUSDT: 0 };
const alertSettings = { BTCUSDT: 3, ETHUSDT: 5 }; // пороги %

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

            if (Math.abs(change) >= threshold && now - alertLastSent[sym] > 7200000) {
                alertLastSent[sym] = now;
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
app.use(express.json());

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

// ── Запуск ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Thinking Trader server running on http://localhost:${PORT}`);
    console.log(`📦 Cache: prices 30s · charts 5m · news 15m · feargreed 30m · translate 24h`);

    // Автопостинг по расписанию
    scheduleDaily(7,  0, buildMorningPost,  '☀️ Утренний дайджест', buildMorningPostEN);
    scheduleDaily(13, 0, buildNoonPost,     '📰 Дневной срез',       buildNoonPostEN);
    scheduleDaily(19, 0, buildEveningPost,  '📊 Вечерний срез',      buildEveningPostEN);

    // Алерты каждые 5 минут
    setInterval(checkPriceAlerts, 5 * 60 * 1000);
    checkPriceAlerts(); // сразу при старте
    console.log(`🤖 Telegram bot активен · алерты каждые 5 мин`);

    // Серверная проверка пользовательских алертов каждые 30 сек
    if (adminDb) {
        setInterval(checkUserAlerts, 30 * 1000);
        checkUserAlerts();
        console.log('🔔 Серверные алерты активны · каждые 30 сек');
    }
});

// Firebase custom token endpoint
app.post('/api/customtoken', async (req, res) => {
    try {
        const { idToken } = req.body;
        if (!adminDb) return res.status(503).json({ error: 'Firebase Admin not initialized' });
        const adminLib = require('firebase-admin');
        const decoded = await adminLib.apps[0].auth().verifyIdToken(idToken);
        const customToken = await adminLib.apps[0].auth().createCustomToken(decoded.uid);
        res.json({ customToken });
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});
