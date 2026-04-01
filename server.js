require('dotenv').config();
const express = require('express');
const path    = require('path');

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
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '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';
const AI_MODEL = 'deepseek/deepseek-chat-v3-0324';
const AI_CACHE_TTL = 5 * 60 * 1000; // 5 минут

app.post('/api/ai-scan', async (req, res) => {
    try {
        const ctx = req.body;
        if (!ctx || !ctx.coin || !ctx.currentPrice) {
            return res.status(400).json({ error: 'Missing context data' });
        }

        // ── Серверный кэш: ключ = монета + таймфрейм + язык ──
        const cacheKey = `ai:${ctx.coin}:${ctx.timeframe}:${ctx.lang || 'ru'}`;
        const cached = cacheGet(cacheKey);
        if (cached) {
            console.log(`✅ AI Scanner cache hit: ${cacheKey}`);
            return res.json(cached);
        }

        const lang = ctx.lang === 'en' ? 'en' : 'ru';

        // Собираем системный промпт
        const systemPrompt = lang === 'en'
            ? `You are a crypto trader. User sends market data. Give a SPECIFIC analysis.

Answer format — 3 parts:

1. "situation" — What is ACTUALLY happening (1 sentence). No generic words like "weak trend".
   Describe specific facts: which patterns appeared, did they work or not, where price came from.
   Good: "Two bullish engulfings in 8 days — first failed, second still unconfirmed. Buyers trying but failing."
   Bad: "Price in range, weak trend."

2. "verdict" — What it means (1 sentence).
   If Long and Short are close (difference less than 15%) — write "Uncertainty — better not to enter".
   If one direction is clearly stronger — explain why.
   Example: "55/45 — uncertainty, no edge" or "70/30 Short — bearish trend and patterns failing".

3. Probabilities and levels — Long %, Short %, entry/target/stop for both.

Rules:
- Base on: distance to levels (risk/reward), 100-200d trend, last 5 candles structure, patterns and their results.
- If a bullish pattern failed (workedOut: false) — that's a bearish signal. And vice versa.
- For fresh patterns (workedOut: null, candlesAgo <= 2): use winRate as the signal strength. If winRate > 55% — treat it as a confirmed signal in that direction. If no winRate — treat as neutral.
- If difference Long/Short is less than 15% — it's uncertainty, say it directly.
- For 4H and 1H: consider anchor 1D levels. If local support coincides with 1D resistance — it's a trap, signal is weakened. 1D levels are more important than local ones.
- Specific prices. No fluff. No disclaimers.
- entry/target/stop must be NUMBERS ONLY. No words like "above", "below", "near" — just the number.

JSON format:
{"situation": "what is happening", "verdict": "what it means", "longPct": 35, "shortPct": 65, "long": {"entry": "69000", "target": "74000", "stop": "64000"}, "short": {"entry": "64000", "target": "60000", "stop": "68000"}}`

            : `Ты криптотрейдер. Пользователь шлёт данные рынка. Дай КОНКРЕТНЫЙ анализ.

Формат ответа — 3 части:

1. "situation" — Что РЕАЛЬНО происходит (1 предложение). Не общие слова типа "слабый тренд".
   Опиши конкретные факты: какие паттерны были, отработали или нет, откуда и куда шла цена.
   Пример хорошо: "Два бычьих поглощения за 8 дней — первое провалилось, второе пока без результата. Покупатели пытаются развернуть, но безуспешно."
   Пример плохо: "Цена в диапазоне, тренд слабый."

2. "verdict" — Что это значит (1 предложение).
   Если Long и Short близки (разница меньше 15%) — прямо пиши "Неопределённость — лучше не входить".
   Если одно направление явно сильнее — объясни почему.
   Пример: "55/45 — неопределённость, ни у кого нет преимущества" или "70/30 в пользу Short — тренд медвежий и паттерны не работают".

3. Вероятности и уровни — Long %, Short %, вход/цель/стоп для обоих.

Правила:
- Основывайся на: расстояние до уровней (risk/reward), тренд 100-200д, структура последних 5 свечей, паттерны и их результат.
- Если паттерн не отработал (workedOut: false) — это медвежий сигнал для бычьего паттерна и наоборот.
- Для свежих паттернов (workedOut: null, candlesAgo <= 2): используй winRate как силу сигнала. Если winRate > 55% — считай это подтверждённым сигналом в том направлении. Если winRate нет — считай нейтральным.
- Если разница Long/Short меньше 15% — это неопределённость, скажи это прямо.
- Для 4H и 1H: учитывай якорные 1D уровни. Если локальный support совпадает с 1D resistance — это ловушка, сигнал ослаблен. 1D уровни важнее локальных.
- Конкретные цены. Без воды. Без дисклеймеров.
- entry/target/stop — ТОЛЬКО ЧИСЛА. Никаких слов "выше", "ниже", "около" — только число.

JSON формат:
{"situation": "что происходит", "verdict": "что это значит", "longPct": 35, "shortPct": 65, "long": {"entry": "69000", "target": "74000", "stop": "64000"}, "short": {"entry": "64000", "target": "60000", "stop": "68000"}}`;

        // Собираем пользовательское сообщение с данными
        let userMsg = `Монета: ${ctx.coin}
Таймфрейм: ${ctx.timeframe}
Текущая цена: ${ctx.currentPrice}

Уровни:
- Поддержка: ${ctx.levels?.support || 'нет данных'}
- Сопротивление: ${ctx.levels?.resistance || 'нет данных'}
- Позиция цены в диапазоне: ${ctx.levels?.positionPct != null ? ctx.levels.positionPct + '%' : 'нет данных'}
- До поддержки: ${ctx.distanceToLevels?.toSupport != null ? ctx.distanceToLevels.toSupport + '%' : '?'}
- До сопротивления: ${ctx.distanceToLevels?.toResistance != null ? ctx.distanceToLevels.toResistance + '%' : '?'}

Тренд:
- Изменение за 100 дней: ${ctx.trend?.change100d != null ? ctx.trend.change100d + '%' : 'нет данных'}
- Изменение за 200 дней: ${ctx.trend?.change200d != null ? ctx.trend.change200d + '%' : 'нет данных'}

Последние 10 свечей:
- Направление: ${ctx.last10?.direction || 'нет данных'}
- Изменение: ${ctx.last10?.changePercent != null ? ctx.last10.changePercent + '%' : 'нет данных'}
- Зелёных: ${ctx.last10?.greenCandles ?? '?'}, Красных: ${ctx.last10?.redCandles ?? '?'}
- Последних подряд: ${ctx.last10?.consecutiveDirection || 'нет данных'}`;

        // Структура последних 5 свечей
        if (ctx.last5structure) {
            userMsg += `\n\nСтруктура последних 5 закрытых свечей (% изменения тела, + зелёная / - красная):`;
            userMsg += `\n[${ctx.last5structure.join('%, ')}%]`;
            // Подсказка для AI
            const greens = ctx.last5structure.filter(v => v > 0).length;
            const reds = ctx.last5structure.filter(v => v < 0).length;
            const avgBody = ctx.last5structure.reduce((s, v) => s + Math.abs(v), 0) / 5;
            userMsg += `\nЗелёных: ${greens}, красных: ${reds}, средний размер тела: ${avgBody.toFixed(1)}%`;
        }

        // Добавляем ВСЕ паттерны за последние 10 свечей
        if (ctx.recentPatterns && ctx.recentPatterns.length > 0) {
            userMsg += `\n\nПаттерны за последние 10 свечей (${ctx.recentPatterns.length} шт.):`;
            ctx.recentPatterns.forEach((p, i) => {
                const worked = p.workedOut === true ? '✅ отработал' : p.workedOut === false ? '❌ не отработал' : 'ещё рано оценивать';
                userMsg += `\n${i + 1}. ${p.type} (${p.direction}) — ${p.candlesAgo} свечей назад, close: ${p.patternClose}`;
                userMsg += `\n   Win rate: ${p.winRate != null ? p.winRate + '%' : 'нет данных'} | Результат: ${worked}`;
            });
        } else {
            userMsg += '\n\nПаттернов за последние 10 свечей нет.';
        }

        // Добавляем якорные уровни если есть (для 4H и 1H)
        if (ctx.anchorLevels) {
            userMsg += `

Якорные уровни (1D):
- 1D Поддержка: ${ctx.anchorLevels.support}
- 1D Сопротивление: ${ctx.anchorLevels.resistance}
- Позиция цены в 1D диапазоне: ${ctx.anchorLevels.positionPct}%`;
        }

        userMsg += '\n\nЧто делать прямо сейчас? Ответь в JSON.';

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
                max_tokens: 300,
            }),
            signal: AbortSignal.timeout(15000),
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
            result = {
                situation: parsed.situation,
                verdict: parsed.verdict || '',
                longPct: parseInt(parsed.longPct) || 50,
                shortPct: parseInt(parsed.shortPct) || 50,
                long: parsed.long || { entry: null, target: null, stop: null },
                short: parsed.short || { entry: null, target: null, stop: null },
            };
        } else if (parsed && (parsed.situation || parsed.text)) {
            result = {
                situation: parsed.situation || parsed.text || '',
                verdict: parsed.verdict || '',
                longPct: parseInt(parsed.longPct) || 50,
                shortPct: parseInt(parsed.shortPct) || 50,
                long: parsed.long || { entry: null, target: null, stop: null },
                short: parsed.short || { entry: null, target: null, stop: null },
            };
        } else {
            result = {
                situation: raw.slice(0, 200),
                verdict: '',
                longPct: 50,
                shortPct: 50,
                long: { entry: null, target: null, stop: null },
                short: { entry: null, target: null, stop: null },
            };
        }

        // Сохраняем в кэш
        cacheSet(cacheKey, result, AI_CACHE_TTL);
        console.log(`💾 AI Scanner cached: ${cacheKey} (TTL ${AI_CACHE_TTL / 1000}s)`);
        res.json(result);

    } catch (e) {
        console.error('❌ AI Scanner exception:', e.message);
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
        setInterval(checkUserAlerts, 30 * 1000);
        checkUserAlerts();
        console.log('🔔 Серверные алерты активны · каждые 30 сек');
    }
});


