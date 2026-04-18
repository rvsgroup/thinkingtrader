/* ══════════════════════════════════════════════════════════════
   BOT SERVER v2 — Thinking Trader
   Алго-скальпер на микроуровнях 5м таймфрейма
   
   Подключается в server.js одной строкой:
   require('./bot-server')(app);
   
   Логика:
   1. Загружает 200 пятиминутных свечей (≈17 часов истории)
   2. Находит микроуровни — зоны где цена разворачивалась 3+ раз
   3. Подключается к Binance WebSocket (5м свечи в реальном времени)
   4. Каждые 5 минут проверяет: цена у уровня + объём повышенный?
   5. Если да — входит в позицию (лонг у поддержки, шорт у сопротивления)
   6. Стоп за уровнем, тейк — следующий уровень
   7. Таймаут 30 минут — если позиция зависла, закрываем
   ══════════════════════════════════════════════════════════════ */

const WebSocket = require('ws');

module.exports = function(app) {

    /* ══════════════════════════════════════════
       ХРАНИЛИЩЕ СЕССИЙ
       uid → { settings, position, candles, levels, ... }
       В памяти — при рестарте сервера сбрасывается
    ══════════════════════════════════════════ */
    const sessions = new Map();  // key: "uid:botId"

    function ts() {
        return new Date().toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }

    // Полный лейбл бота (как в виджете клиента)
    function getFullBotLabel(session) {
        const s = '\u00b7'; // ·
        const pair = session.pair || '???';
        const strat = session.strategy === 'mean_reversion' ? 'MR' : 'SC';
        const tf = session.timeframe || '5m';
        const mode = session.entryMode === 'tick' ? 'T' : 'C';
        const dir = session.direction === 'long' ? 'L' : session.direction === 'short' ? 'S' : 'L+S';
        let extra = '';
        if (session.trailingEnabled) extra += ` ${s} TR`;
        if (session.bbExitEnabled) extra += ` ${s} BB`;
        if (session.clusterEntryFilter) extra += ` ${s} Cl`;
        if (session.rsiOversold || session.rsiOverbought) {
            extra += ` ${s} ${session.rsiOversold || 35}/${session.rsiOverbought || 65}`;
        }
        return `${pair} ${s} ${strat} ${s} ${tf} ${s} ${mode} ${s} ${dir}${extra}`;
    }

    // Получить список всех ботов пользователя
    function getUserBots(uid) {
        const bots = [];
        for (const [key, session] of sessions) {
            if (key.startsWith(uid + ':')) {
                const botId = key.split(':')[1];
                bots.push({
                    botId,
                    pair: session.pair,
                    strategy: session.strategy || 'scalper',
                    timeframe: session.timeframe,
                    running: session.running,
                    paused: session.paused,
                    mode: session.mode,
                    balance: Math.round(session.virtualBalance * 100) / 100,
                    dayPnl: Math.round(session.dayPnl * 100) / 100,
                    position: session.position ? session.position.side : null,
                    name: session.botName || null,
                    entryMode: session.entryMode || 'candle',
                    direction: session.direction || 'both',
                    trailingEnabled: session.trailingEnabled || false,
                    rsiOverbought: session.rsiOverbought || 65,
                    rsiOversold: session.rsiOversold || 35,
                    clusterEntryFilter: session.clusterEntryFilter || false,
                    bbExitEnabled: session.bbExitEnabled || false,
                    notifyEnabled: session.notifyEnabled !== false,
                });
            }
        }
        return bots;
    }

    /* ══════════════════════════════════════════
       PUSH-УВЕДОМЛЕНИЯ
       - closePosition → пуш о сделке
       - checkLimits   → пуш о остановке бота
       Использует global.sendPushToUser из server.js
    ══════════════════════════════════════════ */

    // Краткое обозначение причины закрытия сделки для title
    function reasonToShort(reason) {
        switch (reason) {
            case 'take_profit':   return 'TP';
            case 'stop_loss':     return 'SL';
            case 'trailing_stop': return 'Trail';
            case 'timeout':       return 'Timeout';
            case 'cluster_exit':  return 'Cluster';
            case 'bb_touch':      return 'BB';
            case 'sma_return':    return 'SMA';
            case 'manual_close':  return 'Ручное';
            case 'manual_stop':   return 'Ручное';
            default:              return reason || '—';
        }
    }

    // Форматирование денег: +$4.20 / −$12.80
    function fmtMoney(v) {
        const abs = Math.abs(v);
        const sign = v >= 0 ? '+' : '−';
        return sign + '$' + abs.toFixed(2);
    }

    // Отправка push-уведомления о закрытой сделке
    async function pushTradeClosed(session, trade) {
        if (!session || session.notifyEnabled === false) return;
        if (session._silentStop) return;  // во время массового стопа — молчим
        if (typeof global.sendPushToUser !== 'function') return;
        if (!session.uid) return;
        try {
            const arrow = trade.pnl >= 0 ? '\u25B2' : '\u25BC';  // ▲ / ▼
            const reasonShort = reasonToShort(trade.reason);
            const pnlStr = fmtMoney(trade.pnl);
            const pctStr = (trade.pnlPct >= 0 ? '+' : '') + trade.pnlPct.toFixed(2) + '%';

            const title = `${arrow} ${session.pair} ${pnlStr} (${pctStr}) \u00B7 ${reasonShort}`;
            const subtitle = getFullBotLabel(session);

            // body: время в позиции + RR если посчитан
            const bodyParts = [];
            if (trade.durationMin != null) bodyParts.push(`${trade.durationMin} мин`);
            if (trade.riskReward)          bodyParts.push(`RR 1:${trade.riskReward.toFixed(1)}`);
            const body = bodyParts.join(' \u00B7 ');

            await global.sendPushToUser(session.uid, title, body, {
                subtitle,
                link: '/app#journal',   // клик → сайт, журнал сделок
                tag:  `bot-trade-${session.botId}-${trade.id}`,  // уникальный тег, не перетирать
            });
        } catch (e) {
            console.warn('[BOT] push trade error:', e.message);
        }
    }

    // Отправка push-уведомления о остановке бота
    async function pushBotStopped(session, cause) {
        // cause: { type: 'consec_losses'|'day_limit'|'manual', value?: number }
        if (!session || session.notifyEnabled === false) return;
        if (session._silentStop) return;  // во время массового стопа — молчим
        if (typeof global.sendPushToUser !== 'function') return;
        if (!session.uid) return;
        try {
            let title;
            if (cause.type === 'consec_losses') {
                title = `Бот остановлен: ${cause.value} убытка подряд`;
            } else if (cause.type === 'day_limit') {
                title = `Бот остановлен: дневной лимит ${fmtMoney(cause.value)}`;
            } else {
                title = 'Бот остановлен вручную';
            }
            const subtitle = getFullBotLabel(session);
            const body = `день ${fmtMoney(session.dayPnl || 0)}`;

            await global.sendPushToUser(session.uid, title, body, {
                subtitle,
                link: '/app#journal',
                tag:  `bot-stop-${session.botId}-${Date.now()}`,
            });
        } catch (e) {
            console.warn('[BOT] push stop error:', e.message);
        }
    }

    function getSession(uid, botId) {
        const key = uid + ':' + botId;
        if (!sessions.has(key)) {
            sessions.set(key, {
                // ── Идентификация ──
                uid:           uid,         // владелец — нужен для push-уведомлений
                botId:         botId,
                botName:       null,        // пользовательское имя бота
                // ── Статус ──
                running:       false,
                paused:        false,
                mode:          null,        // 'paper' | 'live'
                market:        'futures',   // 'futures' | 'spot'

                // ── Настройки пары ──
                pair:          'BTC/USDT',  // отображение
                symbol:        'BTCUSDT',   // для Binance API
                timeframe:     '5m',        // '1m' | '5m'
                binanceInterval: '5m',      // для WebSocket и REST

                // ── Настройки алгоритма ──
                levelTouches:  3,           // мин. касаний для уровня
                levelTolerance: 0.0005,     // ±0.05% зона уровня
                volumeMultiplier: 1.5,      // объём текущей свечи / средний
                positionTimeout: 6,         // таймаут в свечах
                stopOffsetPct: 0.001,       // стоп за уровнем (0.1%)
                candlesForLevels: 200,      // свечей для расчёта уровней
                candlesForVolume: 20,       // свечей для среднего объёма

                // ── Риск-менеджмент ──
                riskPct:       2,           // % от депозита на сделку
                dayLimitPct:   5,           // макс. дневной убыток в %
                maxLosses:     3,           // пауза после N убытков подряд
                maxLeverage:   5,           // макс. плечо (1-10)

                // ── Таргет-профит ──
                minProfitPct:    0.15,      // мин. профит для входа (вшит, 0.15%)
                maxProfitPct:    1.0,       // макс. тейк-профит (% от цены, настраивается)
                cooldownCandles: 5,         // cooldown после закрытия (в свечах)
                stopAtrMultiplier: 1.5,    // множитель ATR для стопа (1.5 = 1.5x ATR)

                // ── Кластерный анализ ──
                clusterEnabled:  true,      // вкл/выкл кластерный анализ
                clusterLookback: null,      // кол-во свечей для фона (null = авто: 5 для 1m, 10 для 5m)
                clusterThreshold: 80,       // порог доминирования (60 = 60/40)
                clusterExitConfirm: 1,      // свечей подтверждения для выхода по кластерам

                // ── Трейлинг-стоп ──
                trailingEnabled: false,     // вкл/выкл
                trailingOffset:  0.25,      // отступ трейла (% от цены)
                trailingActivation: 70,     // активация после N% пути до тейка

                // ── Выход по противоположной полосе Боллинджера (только для MR) ──
                bbExitEnabled:       false,  // если true — игнорируется minProfit и trailing
                bbExitTolerance:     5,      // % от ширины канала: насколько не дотягивать до ББ считать касанием
                smaReturnTolerance:  5,      // % от ширины канала: глубина захода за SMA для поднятия флага wasBeyondSma

                // ── Push-уведомления ──
                notifyEnabled:   true,      // уведомлять о закрытии сделок и остановке бота

                // ── Баланс (paper trading) ──
                virtualBalance: 10000,
                startBalance:   10000,

                // ── Состояние ──
                position:      null,        // текущая позиция
                trades:        [],          // история сделок
                consecutiveLosses: 0,
                dayPnl:        0,
                dayStartDate:  null,
                cooldownUntil: 0,           // свечей до следующего входа        // дата для сброса дневного PnL

                // ── Данные рынка ──
                candles:       [],          // массив 5м свечей
                levels:        [],          // найденные микроуровни
                currentPrice:  0,           // последняя цена
                candleCount:   0,           // счётчик свечей с момента открытия позиции

                // ── WebSocket ──
                ws:            null,
                wsReconnectTimer: null,
                lastCandleTime: 0,          // время последней закрытой свечи

                // ── Bybit API (для live) ──
                apiKey:        '',
                apiSecret:     '',
            });
        }
        return sessions.get(key);
    }


    /* ══════════════════════════════════════════
       1. ЗАГРУЗКА ИСТОРИЧЕСКИХ СВЕЧЕЙ
       REST API Binance — до 1000 свечей за запрос
    ══════════════════════════════════════════ */

    async function loadHistoricalCandles(symbol, interval = '5m', limit = 200) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!Array.isArray(data)) {
                console.error('[BOT] Invalid klines response:', data);
                return [];
            }

            return data.map(k => ({
                time:    Math.floor(k[0] / 1000),  // unix timestamp в секундах
                open:    parseFloat(k[1]),
                high:    parseFloat(k[2]),
                low:     parseFloat(k[3]),
                close:   parseFloat(k[4]),
                volume:  parseFloat(k[5]),
                buyVolume: parseFloat(k[9] || 0),   // taker buy base asset volume
                closed:  true,                      // историческая = закрытая
            }));
        } catch(e) {
            console.error('[BOT] Failed to load historical candles:', e.message);
            return [];
        }
    }

    /**
     * Получает buyVolume последней закрытой свечи через REST API
     * Binance klines field [9] = taker buy base asset volume
     * Таймаут 2 секунды — если не ответил, fallback на эвристику
     */
    async function fetchLastCandleBuyVolume(symbol, interval) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);

            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=2`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            const data = await res.json();
            if (!Array.isArray(data) || data.length < 2) return 0;

            // Предпоследняя свеча — это только что закрытая (последняя ещё формируется)
            const lastClosed = data[data.length - 2];
            return parseFloat(lastClosed[9] || 0);
        } catch(e) {
            // Таймаут или ошибка — не критично, используем fallback
            return 0;
        }
    }


    /* ══════════════════════════════════════════
       2. ПОИСК МИКРОУРОВНЕЙ
       Ищем зоны где цена разворачивалась 3+ раз
    ══════════════════════════════════════════ */

    function findMicroLevels(candles, minTouches = 3, tolerance = 0.0005, currentPrice = 0) {
        if (candles.length < 30) return [];

        // ── Шаг 1: находим все точки разворота (pivot points) ──
        // Локальный максимум: high свечи выше high обеих соседних свечей
        // Локальный минимум: low свечи ниже low обеих соседних свечей
        const pivots = [];

        for (let i = 2; i < candles.length - 2; i++) {
            const c = candles[i];

            // Локальный максимум (проверяем 2 свечи в каждую сторону)
            const isHigh = c.high > candles[i-1].high && c.high > candles[i+1].high
                        && c.high >= candles[i-2].high && c.high >= candles[i+2].high;

            // Локальный минимум
            const isLow = c.low < candles[i-1].low && c.low < candles[i+1].low
                       && c.low <= candles[i-2].low && c.low <= candles[i+2].low;

            if (isHigh) pivots.push({ price: c.high, index: i, type: 'high' });
            if (isLow)  pivots.push({ price: c.low,  index: i, type: 'low' });
        }

        if (pivots.length < 3) return [];

        // ── Шаг 2: группируем близкие pivot-ы в кластеры ──
        // Точки с разницей ≤ tolerance (0.05%) считаются одним уровнем
        const used = new Set();
        const clusters = [];

        for (let i = 0; i < pivots.length; i++) {
            if (used.has(i)) continue;

            const cluster = [pivots[i]];
            used.add(i);

            for (let j = i + 1; j < pivots.length; j++) {
                if (used.has(j)) continue;

                const diff = Math.abs(pivots[i].price - pivots[j].price) / pivots[i].price;
                if (diff <= tolerance) {
                    cluster.push(pivots[j]);
                    used.add(j);
                }
            }

            clusters.push(cluster);
        }

        // ── Шаг 3: фильтруем — только кластеры с 3+ касаниями ──
        const levels = [];

        for (const cluster of clusters) {
            if (cluster.length < minTouches) continue;

            // Средняя цена кластера
            const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;

            // Тип определяется позже, после получения текущей цены

            // Последнее касание (индекс самой свежей свечи в кластере)
            const lastTouch = Math.max(...cluster.map(p => p.index));

            levels.push({
                price:     Math.round(avgPrice * 100) / 100,
                touches:   cluster.length,
                type:      null, // определим ниже
                lastTouch: lastTouch,
                strength:  cluster.length >= 5 ? 'strong' : 'normal',
            });
        }

        // ── Шаг 4: убираем дубликаты (уровни слишком близко друг к другу) ──
        // Если два уровня ближе чем 0.1% — оставляем тот, у которого больше касаний
        const merged = [];
        const sortedLevels = levels.sort((a, b) => a.price - b.price);

        for (const level of sortedLevels) {
            const existing = merged.find(m =>
                Math.abs(m.price - level.price) / m.price < 0.001 // 0.1%
            );

            if (existing) {
                // Оставляем более сильный
                if (level.touches > existing.touches) {
                    Object.assign(existing, level);
                }
            } else {
                merged.push({ ...level });
            }
        }

        // ── Шаг 5: анализируем направление касаний для каждого уровня ──
        // Проходим по ВСЕМ свечам и считаем: сколько касаний сверху, сколько снизу
        const price = currentPrice > 0
            ? currentPrice
            : (candles.length > 0 ? candles[candles.length - 1].close : 0);

        for (const level of merged) {
            let fromAbove = 0;  // цена пришла сверху (поддержка)
            let fromBelow = 0;  // цена пришла снизу (сопротивление)
            let bounceUp = 0;   // отскочила вверх после касания
            let bounceDown = 0; // отскочила вниз после касания

            const zoneTol = level.price * tolerance;

            for (let i = 1; i < candles.length; i++) {
                const c = candles[i];
                const prev = candles[i - 1];

                // Свеча касается зоны уровня?
                const touched = c.low <= level.price + zoneTol && c.high >= level.price - zoneTol;
                if (!touched) continue;

                // Откуда пришла цена?
                const prevMid = (prev.open + prev.close) / 2;
                if (prevMid > level.price) {
                    fromAbove++;
                } else {
                    fromBelow++;
                }

                // Куда ушла после касания?
                if (c.close > level.price + zoneTol) bounceUp++;
                else if (c.close < level.price - zoneTol) bounceDown++;
            }

            const totalTouches = fromAbove + fromBelow;

            level.touchesFromAbove = fromAbove;
            level.touchesFromBelow = fromBelow;
            level.totalTouches     = totalTouches;
            level.bounceUp         = bounceUp;
            level.bounceDown       = bounceDown;
            level.bounceRate       = totalTouches > 0
                ? Math.round((Math.max(bounceUp, bounceDown) / totalTouches) * 100)
                : 0;

            // Тип уровня ВСЕГДА определяется по текущей цене:
            // выше цены = сопротивление, ниже = поддержка
            // (бывшее сопротивление после пробоя становится поддержкой — классика)
            level.type = level.price >= price ? 'resistance' : 'support';

            // Обновляем strength с учётом реальных касаний
            level.strength = totalTouches >= 10 ? 'strong' : (totalTouches >= 5 ? 'normal' : 'weak');
        }

        return merged.sort((a, b) => a.price - b.price);
    }


    /* ══════════════════════════════════════════
       3. ПРОВЕРКА ОБЪЁМА
       Текущий объём vs средний за N свечей
    ══════════════════════════════════════════ */

    function isVolumeConfirmed(candles, multiplier = 1.5, lookback = 20) {
        if (candles.length < lookback + 1) return false;

        // Последняя ЗАКРЫТАЯ свеча (не текущая формирующаяся)
        const current = candles[candles.length - 1];
        if (!current.closed) return false;

        // Средний объём за предыдущие N свечей
        const prevCandles = candles.slice(-(lookback + 1), -1);
        const avgVolume = prevCandles.reduce((sum, c) => sum + c.volume, 0) / prevCandles.length;

        if (avgVolume === 0) return false;

        const ratio = current.volume / avgVolume;
        return ratio >= multiplier;
    }


    /* ══════════════════════════════════════════
       4. КЛАСТЕРНЫЙ АНАЛИЗ СВЕЧИ
       Определяем кто доминирует: покупатели или продавцы
    ══════════════════════════════════════════ */

    /**
     * Анализирует одну свечу — возвращает % покупателей
     * Использует buyVolume (taker buy) из Binance если доступен
     * Fallback: body heuristic
     */
    function analyzeCandleCluster(candle) {
        if (!candle || candle.volume <= 0) return 50;

        // PRIMARY: реальная дельта из Binance
        if (candle.buyVolume > 0 && candle.buyVolume <= candle.volume) {
            return (candle.buyVolume / candle.volume) * 100;
        }

        // FALLBACK: body + shadow heuristic
        const range = candle.high - candle.low;
        if (range <= 0) return 50;

        const bodyTop = Math.max(candle.open, candle.close);
        const bodyBottom = Math.min(candle.open, candle.close);
        const lowerWick = bodyBottom - candle.low;
        const upperWick = candle.high - bodyTop;
        const isBullish = candle.close >= candle.open;

        // Нижняя тень = покупатели оттолкнули, верхняя = продавцы оттолкнули
        const totalWick = lowerWick + upperWick || 1;
        let buyPct = (lowerWick / totalWick) * 50 + (isBullish ? 55 : 45);
        return Math.max(0, Math.min(100, buyPct));
    }

    /**
     * Анализирует массив свечей — возвращает кто доминирует
     * @returns {{ buyPct, sellPct, concentration, trend }}
     */
    function analyzeClusterGroup(candles, threshold = 60) {
        if (!candles || candles.length === 0) return { buyPct: 50, sellPct: 50, concentration: 'mixed', trend: 'stable' };

        let totalBuyPct = 0;
        let count = 0;

        for (const c of candles) {
            const bp = analyzeCandleCluster(c);
            totalBuyPct += bp;
            count++;
        }

        const avgBuyPct = count > 0 ? Math.round(totalBuyPct / count) : 50;
        const avgSellPct = 100 - avgBuyPct;

        let concentration;
        if (avgBuyPct >= threshold) concentration = 'buyers';
        else if (avgSellPct >= threshold) concentration = 'sellers';
        else concentration = 'mixed';

        // Тренд: сравниваем первую и вторую половину
        let trend = 'stable';
        if (candles.length >= 4) {
            const half = Math.floor(candles.length / 2);
            const firstHalf = candles.slice(0, half);
            const secondHalf = candles.slice(half);

            let firstBuy = 0, secondBuy = 0;
            firstHalf.forEach(c => { firstBuy += analyzeCandleCluster(c); });
            secondHalf.forEach(c => { secondBuy += analyzeCandleCluster(c); });

            firstBuy /= firstHalf.length;
            secondBuy /= secondHalf.length;

            if (secondBuy - firstBuy > 5) trend = 'buyers_increasing';
            else if (firstBuy - secondBuy > 5) trend = 'buyers_decreasing';
        }

        return { buyPct: avgBuyPct, sellPct: avgSellPct, concentration, trend };
    }

    /**
     * Проверяет кластерное подтверждение для входа.
     * Два пути (хотя бы один должен пройти):
     *
     * ПУТЬ 1 — Плавное затухание (3 свечи):
     *   Фон подтверждает → мягкий режим (блокируем только при наращивании ≥3%)
     *   Фон против → строгий режим (затухание ≥2% на каждом шаге)
     *
     * ПУТЬ 2 — Резкий перелом (2 свечи):
     *   Предпоследняя свеча сильно в одну сторону (≥60%),
     *   последняя резко переключилась: противник ≥70%.
     *   Не нужна ступенчатая проверка — сам перелом достаточен.
     *
     * @param {Array} closedCandles
     * @param {string} side — 'SHORT' или 'LONG'
     * @param {number} bgBuyPct — buyPct фона
     * @returns {{ fading: boolean, detail: string, values: number[] }}
     */
    function checkClusterFading(closedCandles, side, bgBuyPct) {
        if (!closedCandles || closedCandles.length < 2) {
            return { fading: false, detail: 'not enough candles', values: [] };
        }

        const c2 = closedCandles[closedCandles.length - 2];
        const c1 = closedCandles[closedCandles.length - 1];
        const bp2 = Math.round(analyzeCandleCluster(c2) * 10) / 10;
        const bp1 = Math.round(analyzeCandleCluster(c1) * 10) / 10;
        const values = [bp2, bp1];

        // ── Резкий перелом (2 свечи) ──
        if (side === 'SHORT') {
            // Предпоследняя: покупатели ≥ 60%, последняя: продавцы ≥ 70% (buy ≤ 30%)
            if (bp2 >= 60 && bp1 <= 30) {
                return { fading: true, detail: `⚡ SHARP reversal SHORT: ${bp2}%→${bp1}% (Δ${(bp2-bp1).toFixed(0)}%)`, values };
            }
        }
        if (side === 'LONG') {
            // Предпоследняя: продавцы ≥ 60% (buy ≤ 40%), последняя: покупатели ≥ 65%
            if (bp2 <= 40 && bp1 >= 65) {
                return { fading: true, detail: `⚡ SHARP reversal LONG: ${bp2}%→${bp1}% (Δ${(bp1-bp2).toFixed(0)}%)`, values };
            }
        }

        return { fading: false, detail: `no sharp reversal: ${bp2}%→${bp1}%`, values };
    }


    /* ══════════════════════════════════════════
       5. ATR — Average True Range
       Адаптивный стоп на основе волатильности
    ══════════════════════════════════════════ */

    function calcATR(candles, period = 20) {
        const closed = candles.filter(c => c.closed);
        if (closed.length < period + 1) return 0;

        const recent = closed.slice(-(period + 1));
        let sumTR = 0;

        for (let i = 1; i < recent.length; i++) {
            const high = recent[i].high;
            const low = recent[i].low;
            const prevClose = recent[i - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            sumTR += tr;
        }

        return sumTR / period;
    }


    /* ══════════════════════════════════════════
       5b. BOLLINGER BANDS + RSI
       Для стратегии Mean Reversion
    ══════════════════════════════════════════ */

    function calcBollingerBands(candles, period = 20, multiplier = 2.0) {
        if (candles.length < period) return null;
        const closes = candles.slice(-period).map(c => c.close);
        const sma = closes.reduce((s, v) => s + v, 0) / period;
        const variance = closes.reduce((s, v) => s + (v - sma) ** 2, 0) / period;
        const stdDev = Math.sqrt(variance);
        return {
            upper: sma + multiplier * stdDev,
            middle: sma,
            lower: sma - multiplier * stdDev,
            stdDev,
        };
    }

    function calcRSI(candles, period = 14) {
        if (candles.length < period + 1) return 50;
        const closes = candles.slice(-(period + 1)).map(c => c.close);
        let gains = 0, losses = 0;
        for (let i = 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    function checkSignalMeanReversion(session) {
        const { candles, market } = session;
        if (candles.length < 30) return null;

        const lastCandle = candles[candles.length - 1];
        if (!lastCandle.closed) return null;

        const price = lastCandle.close;

        // ── Bollinger Bands ──
        const bbPeriod = session.bbPeriod || 20;
        const bbMult = session.bbMultiplier || 2.0;
        const closedCandles = candles.filter(c => c.closed);
        const bb = calcBollingerBands(closedCandles, bbPeriod, bbMult);
        if (!bb) return null;

        // ── RSI ──
        const rsiPeriod = session.rsiPeriod || 14;
        const rsi = calcRSI(closedCandles, rsiPeriod);
        const rsiOverbought = session.rsiOverbought || 65;
        const rsiOversold = session.rsiOversold || 35;

        // ── Определяем сигнал ──
        let side = null;

        // Позиция в канале: 0% = нижняя полоса, 100% = верхняя полоса
        const bbRange = bb.upper - bb.lower;
        const channelPct = bbRange > 0 ? ((price - bb.lower) / bbRange) * 100 : 50;

        // Вход разрешён от 95% канала (не строго за полосой)
        if (channelPct >= 95 && rsi >= rsiOverbought) {
            side = 'SHORT';
        } else if (channelPct <= 5 && rsi <= rsiOversold) {
            side = 'LONG';
        }

        if (!side) return null;
        if (market === 'spot' && side === 'SHORT') return null;

        // ── Фильтр направления ──
        if (session.direction === 'long' && side === 'SHORT') return null;
        if (session.direction === 'short' && side === 'LONG') return null;

        // ── Кластерный фильтр при входе (если включён) ──
        if (session.clusterEntryFilter) {
            const closedForCluster = candles.filter(c => c.closed);

            // 1) Фон
            const bgCandles = closedForCluster.slice(-(session.clusterLookback || 10));
            const bg = analyzeClusterGroup(bgCandles, 60);

            // Фон блокирует только если явно против (без резкого перелома)
            const bgAgainst = (side === 'SHORT' && bg.buyPct > 50) || (side === 'LONG' && bg.buyPct < 50);

            // 2) Затухание / резкий перелом
            const fading = checkClusterFading(closedForCluster, side, bg.buyPct);

            if (!fading.fading) {
                // Если фон тоже против — точно не входим
                if (bgAgainst) {
                    console.log(`[BOT] ⏳ Cluster: bg against + no fading for ${side}: ${fading.detail}`);
                    return null;
                }
                // Фон за нас, но нет затухания — тоже не входим (ждём подтверждения)
                console.log(`[BOT] ⏳ Cluster fading NOT confirmed for ${side}: ${fading.detail}`);
                return null;
            }
            console.log(`[BOT] ✅ Cluster confirmed for ${side}: ${fading.detail}`);
        }

        // ── Таргет = максимум из SMA и минимального профита из настроек ──
        const smaTarget = Math.round(bb.middle * 100) / 100;
        const minProfitPct = session.maxProfitPct || 1.0;
        const minTarget = side === 'LONG'
            ? Math.round(price * (1 + minProfitPct / 100) * 100) / 100
            : Math.round(price * (1 - minProfitPct / 100) * 100) / 100;
        const target = side === 'LONG'
            ? Math.max(smaTarget, minTarget)
            : Math.min(smaTarget, minTarget);

        // ── Стоп = за полосой + ATR × множитель ──
        const atr = calcATR(candles, 20);
        if (atr <= 0) return null;

        const stopAtrDist = atr * (session.stopAtrMultiplier || 1.5);
        const stop = side === 'LONG'
            ? Math.round((bb.lower - stopAtrDist) * 100) / 100
            : Math.round((bb.upper + stopAtrDist) * 100) / 100;

        const risk = Math.abs(price - stop);
        const reward = Math.abs(target - price);
        if (risk === 0 || reward / risk < 1.0) return null;

        const potentialProfitPct = reward / price * 100;
        const feePct = 0.11;
        if (potentialProfitPct - feePct < (session.minProfitPct || 0.15)) return null;

        return {
            side,
            entry: price,
            stop,
            target,
            atr: Math.round(atr * 100) / 100,
            riskReward: Math.round((reward / risk) * 100) / 100,
            rsi: Math.round(rsi * 10) / 10,
            bbUpper: Math.round(bb.upper * 100) / 100,
            bbMiddle: Math.round(bb.middle * 100) / 100,
            bbLower: Math.round(bb.lower * 100) / 100,
            volumeRatio: Math.round(
                (lastCandle.volume / (candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20)) * 100
            ) / 100,
        };
    }


    /* ══════════════════════════════════════════
       Вход по тику для Mean Reversion
    ══════════════════════════════════════════ */
    function checkTickEntry(session, price) {
        if (!price || price <= 0) return;
        if (session.position) return;

        // Throttle: не чаще раза в 5 секунд
        const now = Date.now();
        if (session._lastTickCheck && now - session._lastTickCheck < 5000) return;
        session._lastTickCheck = now;

        const { candles, market } = session;
        const closedCandles = candles.filter(c => c.closed);
        if (closedCandles.length < 30) return;

        // ── Bollinger Bands (по закрытым свечам) ──
        const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
        if (!bb) return;

        // ── RSI (по закрытым свечам) ──
        const rsi = calcRSI(closedCandles, session.rsiPeriod || 14);
        const rsiOverbought = session.rsiOverbought || 65;
        const rsiOversold = session.rsiOversold || 35;

        // ── Сигнал ──
        let side = null;
        const bbRange = bb.upper - bb.lower;
        const channelPct = bbRange > 0 ? ((price - bb.lower) / bbRange) * 100 : 50;

        if (channelPct >= 95 && rsi >= rsiOverbought) {
            side = 'SHORT';
        } else if (channelPct <= 5 && rsi <= rsiOversold) {
            side = 'LONG';
        }
        if (!side) return;

        if (market === 'spot' && side === 'SHORT') return;
        if (session.direction === 'long' && side === 'SHORT') return;
        if (session.direction === 'short' && side === 'LONG') return;

        // ── Кластерный фильтр при входе (если включён) ──
        if (session.clusterEntryFilter) {
            const bgCandles = closedCandles.slice(-(session.clusterLookback || 10));
            const bg = analyzeClusterGroup(bgCandles, 60);
            const fading = checkClusterFading(closedCandles, side, bg.buyPct);
            if (!fading.fading) return;
        }

        // ── Таргет = макс(SMA, минимальный профит) ──
        const smaTarget = Math.round(bb.middle * 100) / 100;
        const minProfitPct = session.maxProfitPct || 1.0;
        const minTarget = side === 'LONG'
            ? Math.round(price * (1 + minProfitPct / 100) * 100) / 100
            : Math.round(price * (1 - minProfitPct / 100) * 100) / 100;
        const target = side === 'LONG'
            ? Math.max(smaTarget, minTarget)
            : Math.min(smaTarget, minTarget);

        // ── Стоп ──
        const atr = calcATR(candles, 20);
        if (atr <= 0) return;
        const stopAtrDist = atr * (session.stopAtrMultiplier || 1.5);
        const stop = side === 'LONG'
            ? Math.round((bb.lower - stopAtrDist) * 100) / 100
            : Math.round((bb.upper + stopAtrDist) * 100) / 100;

        // ── R:R и мин. профит ──
        const risk = Math.abs(price - stop);
        const reward = Math.abs(target - price);
        if (risk === 0 || reward / risk < 1.0) return;
        const potentialProfitPct = reward / price * 100;
        if (potentialProfitPct - 0.11 < (session.minProfitPct || 0.15)) return;

        const signal = {
            side,
            entry: price,
            stop,
            target,
            atr: Math.round(atr * 100) / 100,
            riskReward: Math.round((reward / risk) * 100) / 100,
            rsi: Math.round(rsi * 10) / 10,
            bbUpper: Math.round(bb.upper * 100) / 100,
            bbMiddle: Math.round(bb.middle * 100) / 100,
            bbLower: Math.round(bb.lower * 100) / 100,
            volumeRatio: 0,
            concentration: 'tick',
        };

        openPosition(session, signal);
    }


    /* ══════════════════════════════════════════
       6. ГЕНЕРАЦИЯ СИГНАЛА
       Кластерный анализ + объём (уровни — для выхода)
    ══════════════════════════════════════════ */

    function checkSignal(session) {
        const { candles, levels, market } = session;

        if (candles.length < 30) return null;

        // Последняя закрытая свеча
        const lastCandle = candles[candles.length - 1];
        if (!lastCandle.closed) return null;

        const price = lastCandle.close;

        // ── Проверяем объём — без повышенного объёма не входим ──
        if (!isVolumeConfirmed(candles, session.volumeMultiplier, session.candlesForVolume)) {
            return null;
        }

        // ── Кластерный анализ ──
        const lookback = session.clusterLookback || 5;
        const threshold = session.clusterThreshold || 80;
        const closedCandles = candles.filter(c => c.closed);

        // Анализ текущей свечи (триггер)
        const triggerBuyPct = analyzeCandleCluster(lastCandle);

        // Анализ фона (последние N свечей)
        const bgCandles = closedCandles.slice(-lookback);
        const background = analyzeClusterGroup(bgCandles, threshold);

        // ── Определяем направление по кластерам ──
        let side = null;

        // Кластер текущей свечи определяет направление
        const triggerBuyers = triggerBuyPct >= threshold;
        const triggerSellers = (100 - triggerBuyPct) >= threshold;

        // Фон (background) должен ПОДТВЕРЖДАТЬ направление с перевесом ≥ 60%:
        // - Для LONG:  быки в фоне ≥ 60%  (buyPct >= 60)
        // - Для SHORT: медведи в фоне ≥ 60% (buyPct <= 40, т.е. sellPct >= 60)
        const bgConfirmLong  = background.buyPct >= 60;
        const bgConfirmShort = background.buyPct <= 40; // sellPct >= 60

        if (triggerBuyers && bgConfirmLong) {
            side = 'LONG';
        } else if (triggerSellers && bgConfirmShort) {
            side = 'SHORT';
        }

        // Проверяем тренд: если сила угасает — не входим
        if (side === 'LONG' && background.trend === 'buyers_decreasing') side = null;
        if (side === 'SHORT' && background.trend === 'buyers_increasing') side = null;

        if (!side) return null;

        // На споте нельзя шортить
        if (market === 'spot' && side === 'SHORT') return null;

        // ── Фильтр направления ──
        if (session.direction === 'long' && side === 'SHORT') return null;
        if (session.direction === 'short' && side === 'LONG') return null;

        // ── ATR-based стоп ──
        const atr = calcATR(candles, 20);
        if (atr <= 0) return null;

        const stopDist = atr * (session.stopAtrMultiplier || 1.5);
        const stop = side === 'LONG'
            ? price - stopDist
            : price + stopDist;

        // ── Таргет = maxProfitPct от цены входа ──
        const tp = side === 'LONG'
            ? price * (1 + session.maxProfitPct / 100)
            : price * (1 - session.maxProfitPct / 100);

        // ── Проверяем минимальный профит после комиссии ──
        const potentialProfitPct = Math.abs(tp - price) / price * 100;
        const feePct = 0.11; // ~0.11% round-trip
        const netProfitPct = potentialProfitPct - feePct;
        if (netProfitPct < session.minProfitPct) return null;

        // Проверяем R:R (минимум 1:1)
        const risk   = Math.abs(price - stop);
        const reward = Math.abs(tp - price);
        if (risk === 0 || reward / risk < 1.0) return null;

        // Ближайший уровень (информационно, не обязательно)
        let nearestLevel = null;
        let minLevelDist = Infinity;
        for (const level of levels) {
            const dist = Math.abs(price - level.price) / level.price;
            if (dist < minLevelDist) { minLevelDist = dist; nearestLevel = level; }
        }

        return {
            side,
            entry:     price,
            stop:      Math.round(stop * 100) / 100,
            target:    Math.round(tp * 100) / 100,
            atr:       Math.round(atr * 100) / 100,
            level:     nearestLevel, // для лога, не для решения
            riskReward: Math.round((reward / risk) * 100) / 100,
            triggerBuyPct: Math.round(triggerBuyPct),
            backgroundBuyPct: background.buyPct,
            concentration: background.concentration,
            volumeRatio: Math.round(
                (lastCandle.volume / (candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20)) * 100
            ) / 100,
        };
    }


    /* ══════════════════════════════════════════
       5. УПРАВЛЕНИЕ ПОЗИЦИЕЙ
       Открытие, закрытие, трейлинг, таймаут
    ══════════════════════════════════════════ */

    function calcPositionSize(session, entry, stop) {
        const riskAmount = session.virtualBalance * (session.riskPct / 100);
        const stopDist = Math.abs(entry - stop) / entry;
        if (stopDist === 0) return 0;
        let size = riskAmount / stopDist;

        // Ограничение плеча: maxLeverage для фьючерсов, 1x для спота
        const maxLev = session.market === 'spot' ? 1 : (session.maxLeverage || 5);
        const maxSize = session.virtualBalance * maxLev;
        if (size > maxSize) size = maxSize;

        console.log(`[BOT ${ts()}] 📐 Position size: balance=$${session.virtualBalance.toFixed(2)} risk=${session.riskPct}% riskAmt=$${riskAmount.toFixed(2)} entry=${entry} stop=${stop} stopDist=${(stopDist*100).toFixed(4)}% rawSize=$${(riskAmount/stopDist).toFixed(2)} maxLev=${maxLev}x maxSize=$${maxSize.toFixed(2)} → size=$${size.toFixed(2)}`);

        return size;
    }

    function openPosition(session, signal) {
        if (session.position) return; // уже есть открытая

        const size = calcPositionSize(session, signal.entry, signal.stop);
        if (size <= 0) return;

        session.position = {
            side:       signal.side,
            entryPrice: signal.entry,
            stop:       signal.stop,
            target:     signal.target,
            size:       size,
            openedAt:   Date.now(),
            candlesHeld: 0,
            level:      signal.level,
            riskReward: signal.riskReward,
            entryType:  signal.concentration === 'manual' ? 'manual' : (signal.concentration === 'tick' ? 'bot_tick' : 'bot'),
            trailingActive: false,
            clusterExitCount: 0,
            // ── Аналитика при входе ──
            entryRsi:        signal.rsi || null,
            entryBbUpper:    signal.bbUpper || null,
            entryBbMiddle:   signal.bbMiddle || null,
            entryBbLower:    signal.bbLower || null,
            entryAtr:        signal.atr || null,
            entryClusterBuy: null, // заполним ниже
            entryMode:       session.entryMode || 'candle',
            strategy:        session.strategy || 'scalper',
            direction:       session.direction || 'both',
            clusterEntryFilter: session.clusterEntryFilter || false,
            // ── Трекинг max/min для анализа ──
            maxUnrealized:   0,    // максимальный unrealized P&L ($)
            maxDrawdown:     0,    // максимальный drawdown ($)
        };

        // Запоминаем кластеры при входе + считаем три варианта для лога
        let clusterDetails = '';
        try {
            const closedForEntry = session.candles.filter(c => c.closed);
            const lb = session.clusterLookback || 10;
            const bgEntry = analyzeClusterGroup(closedForEntry.slice(-lb), 60);
            session.position.entryClusterBuy = bgEntry.buyPct;

            // Считаем для информации кластер на 3 свечах и на последней (триггер)
            const bg3 = analyzeClusterGroup(closedForEntry.slice(-3), 60);
            const lastC = closedForEntry[closedForEntry.length - 1];
            const triggerBuy = lastC ? Math.round(analyzeCandleCluster(lastC)) : 50;

            const filterStatus = session.clusterEntryFilter ? 'ON' : 'OFF';
            clusterDetails = ` | Cluster[trig:${triggerBuy}% /3c:${bg3.buyPct}% /${lb}c:${bgEntry.buyPct}% filter:${filterStatus}]`;
        } catch(e) {}

        const stratInfo = signal.rsi !== undefined
            ? `RSI: ${signal.rsi} | BB: ${signal.bbLower}/${signal.bbMiddle}/${signal.bbUpper}`
            : `Cluster: trigger=${signal.triggerBuyPct}% bg=${signal.backgroundBuyPct}%`;
        console.log(`[BOT ${ts()}] ✅ OPENED ${signal.side} @ ${signal.entry} | Stop: ${signal.stop} (ATR:${signal.atr}) | Target: ${signal.target} | Size: ${size.toFixed(2)} USDT | R:R ${signal.riskReward} | ${stratInfo} | Vol: ${signal.volumeRatio}x${clusterDetails}`);
    }

    function closePosition(session, price, reason) {
        const pos = session.position;
        if (!pos) return;

        const priceDiff = pos.side === 'LONG'
            ? (price - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - price) / pos.entryPrice;

        const grossPnl = pos.size * priceDiff;

        // Комиссия: maker 0.02%, taker 0.055%
        // Вход = taker (маркет), выход по стопу/таймауту/трейлинг = taker, выход по тейку = maker
        const entryFeeRate = 0.00055;  // taker
        const exitFeeRate  = reason === 'take_profit' ? 0.0002 : 0.00055;
        const entryFee = pos.size * entryFeeRate;
        const exitFee  = pos.size * exitFeeRate;
        const totalFee = entryFee + exitFee;

        const netPnl = grossPnl - totalFee;
        session.virtualBalance += netPnl;
        session.dayPnl += netPnl;

        const trade = {
            id:          Date.now(),
            side:        pos.side,
            pair:        session.pair,
            entryPrice:  pos.entryPrice,
            closePrice:  price,
            stop:        pos.stop,
            target:      pos.target,
            size:        Math.round(pos.size * 100) / 100,
            grossPnl:    Math.round(grossPnl * 100) / 100,
            fee:         Math.round(totalFee * 100) / 100,
            pnl:         Math.round(netPnl * 100) / 100,
            pnlPct:      Math.round(((netPnl / pos.size) * 100) * 100) / 100,
            reason:      reason,
            entryType:   pos.entryType || 'bot',
            riskReward:  pos.riskReward,
            levelTouches: pos.level ? pos.level.touches : 0,
            candlesHeld: pos.candlesHeld,
            openedAt:    pos.openedAt,
            closedAt:    Date.now(),
            // ── Расширенная аналитика ──
            strategy:         pos.strategy || 'scalper',
            entryMode:        pos.entryMode || 'candle',
            direction:        pos.direction || 'both',
            clusterEntryUsed: pos.clusterEntryFilter || false,
            entryRsi:         pos.entryRsi,
            entryBbUpper:     pos.entryBbUpper,
            entryBbMiddle:    pos.entryBbMiddle,
            entryBbLower:     pos.entryBbLower,
            entryAtr:         pos.entryAtr,
            entryClusterBuy:  pos.entryClusterBuy,
            exitClusterBuy:   null, // заполним ниже
            maxUnrealized:    pos.maxUnrealized || 0,
            maxDrawdown:      pos.maxDrawdown || 0,
            durationMin:      Math.round((Date.now() - pos.openedAt) / 60000),
        };

        // Кластеры при выходе
        let exitClusterDetails = '';
        try {
            const closedForExit = session.candles.filter(c => c.closed);
            const lb = session.clusterLookback || 10;
            const bgExit = analyzeClusterGroup(closedForExit.slice(-lb), 60);
            trade.exitClusterBuy = bgExit.buyPct;

            const bg3Exit = analyzeClusterGroup(closedForExit.slice(-3), 60);
            const lastCExit = closedForExit[closedForExit.length - 1];
            const triggerBuyExit = lastCExit ? Math.round(analyzeCandleCluster(lastCExit)) : 50;
            const entryClusterStr = pos.entryClusterBuy !== null ? `${pos.entryClusterBuy}%` : 'n/a';

            exitClusterDetails = ` | Cluster[entry(${lb}c):${entryClusterStr}→exit trig:${triggerBuyExit}% /3c:${bg3Exit.buyPct}% /${lb}c:${bgExit.buyPct}%]`;
        } catch(e) {}

        session.trades.unshift(trade);
        if (session.trades.length > 200) session.trades.pop();

        if (netPnl < 0) {
            session.consecutiveLosses++;
        } else {
            session.consecutiveLosses = 0;
        }

        // Cooldown: после закрытия ждём N свечей перед следующим входом
        session.cooldownUntil = session.cooldownCandles || 5;

        // Max favorable / adverse для анализа
        const mfa = pos.maxUnrealized !== undefined ? ` | MaxFav: $${pos.maxUnrealized.toFixed(2)}` : '';
        const mdd = pos.maxDrawdown !== undefined ? ` | MaxDD: $${pos.maxDrawdown.toFixed(2)}` : '';

        const emoji = netPnl >= 0 ? '🟢' : '🔴';
        console.log(`[BOT ${ts()}] ${emoji} CLOSED ${pos.side} @ ${price} | Gross: $${grossPnl.toFixed(2)} | Fee: $${totalFee.toFixed(2)} | Net: $${netPnl.toFixed(2)} (${trade.pnlPct}%) | ${reason} | ${pos.candlesHeld} candles${mfa}${mdd}${exitClusterDetails}`);

        // ── Push-уведомление о закрытой сделке ──
        pushTradeClosed(session, trade);

        session.position = null;
        checkLimits(session);
    }

    function checkLimits(session) {
        // Сброс дневного PnL в полночь UTC
        const today = new Date().toISOString().slice(0, 10);
        if (session.dayStartDate !== today) {
            session.dayPnl = 0;
            session.dayStartDate = today;
        }

        // Дневной лимит убытка
        const dayLossLimit = session.startBalance * (session.dayLimitPct / 100);
        if (session.dayPnl < -dayLossLimit) {
            session.paused = true;
            session.running = false;
            console.log(`[BOT] ⏸ PAUSED — дневной лимит убытка достигнут: $${session.dayPnl.toFixed(2)} (лимит: -$${dayLossLimit.toFixed(2)})`);
            pushBotStopped(session, { type: 'day_limit', value: session.dayPnl });
            return;
        }

        // Серия потерь
        if (session.consecutiveLosses >= session.maxLosses) {
            session.paused = true;
            session.running = false;
            console.log(`[BOT] ⏸ PAUSED — ${session.consecutiveLosses} убытков подряд (лимит: ${session.maxLosses})`);
            pushBotStopped(session, { type: 'consec_losses', value: session.consecutiveLosses });
        }
    }

    // Проверка позиции на каждом обновлении цены
    function checkPosition(session, price) {
        const pos = session.position;
        if (!pos) return;

        session.currentPrice = price;

        // ── Трекинг max unrealized P&L и max drawdown ──
        const unrealized = pos.side === 'LONG'
            ? (price - pos.entryPrice) / pos.entryPrice * pos.size
            : (pos.entryPrice - price) / pos.entryPrice * pos.size;
        if (unrealized > (pos.maxUnrealized || 0)) pos.maxUnrealized = Math.round(unrealized * 100) / 100;
        if (unrealized < (pos.maxDrawdown || 0)) pos.maxDrawdown = Math.round(unrealized * 100) / 100;

        // ── Стоп-лосс (включая трейлинг) ──
        if (pos.side === 'LONG' && price <= pos.stop) {
            closePosition(session, price, pos.trailingActive ? 'trailing_stop' : 'stop_loss');
            return;
        }
        if (pos.side === 'SHORT' && price >= pos.stop) {
            closePosition(session, price, pos.trailingActive ? 'trailing_stop' : 'stop_loss');
            return;
        }

        // ══════════════════════════════════════════════════════════════
        // НОВЫЕ MR-ВЫХОДЫ: bb_touch (режим 2) и sma_return (оба режима)
        // Работают только для mean_reversion. Для scalper пропускаем.
        // ══════════════════════════════════════════════════════════════
        if (session.strategy === 'mean_reversion') {
            const closedCandles = session.candles.filter(c => c.closed);
            const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
            if (bb && bb.upper && bb.lower && bb.middle) {
                const channelWidth = bb.upper - bb.lower;
                if (channelWidth > 0) {
                    // --- РЕЖИМ 2: выход по касанию противоположной ББ ---
                    if (session.bbExitEnabled) {
                        const tolPct = (session.bbExitTolerance || 5) / 100;
                        const touchDist = channelWidth * tolPct;
                        if (pos.side === 'LONG') {
                            // закрываемся при касании или приближении к верхней ББ
                            if (price >= bb.upper - touchDist) {
                                closePosition(session, price, 'bb_touch');
                                return;
                            }
                        } else {
                            // SHORT — при касании/приближении к нижней ББ
                            if (price <= bb.lower + touchDist) {
                                closePosition(session, price, 'bb_touch');
                                return;
                            }
                        }
                    }

                    // --- SMA-RETURN (работает в обоих режимах) ---
                    // Шаг 1: поднимаем флаг wasBeyondSma если цена глубоко зашла за SMA
                    const smaTolPct = (session.smaReturnTolerance || 5) / 100;
                    const smaDeepDist = channelWidth * smaTolPct;
                    if (pos.side === 'LONG') {
                        // глубокий заход = выше SMA + толеранс
                        if (price >= bb.middle + smaDeepDist) {
                            pos.wasBeyondSma = true;
                        }
                        // возврат = цена вернулась к SMA сверху (строго, без толеранса)
                        if (pos.wasBeyondSma && price <= bb.middle) {
                            closePosition(session, price, 'sma_return');
                            return;
                        }
                    } else {
                        // SHORT — глубокий заход = ниже SMA − толеранс
                        if (price <= bb.middle - smaDeepDist) {
                            pos.wasBeyondSma = true;
                        }
                        if (pos.wasBeyondSma && price >= bb.middle) {
                            closePosition(session, price, 'sma_return');
                            return;
                        }
                    }
                }
            }
        }

        // ── Тейк-профит ──
        if (pos.side === 'LONG' && price >= pos.target) {
            closePosition(session, price, 'take_profit');
            return;
        }
        if (pos.side === 'SHORT' && price <= pos.target) {
            closePosition(session, price, 'take_profit');
            return;
        }

        // ── Трейлинг-стоп ──
        if (session.trailingEnabled) {
            const totalPath = Math.abs(pos.target - pos.entryPrice);
            const activationThreshold = totalPath * (session.trailingActivation / 100);
            const trailDist = price * (session.trailingOffset / 100);

            if (pos.side === 'LONG') {
                const progress = price - pos.entryPrice;
                if (progress >= activationThreshold) {
                    const newStop = price - trailDist;
                    if (newStop > pos.stop) {
                        if (!pos.trailingActive) {
                            console.log(`[BOT] 📈 Trailing stop ACTIVATED for LONG @ ${price} | New stop: ${newStop.toFixed(2)}`);
                        }
                        pos.stop = Math.round(newStop * 100) / 100;
                        pos.trailingActive = true;
                    }
                }
            } else {
                const progress = pos.entryPrice - price;
                if (progress >= activationThreshold) {
                    const newStop = price + trailDist;
                    if (newStop < pos.stop) {
                        if (!pos.trailingActive) {
                            console.log(`[BOT ${ts()}] 📉 Trailing stop ACTIVATED for SHORT @ ${price} | New stop: ${newStop.toFixed(2)}`);
                        }
                        pos.stop = Math.round(newStop * 100) / 100;
                        pos.trailingActive = true;
                    }
                }
            }
        }
    }

    // Проверка таймаута (вызывается при закрытии каждой свечи)
    function checkTimeout(session) {
        const pos = session.position;
        if (!pos) return;

        pos.candlesHeld++;

        if (pos.candlesHeld >= session.positionTimeout) {
            closePosition(session, session.currentPrice, 'timeout');
        }
    }


    /* ══════════════════════════════════════════
       6. ГЛАВНЫЙ ЦИКЛ (при закрытии свечи)
       Вызывается каждые 5 минут
    ══════════════════════════════════════════ */

    function onCandleClose(session) {
        if (!session.running || session.paused) return;

        // Обновляем уровни
        session.levels = findMicroLevels(
            session.candles,
            session.levelTouches,
            session.levelTolerance,
            session.currentPrice
        );

        // Проверяем таймаут открытой позиции
        checkTimeout(session);

        // ── Динамический тейк для Mean Reversion ──
        if (session.position && session.strategy === 'mean_reversion') {
            const closedCandles = session.candles.filter(c => c.closed);
            const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
            if (bb) {
                const pos = session.position;

                let newTarget;
                if (session.bbExitEnabled) {
                    // РЕЖИМ 2: цель = противоположная ББ. Target на шкале = реальная цель выхода.
                    newTarget = pos.side === 'LONG'
                        ? Math.round(bb.upper * 100) / 100
                        : Math.round(bb.lower * 100) / 100;
                } else {
                    // РЕЖИМ 1: цель = max(SMA, minProfit)
                    const smaTarget = Math.round(bb.middle * 100) / 100;
                    const minProfitPct = session.maxProfitPct || 1.0;
                    const minTarget = pos.side === 'LONG'
                        ? Math.round(pos.entryPrice * (1 + minProfitPct / 100) * 100) / 100
                        : Math.round(pos.entryPrice * (1 - minProfitPct / 100) * 100) / 100;
                    newTarget = pos.side === 'LONG'
                        ? Math.max(smaTarget, minTarget)
                        : Math.min(smaTarget, minTarget);
                }

                if (newTarget !== pos.target) {
                    const oldTarget = pos.target;
                    pos.target = newTarget;
                    const label = session.bbExitEnabled ? 'BB' : 'SMA/min';
                    console.log(`[BOT ${ts()}] 🎯 Target updated: ${oldTarget} → ${newTarget} (mode: ${label})`);
                }
            }
        }

        // ── Кластерный выход из позиции ──
        // Работает только если тумблер "Учитывать кластеры" включён
        if (session.position && (session.clusterEntryFilter || (session.strategy !== 'mean_reversion' && session.clusterEnabled))) {
            checkClusterExit(session);
        }

        // Cooldown: уменьшаем счётчик
        if (session.cooldownUntil > 0) {
            session.cooldownUntil--;
        }

        // Если нет позиции и нет cooldown — ищем сигнал
        if (!session.position && session.cooldownUntil <= 0) {
            const signal = session.strategy === 'mean_reversion'
                ? checkSignalMeanReversion(session)
                : checkSignal(session);
            if (signal) {
                openPosition(session, signal);
            }
        }

        // Лог состояния
        const lvlInfo = session.levels.map(l =>
            `${l.type === 'support' ? 'S' : 'R'}:${l.price}(${l.touches})`
        ).join(' | ');

        console.log(`[BOT ${ts()}] 📊 Candle closed @ ${session.currentPrice} | Levels: ${lvlInfo || 'none'} | Position: ${session.position ? session.position.side : 'none'} | Balance: $${session.virtualBalance.toFixed(2)}`);
    }

    /**
     * Проверяет кластеры для выхода из позиции:
     * - Смена доминирования (для лонга — продавцы перехватили)
     * - Учитывает уровни: у сильного уровня + кластер против → быстрее выход
     */
    function checkClusterExit(session) {
        const pos = session.position;
        if (!pos) return;

        const closedCandles = session.candles.filter(c => c.closed);
        if (closedCandles.length < 2) return;

        const lastCandle = closedCandles[closedCandles.length - 1];
        // Для Mean Reversion порог выхода 75%, для скальпера — clusterThreshold (80)
        const threshold = session.strategy === 'mean_reversion' ? 70 : (session.clusterThreshold || 80);
        const confirmNeeded = session.clusterExitConfirm || 1;

        // Анализируем кластер последней свечи
        const candleBuyPct = analyzeCandleCluster(lastCandle);
        const isBuyerDominant = candleBuyPct >= threshold;
        const isSellerDominant = (100 - candleBuyPct) >= threshold;

        // Определяем: кластер против нашей позиции?
        let clusterAgainst = false;
        if (pos.side === 'LONG' && isSellerDominant) clusterAgainst = true;
        if (pos.side === 'SHORT' && isBuyerDominant) clusterAgainst = true;

        // Проверяем: цена у сильного уровня?
        let atStrongLevel = false;
        for (const level of session.levels) {
            const dist = Math.abs(session.currentPrice - level.price) / level.price;
            if (dist <= session.levelTolerance) {
                // Для лонга: уровень сопротивления с реальными касаниями снизу = стена
                // Для шорта: уровень поддержки с реальными касаниями сверху = стена
                const realTouches = level.totalTouches || level.touches;
                if (pos.side === 'LONG' && level.type === 'resistance' && level.touchesFromBelow >= 5) atStrongLevel = true;
                if (pos.side === 'SHORT' && level.type === 'support' && level.touchesFromAbove >= 5) atStrongLevel = true;
            }
        }

        if (clusterAgainst) {
            pos.clusterExitCount++;

            // У сильного уровня — закрываем быстрее (сразу)
            const neededConfirm = atStrongLevel ? 1 : confirmNeeded;

            if (pos.clusterExitCount >= neededConfirm) {
                // Проверяем что чистый профит (после комиссии) положительный
                const priceDiff = pos.side === 'LONG'
                    ? (session.currentPrice - pos.entryPrice) / pos.entryPrice
                    : (pos.entryPrice - session.currentPrice) / pos.entryPrice;

                const grossPnl = pos.size * priceDiff;
                const estimatedFee = pos.size * 0.0011; // ~0.11% round-trip

                if (grossPnl > estimatedFee) {
                    // Чистый профит положительный — закрываем по кластерному сигналу
                    console.log(`[BOT ${ts()}] 🔮 Cluster exit: ${pos.side} — dominance shifted (buy=${Math.round(candleBuyPct)}%, confirm=${pos.clusterExitCount}/${neededConfirm}, net=$${(grossPnl - estimatedFee).toFixed(2)}${atStrongLevel ? ', at strong level' : ''})`);
                    closePosition(session, session.currentPrice, 'cluster_exit');
                }
                // Если в минусе или профит не покрывает комиссию — не закрываем, ждём стоп/трейлинг
            }
        } else {
            // Кластер в нашу сторону — сбрасываем счётчик
            pos.clusterExitCount = 0;
        }
    }


    /* ══════════════════════════════════════════
       7. BINANCE WEBSOCKET
       Подключение к потоку 5-минутных свечей
    ══════════════════════════════════════════ */

    function connectWebSocket(uid, botId) {
        const session = getSession(uid, botId);
        const symbol = session.symbol.toLowerCase(); // btcusdt

        // Закрываем старое соединение если есть
        disconnectWebSocket(uid, botId);

        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_${session.binanceInterval}`;

        console.log(`[BOT] 🔌 Connecting WebSocket: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
            console.log(`[BOT] WebSocket connected for ${session.symbol}`);
            // Ping каждые 3 минуты чтобы Binance не дропал соединение
            session.wsPingTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            }, 180000);
        });

        ws.on('pong', () => {
            // Binance ответил — соединение живое
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.e !== 'kline') return;

                const k = msg.k;
                const candle = {
                    time:    Math.floor(k.t / 1000),
                    open:    parseFloat(k.o),
                    high:    parseFloat(k.h),
                    low:     parseFloat(k.l),
                    close:   parseFloat(k.c),
                    volume:  parseFloat(k.v),
                    closed:  k.x,   // true когда свеча закрылась
                };

                // Обновляем текущую цену (на каждом тике)
                session.currentPrice = candle.close;

                // Проверяем стоп/тейк по текущей цене (не ждём закрытия свечи)
                if (session.position) {
                    checkPosition(session, candle.close);
                }

                // ── Вход по тику (Mean Reversion, tick mode) ──
                if (!session.position && session.cooldownUntil <= 0
                    && session.strategy === 'mean_reversion'
                    && session.entryMode === 'tick') {
                    if (typeof checkTickEntry === 'function') {
                        checkTickEntry(session, candle.close);
                    } else {
                        console.error(`[BOT] ❌ checkTickEntry not available — tick entry skipped. Restart required.`);
                    }
                }

                // Свеча закрылась — получаем точные данные и запускаем анализ
                if (candle.closed && candle.time !== session.lastCandleTime) {
                    session.lastCandleTime = candle.time;

                    // Убираем последнюю незакрытую если она есть
                    if (session.candles.length > 0 && !session.candles[session.candles.length - 1].closed) {
                        session.candles.pop();
                    }

                    // Дополняем свечу точным buyVolume через REST API
                    fetchLastCandleBuyVolume(session.symbol, session.binanceInterval)
                        .then(buyVolume => {
                            candle.buyVolume = buyVolume;
                            session.candles.push(candle);

                            // Ограничиваем размер массива
                            if (session.candles.length > 500) {
                                session.candles = session.candles.slice(-300);
                            }

                            // Запускаем анализ с точными данными
                            onCandleClose(session);
                        })
                        .catch(() => {
                            // Если REST не ответил — используем свечу без buyVolume (fallback)
                            session.candles.push(candle);
                            if (session.candles.length > 500) {
                                session.candles = session.candles.slice(-300);
                            }
                            onCandleClose(session);
                        });

                } else if (!candle.closed) {
                    // Обновляем текущую (незакрытую) свечу
                    if (session.candles.length > 0 && !session.candles[session.candles.length - 1].closed) {
                        session.candles[session.candles.length - 1] = candle;
                    } else {
                        session.candles.push(candle);
                    }
                }

            } catch(e) {
                console.error('[BOT] WebSocket message error:', e.message);
            }
        });

        ws.on('close', () => {
            if (session.wsPingTimer) { clearInterval(session.wsPingTimer); session.wsPingTimer = null; }
            // Автореконнект через 5 секунд
            if (session.running) {
                session.wsReconnectTimer = setTimeout(() => {
                    connectWebSocket(uid, botId);
                }, 5000);
            }
        });

        ws.on('error', (err) => {
            console.error('[BOT] WebSocket error:', err.message);
        });

        session.ws = ws;
    }

    function disconnectWebSocket(uid, botId) {
        const session = getSession(uid, botId);
        if (session.wsPingTimer) {
            clearInterval(session.wsPingTimer);
            session.wsPingTimer = null;
        }
        if (session.wsReconnectTimer) {
            clearTimeout(session.wsReconnectTimer);
            session.wsReconnectTimer = null;
        }
        if (session.ws) {
            session.ws.removeAllListeners();
            try {
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.close();
                } else {
                    session.ws.terminate();
                }
            } catch(e) { /* ignore close errors */ }
            session.ws = null;
        }
    }


    /* ══════════════════════════════════════════
       8. ЗАПУСК / ОСТАНОВКА БОТА
    ══════════════════════════════════════════ */

    async function startBot(uid, botId, settings) {
        const session = getSession(uid, botId);

        // ── Защита от двойного запуска ──
        if (session.running) {
            console.log(`[BOT] ⚠️ Bot already running for uid=${uid}, stopping previous instance...`);
            stopBot(uid, botId);
            // Даём время на отключение WebSocket
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (session._starting) {
            console.log(`[BOT] ⚠️ Bot is already starting for uid=${uid}, ignoring duplicate request`);
            return { ok: false, error: 'Bot is already starting, please wait' };
        }
        session._starting = true;

        try {
        // Применяем настройки
        session.mode             = settings.mode           || 'paper';
        session.market           = settings.market         || 'futures';
        session.pair             = settings.pair           || 'BTC/USDT';
        session.symbol           = (settings.pair || 'BTC/USDT').replace('/', '').toUpperCase();
        session.riskPct          = parseFloat(settings.riskPct)         || 2;
        session.dayLimitPct      = parseFloat(settings.dayLimitPct)     || 5;
        session.maxLosses        = parseInt(settings.maxLosses)         || 3;
        session.maxLeverage      = parseInt(settings.maxLeverage)       || 5;
        session.virtualBalance   = parseFloat(settings.virtualBalance)  || 10000;
        session.startBalance     = session.virtualBalance;
        session.volumeMultiplier = parseFloat(settings.volumeMultiplier) || 1.5;
        session.positionTimeout  = parseInt(settings.positionTimeout)    || 6;

        // Трейлинг-стоп
        session.trailingEnabled    = !!settings.trailingEnabled;
        session.trailingOffset     = parseFloat(settings.trailingOffset)     || 0.25;
        session.trailingActivation = parseFloat(settings.trailingActivation) || 70;

        // Выход по противоположной полосе Боллинджера (MR) + толерансы возврата/касания
        session.bbExitEnabled      = !!settings.bbExitEnabled;
        session.bbExitTolerance    = parseFloat(settings.bbExitTolerance);
        if (!Number.isFinite(session.bbExitTolerance)) session.bbExitTolerance = 5;
        session.smaReturnTolerance = parseFloat(settings.smaReturnTolerance);
        if (!Number.isFinite(session.smaReturnTolerance)) session.smaReturnTolerance = 5;

        // Режим 2 жёстко отключает трейлинг и minProfit на серверной стороне, независимо от UI
        if (session.bbExitEnabled) {
            session.trailingEnabled = false;
        }

        // Push-уведомления: по умолчанию включены, если явно не выключено
        session.notifyEnabled      = settings.notifyEnabled !== false;

        // Таргет-профит
        session.minProfitPct    = 0.15; // вшит
        session.maxProfitPct    = parseFloat(settings.maxProfitPct)     || 1.0;
        session.cooldownCandles = parseInt(settings.cooldownCandles)    || 5;
        session.stopAtrMultiplier = parseFloat(settings.stopAtrMultiplier) || 1.5;

        // ── Стратегия ──
        session.strategy = settings.strategy || 'scalper'; // 'scalper' | 'mean_reversion'
        session.direction = settings.direction || 'both'; // 'both' | 'long' | 'short'
        session.entryMode = settings.entryMode || 'candle'; // 'candle' | 'tick'

        // Кластерный анализ
        session.clusterEnabled     = settings.clusterEnabled !== false;
        session.clusterThreshold   = parseInt(settings.clusterThreshold)   || 80;
        session.clusterExitConfirm = parseInt(settings.clusterExitConfirm) || 1;

        // ── Mean Reversion параметры ──
        session.bbPeriod      = parseInt(settings.bbPeriod)      || 20;
        session.bbMultiplier  = parseFloat(settings.bbMultiplier)  || 2.0;
        session.rsiPeriod     = parseInt(settings.rsiPeriod)     || 14;
        session.rsiOverbought = parseInt(settings.rsiOverbought) || 65;
        session.rsiOversold   = parseInt(settings.rsiOversold)   || 35;

        // ── Таймфрейм ──
        const tf = settings.timeframe || '5m';
        session.timeframe = tf;
        session.binanceInterval = tf; // '1m' или '5m'

        // Адаптация параметров под таймфрейм
        if (tf === '1m') {
            session.candlesForLevels = 500;     // 500 минут = ~8 часов
            session.levelTolerance   = 0.0006;  // ±0.06% (расширенная зона для минутки)
            session.stopOffsetPct    = 0.0007;  // стоп 0.07% (уже)
            session.clusterLookback  = parseInt(settings.clusterLookback) || 5;
        } else {
            session.candlesForLevels = 200;     // 200 × 5м = ~17 часов
            session.levelTolerance   = 0.0005;  // ±0.05%
            session.stopOffsetPct    = 0.001;   // стоп 0.1%
            session.clusterLookback  = parseInt(settings.clusterLookback) || 10;
        }

        // Сброс состояния (trades НЕ сбрасываем — копим историю)
        session.running           = true;
        session.paused            = false;
        session.consecutiveLosses = 0;
        // session.trades — сохраняем!
        session.position          = null;
        session.levels            = [];
        session.lastCandleTime    = 0;

        // dayPnl сбрасываем только если новый день
        var today = new Date().toISOString().slice(0, 10);
        if (session.dayStartDate !== today) {
            session.dayPnl = 0;
            session.dayStartDate = today;
        }

        // ── Загружаем историю ──
        console.log(`[BOT] Loading ${session.candlesForLevels} historical ${session.binanceInterval} candles for ${session.symbol}...`);
        session.candles = await loadHistoricalCandles(session.symbol, session.binanceInterval, session.candlesForLevels);

        if (session.candles.length === 0) {
            session.running = false;
            session._starting = false;
            return { ok: false, error: 'Failed to load candle data' };
        }

        console.log(`[BOT] Loaded ${session.candles.length} candles`);

        // Текущая цена
        session.currentPrice = session.candles[session.candles.length - 1].close;

        // ── Считаем начальные уровни ──
        session.levels = findMicroLevels(
            session.candles,
            session.levelTouches,
            session.levelTolerance,
            session.currentPrice
        );
        console.log(`[BOT] Found ${session.levels.length} micro-levels`);

        // ── Подключаем WebSocket ──
        connectWebSocket(uid, botId);

        session._starting = false;
        return { ok: true, levels: session.levels.length, candles: session.candles.length };
        } catch (err) {
            session._starting = false;
            session.running = false;
            throw err;
        }
    }

    function stopBot(uid, botId, silent) {
        const session = getSession(uid, botId);
        const wasRunning = session.running;
        session.running = false;

        // Флаг «молчаливой остановки» — подавляет индивидуальные push во время массового стопа
        if (silent) session._silentStop = true;

        // Закрываем позицию по рынку
        if (session.position && session.currentPrice > 0) {
            closePosition(session, session.currentPrice, 'manual_stop');
        }

        // Отключаем WebSocket
        disconnectWebSocket(uid, botId);

        console.log(`[BOT] 🛑 Bot stopped for uid=${uid} bot=${botId}${silent ? ' (silent)' : ''}`);

        // Push-уведомление — только если бот реально работал и не молчаливый стоп
        if (wasRunning && !silent) {
            pushBotStopped(session, { type: 'manual' });
        }

        // Снимаем флаг после завершения (на случай если сессия переиспользуется)
        if (silent) session._silentStop = false;

        return { wasRunning };
    }


    /* ══════════════════════════════════════════
       9. API ROUTES
    ══════════════════════════════════════════ */

    // POST /api/bot/start — запустить бота
    app.post('/api/bot/start', async (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const result = await startBot(uid, botId, req.body);
            if (result.ok) {
                res.json({
                    ok: true,
                    botId: botId,
                    balance: getSession(uid, botId).virtualBalance,
                    levels: result.levels,
                    candles: result.candles,
                });
            } else {
                res.status(500).json({ error: result.error });
            }
        } catch(e) {
            console.error('[BOT] /start error:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/stop — остановить бота
    // body.silent = true подавляет индивидуальные push (для массового стопа)
    app.post('/api/bot/stop', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const silent = !!req.body.silent;
            const result = stopBot(uid, botId, silent);
            res.json({ ok: true, wasRunning: result.wasRunning });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/notify-summary — сводный push после массового стопа
    // body: { uid, count, dayPnlTotal } — отправляет одно уведомление типа "Остановлено 12 ботов"
    app.post('/api/bot/notify-summary', async (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const count = parseInt(req.body.count) || 0;
            const dayPnlTotal = parseFloat(req.body.dayPnlTotal) || 0;

            if (count <= 0) {
                return res.json({ ok: true, sent: false, reason: 'nothing to notify' });
            }
            if (typeof global.sendPushToUser !== 'function') {
                return res.json({ ok: true, sent: false, reason: 'push unavailable' });
            }

            // Форматирование: "Остановлено 12 ботов" / subtitle: "суммарно за день: +$34.20"
            const title = `Остановлено ${count} ${pluralBots(count)}`;
            const pnlSign = dayPnlTotal >= 0 ? '+' : '−';
            const pnlAbs = Math.abs(dayPnlTotal).toFixed(2);
            const subtitle = `суммарно за день: ${pnlSign}$${pnlAbs}`;
            const body = 'массовая остановка';

            await global.sendPushToUser(uid, title, body, {
                subtitle,
                link: '/app#journal',
                tag:  `bot-stop-all-${Date.now()}`,
            });
            res.json({ ok: true, sent: true });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Локальный хелпер для корректного склонения
    function pluralBots(n) {
        const n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return 'бота';
        if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return 'бота';
        return 'ботов';
    }

    // POST /api/bot/notify — переключить push-уведомления для бота
    app.post('/api/bot/notify', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const enabled = req.body.enabled !== false;
            const session = getSession(uid, botId);
            session.notifyEnabled = enabled;
            res.json({ ok: true, notifyEnabled: enabled });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/test-notify — отправить тестовое уведомление (для проверки дизайна)
    app.post('/api/bot/test-notify', async (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            if (!session.uid) session.uid = uid;

            // Фиктивный "успешный" trade для демонстрации формата
            const fakeTrade = {
                id:          Date.now(),
                pnl:         4.20,
                pnlPct:      0.42,
                reason:      'take_profit',
                durationMin: 23,
                riskReward:  2.1,
            };
            await pushTradeClosed(session, fakeTrade);
            res.json({ ok: true, sent: 'test trade push' });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/resume — возобновить после паузы
    app.post('/api/bot/resume', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            session.paused = false;
            session.running = true;
            session.consecutiveLosses = 0;
            // WebSocket уже подключён, просто снимаем паузу
            if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
                connectWebSocket(uid, botId);
            }
            res.json({ ok: true });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/manual-trade — ручной вход в позицию
    app.post('/api/bot/manual-trade', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const side = req.body.side; // 'LONG' или 'SHORT'
            const session = getSession(uid, botId);

            if (!session.running) return res.status(400).json({ error: 'Бот не запущен' });
            if (session.position) return res.status(400).json({ error: 'Уже есть открытая позиция' });
            if (!side || (side !== 'LONG' && side !== 'SHORT')) return res.status(400).json({ error: 'Укажите side: LONG или SHORT' });
            if (session.market === 'spot' && side === 'SHORT') return res.status(400).json({ error: 'SHORT недоступен на споте' });
            if (!session.currentPrice || session.currentPrice <= 0) return res.status(400).json({ error: 'Нет данных о цене' });

            const price = session.currentPrice;
            const atr = calcATR(session.candles, 20);
            const stopDist = atr > 0 ? atr * (session.stopAtrMultiplier || 1.5) : price * 0.002;

            let stop, tp;

            if (session.strategy === 'mean_reversion') {
                // Mean Reversion: таргет = макс(SMA, минимальный профит), стоп за полосой BB
                const closedCandles = session.candles.filter(c => c.closed);
                const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
                if (bb) {
                    const smaTarget = bb.middle;
                    const minProfitPct = session.maxProfitPct || 1.0;
                    const minTarget = side === 'LONG'
                        ? price * (1 + minProfitPct / 100)
                        : price * (1 - minProfitPct / 100);
                    tp = side === 'LONG'
                        ? Math.max(smaTarget, minTarget)
                        : Math.min(smaTarget, minTarget);
                    stop = side === 'LONG'
                        ? bb.lower - (atr > 0 ? atr * (session.stopAtrMultiplier || 1.5) : price * 0.002)
                        : bb.upper + (atr > 0 ? atr * (session.stopAtrMultiplier || 1.5) : price * 0.002);
                } else {
                    tp = side === 'LONG' ? price * 1.005 : price * 0.995;
                    stop = side === 'LONG' ? price - stopDist : price + stopDist;
                }
            } else {
                // Скальпер: старая логика
                stop = side === 'LONG' ? price - stopDist : price + stopDist;
                tp = side === 'LONG'
                    ? price * (1 + session.maxProfitPct / 100)
                    : price * (1 - session.maxProfitPct / 100);
            }

            const signal = {
                side,
                entry: price,
                stop: Math.round(stop * 100) / 100,
                target: Math.round(tp * 100) / 100,
                atr: Math.round(atr * 100) / 100,
                level: null,
                riskReward: Math.round((Math.abs(tp - price) / Math.abs(price - stop)) * 100) / 100,
                triggerBuyPct: 50,
                backgroundBuyPct: 50,
                concentration: 'manual',
                volumeRatio: 0,
            };

            openPosition(session, signal);
            console.log(`[BOT ${ts()}] 🖐 MANUAL ${side} @ ${price} | Stop: ${signal.stop} | Target: ${signal.target}`);

            res.json({ ok: true, position: session.position ? {
                side: session.position.side,
                entryPrice: session.position.entryPrice,
                stop: session.position.stop,
                target: session.position.target,
            } : null });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/settings — горячее обновление настроек (без перезапуска)
    app.post('/api/bot/settings', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            const s = req.body;
            const changed = [];

            // Кластеры
            if (s.clusterEntryFilter !== undefined) {
                session.clusterEntryFilter = !!s.clusterEntryFilter;
                changed.push(`clusterFilter:${session.clusterEntryFilter ? 'ON' : 'OFF'}`);
            }
            if (s.clusterEnabled !== undefined) { session.clusterEnabled = !!s.clusterEnabled; changed.push('clusterEnabled'); }
            if (s.clusterThreshold) { session.clusterThreshold = parseInt(s.clusterThreshold); changed.push('clusterThreshold'); }
            if (s.clusterExitConfirm) { session.clusterExitConfirm = parseInt(s.clusterExitConfirm); changed.push('clusterExitConfirm'); }
            if (s.clusterLookback) { session.clusterLookback = parseInt(s.clusterLookback); changed.push('clusterLookback'); }

            // Направление
            if (s.direction) { session.direction = s.direction; changed.push(`direction:${s.direction}`); }

            // Режим входа
            if (s.entryMode) { session.entryMode = s.entryMode; changed.push(`entryMode:${s.entryMode}`); }

            // Риск
            if (s.riskPct) { session.riskPct = parseFloat(s.riskPct); changed.push('riskPct'); }
            if (s.dayLimitPct) { session.dayLimitPct = parseFloat(s.dayLimitPct); changed.push('dayLimitPct'); }
            if (s.maxLosses) { session.maxLosses = parseInt(s.maxLosses); changed.push('maxLosses'); }
            if (s.maxLeverage) { session.maxLeverage = parseInt(s.maxLeverage); changed.push('maxLeverage'); }

            // Таргет / стоп
            if (s.maxProfitPct) { session.maxProfitPct = parseFloat(s.maxProfitPct); changed.push('maxProfitPct'); }
            if (s.cooldownCandles) { session.cooldownCandles = parseInt(s.cooldownCandles); changed.push('cooldownCandles'); }
            if (s.stopAtrMultiplier) { session.stopAtrMultiplier = parseFloat(s.stopAtrMultiplier); changed.push('stopAtrMultiplier'); }
            if (s.positionTimeout !== undefined) { session.positionTimeout = parseInt(s.positionTimeout); changed.push('positionTimeout'); }

            // Трейлинг
            if (s.trailingEnabled !== undefined) { session.trailingEnabled = !!s.trailingEnabled; changed.push(`trailing:${session.trailingEnabled ? 'ON' : 'OFF'}`); }
            if (s.trailingOffset) { session.trailingOffset = parseFloat(s.trailingOffset); changed.push('trailingOffset'); }
            if (s.trailingActivation) { session.trailingActivation = parseFloat(s.trailingActivation); changed.push('trailingActivation'); }

            // Bollinger / RSI (Mean Reversion)
            if (s.bbPeriod) { session.bbPeriod = parseInt(s.bbPeriod); changed.push('bbPeriod'); }
            if (s.bbMultiplier) { session.bbMultiplier = parseFloat(s.bbMultiplier); changed.push('bbMultiplier'); }
            if (s.rsiPeriod) { session.rsiPeriod = parseInt(s.rsiPeriod); changed.push('rsiPeriod'); }
            if (s.rsiOverbought) { session.rsiOverbought = parseFloat(s.rsiOverbought); changed.push('rsiOverbought'); }
            if (s.rsiOversold) { session.rsiOversold = parseFloat(s.rsiOversold); changed.push('rsiOversold'); }

            // Объём
            if (s.volumeMultiplier) { session.volumeMultiplier = parseFloat(s.volumeMultiplier); changed.push('volumeMultiplier'); }

            // Имя бота
            if (s.botName !== undefined) { session.botName = s.botName || null; changed.push('botName'); }

            if (changed.length > 0) {
                console.log(`[BOT ${ts()}] ⚙️ Hot settings update (bot=${botId}): ${changed.join(', ')}`);
            }

            res.json({ ok: true, changed });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/manual-close — ручное закрытие позиции
    app.post('/api/bot/manual-close', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);

            if (!session.position) return res.status(400).json({ error: 'Нет открытой позиции' });

            closePosition(session, session.currentPrice, 'manual_close');
            console.log(`[BOT ${ts()}] 🖐 MANUAL CLOSE @ ${session.currentPrice}`);
            res.json({ ok: true });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ── MULTI-BOT ENDPOINTS ──

    // GET /api/bot/list — список всех ботов пользователя
    app.get('/api/bot/list', (req, res) => {
        try {
            const uid = req.query.uid || 'anonymous';
            const bots = getUserBots(uid);
            res.json({ bots });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/create — создать нового бота (без запуска)
    app.post('/api/bot/create', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = 'bot_' + Date.now();
            const session = getSession(uid, botId);
            session.botName = req.body.botName || null;
            if (req.body.pair) session.pair = req.body.pair;
            if (req.body.strategy) session.strategy = req.body.strategy;
            console.log(`[BOT ${ts()}] ➕ Created bot ${botId} for uid=${uid} (${session.pair} / ${session.strategy || 'scalper'})`);
            res.json({ ok: true, botId, bots: getUserBots(uid) });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/delete — удалить бота
    app.post('/api/bot/delete', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId;
            if (!botId) return res.status(400).json({ error: 'botId required' });

            const key = uid + ':' + botId;
            const session = sessions.get(key);
            if (session) {
                if (session.running) stopBot(uid, botId);
                sessions.delete(key);
            }
            console.log(`[BOT ${ts()}] ❌ Deleted bot ${botId} for uid=${uid}`);
            res.json({ ok: true, bots: getUserBots(uid) });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/rename — переименовать бота
    app.post('/api/bot/rename', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            session.botName = req.body.botName || null;
            res.json({ ok: true });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/bot/status — текущий статус
    app.get('/api/bot/status', (req, res) => {
        try {
            const uid = req.query.uid || 'anonymous';
            const botId = req.query.botId || 'default';
            const key = uid + ':' + botId;

            // Не создаём новую сессию при просмотре статуса —
            // иначе будут появляться "призрачные" боты в списке.
            if (!sessions.has(key)) {
                return res.json({
                    botId, exists: false, running: false, paused: false,
                    position: null, levels: [], tradeCount: 0, currentPrice: 0,
                    balance: 0, dayPnl: 0, totalPnl: 0,
                });
            }
            const session = sessions.get(key);

            res.json({
                botId:       botId,
                botName:     session.botName,
                running:     session.running,
                paused:      session.paused,
                mode:        session.mode,
                market:      session.market,
                pair:        session.pair,
                timeframe:   session.timeframe,
                balance:     Math.round(session.virtualBalance * 100) / 100,
                startBalance: session.startBalance,
                dayPnl:      Math.round(session.dayPnl * 100) / 100,
                totalPnl:    Math.round((session.virtualBalance - session.startBalance) * 100) / 100,
                currentPrice: session.currentPrice,
                maxLeverage: session.maxLeverage,
                trailingEnabled: session.trailingEnabled,
                trailingActivation: session.trailingActivation,
                trailingOffset: session.trailingOffset,
                bbExitEnabled: session.bbExitEnabled,
                bbExitTolerance: session.bbExitTolerance,
                smaReturnTolerance: session.smaReturnTolerance,
                maxProfitPct: session.maxProfitPct,
                cooldownCandles: session.cooldownCandles,
                stopAtrMultiplier: session.stopAtrMultiplier,
                clusterEnabled: session.clusterEnabled,
                clusterEntryFilter: session.clusterEntryFilter || false,
                clusterThreshold: session.clusterThreshold,
                clusterExitConfirm: session.clusterExitConfirm,
                clusterLookback: session.clusterLookback,
                position:    session.position ? {
                    side:        session.position.side,
                    entryPrice:  session.position.entryPrice,
                    stop:        session.position.stop,
                    target:      session.position.target,
                    size:        Math.round(session.position.size * 100) / 100,
                    openedAt:    session.position.openedAt,
                    candlesHeld: session.position.candlesHeld,
                    unrealizedPnl: calcUnrealizedPnl(session),
                    trailingActive: session.position.trailingActive || false,
                } : null,
                levels:      session.levels,
                levelsCount: session.levels.length,
                consecutiveLosses: session.consecutiveLosses,
                tradeCount:  session.trades.length,
                winRate:     calcWinRate(session.trades),
                wsConnected: session.ws && session.ws.readyState === WebSocket.OPEN,
                candlesLoaded: session.candles.length,
                volumeInfo: getVolumeInfo(session),
                clusterInfo: getClusterInfo(session),
                strategy: session.strategy || 'scalper',
                bbData: session.strategy === 'mean_reversion' ? (() => {
                    const closedCandles = session.candles.filter(c => c.closed);
                    const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
                    const rsi = calcRSI(closedCandles, session.rsiPeriod || 14);
                    return bb ? {
                        upper: Math.round(bb.upper * 100) / 100,
                        middle: Math.round(bb.middle * 100) / 100,
                        lower: Math.round(bb.lower * 100) / 100,
                        rsi: Math.round(rsi * 10) / 10,
                    } : null;
                })() : null,
            });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/bot/trades — лог сделок
    app.get('/api/bot/trades', (req, res) => {
        try {
            const uid   = req.query.uid || 'anonymous';
            const botId = req.query.botId || 'default';
            const limit = parseInt(req.query.limit) || 20;
            const session = getSession(uid, botId);
            const label = getFullBotLabel(session);
            const trades = session.trades.slice(0, limit).map(t => Object.assign({}, t, { botLabel: label }));
            res.json({ trades });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/bot/trades-all — все сделки всех ботов пользователя
    app.get('/api/bot/trades-all', (req, res) => {
        try {
            const uid = req.query.uid || 'anonymous';
            const limit = parseInt(req.query.limit) || 100;
            const allTrades = [];
            for (const [key, session] of sessions) {
                if (!key.startsWith(uid + ':')) continue;
                const botId = key.split(':')[1];
                const label = getFullBotLabel(session);
                session.trades.forEach(t => {
                    allTrades.push(Object.assign({}, t, { botId, botLabel: label }));
                });
            }
            allTrades.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
            res.json({ trades: allTrades.slice(0, limit) });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/bot/levels — текущие уровни (для отрисовки на графике)
    app.get('/api/bot/levels', (req, res) => {
        try {
            const uid = req.query.uid || 'anonymous';
            const botId = req.query.botId || 'default';
            const session = getSession(uid, botId);

            // BB данные для Mean Reversion (история для кривых линий)
            let bbHistory = null;
            if (session.strategy === 'mean_reversion') {
                const closedCandles = session.candles.filter(c => c.closed);
                const bbPeriod = session.bbPeriod || 20;
                const bbMult = session.bbMultiplier || 2.0;
                bbHistory = [];
                for (let i = bbPeriod - 1; i < closedCandles.length; i++) {
                    const slice = closedCandles.slice(i - bbPeriod + 1, i + 1);
                    const bb = calcBollingerBands(slice, bbPeriod, bbMult);
                    if (bb) {
                        bbHistory.push({
                            time: closedCandles[i].time,
                            upper: Math.round(bb.upper * 100) / 100,
                            middle: Math.round(bb.middle * 100) / 100,
                            lower: Math.round(bb.lower * 100) / 100,
                        });
                    }
                }
            }

            res.json({
                levels: session.levels,
                currentPrice: session.currentPrice,
                strategy: session.strategy || 'scalper',
                bbHistory: bbHistory,
                position: session.position ? {
                    side: session.position.side,
                    entry: session.position.entryPrice,
                    stop: session.position.stop,
                    target: session.position.target,
                } : null,
            });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });


    /* ══════════════════════════════════════════
       ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    ══════════════════════════════════════════ */

    function calcWinRate(trades) {
        if (!trades.length) return null;
        const wins = trades.filter(t => t.pnl > 0).length;
        return Math.round((wins / trades.length) * 1000) / 10;
    }

    function getVolumeInfo(session) {
        if (!session.candles || session.candles.length < 22) return null;

        // Последняя закрытая свеча
        const closedCandles = session.candles.filter(c => c.closed);
        if (closedCandles.length < 21) return null;

        const lastCandle = closedCandles[closedCandles.length - 1];
        const prev20 = closedCandles.slice(-21, -1);
        const avgVolume = prev20.reduce((sum, c) => sum + c.volume, 0) / prev20.length;

        if (avgVolume === 0) return null;

        const ratio = lastCandle.volume / avgVolume;
        const needed = session.volumeMultiplier;

        return {
            current:  Math.round(lastCandle.volume * 100) / 100,
            average:  Math.round(avgVolume * 100) / 100,
            ratio:    Math.round(ratio * 100) / 100,
            needed:   needed,
            confirmed: ratio >= needed,
        };
    }

    function getClusterInfo(session) {
        if (!session.candles || session.candles.length < 5) return null;

        const closedCandles = session.candles.filter(c => c.closed);
        if (closedCandles.length < 3) return null;

        const lookback = session.clusterLookback || 5;
        const threshold = session.clusterThreshold || 80;
        const bgCandles = closedCandles.slice(-lookback);
        const bg = analyzeClusterGroup(bgCandles, threshold);

        // Последняя свеча
        const lastCandle = closedCandles[closedCandles.length - 1];
        const lastBuyPct = Math.round(analyzeCandleCluster(lastCandle));

        return {
            buyPct:        bg.buyPct,
            sellPct:       bg.sellPct,
            concentration: bg.concentration,
            trend:         bg.trend,
            lastCandleBuy: lastBuyPct,
            lastCandleSell: 100 - lastBuyPct,
            lookback:      bgCandles.length,
        };
    }

    function calcUnrealizedPnl(session) {
        const pos = session.position;
        if (!pos || !session.currentPrice) return 0;

        const diff = pos.side === 'LONG'
            ? (session.currentPrice - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - session.currentPrice) / pos.entryPrice;

        return Math.round(pos.size * diff * 100) / 100;
    }

    console.log('🤖 Bot Server v2 (Algo Scalper) routes loaded');
};
