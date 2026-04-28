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
const fs = require('fs');
const path = require('path');
const { createClient: createBinanceClient } = require('./binance-client');
const credsStore = require('./credentials-store');

module.exports = function(app) {

    /* ══════════════════════════════════════════
       ХРАНИЛИЩЕ СЕССИЙ
       uid → { settings, position, candles, levels, ... }
       Персистентность: автосохранение в bot-sessions.json каждые 30с
       + при graceful shutdown. Свечи и WS-состояние НЕ сохраняются
       (быстро перезагружаются при старте бота).
    ══════════════════════════════════════════ */
    const sessions = new Map();  // key: "uid:botId"

    const PERSIST_FILE = path.join(__dirname, 'bot-sessions.json');
    const PERSIST_INTERVAL_MS = 30_000;

    // Какие поля сохраняем на диск. Специально НЕ сохраняем:
    // - candles (массив из 200+ свечей, быстро подгрузится)
    // - ws (нельзя сериализовать)
    // - levels (пересчитаются из свечей)
    // - position (если сервер упал во время открытой позиции, безопаснее
    //   потерять её и не автоматически восстанавливать — биржа всё равно
    //   состояние позиции не знает в paper-режиме, а в live надо бы
    //   синхронизировать отдельно)
    const PERSISTED_FIELDS = [
        'uid', 'botId', 'botName', 'pair', 'symbol', 'timeframe', 'binanceInterval',
        'strategy', 'direction', 'entryMode', 'market',
        'virtualBalance', 'startBalance', '_startBalanceInit',
        'dayPnl', 'dayStartDate',
        'trades',
        'maxProfitPct', 'stopAtrMultiplier', 'positionTimeout', 'cooldownCandles',
        'maxLeverage', 'volumeMultiplier', 'riskPct', 'dayLimitPct', 'maxLosses',
        'trailingEnabled', 'trailingOffset', 'trailingActivation',
        'stepTpEnabled', 'stepTpTrigger', 'stepTpStep', 'stepTpTolerance',
        'bbExitEnabled', 'bbExitTolerance',
        'smaReturnEnabled', 'smaReturnTolerance',
        'atrFilterEnabled', 'atrFilterThreshold',
        'clusterEntryFilter', 'clusterThreshold', 'clusterLookback', 'clusterExitConfirm',
        'regimeFilterEnabled',
        'tradingWindowEU', 'tradingWindowUS',
        'rsiPeriod', 'rsiOversold', 'rsiOverbought',
        'bbPeriod', 'bbMultiplier',
        'levelTouches', 'levelTolerance',
        // ── Live mode (API ключи НЕ персистим — только флаги) ──
        // apiKey/apiSecret хранятся отдельно в зашифрованном виде (см. credentials store)
        'mode', 'apiTestnet',
    ];

    function serializeSession(session) {
        const out = {};
        for (const key of PERSISTED_FIELDS) {
            if (session[key] !== undefined) out[key] = session[key];
        }
        return out;
    }

    function saveSessionsToDisk() {
        try {
            const data = {};
            for (const [key, sess] of sessions) {
                data[key] = serializeSession(sess);
            }
            fs.writeFileSync(PERSIST_FILE, JSON.stringify(data), 'utf8');
        } catch(e) {
            console.error('[BOT PERSIST] Save failed:', e.message);
        }
    }

    function loadSessionsFromDisk() {
        try {
            if (!fs.existsSync(PERSIST_FILE)) {
                console.log('[BOT PERSIST] No existing ' + PERSIST_FILE + ' — starting fresh');
                return 0;
            }
            const raw = fs.readFileSync(PERSIST_FILE, 'utf8');
            const data = JSON.parse(raw);
            let loaded = 0;
            let tradesCount = 0;
            for (const [key, stored] of Object.entries(data)) {
                // Создаём сессию через getSession (установит все дефолты),
                // потом перезаписываем сохранёнными полями
                const [uid, botId] = key.split(':');
                if (!uid || !botId) continue;
                const session = getSession(uid, botId);
                for (const field of PERSISTED_FIELDS) {
                    if (stored[field] !== undefined) session[field] = stored[field];
                }
                // running сбрасываем — бот НЕ запускается автоматически,
                // пользователь должен нажать LIVE снова
                session.running = false;
                session.paused = false;
                session.position = null;  // открытые позиции теряются при рестарте
                tradesCount += (session.trades || []).length;
                loaded++;
            }
            console.log('[BOT PERSIST] Loaded ' + loaded + ' sessions with ' + tradesCount + ' total trades from ' + PERSIST_FILE);
            return loaded;
        } catch(e) {
            console.error('[BOT PERSIST] Load failed:', e.message);
            return 0;
        }
    }

    // Периодическое автосохранение
    setInterval(saveSessionsToDisk, PERSIST_INTERVAL_MS);

    // Сохранение при graceful shutdown
    let shutdownHandled = false;
    function gracefulSave(signal) {
        if (shutdownHandled) return;
        shutdownHandled = true;
        console.log('[BOT PERSIST] Received ' + signal + ', saving sessions...');
        saveSessionsToDisk();
        console.log('[BOT PERSIST] Sessions saved. Bye.');
        process.exit(0);
    }
    process.on('SIGINT',  () => gracefulSave('SIGINT'));
    process.on('SIGTERM', () => gracefulSave('SIGTERM'));
    process.on('beforeExit', () => saveSessionsToDisk());

    function ts() {
        return new Date().toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }

    // Полный лейбл бота (как в виджете клиента)
    function getFullBotLabel(session) {
        const s = '\u00b7'; // ·
        const pair = session.pair || '???';
        const strat = session.strategy === 'mean_reversion' ? 'MR'
                    : session.strategy === 'manual' ? 'MN'
                    : 'SC';
        const tf = session.timeframe || '5m';
        const mode = session.entryMode === 'tick' ? 'T' : 'C';
        const dir = session.direction === 'long' ? 'L' : session.direction === 'short' ? 'S' : 'L+S';
        let extra = '';
        if (session.trailingEnabled) extra += ` ${s} TR`;
        if (session.stepTpEnabled)   extra += ` ${s} STP`;
        if (session.bbExitEnabled) extra += ` ${s} BB`;
        if (session.clusterEntryFilter) extra += ` ${s} Cl`;
        if (session.regimeFilterEnabled) extra += ` ${s} R`;
        if (session.atrFilterEnabled) extra += ` ${s} A`;
        // Окно торговли (W12 = только EU, W17 = только US, W12-17 = оба)
        if (session.tradingWindowEU || session.tradingWindowUS) {
            let wTag = 'W';
            if (session.tradingWindowEU && session.tradingWindowUS) wTag = 'W12-17';
            else if (session.tradingWindowEU) wTag = 'W12';
            else if (session.tradingWindowUS) wTag = 'W17';
            extra += ` ${s} ${wTag}`;
        }
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
                    totalPnl: Math.round(((session.virtualBalance || 0) - (session.startBalance || 0)) * 100) / 100,
                    position: session.position ? session.position.side : null,
                    name: session.botName || null,
                    entryMode: session.entryMode || 'candle',
                    direction: session.direction || 'both',
                    trailingEnabled: session.trailingEnabled || false,
                    stepTpEnabled: session.stepTpEnabled || false,
                    stepTpTrigger: session.stepTpTrigger || 5.00,
                    stepTpStep: session.stepTpStep || 0.50,
                    stepTpTolerance: session.stepTpTolerance || 0.50,
                    rsiOverbought: session.rsiOverbought || 65,
                    rsiOversold: session.rsiOversold || 35,
                    clusterEntryFilter: session.clusterEntryFilter || false,
                    regimeFilterEnabled: session.regimeFilterEnabled || false,
                    tradingWindowEU: !!session.tradingWindowEU,
                    tradingWindowUS: !!session.tradingWindowUS,
                    atrFilterEnabled: session.atrFilterEnabled || false,
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
            case 'step_tp':       return 'StepTP';
            case 'timeout':       return 'Timeout';
            case 'cluster_exit':  return 'Cluster';
            case 'bb_touch':      return 'BB';
            case 'sma_return':    return 'SMA';
            case 'manual_close':  return 'Ручное';
            case 'manual_stop':   return 'Ручное';
            case 'manual_limit_exit': return 'Лим. выход';
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

            // Компактный тег бота для title: стратегия + RSI + флаги (STP/TR/A/CL/R/BB).
            // Без таймфрейма и направления — это видно по самой паре и направлению сделки.
            // Цель: чтобы юзер мог в push различить какой именно бот сработал из 50.
            const tagParts = [];
            const stratShort = session.strategy === 'mean_reversion' ? 'MR'
                            : session.strategy === 'manual' ? 'MN' : 'SC';
            tagParts.push(stratShort);
            if (session.rsiOversold || session.rsiOverbought) {
                tagParts.push(`${session.rsiOversold || 35}/${session.rsiOverbought || 65}`);
            }
            if (session.stepTpEnabled)       tagParts.push('STP');
            if (session.trailingEnabled)     tagParts.push('TR');
            if (session.atrFilterEnabled)    tagParts.push('A');
            if (session.clusterEntryFilter)  tagParts.push('CL');
            if (session.regimeFilterEnabled) tagParts.push('R');
            if (session.bbExitEnabled)       tagParts.push('BB');
            if (session.tradingWindowEU || session.tradingWindowUS) {
                let wTag = 'W';
                if (session.tradingWindowEU && session.tradingWindowUS) wTag = 'W12-17';
                else if (session.tradingWindowEU) wTag = 'W12';
                else if (session.tradingWindowUS) wTag = 'W17';
                tagParts.push(wTag);
            }
            const botTag = tagParts.join(' ');

            // Убираем /USDT из пары — и так понятно что котировка к USDT
            const pairShort = (session.pair || '').replace('/USDT', '').replace('USDT', '');

            const title = `${arrow} ${pairShort} ${botTag} ${pnlStr} (${pctStr}) \u00B7 ${reasonShort}`;
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

    /**
     * Push о критическом расхождении биржи и сайта.
     * Используется когда мы не смогли закрыть позицию даже после повторной попытки,
     * или обнаружили рассинхрон который не можем починить автоматически.
     * Это ВАЖНОЕ уведомление — должно дойти даже если notifyEnabled=false для торговых.
     */
    async function pushDesyncAlert(session, message) {
        if (!session) return;
        if (typeof global.sendPushToUser !== 'function') return;
        if (!session.uid) return;
        try {
            const title = '🚨 Критическая ошибка торговли';
            const subtitle = getFullBotLabel(session);
            await global.sendPushToUser(session.uid, title, message, {
                subtitle,
                link: '/app#journal',
                tag:  `bot-desync-${session.botId}-${Date.now()}`,
                priority: 'high',
            });
        } catch (e) {
            console.warn('[BOT] push desync error:', e.message);
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

                // ── Шаговый TP (Step TP / STP) — конкурент трейлингу ──
                // Логика: когда прибыль (Gross, в $) пересекает каждую ступеньку (trigger + N*step),
                // стоп переставляется на уровень прибыли (trigger + N*step − tolerance).
                // Взаимоисключает trailing (оба не могут быть включены одновременно).
                stepTpEnabled:   false,     // вкл/выкл
                stepTpTrigger:   5.00,      // порог активации в $ (первый уровень)
                stepTpStep:      0.50,      // шаг подтяжки в $
                stepTpTolerance: 0.50,      // зазор стопа от уровня в $

                // ── Выход по противоположной полосе Боллинджера (только для MR) ──
                bbExitEnabled:       false,  // если true — игнорируется minProfit и trailing
                bbExitTolerance:     5,      // % от ширины канала: насколько не дотягивать до ББ считать касанием
                smaReturnEnabled:    false,  // если true — закрываем при возврате к SMA после глубокого захода
                smaReturnTolerance:  5,      // % от ширины канала: глубина захода за SMA для поднятия флага wasBeyondSma

                // ── ATR-фильтр волатильности (ненаправленный) ──
                atrFilterEnabled:    false,  // если true — блокируем вход когда multiplier >= threshold
                atrFilterThreshold:  2.0,    // отношение atr14/atr50, выше которого это "импульс"

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

                // ── Binance Futures API (для live) ──
                apiKey:        '',
                apiSecret:     '',
                apiTestnet:    false,    // если true — используем testnet.binancefuture.com
                apiConnected:  false,    // подтверждено что ключи рабочие (после теста)

                // ── Live runtime state ──
                // Содержит cached binance-client (создаётся лениво при первом ордере)
                // и Set символов для которых уже выставлены leverage/margin/positionMode.
                // Не персистится — всё пересоздаётся при старте бота.
                _binanceClient:        null,
                _exchangeConfigured:   new Set(),
                _liveSymbolFilters:    null,  // кеш фильтров символа
                _liveSyncInterval:     null,  // setInterval для синхронизации с биржей
                _syncInFlight:         false, // защита от наложения sync-итераций
                _syncBusy:             false, // дебаунс: sync делает «тяжёлое» (закрытие phantom, переподнятие стопа)
                _syncLastActionAt:     0,     // timestamp последнего «тяжёлого» действия sync (anti-flap)
                _zombieWarnedAt:       0,     // throttle для повторных предупреждений о zombie-позициях
                _syncSizeWarnedAt:     0,     // throttle для предупреждений о расхождении размеров
                _syncStopWarnedAt:     0,     // throttle для предупреждений об отсутствии стопа
                exchangeMarkPrice:     null,  // последний markPrice с биржи (обновляется в sync)
                exchangeUnrealizedPnl: 0,     // последний unrealized P&L с биржи
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
                price:     avgPrice,
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

    /**
     * Определяет текущий режим волатильности через отношение короткого ATR к длинному.
     * Возвращает { multiplier, level, blocked } где:
     *   multiplier — atrShort/atrLong (1.0 = норма, 2.0 = вдвое больше обычного)
     *   level      — 'calm' | 'active' | 'impulse'
     *   blocked    — true если multiplier >= threshold (вход запрещать)
     *
     * Короткий ATR (14) реагирует на последние несколько свечей,
     * длинный (50) — это "нормальный" фон. Отношение растёт, когда
     * рынок входит в импульс (новость, ликвидация, паника).
     */
    function detectATRRegime(candles, threshold = 2.0) {
        const atrShort = calcATR(candles, 14);
        const atrLong  = calcATR(candles, 50);
        if (atrShort <= 0 || atrLong <= 0) {
            return { multiplier: 1.0, level: 'calm', blocked: false, atrShort: 0, atrLong: 0 };
        }
        const multiplier = atrShort / atrLong;
        let level;
        if (multiplier < 1.3)      level = 'calm';
        else if (multiplier < threshold) level = 'active';
        else                       level = 'impulse';
        return {
            multiplier: Math.round(multiplier * 100) / 100,
            level,
            blocked: multiplier >= threshold,
            atrShort: Math.round(atrShort * 100) / 100,
            atrLong:  Math.round(atrLong  * 100) / 100,
            threshold,
        };
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


    /* ══════════════════════════════════════════
       5c. MARKET REGIME — EMA50 + EMA200 на двух ТФ
       Определяет глобальный тренд: up / down / flat
       Блокирует вход против старшего тренда
    ══════════════════════════════════════════ */

    /**
     * Экспоненциальная скользящая средняя.
     * EMA = close_today × k + EMA_yesterday × (1 − k), где k = 2/(period+1).
     * Инициализируем как SMA первых `period` свечей (стандарт).
     * Возвращает массив EMA той же длины что и closes (первые period-1 значений = null).
     */
    function calcEMA(closes, period) {
        if (!closes || closes.length < period) return [];
        const k = 2 / (period + 1);
        const ema = new Array(closes.length).fill(null);

        // Seed: SMA первых `period` значений
        let sum = 0;
        for (let i = 0; i < period; i++) sum += closes[i];
        ema[period - 1] = sum / period;

        // Рекурсивный расчёт
        for (let i = period; i < closes.length; i++) {
            ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
        }
        return ema;
    }

    /* ════════════════════════════════════════════════════════════
       НОВЫЙ ДЕТЕКТОР РЕЖИМА РЫНКА (V2) — три таймфрейма

       Архитектура:
       - 4h  (контекст): EMA50/EMA200 + наклон EMA50 за 10 баров
       - 15m (тренд):    EMA21/EMA55 + ADX(14) для отсева флэта
       - 5m  (пульс):    EMA9/EMA21 + сдвиг цены за последние 12 свечей

       Каждый ТФ возвращает 'up' | 'down' | 'flat'.

       Решающее правило:
       - все три согласны вверх  → LONG
       - все три согласны вниз   → SHORT
       - любое расхождение/флэт  → BLOCK (полный запрет торговли)
       ════════════════════════════════════════════════════════════ */

    /**
     * ADX(14) — Average Directional Index по Уэллсу Уайлдеру.
     * Измеряет силу тренда независимо от направления.
     * < 20 — слабый тренд / флэт; > 25 — настоящий тренд.
     *
     * @returns {number|null} последнее значение ADX или null если недостаточно данных
     */
    function calcADX(candles, period = 14) {
        if (!candles || candles.length < period * 2 + 1) return null;

        const len = candles.length;
        const tr = new Array(len);
        const plusDM = new Array(len);
        const minusDM = new Array(len);

        tr[0] = candles[0].high - candles[0].low;
        plusDM[0] = 0;
        minusDM[0] = 0;

        for (let i = 1; i < len; i++) {
            const c = candles[i];
            const p = candles[i - 1];
            const upMove = c.high - p.high;
            const downMove = p.low - c.low;

            plusDM[i]  = (upMove > downMove && upMove > 0)   ? upMove   : 0;
            minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;

            const tr1 = c.high - c.low;
            const tr2 = Math.abs(c.high - p.close);
            const tr3 = Math.abs(c.low  - p.close);
            tr[i] = Math.max(tr1, tr2, tr3);
        }

        // Сглаживание Wilder (RMA): первое значение = SMA, дальше — рекуррентно
        let trS = 0, plusS = 0, minusS = 0;
        for (let i = 1; i <= period; i++) {
            trS    += tr[i];
            plusS  += plusDM[i];
            minusS += minusDM[i];
        }

        const dx = [];
        for (let i = period + 1; i < len; i++) {
            trS    = trS    - (trS / period)    + tr[i];
            plusS  = plusS  - (plusS / period)  + plusDM[i];
            minusS = minusS - (minusS / period) + minusDM[i];

            const plusDI  = trS === 0 ? 0 : (plusS  / trS) * 100;
            const minusDI = trS === 0 ? 0 : (minusS / trS) * 100;
            const sum = plusDI + minusDI;
            const dxVal = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
            dx.push(dxVal);
        }

        if (dx.length < period) return null;

        // ADX = RMA от DX
        let adx = 0;
        for (let i = 0; i < period; i++) adx += dx[i];
        adx = adx / period;
        for (let i = period; i < dx.length; i++) {
            adx = (adx * (period - 1) + dx[i]) / period;
        }

        return adx;
    }

    /**
     * Анализ 4ч-таймфрейма (контекст).
     * EMA50/EMA200 — направление + наклон EMA50 за последние 10 баров.
     */
    function analyzeRegime4h(candles) {
        if (!candles || candles.length < 210) return { state: 'flat', reason: 'not_enough_data' };

        const closes = candles.map(c => c.close);
        const ema50 = calcEMA(closes, 50);
        const ema200 = calcEMA(closes, 200);

        const last = closes.length - 1;
        const e50 = ema50[last];
        const e200 = ema200[last];
        const e50Prev = ema50[last - 10];
        if (e50 == null || e200 == null || e50Prev == null) return { state: 'flat', reason: 'no_ema' };

        const gap = Math.abs(e50 - e200) / e200 * 100;
        const slope = (e50 - e50Prev) / e50Prev * 100;

        // Гэп между EMA50 и EMA200 слишком мал → флэт
        if (gap < 0.15) return { state: 'flat', reason: 'ema_tangled', gap, slope };

        if (e50 > e200 && slope > 0.05) return { state: 'up',   reason: 'ok', gap, slope };
        if (e50 < e200 && slope < -0.05) return { state: 'down', reason: 'ok', gap, slope };

        return { state: 'flat', reason: 'mixed', gap, slope };
    }

    /**
     * Анализ 15m-таймфрейма (тренд).
     * EMA21/EMA55 + ADX(14). При ADX < 20 считаем что тренда нет.
     */
    function analyzeRegime15m(candles) {
        if (!candles || candles.length < 60) return { state: 'flat', reason: 'not_enough_data' };

        const closes = candles.map(c => c.close);
        const ema21 = calcEMA(closes, 21);
        const ema55 = calcEMA(closes, 55);

        const last = closes.length - 1;
        const e21 = ema21[last];
        const e55 = ema55[last];
        if (e21 == null || e55 == null) return { state: 'flat', reason: 'no_ema' };

        const adx = calcADX(candles, 14);
        if (adx == null) return { state: 'flat', reason: 'no_adx' };

        // ADX < 20 → нет тренда (флэт)
        if (adx < 20) return { state: 'flat', reason: 'low_adx', adx };

        if (e21 > e55) return { state: 'up',   reason: 'ok', adx };
        if (e21 < e55) return { state: 'down', reason: 'ok', adx };

        return { state: 'flat', reason: 'ema_equal', adx };
    }

    /**
     * Анализ 5m-таймфрейма (пульс).
     * EMA9/EMA21 + куда сдвинулась цена за последние 12 свечей (час).
     * Оба сигнала должны согласоваться.
     */
    function analyzeRegime5m(candles) {
        if (!candles || candles.length < 25) return { state: 'flat', reason: 'not_enough_data' };

        const closes = candles.map(c => c.close);
        const ema9  = calcEMA(closes, 9);
        const ema21 = calcEMA(closes, 21);

        const last = closes.length - 1;
        const e9 = ema9[last];
        const e21 = ema21[last];
        if (e9 == null || e21 == null) return { state: 'flat', reason: 'no_ema' };

        // Сдвиг цены за последние 12 свечей (1 час на 5m)
        if (last < 12) return { state: 'flat', reason: 'no_history' };
        const priceNow = closes[last];
        const priceHourAgo = closes[last - 12];
        const moveP = (priceNow - priceHourAgo) / priceHourAgo * 100;

        // Чтобы избежать шума требуем минимальный сдвиг 0.1%
        const emaUp = e9 > e21;
        const emaDown = e9 < e21;
        const moveUp = moveP > 0.1;
        const moveDown = moveP < -0.1;

        if (emaUp && moveUp) return { state: 'up',   reason: 'ok', move: moveP };
        if (emaDown && moveDown) return { state: 'down', reason: 'ok', move: moveP };

        return { state: 'flat', reason: 'ema_move_disagree', move: moveP };
    }

    /**
     * Кэши для V2-детектора с разной частотой обновления:
     * - 4h:  раз в час
     * - 15m: раз в 10 минут
     * - 5m:  раз в 5 минут
     * Ключ кэша: symbol.
     */
    const _regimeCacheV2 = {
        h4:  new Map(),  // { state, reason, ... , updatedAt }
        m15: new Map(),
        m5:  new Map(),
    };
    const REGIME_V2_TTL = {
        h4:  60 * 60 * 1000,  // 1 час
        m15: 10 * 60 * 1000,  // 10 минут
        m5:  5  * 60 * 1000,  // 5 минут
    };

    /**
     * Главный оркестратор V2: возвращает разрешённое направление по правилу
     * «все три согласны или блок».
     *
     * @returns объект:
     * {
     *   tf4h: { state, reason, ... },
     *   tf15m: { state, reason, ..., adx },
     *   tf5m: { state, reason, ..., move },
     *   allowed: 'LONG' | 'SHORT' | 'BLOCK',
     *   updatedAt: number,
     * }
     */
    async function detectMarketRegimeV2(symbol) {
        const now = Date.now();

        // 4h — берём из кэша или загружаем
        let tf4h;
        const c4 = _regimeCacheV2.h4.get(symbol);
        if (c4 && now - c4.updatedAt < REGIME_V2_TTL.h4) {
            tf4h = c4.data;
        } else {
            try {
                const candles4h = await loadHistoricalCandles(symbol, '4h', 250);
                tf4h = analyzeRegime4h(candles4h);
                tf4h.updatedAt = now;
                _regimeCacheV2.h4.set(symbol, { data: tf4h, updatedAt: now });
            } catch (e) {
                tf4h = { state: 'flat', reason: 'fetch_error', error: e.message, updatedAt: now };
            }
        }

        // 15m
        let tf15m;
        const c15 = _regimeCacheV2.m15.get(symbol);
        if (c15 && now - c15.updatedAt < REGIME_V2_TTL.m15) {
            tf15m = c15.data;
        } else {
            try {
                const candles15m = await loadHistoricalCandles(symbol, '15m', 100);
                tf15m = analyzeRegime15m(candles15m);
                tf15m.updatedAt = now;
                _regimeCacheV2.m15.set(symbol, { data: tf15m, updatedAt: now });
            } catch (e) {
                tf15m = { state: 'flat', reason: 'fetch_error', error: e.message, updatedAt: now };
            }
        }

        // 5m
        let tf5m;
        const c5 = _regimeCacheV2.m5.get(symbol);
        if (c5 && now - c5.updatedAt < REGIME_V2_TTL.m5) {
            tf5m = c5.data;
        } else {
            try {
                const candles5m = await loadHistoricalCandles(symbol, '5m', 50);
                tf5m = analyzeRegime5m(candles5m);
                tf5m.updatedAt = now;
                _regimeCacheV2.m5.set(symbol, { data: tf5m, updatedAt: now });
            } catch (e) {
                tf5m = { state: 'flat', reason: 'fetch_error', error: e.message, updatedAt: now };
            }
        }

        // Решающее правило: все три согласны → разрешаем направление; иначе блок
        let allowed = 'BLOCK';
        if (tf4h.state === 'up'   && tf15m.state === 'up'   && tf5m.state === 'up')   allowed = 'LONG';
        if (tf4h.state === 'down' && tf15m.state === 'down' && tf5m.state === 'down') allowed = 'SHORT';

        return {
            tf4h:    tf4h,
            tf15m:   tf15m,
            tf5m:    tf5m,
            allowed: allowed,
            updatedAt: now,
        };
    }

    /**
     * Определяет режим по EMA50 и EMA200 на одном таймфрейме.
     *
     * Правила:
     * - UP:   EMA50 > EMA200  И  EMA50 растёт (текущая > 10 баров назад)
     * - DOWN: EMA50 < EMA200  И  EMA50 падает
     * - FLAT: все остальные случаи (переплетаются, горизонтальные)
     *
     * @param {Array} candles — массив свечей (закрытых)
     * @returns {string} 'up' | 'down' | 'flat'
     */
    function detectRegimeForTF(candles) {
        if (!candles || candles.length < 210) return 'flat';

        const closes = candles.map(c => c.close);
        const ema50 = calcEMA(closes, 50);
        const ema200 = calcEMA(closes, 200);

        const last = closes.length - 1;
        const e50 = ema50[last];
        const e200 = ema200[last];
        if (e50 == null || e200 == null) return 'flat';

        // Сравниваем с EMA50 за 10 баров назад для определения угла наклона
        const e50Prev = ema50[last - 10];
        if (e50Prev == null) return 'flat';

        // Разрыв между EMA50 и EMA200 (насколько значимо отклонение)
        const gap = Math.abs(e50 - e200) / e200 * 100; // в процентах

        // Если разрыв меньше 0.1% — считаем что EMA переплетаются (флет)
        if (gap < 0.1) return 'flat';

        // Наклон EMA50 (в процентах от цены)
        const slope = (e50 - e50Prev) / e50Prev * 100;

        // UP: EMA50 выше EMA200 и растёт
        if (e50 > e200 && slope > 0.02) return 'up';
        // DOWN: EMA50 ниже EMA200 и падает
        if (e50 < e200 && slope < -0.02) return 'down';

        // Переплетение или противоречие направления и наклона
        return 'flat';
    }

    /* ──────────────────────────────────────────────
       ОКНО ТОРГОВЛИ (W) — временные фильтры по UTC

       Европа:  07:05 – 11:55 UTC  (5 часов чистых, с буферами по 5 минут)
       US Open: 13:05 – 16:55 UTC  (4 часа чистых, с буферами по 5 минут)

       Логика:
       - Оба тумблера выключены  → торгуем круглосуточно (старое поведение).
       - Включён хоть один       → торгуем только в активных окнах.
       ────────────────────────────────────────────── */

    const TRADING_WINDOW_EU_START_MIN = 7 * 60 + 5;   // 07:05 UTC = 425 минут от полуночи
    const TRADING_WINDOW_EU_END_MIN   = 11 * 60 + 55; // 11:55 UTC = 715 минут
    const TRADING_WINDOW_US_START_MIN = 13 * 60 + 5;  // 13:05 UTC = 785 минут
    const TRADING_WINDOW_US_END_MIN   = 16 * 60 + 55; // 16:55 UTC = 1015 минут

    /**
     * Возвращает текущую активную метку окна для журнала: 'EU' | 'US' | 'EU+US' | 'all' | 'none'
     */
    function getActiveWindowLabel(session) {
        const eu = !!session.tradingWindowEU;
        const us = !!session.tradingWindowUS;
        if (!eu && !us) return 'all';
        if (eu && us) return 'EU+US';
        return eu ? 'EU' : 'US';
    }

    /**
     * Проверяет, можно ли сейчас торговать по временному фильтру.
     * @returns {boolean} true если разрешено, false если бот должен ждать.
     */
    function isInsideTradingWindow(session) {
        const eu = !!session.tradingWindowEU;
        const us = !!session.tradingWindowUS;
        // Оба выключены → ограничений нет
        if (!eu && !us) return true;

        const now = new Date();
        const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();

        if (eu && minOfDay >= TRADING_WINDOW_EU_START_MIN && minOfDay <= TRADING_WINDOW_EU_END_MIN) {
            return true;
        }
        if (us && minOfDay >= TRADING_WINDOW_US_START_MIN && minOfDay <= TRADING_WINDOW_US_END_MIN) {
            return true;
        }
        return false;
    }

    /**
     * Универсальный фильтр режима рынка (V2).
     * Возвращает true если сделку нужно блокировать.
     *
     * Используется в checkSignalMeanReversion / checkTickEntry / checkSignal.
     */
    function isBlockedByRegime(session, side, ctx = '') {
        if (!session.regimeFilterEnabled) return false;
        if (!session.regime || !session.regime.allowed) return false;
        const allowed = session.regime.allowed;
        // 'BLOCK' — никакая сторона не разрешена
        if (allowed === 'BLOCK') {
            const r = session.regime;
            const stateStr = `4h=${r.tf4h ? r.tf4h.state : '?'}, 15m=${r.tf15m ? r.tf15m.state : '?'}, 5m=${r.tf5m ? r.tf5m.state : '?'}`;
            console.log(`[BOT ${ts()}] 🚫 ${ctx}${side} blocked by regime V2 (BLOCK): ${stateStr}`);
            return true;
        }
        // Старый формат совместимости ('LONG' / 'SHORT' / 'BOTH')
        if (allowed === 'BOTH') return false;
        if (allowed !== side) {
            const r = session.regime;
            const stateStr = r.tf4h ? `4h=${r.tf4h.state}, 15m=${r.tf15m.state}, 5m=${r.tf5m.state}`
                                    : `${r.tfHigher}=${r.higher}, ${r.tfMain}=${r.main}`;
            console.log(`[BOT ${ts()}] 🚫 ${ctx}${side} blocked by regime: ${stateStr} → allowed ${allowed}`);
            return true;
        }
        return false;
    }

    /**
     * Кэш режимов: ключ = symbol, значение = { data, updatedAt }.
     * Режим пересчитываем максимум раз в 15 минут (900 сек),
     * т.к. основная 15m-свеча за это время полностью обновляется.
     */
    const _regimeCache = new Map();
    const REGIME_TTL_MS = 15 * 60 * 1000; // 15 минут

    /**
     * Определяет режим рынка для торговой пары.
     * Для 5m-бота смотрим 15m + 1h; для 1m-бота — 5m + 15m.
     *
     * @param {string} symbol — 'BTCUSDT'
     * @param {string} tradingTF — '5m' | '1m'
     * @returns {Promise<{h1: string, m15: string, m5: string, allowed: string, higher: string, main: string}>}
     */
    async function detectMarketRegime(symbol, tradingTF = '5m') {
        const now = Date.now();
        const cacheKey = symbol + ':' + tradingTF;
        const cached = _regimeCache.get(cacheKey);
        if (cached && (now - cached.updatedAt) < REGIME_TTL_MS) {
            return cached.data;
        }

        // Выбираем какие ТФ использовать в зависимости от торгового
        // Для 5m: main = 15m, higher = 1h
        // Для 1m: main = 5m,  higher = 15m
        const tfMain = tradingTF === '1m' ? '5m' : '15m';
        const tfHigher = tradingTF === '1m' ? '15m' : '1h';

        try {
            // Загружаем 250 свечей каждого ТФ (для EMA200 нужно минимум 200)
            const [candlesMain, candlesHigher] = await Promise.all([
                loadHistoricalCandles(symbol, tfMain, 250),
                loadHistoricalCandles(symbol, tfHigher, 250),
            ]);

            const regimeMain = detectRegimeForTF(candlesMain);
            const regimeHigher = detectRegimeForTF(candlesHigher);

            // Таблица решений:
            // higher = down      → только SHORT
            // higher = up        → только LONG
            // higher = flat + main = up   → только LONG
            // higher = flat + main = down → только SHORT
            // оба flat           → BOTH
            let allowed = 'BOTH';
            if (regimeHigher === 'down') allowed = 'SHORT';
            else if (regimeHigher === 'up') allowed = 'LONG';
            else if (regimeHigher === 'flat') {
                if (regimeMain === 'up') allowed = 'LONG';
                else if (regimeMain === 'down') allowed = 'SHORT';
                else allowed = 'BOTH';
            }

            const data = {
                higher:     regimeHigher,   // 'up' | 'down' | 'flat'
                main:       regimeMain,     // 'up' | 'down' | 'flat'
                tfHigher:   tfHigher,       // '1h' | '15m'
                tfMain:     tfMain,         // '15m' | '5m'
                allowed:    allowed,        // 'LONG' | 'SHORT' | 'BOTH'
                updatedAt:  now,
            };

            _regimeCache.set(cacheKey, { data, updatedAt: now });
            return data;
        } catch(e) {
            console.error(`[BOT] detectMarketRegime(${symbol}) failed:`, e.message);
            // При ошибке не блокируем торговлю — возвращаем BOTH
            return {
                higher: 'flat', main: 'flat',
                tfHigher, tfMain,
                allowed: 'BOTH', updatedAt: now, error: true,
            };
        }
    }


    function checkSignalMeanReversion(session) {
        const { candles, market } = session;
        if (candles.length < 30) return null;

        // ── Окно торговли (W) ──
        if (!isInsideTradingWindow(session)) return null;

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

        // ── Фильтр режима рынка (V2: 4h + 15m + 5m) ──
        // Работает только если тумблер regimeFilterEnabled включён пользователем.
        if (isBlockedByRegime(session, side, '')) return null;

        // ── ATR-фильтр волатильности (ненаправленный) ──
        // Блокируем вход в любую сторону, когда atr14/atr50 >= threshold.
        if (session.atrFilterEnabled && session.atrRegime && session.atrRegime.blocked) {
            console.log(`[BOT ${ts()}] 🚫 ${side} blocked by ATR impulse: ×${session.atrRegime.multiplier} >= ${session.atrRegime.threshold}`);
            return null;
        }

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
        const smaTarget = bb.middle;
        const minProfitPct = session.maxProfitPct || 1.0;
        const minTarget = side === 'LONG'
            ? price * (1 + minProfitPct / 100)
            : price * (1 - minProfitPct / 100);
        const target = side === 'LONG'
            ? Math.max(smaTarget, minTarget)
            : Math.min(smaTarget, minTarget);

        // ── Стоп = за полосой + ATR × множитель ──
        const atr = calcATR(candles, 20);
        if (atr <= 0) return null;

        const stopAtrDist = atr * (session.stopAtrMultiplier || 1.5);
        const stop = side === 'LONG'
            ? (bb.lower - stopAtrDist)
            : (bb.upper + stopAtrDist);

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
            atr: atr,
            riskReward: Math.round((reward / risk) * 100) / 100,
            rsi: Math.round(rsi * 10) / 10,
            bbUpper: bb.upper,
            bbMiddle: bb.middle,
            bbLower: bb.lower,
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

        // ── Окно торговли (W) ──
        if (!isInsideTradingWindow(session)) return;

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

        // ── Фильтр режима рынка (V2: 4h + 15m + 5m) ──
        if (isBlockedByRegime(session, side, 'tick ')) return;

        // ── ATR-фильтр волатильности ──
        if (session.atrFilterEnabled && session.atrRegime && session.atrRegime.blocked) {
            console.log(`[BOT ${ts()}] 🚫 tick ${side} blocked by ATR impulse: ×${session.atrRegime.multiplier} >= ${session.atrRegime.threshold}`);
            return;
        }

        // ── Кластерный фильтр при входе (если включён) ──
        if (session.clusterEntryFilter) {
            const bgCandles = closedCandles.slice(-(session.clusterLookback || 10));
            const bg = analyzeClusterGroup(bgCandles, 60);
            const fading = checkClusterFading(closedCandles, side, bg.buyPct);
            if (!fading.fading) return;
        }

        // ── Таргет = макс(SMA, минимальный профит) ──
        const smaTarget = bb.middle;
        const minProfitPct = session.maxProfitPct || 1.0;
        const minTarget = side === 'LONG'
            ? price * (1 + minProfitPct / 100)
            : price * (1 - minProfitPct / 100);
        const target = side === 'LONG'
            ? Math.max(smaTarget, minTarget)
            : Math.min(smaTarget, minTarget);

        // ── Стоп ──
        const atr = calcATR(candles, 20);
        if (atr <= 0) return;
        const stopAtrDist = atr * (session.stopAtrMultiplier || 1.5);
        const stop = side === 'LONG'
            ? (bb.lower - stopAtrDist)
            : (bb.upper + stopAtrDist);

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
            atr: atr,
            riskReward: Math.round((reward / risk) * 100) / 100,
            rsi: Math.round(rsi * 10) / 10,
            bbUpper: bb.upper,
            bbMiddle: bb.middle,
            bbLower: bb.lower,
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

        // ── Окно торговли (W) ──
        if (!isInsideTradingWindow(session)) return null;

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

        // ── Фильтр режима рынка (V2: 4h + 15m + 5m) ──
        if (isBlockedByRegime(session, side, '')) return null;

        // ── ATR-фильтр волатильности ──
        if (session.atrFilterEnabled && session.atrRegime && session.atrRegime.blocked) {
            console.log(`[BOT ${ts()}] 🚫 ${side} blocked by ATR impulse: ×${session.atrRegime.multiplier} >= ${session.atrRegime.threshold}`);
            return null;
        }

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
            stop:      stop,
            target:    tp,
            atr:       atr,
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
        // В manual-стратегии, если выбран режим 'fixed' — размер = фикс % от баланса,
        // независимо от расстояния до стопа. Это проще для понимания, но риск на сделку
        // меняется в зависимости от того, насколько далеко стоп.
        if (session.strategy === 'manual' && session.manualSizeMode === 'fixed') {
            const fixedPct = session.manualFixedSizePct || 10;
            let size = session.virtualBalance * (fixedPct / 100);
            // Всё равно ограничиваем максимальным плечом, чтобы не открыть позицию больше,
            // чем позволяет баланс × плечо.
            const maxLev = session.market === 'spot' ? 1 : (session.maxLeverage || 5);
            const maxSize = session.virtualBalance * maxLev;
            if (size > maxSize) size = maxSize;
            console.log(`[BOT ${ts()}] 📐 Manual fixed size: balance=$${session.virtualBalance.toFixed(2)} fixedPct=${fixedPct}% → size=$${size.toFixed(2)}`);
            return size;
        }

        // Стандартный расчёт по риску от расстояния до стопа (scalper / MR / manual-risk)
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

    /* ══════════════════════════════════════════════════════════════
       LIVE TRADING HELPERS
       
       Цепочка для реального открытия позиции на Binance Futures.
       Вызывается из openPosition только если session.mode === 'live'.
       
       Архитектурный подход:
       - openPosition остаётся синхронной (paper-ветка не меняется).
       - Для Live ставится временная "плейсхолдер" позиция с _pending=true,
         которая блокирует новые входы пока идёт async-цепочка.
       - При успехе плейсхолдер заполняется реальными данными с биржи.
       - При любой ошибке плейсхолдер удаляется — позиции не появилось.
       - Если market-вход прошёл но стоп НЕ удалось выставить — это
         критическая ситуация, немедленно закрываем позицию обратным
         market-ордером. Безопасность важнее.
    ══════════════════════════════════════════════════════════════ */

    /**
     * Лениво создать или достать кешированный binance-client для сессии.
     * Один клиент на всю жизнь сессии в памяти; при перезапуске сервера
     * пересоздаётся при следующем старте бота.
     */
    function getLiveClient(session) {
        if (session._binanceClient) return session._binanceClient;
        if (!session.apiKey || !session.apiSecret) return null;
        session._binanceClient = createBinanceClient({
            apiKey:    session.apiKey,
            apiSecret: session.apiSecret,
            testnet:   !!session.apiTestnet,
        });
        return session._binanceClient;
    }

    /**
     * Один раз на сессию для каждого символа выставить ISOLATED, leverage,
     * one-way mode. Binance возвращает разные ошибки которые на самом деле OK:
     *   -4046 "No need to change margin type"
     *   -4047 "Margin type cannot be changed if there exists position" (есть позиция — не меняем, оставляем как есть)
     *   -4059 "No need to change position side"
     *   -4068 "Position side cannot be changed if there exists position" (есть позиция от другого бота — оставляем как есть)
     *   -2014 "API-key format invalid" (это не ок, это реальная ошибка)
     * Эти "ошибки" мы игнорируем — они означают либо "уже как надо", либо "конфликт с
     * открытой позицией от другого бота, оставим как есть".
     *
     * Возвращает { ok, error? }. Кеширует факт настройки в _exchangeConfigured,
     * чтобы не дёргать биржу повторно.
     */
    async function ensureLiveSetup(session, symbol, leverage) {
        if (session._exchangeConfigured && session._exchangeConfigured.has(symbol)) {
            return { ok: true, cached: true };
        }
        const client = getLiveClient(session);
        if (!client) return { ok: false, error: 'Binance client not initialized (missing keys)' };

        console.log(`[LIVE ${ts()}] ⚙️  Setting up ${symbol}: position-mode=ONE_WAY, margin=ISOLATED, leverage=${leverage}x`);

        // Коды которые мы считаем "это ок, идём дальше":
        // -4046: No need to change margin type (уже ISOLATED)
        // -4047: Margin type cannot be changed if there exists position
        // -4059: No need to change position side (уже ONE_WAY)
        // -4067: Position side cannot be changed if there exists open orders
        // -4068: Position side cannot be changed if there exists position
        // Любая из этих ошибок означает: либо настройка уже какая надо, либо нельзя
        // её менять из-за конфликта с другим ботом — оставляем как есть и идём дальше.
        const isBenignSetupError = (apiCode) =>
            apiCode === -4046 || apiCode === -4047 ||
            apiCode === -4059 || apiCode === -4067 || apiCode === -4068;

        // 1. One-way mode (false = одна позиция на символ). Глобальная настройка.
        const pmRes = await client.setPositionMode(false);
        if (!pmRes.ok && !isBenignSetupError(pmRes.apiCode)) {
            console.error(`[LIVE ${ts()}] ❌ setPositionMode failed: ${pmRes.error} (code ${pmRes.apiCode || '?'})`);
            return { ok: false, error: 'setPositionMode failed: ' + pmRes.error };
        }
        if (!pmRes.ok) {
            console.log(`[LIVE ${ts()}] ℹ️  setPositionMode: ${pmRes.error} (code ${pmRes.apiCode}) — это ок, режим уже выставлен`);
        }

        // 2. Isolated margin (per-symbol). Если на этом символе уже есть позиция
        //    (например от другого бота) — поменять нельзя, но это значит margin уже какой надо.
        const mtRes = await client.setMarginType(symbol, 'ISOLATED');
        if (!mtRes.ok && !isBenignSetupError(mtRes.apiCode)) {
            console.error(`[LIVE ${ts()}] ❌ setMarginType failed: ${mtRes.error} (code ${mtRes.apiCode || '?'})`);
            return { ok: false, error: 'setMarginType failed: ' + mtRes.error };
        }
        if (!mtRes.ok) {
            console.log(`[LIVE ${ts()}] ℹ️  setMarginType: ${mtRes.error} (code ${mtRes.apiCode}) — это ок, margin уже выставлен`);
        }

        // 3. Leverage. Если есть открытая позиция — биржа тоже может вернуть -4046.
        //    Тоже терпимо — плечо у позиции уже какое-то, просто не наше.
        const lvRes = await client.setLeverage(symbol, leverage);
        if (!lvRes.ok && !isBenignSetupError(lvRes.apiCode)) {
            console.error(`[LIVE ${ts()}] ❌ setLeverage failed: ${lvRes.error} (code ${lvRes.apiCode || '?'})`);
            return { ok: false, error: 'setLeverage failed: ' + lvRes.error };
        }
        if (!lvRes.ok) {
            console.log(`[LIVE ${ts()}] ℹ️  setLeverage: ${lvRes.error} (code ${lvRes.apiCode}) — это ок, плечо уже выставлено`);
        }

        if (!session._exchangeConfigured) session._exchangeConfigured = new Set();
        session._exchangeConfigured.add(symbol);
        console.log(`[LIVE ${ts()}] ✅ Setup complete for ${symbol}`);
        return { ok: true };
    }

    /**
     * Полная цепочка открытия позиции на бирже:
     * 1. ensureLiveSetup (margin/leverage/positionMode)
     * 2. getSymbolFilters → округлить quantity до stepSize
     * 3. Проверить minQty / minNotional
     * 4. placeMarketOrder
     * 5. getOrder → реальная fill-цена и кол-во
     * 6. placeStopMarketOrder с closePosition=true
     * 7. Если стоп не выставился — закрыть позицию обратным market-ордером
     * 8. Заполнить session.position реальными данными
     *
     * Возвращает { ok, fillPrice?, fillQty?, commission?, stopOrderId?, entryOrderId?, error? }.
     * НЕ создаёт session.position — это делает вызывающий код в openPosition.
     */
    async function executeOpenLive(session, signal, plannedQuantity) {
        const client = getLiveClient(session);
        if (!client) return { ok: false, error: 'Binance client not initialized' };

        const symbol = session.symbol;
        const side   = signal.side === 'LONG' ? 'BUY' : 'SELL';   // сторона входа
        const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';     // сторона стопа

        // Расчётное плечо для этого ордера. Используем maxLeverage из настроек,
        // даже если фактически позиция меньше — биржа разрешит более низкое плечо.
        const leverage = parseInt(session.maxLeverage) || 3;

        console.log(`[LIVE-OPEN ${ts()}] STEP 1: ensureLiveSetup ${symbol} leverage=${leverage}x`);
        // 1. Setup символа (один раз на сессию)
        const setup = await ensureLiveSetup(session, symbol, leverage);
        if (!setup.ok) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 1 FAILED: ${setup.error}`);
            return { ok: false, error: setup.error };
        }
        console.log(`[LIVE-OPEN ${ts()}] ✓ STEP 1 OK${setup.cached ? ' (cached)' : ''}`);

        console.log(`[LIVE-OPEN ${ts()}] STEP 2: getSymbolFilters ${symbol}`);
        // 2. Фильтры символа
        const filtersRes = await client.getSymbolFilters(symbol);
        if (!filtersRes.ok) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 2 FAILED: getSymbolFilters: ${filtersRes.error}`);
            return { ok: false, error: 'getSymbolFilters failed: ' + filtersRes.error };
        }
        const f = filtersRes.data;
        console.log(`[LIVE-OPEN ${ts()}] ✓ STEP 2 OK: stepSize=${f.stepSize} tickSize=${f.tickSize} minQty=${f.minQty} minNotional=${f.minNotional}`);

        // 3. Округлить quantity вниз до stepSize
        const qty = client.roundDownToStep(plannedQuantity, f.stepSize);
        console.log(`[LIVE-OPEN ${ts()}] STEP 3: qty rounded ${plannedQuantity} → ${qty}`);
        if (qty <= 0) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 3 FAILED: qty rounded to 0`);
            return { ok: false, error: `Quantity ${plannedQuantity} округлилось до 0 (stepSize=${f.stepSize})` };
        }
        if (f.minQty != null && qty < f.minQty) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 3 FAILED: qty ${qty} < minQty ${f.minQty}`);
            return { ok: false, error: `Quantity ${qty} < minQty ${f.minQty}. Увеличь баланс или risk%.` };
        }
        if (f.minNotional != null && qty * signal.entry < f.minNotional) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 3 FAILED: notional ${(qty*signal.entry).toFixed(2)} < ${f.minNotional}`);
            return { ok: false, error: `Notional ${(qty*signal.entry).toFixed(2)} < minNotional ${f.minNotional}` };
        }

        console.log(`[LIVE-OPEN ${ts()}] STEP 4: 📤 placeMarketOrder ${side} ${symbol} qty=${qty}`);

        // 4. Market-ордер
        const orderRes = await client.placeMarketOrder(symbol, side, qty, false);
        if (!orderRes.ok) {
            console.error(`[LIVE-OPEN ${ts()}] ❌ STEP 4 FAILED: ${orderRes.error} (code ${orderRes.apiCode || '?'})`);
            return { ok: false, error: 'placeMarketOrder failed: ' + orderRes.error };
        }
        const orderId = orderRes.data.orderId;
        console.log(`[LIVE-OPEN ${ts()}] ✓ STEP 4 OK: orderId=${orderId} status=${orderRes.data.status} avgPrice=${orderRes.data.avgPrice}`);

        // 5. Реальные данные fill'а. avgPrice уже в ответе на market — используем сразу;
        //    но для точной комиссии нужны userTrades по orderId.
        let fillPrice = parseFloat(orderRes.data.avgPrice) || signal.entry;
        let fillQty   = parseFloat(orderRes.data.executedQty) || qty;
        let commission = 0;
        let commissionAsset = 'USDT';

        try {
            const trades = await client.getUserTrades(symbol, { orderId, limit: 50 });
            if (trades.ok && Array.isArray(trades.data) && trades.data.length > 0) {
                let notional = 0;
                let totalQty = 0;
                for (const t of trades.data) {
                    const p = parseFloat(t.price);
                    const q = parseFloat(t.qty);
                    notional += p * q;
                    totalQty += q;
                    commission += parseFloat(t.commission) || 0;
                    commissionAsset = t.commissionAsset || commissionAsset;
                }
                if (totalQty > 0) {
                    fillPrice = notional / totalQty;
                    fillQty = totalQty;
                }
                console.log(`[LIVE ${ts()}] 📊 Fills: ${trades.data.length}, totalQty=${totalQty}, avgPrice=${fillPrice.toFixed(6)}, commission=${commission} ${commissionAsset}`);
            }
        } catch (e) {
            console.warn(`[LIVE ${ts()}] ⚠️  getUserTrades failed (non-fatal): ${e.message}. Using order-level avgPrice.`);
        }

        // 6. Стоп-лосс на бирже. Округляем stopPrice до tickSize.
        const stopPrice = client.roundToTick(signal.stop, f.tickSize);
        console.log(`[LIVE ${ts()}] 📤 Placing STOP_MARKET ${oppositeSide} ${symbol} stopPrice=${stopPrice} (closePosition=true)`);

        let stopRes = await client.placeStopMarketOrder(symbol, oppositeSide, stopPrice, {
            workingType: 'MARK_PRICE',
        });

        // Один ретрай при сбое — сетевой глюк или гонка
        if (!stopRes.ok) {
            console.warn(`[LIVE ${ts()}] ⚠️  STOP_MARKET first attempt failed: ${stopRes.error}. Retry...`);
            await new Promise(r => setTimeout(r, 500));
            stopRes = await client.placeStopMarketOrder(symbol, oppositeSide, stopPrice, {
                workingType: 'MARK_PRICE',
            });
        }

        // 7. Если стоп так и не выставился — позиция открыта без защиты. Закрываем!
        if (!stopRes.ok) {
            console.error(`[LIVE ${ts()}] 🚨 CRITICAL: STOP_MARKET failed twice — closing position immediately!`);
            console.error(`[LIVE ${ts()}] 🚨 Last error: ${stopRes.error} (code ${stopRes.apiCode || '?'})`);
            try {
                const closeRes = await client.placeMarketOrder(symbol, oppositeSide, fillQty, true);
                if (closeRes.ok) {
                    console.log(`[LIVE ${ts()}] ✅ Emergency close OK: orderId=${closeRes.data.orderId}`);
                } else {
                    console.error(`[LIVE ${ts()}] 🚨🚨 EMERGENCY CLOSE ALSO FAILED: ${closeRes.error}`);
                    console.error(`[LIVE ${ts()}] 🚨🚨 МАНУАЛЬНО ЗАКРОЙ ПОЗИЦИЮ В БИРЖЕВОМ ИНТЕРФЕЙСЕ ${symbol}!`);
                }
            } catch (e) {
                console.error(`[LIVE ${ts()}] 🚨🚨 EMERGENCY CLOSE EXCEPTION: ${e.message}`);
                console.error(`[LIVE ${ts()}] 🚨🚨 МАНУАЛЬНО ЗАКРОЙ ПОЗИЦИЮ В БИРЖЕВОМ ИНТЕРФЕЙСЕ ${symbol}!`);
            }
            return {
                ok: false,
                error: 'Стоп не удалось выставить, позиция аварийно закрыта. Проверь Binance и логи.',
            };
        }

        const stopOrderId = stopRes.data.algoId;  // в новом Algo API возвращается algoId, а не orderId
        console.log(`[LIVE ${ts()}] ✅ STOP_MARKET placed: algoId=${stopOrderId}`);

        return {
            ok:           true,
            entryOrderId: orderId,
            stopOrderId:  stopOrderId,
            fillPrice,
            fillQty,
            commission,
            commissionAsset,
            slippage:     fillPrice - signal.entry,  // знак: + для SHORT-проскальзывания, - для LONG-проскальзывания (хуже)
        };
    }

    function openPosition(session, signal) {
        if (session.position) return; // уже есть открытая (или _pending плейсхолдер)

        const size = calcPositionSize(session, signal.entry, signal.stop);
        if (size <= 0) return;

        // ── LIVE: ставим плейсхолдер и запускаем async-цепочку ──
        // Плейсхолдер _pending блокирует новые входы (см. session.position проверку выше),
        // пока биржа отрабатывает market-вход и постановку стопа. После успеха —
        // плейсхолдер заполняется реальными данными. После ошибки — обнуляется.
        if (session.mode === 'live') {
            // quantity = size (USDT) / entry price = базовая валюта (BTC, ETH и т.д.)
            const plannedQty = size / signal.entry;

            // Плейсхолдер. Минимум полей чтобы блокировать дублирующий вход.
            session.position = {
                _pending:   true,
                _pendingAt: Date.now(),
                side:       signal.side,
                entryPrice: signal.entry,  // временно сигнальная цена; перезапишется fill-ценой
                stop:       signal.stop,
                target:     signal.target,
                size:       size,
            };
            console.log(`[BOT ${ts()}] 🔄 LIVE: opening ${signal.side} ${session.symbol}, planned qty=${plannedQty}, size=$${size.toFixed(2)}`);

            // Fire-and-forget. Если упадём — обнулим session.position в catch.
            executeOpenLive(session, signal, plannedQty)
                .then(result => {
                    if (!result.ok) {
                        console.error(`[BOT ${ts()}] ❌ LIVE open FAILED: ${result.error}`);
                        // Если позиция была плейсхолдером — снимаем. Если её уже сменил
                        // closePosition (что маловероятно но возможно), не трогаем.
                        if (session.position && session.position._pending) {
                            session.position = null;
                        }
                        return;
                    }
                    // Успех — заполняем настоящую позицию реальными данными
                    finalizeOpenPosition(session, signal, result, size);
                })
                .catch(err => {
                    console.error(`[BOT ${ts()}] 💥 LIVE open exception: ${err.message}`);
                    console.error(err.stack);
                    if (session.position && session.position._pending) {
                        session.position = null;
                    }
                });
            return;
        }

        // ── PAPER: всё как раньше, синхронно ──
        finalizeOpenPosition(session, signal, null, size);
    }

    /**
     * Финализирует session.position: заполняет все поля, пишет лог.
     * В paper-ветке вызывается сразу из openPosition.
     * В live-ветке вызывается после успешной цепочки executeOpenLive.
     *
     * liveResult: null для paper, объект с биржевыми данными для live.
     */
    function finalizeOpenPosition(session, signal, liveResult, size) {
        // Реальная цена / комиссия — для live из биржи, для paper из сигнала.
        const entryPrice = liveResult ? liveResult.fillPrice : signal.entry;
        const slippage   = liveResult ? liveResult.slippage  : 0;

        session.position = {
            side:       signal.side,
            entryPrice: entryPrice,
            stop:       signal.stop,
            target:     signal.target,
            size:       size,
            openedAt:   Date.now(),
            candlesHeld: 0,
            level:      signal.level,
            riskReward: signal.riskReward,
            entryType:  signal.concentration === 'manual' ? 'manual' : (signal.concentration === 'tick' ? 'bot_tick' : 'bot'),
            // source различает, как попала позиция в систему: 'manual' — клик пользователя
            // (Market/Limit), 'auto' — автосигнал бота. Используется в журнале для фильтрации статистики.
            source:     signal.concentration === 'manual' ? 'manual' : 'auto',
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
            regimeFilterEnabled: session.regimeFilterEnabled || false,
            // ── Снэпшот окна торговли при входе ──
            tradingWindowAtEntry: getActiveWindowLabel(session),
            entryHourUTC:        new Date().getUTCHours(),
            entryMinuteUTC:      new Date().getUTCMinutes(),
            // ── Снэпшот режима рынка при входе (V2: 4h + 15m + 5m) ──
            entryRegime:     session.regime ? {
                tf4hState:    session.regime.tf4h  ? session.regime.tf4h.state  : null,
                tf15mState:   session.regime.tf15m ? session.regime.tf15m.state : null,
                tf5mState:    session.regime.tf5m  ? session.regime.tf5m.state  : null,
                tf15mAdx:     session.regime.tf15m ? session.regime.tf15m.adx   : null,
                tf5mMove:     session.regime.tf5m  ? session.regime.tf5m.move   : null,
                allowed:      session.regime.allowed,
            } : null,
            // ── Трекинг max/min для анализа ──
            maxUnrealized:   0,
            maxDrawdown:     0,
            maxUnrealizedAt: null,
            maxUnrealizedPrice: null,
            maxDrawdownAt:   null,
            maxDrawdownPrice: null,
            firstMoveSide:   null,
            trailingActivatedAt:    null,
            trailingActivatedPrice: null,
            trailingActivatedPnl:   null,
            // ── Трекинг Step TP (STP) ──
            stepTpActive:           false,
            stepTpLastLevel:        -1,
            stepTpActivatedAt:      null,
            stepTpActivatedPrice:   null,
            stepTpActivatedPnl:     null,
            stepTpMaxLevel:         null,
            // ── Live: данные с биржи ──
            // Эти поля только для live-режима. orderId нужен для подтяжки стопа в Step TP
            // (cancel + new), commission — для журнала. signalEntry хранит "что было расчётно",
            // чтобы потом видеть проскальзывание в журнале.
            liveEntryOrderId: liveResult ? liveResult.entryOrderId : null,
            liveStopOrderId:  liveResult ? liveResult.stopOrderId  : null,
            liveFillQty:      liveResult ? liveResult.fillQty      : null,
            liveEntryCommission: liveResult ? liveResult.commission : 0,
            liveCommissionAsset: liveResult ? liveResult.commissionAsset : null,
            signalEntry:      signal.entry,
            slippageEntry:    slippage,
        };

        // Запоминаем кластеры при входе + считаем три варианта для лога
        let clusterDetails = '';
        try {
            const closedForEntry = session.candles.filter(c => c.closed);
            const lb = session.clusterLookback || 10;
            const bgEntry = analyzeClusterGroup(closedForEntry.slice(-lb), 60);
            session.position.entryClusterBuy = bgEntry.buyPct;

            const bg3 = analyzeClusterGroup(closedForEntry.slice(-3), 60);
            const lastC = closedForEntry[closedForEntry.length - 1];
            const triggerBuy = lastC ? Math.round(analyzeCandleCluster(lastC)) : 50;

            const filterStatus = session.clusterEntryFilter ? 'ON' : 'OFF';
            clusterDetails = ` | Cluster[trig:${triggerBuy}% /3c:${bg3.buyPct}% /${lb}c:${bgEntry.buyPct}% filter:${filterStatus}]`;
        } catch(e) {}

        const stratInfo = signal.rsi !== undefined
            ? `RSI: ${signal.rsi} | BB: ${signal.bbLower}/${signal.bbMiddle}/${signal.bbUpper}`
            : `Cluster: trigger=${signal.triggerBuyPct}% bg=${signal.backgroundBuyPct}%`;
        const modeTag = session.mode === 'live' ? '🔴 LIVE' : '📄 PAPER';
        const slipInfo = liveResult ? ` | Slip: ${slippage >= 0 ? '+' : ''}${slippage.toFixed(4)}` : '';
        console.log(`[BOT ${ts()}] ✅ ${modeTag} OPENED ${signal.side} @ ${entryPrice} | Stop: ${signal.stop} (ATR:${signal.atr}) | Target: ${signal.target == null ? '—' : signal.target} | Size: ${size.toFixed(2)} USDT | R:R ${signal.riskReward == null ? '—' : signal.riskReward} | ${stratInfo} | Vol: ${signal.volumeRatio}x${clusterDetails}${slipInfo}`);
    }

    function closePosition(session, price, reason) {
        const pos = session.position;
        if (!pos) return;
        // Плейсхолдер _pending — позиция ещё открывается на бирже, закрывать нечего
        if (pos._pending) {
            console.warn(`[BOT ${ts()}] ⚠️  closePosition called for _pending placeholder — ignoring (reason=${reason})`);
            return;
        }
        // Уже идёт асинхронное закрытие — повторно не запускаем
        if (pos._closing) {
            console.log(`[BOT ${ts()}] (closePosition skipped: already _closing, reason=${reason})`);
            return;
        }

        // ── LIVE: помечаем _closing и запускаем async-цепочку ──
        // Флаг блокирует повторные вызовы closePosition (от тиков, таймаута,
        // cluster exit и т.д.), пока биржа отрабатывает market-close.
        // По завершении: либо finalizeClosePosition с реальной fill-ценой и комиссией,
        // либо в случае ошибки — снимаем _closing и оставляем позицию (она реально
        // ещё открыта на бирже).
        if (session.mode === 'live') {
            pos._closing = true;
            pos._closingReason = reason;
            pos._closingPriceHint = price; // запасной вариант если биржа не вернёт fill
            console.log(`[BOT ${ts()}] 🔄 LIVE: closing ${pos.side} ${session.symbol} @ ~${price} (reason: ${reason})`);

            executeCloseLive(session, pos, reason)
                .then(result => {
                    if (!result.ok) {
                        console.error(`[BOT ${ts()}] ❌ LIVE close FAILED: ${result.error}`);
                        // Снимаем флаг чтобы можно было попробовать закрыть снова
                        // (например пользователь нажмёт CLOSE ещё раз).
                        // Позиция в session.position остаётся — она реально открыта на бирже.
                        if (session.position && session.position._closing) {
                            session.position._closing = false;
                            session.position._closingReason = null;
                            session.position._closingPriceHint = null;
                        }
                        return;
                    }
                    // Успех (или биржа сообщила что позиции уже нет — учли в executeCloseLive).
                    // Финализируем с реальными данными.
                    finalizeClosePosition(session, pos, result, reason);
                })
                .catch(err => {
                    console.error(`[BOT ${ts()}] 💥 LIVE close exception: ${err.message}`);
                    console.error(err.stack);
                    if (session.position && session.position._closing) {
                        session.position._closing = false;
                        session.position._closingReason = null;
                    }
                });
            return;
        }

        // ── PAPER: всё как раньше, синхронно ──
        // Сохраняем цену в hint так же как для live, чтобы finalizeClosePosition
        // мог унифицированно её использовать.
        pos._closingPriceHint = price;
        finalizeClosePosition(session, pos, null, reason);
    }

    /**
     * Полная цепочка закрытия позиции на бирже:
     * 1. Отправить market-ордер в обратную сторону с reduceOnly=true
     * 2. Получить реальную fill-цену и комиссию через getUserTrades
     * 3. Отменить оставшийся STOP_MARKET (algoId), чтобы не сработал на пустой
     *    позиции и не открыл противоположную сделку
     *
     * Если позиция на бирже уже отсутствует (стоп сам сработал, или закрыли вручную):
     *   - Binance вернёт ошибку -2022 ReduceOnly или -2027 (no position)
     *   - В этом случае пытаемся узнать как именно она закрылась через
     *     getPositionRisk: positionAmt должен быть 0
     *   - Записываем сделку с priceHint (текущая цена) и reason='external_close'
     *
     * Возвращает { ok, fillPrice, fillQty, commission, slippage, externallyClosed?, error? }.
     */
    async function executeCloseLive(session, pos, reason) {
        const client = getLiveClient(session);
        if (!client) return { ok: false, error: 'Binance client not initialized' };

        const symbol = session.symbol;
        // Сторона close-ордера противоположна стороне позиции
        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        // Используем реально исполненный qty с биржи (с округлением, как в open)
        const qty = pos.liveFillQty || (pos.size / pos.entryPrice);

        console.log(`[LIVE ${ts()}] 📤 Placing MARKET ${closeSide} ${symbol} qty=${qty} reduceOnly=true (close)`);

        // 1. Market-ордер в обратную сторону с reduceOnly. Если позиции уже нет
        //    (стоп сработал) — биржа вернёт ошибку, обработаем ниже.
        const orderRes = await client.placeMarketOrder(symbol, closeSide, qty, true);

        // Обработка случая когда позиции на бирже уже нет
        if (!orderRes.ok) {
            // -2022: "ReduceOnly Order is rejected" / -2027: "Exceeded the maximum allowable position"
            // Также возможна ошибка о том что позиция отсутствует.
            // Проверяем через getPositionRisk: если positionAmt == 0, значит закрыта вне нас.
            console.warn(`[LIVE ${ts()}] ⚠️  Close order rejected: ${orderRes.error} (code ${orderRes.apiCode || '?'})`);
            const posRiskRes = await client.getPositionRisk(symbol);
            if (posRiskRes.ok && Array.isArray(posRiskRes.data)) {
                const posOnExch = posRiskRes.data.find(p => p.symbol === symbol);
                const amt = posOnExch ? parseFloat(posOnExch.positionAmt) : 0;
                if (amt === 0) {
                    console.log(`[LIVE ${ts()}] ℹ️  Position already closed on exchange (probably stop triggered or manual close on Binance UI)`);
                    // Отменяем оставшийся стоп если он ещё висит (на всякий случай)
                    await cancelStopIfExists(client, symbol, pos.liveStopOrderId);

                    // Пытаемся достать реальную fill-цену и комиссию из истории сделок.
                    // Берём сделки за последние 5 минут с противоположной стороны
                    // (для LONG позиции — SELL fills, это наш стоп-fill).
                    let realFillPrice = pos._closingPriceHint || session.currentPrice || pos.entryPrice;
                    let realFillQty   = pos.liveFillQty || qty;
                    let realCommission = 0;
                    let realCommissionAsset = pos.liveCommissionAsset || 'USDT';

                    try {
                        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
                        const histRes = await client.getUserTrades(symbol, { limit: 50 });
                        if (histRes.ok && Array.isArray(histRes.data) && histRes.data.length > 0) {
                            // Фильтруем: свежие (за 5 минут) + противоположная сторона позиции
                            const targetSide = closeSide; // SELL для LONG, BUY для SHORT
                            const closeFills = histRes.data.filter(t =>
                                t.side === targetSide &&
                                parseFloat(t.time || t.timestamp || 0) >= fiveMinAgo
                            );
                            if (closeFills.length > 0) {
                                let notional = 0;
                                let totalQty = 0;
                                for (const t of closeFills) {
                                    const p = parseFloat(t.price);
                                    const q = parseFloat(t.qty);
                                    notional += p * q;
                                    totalQty += q;
                                    realCommission += parseFloat(t.commission) || 0;
                                    realCommissionAsset = t.commissionAsset || realCommissionAsset;
                                }
                                if (totalQty > 0) {
                                    realFillPrice = notional / totalQty;
                                    realFillQty = totalQty;
                                }
                                console.log(`[LIVE ${ts()}] 📊 Stop fill recovered: ${closeFills.length} trades, totalQty=${totalQty}, avgPrice=${realFillPrice.toFixed(6)}, commission=${realCommission} ${realCommissionAsset}`);
                            } else {
                                console.warn(`[LIVE ${ts()}] ⚠️  No matching ${targetSide} fills in last 5 min — fee will be 0 for this trade`);
                            }
                        }
                    } catch (e) {
                        console.warn(`[LIVE ${ts()}] ⚠️  History fetch failed for stop-fill: ${e.message}. fee=0 for this trade`);
                    }

                    return {
                        ok: true,
                        externallyClosed: true,
                        fillPrice:        realFillPrice,
                        fillQty:          realFillQty,
                        commission:       realCommission,
                        commissionAsset:  realCommissionAsset,
                        slippage:         realFillPrice - (pos._closingPriceHint || pos.entryPrice),
                        reason:           'external_close',
                    };
                }
            }
            // Позиция всё ещё есть, но close-ордер упал — возвращаем ошибку наверх
            return { ok: false, error: 'placeMarketOrder (close) failed: ' + orderRes.error };
        }

        const orderId = orderRes.data.orderId;
        console.log(`[LIVE ${ts()}] ✅ MARKET (close) filled: orderId=${orderId} status=${orderRes.data.status} avgPrice=${orderRes.data.avgPrice}`);

        // 2. Реальные fill-данные через getUserTrades
        let fillPrice = parseFloat(orderRes.data.avgPrice) || pos._closingPriceHint || session.currentPrice;
        let fillQty   = parseFloat(orderRes.data.executedQty) || qty;
        let commission = 0;
        let commissionAsset = pos.liveCommissionAsset || 'USDT';

        try {
            const trades = await client.getUserTrades(symbol, { orderId, limit: 50 });
            if (trades.ok && Array.isArray(trades.data) && trades.data.length > 0) {
                let notional = 0;
                let totalQty = 0;
                for (const t of trades.data) {
                    const p = parseFloat(t.price);
                    const q = parseFloat(t.qty);
                    notional += p * q;
                    totalQty += q;
                    commission += parseFloat(t.commission) || 0;
                    commissionAsset = t.commissionAsset || commissionAsset;
                }
                if (totalQty > 0) {
                    fillPrice = notional / totalQty;
                    fillQty = totalQty;
                }
                console.log(`[LIVE ${ts()}] 📊 Close fills: ${trades.data.length}, totalQty=${totalQty}, avgPrice=${fillPrice.toFixed(6)}, commission=${commission} ${commissionAsset}`);
            }
        } catch (e) {
            console.warn(`[LIVE ${ts()}] ⚠️  getUserTrades (close) failed (non-fatal): ${e.message}. Using order-level avgPrice.`);
        }

        // ── ДВОЙНАЯ ПРОВЕРКА: позиция реально закрылась? ──
        // Биржа сказала filled, getUserTrades подтвердил fills, НО хотим убедиться
        // что на бирже реально позиции больше нет. Защита от:
        //   - частичного исполнения (qty уехал, но не весь)
        //   - багов биржи когда filled приходит раньше фактического обновления позиции
        //   - расхождения нашей памяти с реальностью
        // Если позиция всё ещё есть — повторяем reduceOnly на остаток.
        // Если и второй раз не помогло — критическая ошибка с push-уведомлением.
        try {
            await new Promise(r => setTimeout(r, 2000));
            const verifyRes = await client.getPositionRisk(symbol);
            if (verifyRes.ok && Array.isArray(verifyRes.data)) {
                const posOnExch = verifyRes.data.find(p => p.symbol === symbol);
                const remainingAmt = posOnExch ? Math.abs(parseFloat(posOnExch.positionAmt)) : 0;

                if (remainingAmt > 0) {
                    console.error(`[LIVE ${ts()}] 🚨 CLOSE VERIFY FAILED: position still on exchange! remaining=${remainingAmt} ${symbol} (filled said ${fillQty}, but exchange still shows ${remainingAmt})`);
                    console.error(`[LIVE ${ts()}] 🔁 Retrying close for remaining ${remainingAmt}...`);

                    // Повторяем market reduceOnly на остаток
                    const retryRes = await client.placeMarketOrder(symbol, closeSide, remainingAmt, true);
                    if (retryRes.ok) {
                        console.log(`[LIVE ${ts()}] ✅ Retry close OK: orderId=${retryRes.data.orderId}`);

                        // Подтянем доп. fills и комиссию из retry-ордера
                        try {
                            const retryTrades = await client.getUserTrades(symbol, { orderId: retryRes.data.orderId, limit: 50 });
                            if (retryTrades.ok && Array.isArray(retryTrades.data)) {
                                let retryNotional = 0;
                                let retryQty = 0;
                                for (const t of retryTrades.data) {
                                    retryNotional += parseFloat(t.price) * parseFloat(t.qty);
                                    retryQty      += parseFloat(t.qty);
                                    commission    += parseFloat(t.commission) || 0;
                                }
                                if (retryQty > 0) {
                                    // Усредняем fillPrice по обоим ордерам взвешенно
                                    const totalNotional = fillPrice * fillQty + retryNotional;
                                    fillQty   += retryQty;
                                    fillPrice  = totalNotional / fillQty;
                                    console.log(`[LIVE ${ts()}] 📊 Combined fill: avgPrice=${fillPrice.toFixed(6)} totalQty=${fillQty} totalCommission=${commission}`);
                                }
                            }
                        } catch (e) {
                            console.warn(`[LIVE ${ts()}] ⚠️  Retry getUserTrades failed: ${e.message}`);
                        }

                        // Финальная проверка после retry — если опять висит, шлём push
                        await new Promise(r => setTimeout(r, 2000));
                        const finalRes = await client.getPositionRisk(symbol);
                        if (finalRes.ok && Array.isArray(finalRes.data)) {
                            const finalPos = finalRes.data.find(p => p.symbol === symbol);
                            const finalAmt = finalPos ? Math.abs(parseFloat(finalPos.positionAmt)) : 0;
                            if (finalAmt > 0) {
                                console.error(`[LIVE ${ts()}] 🚨🚨 CRITICAL: position STILL on exchange after retry! remaining=${finalAmt} ${symbol}. Manual intervention required!`);
                                pushDesyncAlert(session, `Не удалось закрыть позицию ${symbol}: на бирже остаток ${finalAmt}. Закрой вручную в Binance!`);
                            } else {
                                console.log(`[LIVE ${ts()}] ✅ Final verify OK: position closed after retry`);
                            }
                        }
                    } else {
                        console.error(`[LIVE ${ts()}] 🚨🚨 RETRY CLOSE FAILED: ${retryRes.error} (code ${retryRes.apiCode || '?'})`);
                        pushDesyncAlert(session, `Не удалось закрыть позицию ${symbol} (повторная попытка не прошла). Закрой вручную в Binance!`);
                    }
                } else {
                    // Норма — позиция реально закрылась
                    console.log(`[LIVE ${ts()}] ✓ Close verified: position is 0 on exchange`);
                }
            }
        } catch (e) {
            console.warn(`[LIVE ${ts()}] ⚠️  Close verification failed (non-fatal): ${e.message}`);
        }

        // 3. Отменить оставшийся STOP_MARKET. Если этого не сделать —
        //    стоп будет висеть с closePosition=true и при триггере откроет
        //    противоположную позицию. Это критично!
        await cancelStopIfExists(client, symbol, pos.liveStopOrderId);

        // Slippage exit — для LONG лучше = выше fillPrice, для SHORT лучше = ниже fillPrice.
        // signed как (fill - hint), интерпретация одинакова с slippageEntry.
        const slippage = fillPrice - (pos._closingPriceHint || pos.entryPrice);

        return {
            ok: true,
            fillPrice,
            fillQty,
            commission,
            commissionAsset,
            slippage,
            externallyClosed: false,
        };
    }

    /**
     * Отменить алго-ордер (стоп). Не падает если ордера уже нет (например стоп
     * сработал и был автоматически снят биржей). Логирует результат.
     */
    async function cancelStopIfExists(client, symbol, algoId) {
        if (!algoId) return;
        try {
            const res = await client.cancelAlgoOrder(symbol, algoId);
            if (res.ok) {
                console.log(`[LIVE ${ts()}] ✅ Cancelled stop algoId=${algoId}`);
            } else {
                // -2011 / -2026: "Order does not exist" — это норма, стоп уже снят/сработал
                if (res.apiCode === -2011 || res.apiCode === -2026) {
                    console.log(`[LIVE ${ts()}] ℹ️  Stop algoId=${algoId} already gone (probably triggered or pre-cancelled)`);
                } else {
                    console.warn(`[LIVE ${ts()}] ⚠️  Stop cancel failed: ${res.error} (code ${res.apiCode || '?'}) — manual check recommended`);
                }
            }
        } catch (e) {
            console.warn(`[LIVE ${ts()}] ⚠️  Stop cancel exception (non-fatal): ${e.message}`);
        }
    }

    /**
     * Подтяжка биржевого STOP_MARKET в Live-режиме (для Step TP).
     * Атомарность недостижима — между cancel и new есть короткое окно
     * (~100-300мс), когда стопа на бирже нет. Это плата за trailing-стопы
     * на любых биржах.
     *
     * Если new упал — это критично (позиция без защиты): пытаемся ретрай,
     * затем emergency-close позиции. Тот же подход что в executeOpenLive.
     *
     * Возвращает { ok, newAlgoId?, error? }. НЕ обновляет pos.liveStopOrderId —
     * это делает вызывающий код в Step TP при ok=true.
     */
    async function executeStepTpUpdateLive(session, pos, newStopPrice) {
        const client = getLiveClient(session);
        if (!client) return { ok: false, error: 'Binance client not initialized' };

        const symbol = session.symbol;
        const oppositeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const oldAlgoId = pos.liveStopOrderId;

        // Округляем новую цену стопа до tickSize символа.
        const filtersRes = await client.getSymbolFilters(symbol);
        if (!filtersRes.ok) {
            return { ok: false, error: 'getSymbolFilters failed: ' + filtersRes.error };
        }
        const tickSize = filtersRes.data.tickSize;
        const newStopRounded = client.roundToTick(newStopPrice, tickSize);

        console.log(`[LIVE ${ts()}] 🎯 Step TP exchange update: cancel algoId=${oldAlgoId} → new STOP_MARKET ${oppositeSide} @ ${newStopRounded}`);

        // 1. Cancel старого стопа. Если его уже нет (стоп сработал) — ловим тихо.
        if (oldAlgoId) {
            const cancelRes = await client.cancelAlgoOrder(symbol, oldAlgoId);
            if (!cancelRes.ok) {
                if (cancelRes.apiCode === -2011 || cancelRes.apiCode === -2026) {
                    // Старый стоп уже снят (мог сработать или был отменён извне).
                    // Если стоп сработал — позиции на бирже скорее всего нет.
                    // Проверим: если позиции нет, не ставим новый стоп.
                    console.warn(`[LIVE ${ts()}] ⚠️  Step TP: old stop already gone, checking position...`);
                    const posRiskRes = await client.getPositionRisk(symbol);
                    if (posRiskRes.ok && Array.isArray(posRiskRes.data)) {
                        const posOnExch = posRiskRes.data.find(p => p.symbol === symbol);
                        const amt = posOnExch ? parseFloat(posOnExch.positionAmt) : 0;
                        if (amt === 0) {
                            console.log(`[LIVE ${ts()}] ℹ️  Step TP: position closed on exchange (stop triggered) — skipping new stop`);
                            return { ok: false, error: 'position_already_closed', positionGone: true };
                        }
                    }
                    // Позиция ещё есть, но старого стопа нет — ставим новый
                } else {
                    console.error(`[LIVE ${ts()}] ❌ Step TP cancel failed: ${cancelRes.error} (code ${cancelRes.apiCode || '?'})`);
                    return { ok: false, error: 'cancel old stop failed: ' + cancelRes.error };
                }
            }
        }

        // 2. New STOP_MARKET на новой цене
        let newRes = await client.placeStopMarketOrder(symbol, oppositeSide, newStopRounded, {
            workingType: 'MARK_PRICE',
        });

        // ── Особый случай: -2021 "Order would immediately trigger" ──
        // Цена ушла настолько далеко в нашу сторону, что новый стоп уже сработал бы
        // в момент постановки. Это значит:
        //   - Закрывать позицию НЕ нужно (мы и так в большем плюсе чем планировали)
        //   - Step TP пока пропускаем (восстановим старый стоп как safety net)
        //   - На следующем тике увидим ещё больший peak и попробуем снова
        // Без этой обработки бот ловил -2021 и делал emergency close, теряя
        // потенциальную прибыль и платя лишнюю taker-комиссию.
        if (!newRes.ok && newRes.apiCode === -2021) {
            console.warn(`[LIVE ${ts()}] ⚠️  Step TP -2021: price ushла далеко, restoring old stop @ ${pos.stop}, will retry on next tick`);
            const oldStopRounded = client.roundToTick(pos.stop, tickSize);
            const restoreRes = await client.placeStopMarketOrder(symbol, oppositeSide, oldStopRounded, {
                workingType: 'MARK_PRICE',
            });
            if (restoreRes.ok) {
                console.log(`[LIVE ${ts()}] ✅ Restored stop @ ${oldStopRounded}: algoId=${restoreRes.data.algoId}`);
                return {
                    ok: true,
                    newAlgoId: restoreRes.data.algoId,
                    skipped: true,  // Step TP подтяжка не применилась, но позиция защищена
                };
            }
            // Если даже старый стоп не встаёт — падаем в общую ветку emergency close ниже.
            console.error(`[LIVE ${ts()}] ❌ Restore old stop also failed: ${restoreRes.error} (${restoreRes.apiCode}) — falling through to emergency close`);
            newRes = restoreRes; // продолжим обработку как fatal
        }

        // Один ретрай при других сетевых/временных ошибках (НЕ -2021 — там ретраи бесполезны)
        if (!newRes.ok && newRes.apiCode !== -2021) {
            console.warn(`[LIVE ${ts()}] ⚠️  Step TP new stop first attempt failed: ${newRes.error}. Retry...`);
            await new Promise(r => setTimeout(r, 500));
            newRes = await client.placeStopMarketOrder(symbol, oppositeSide, newStopRounded, {
                workingType: 'MARK_PRICE',
            });
        }

        if (!newRes.ok) {
            // КРИТИЧНО: позиция без стопа. Аварийно закрываем market-ордером.
            console.error(`[LIVE ${ts()}] 🚨 CRITICAL: Step TP new stop failed twice — closing position immediately!`);
            console.error(`[LIVE ${ts()}] 🚨 Last error: ${newRes.error} (code ${newRes.apiCode || '?'})`);
            try {
                const qty = pos.liveFillQty || (pos.size / pos.entryPrice);
                const closeRes = await client.placeMarketOrder(symbol, oppositeSide, qty, true);
                if (closeRes.ok) {
                    console.log(`[LIVE ${ts()}] ✅ Emergency close OK: orderId=${closeRes.data.orderId}`);
                    return { ok: false, error: 'Step TP failed, position emergency-closed', emergencyClosed: true };
                } else {
                    console.error(`[LIVE ${ts()}] 🚨🚨 EMERGENCY CLOSE ALSO FAILED: ${closeRes.error}`);
                    console.error(`[LIVE ${ts()}] 🚨🚨 МАНУАЛЬНО ЗАКРОЙ ПОЗИЦИЮ В БИРЖЕВОМ ИНТЕРФЕЙСЕ ${symbol}!`);
                }
            } catch (e) {
                console.error(`[LIVE ${ts()}] 🚨🚨 EMERGENCY CLOSE EXCEPTION: ${e.message}`);
                console.error(`[LIVE ${ts()}] 🚨🚨 МАНУАЛЬНО ЗАКРОЙ ПОЗИЦИЮ В БИРЖЕВОМ ИНТЕРФЕЙСЕ ${symbol}!`);
            }
            return { ok: false, error: 'Step TP failed and emergency close failed' };
        }

        const newAlgoId = newRes.data.algoId;
        console.log(`[LIVE ${ts()}] ✅ Step TP new stop placed: algoId=${newAlgoId}`);
        return { ok: true, newAlgoId };
    }

    /* ══════════════════════════════════════════════════════════════
       LIVE: ОБНОВЛЕНИЕ ДАННЫХ С БИРЖИ ДЛЯ UI

       Раз в N секунд опрашиваем биржу и обновляем markPrice + unrealizedPnl
       в session, чтобы карточка позиции в UI показывала актуальные числа.

       Никаких автоматических действий: ни phantom-detection, ни re-place стопа,
       ни zombie-уведомлений. Юзер ведёт всю торговлю через сайт; если что-то
       пошло не так — увидит расхождение в UI и решит сам.
    ══════════════════════════════════════════════════════════════ */

    /**
     * Sync-цикл (10с). Делает 4 проверки согласованности памяти и биржи:
     *   1) Phantom — позиция в памяти есть, на бирже нет → закрываем как external_close
     *   2) Zombie — на бирже есть, в памяти нет → подбираем в память, ставим стоп если нет
     *   3) Size mismatch — размеры не совпадают → корректируем pos.liveFillQty, варн
     *   4) Stop missing — pos.liveStopOrderId есть, на бирже его нет → переподнимаем
     *
     * Защита:
     *   - _syncInFlight: не накладываем тики друг на друга
     *   - _syncBusy: если уже делаем тяжёлую операцию — следующий тик пропускает
     *   - _syncLastActionAt + ANTI_FLAP_MS: после любого «тяжёлого» действия ждём минуту
     *   - Не трогаем pos с _pending/_closing/_stepTpPending
     */
    const SYNC_ANTI_FLAP_MS = 60 * 1000; // после тяжёлого действия — пауза 60с
    const SYNC_QTY_EPS_REL  = 0.005;     // 0.5% — допуск для сравнения размеров (округление биржи)

    async function syncLiveStateWithExchange(session) {
        if (!session.running)            return;
        if (session.mode !== 'live')     return;
        if (session._syncInFlight)       return;
        if (session._syncBusy)           return; // дебаунс: предыдущая тяжёлая операция ещё не доехала

        // Если идёт активная операция в основном пайплайне — не мешаем ей.
        const pos = session.position;
        if (pos && (pos._pending || pos._closing || pos._stepTpPending)) return;

        session._syncInFlight = true;
        try {
            const client = getLiveClient(session);
            if (!client) return;

            const symbol = session.symbol;

            // ── Шаг 1: тянем позицию с биржи ──
            const posRiskRes = await client.getPositionRisk(symbol);
            if (!posRiskRes.ok) {
                console.warn(`[LIVE-SYNC ${ts()}] getPositionRisk failed: ${posRiskRes.error || 'unknown'}`);
                return;
            }

            const posOnExch = (posRiskRes.data || []).find(p => p.symbol === symbol);
            const exchAmt    = posOnExch ? parseFloat(posOnExch.positionAmt) : 0;
            const exchEntry  = posOnExch ? parseFloat(posOnExch.entryPrice)  : 0;
            const hasOnExch  = exchAmt !== 0;

            // Обновляем UI-снэпшот всегда (как было раньше)
            if (hasOnExch) {
                session.exchangePositionAmt   = exchAmt;
                session.exchangeMarkPrice     = parseFloat(posOnExch.markPrice) || null;
                session.exchangeUnrealizedPnl = parseFloat(posOnExch.unRealizedProfit) || 0;
            } else {
                session.exchangePositionAmt   = 0;
                session.exchangeMarkPrice     = null;
                session.exchangeUnrealizedPnl = 0;
            }

            // ── Anti-flap: если только что что-то делали — на этом тике только UI-снэпшот ──
            const now = Date.now();
            if (now - (session._syncLastActionAt || 0) < SYNC_ANTI_FLAP_MS) {
                return;
            }

            // ── Перечитываем pos (могла измениться, пока шёл await) ──
            const curPos = session.position;
            if (curPos && (curPos._pending || curPos._closing || curPos._stepTpPending)) return;

            const hasInMem = !!curPos;

            // ── Проверка #1: PHANTOM — в памяти есть, на бирже нет ──
            if (hasInMem && !hasOnExch) {
                console.warn(`[LIVE-SYNC ${ts()}] 👻 PHANTOM detected: ${symbol} ${curPos.side} in memory, but position on exchange is 0. Closing as external_close.`);
                session._syncBusy = true;
                try {
                    await handlePhantomClose(session, curPos);
                } catch (e) {
                    console.error(`[LIVE-SYNC ${ts()}] phantom-close exception: ${e.message}`);
                } finally {
                    session._syncBusy = false;
                    session._syncLastActionAt = Date.now();
                }
                return; // следующий тик подхватит уже чистое состояние
            }

            // ── Проверка #2: ZOMBIE — на бирже есть, в памяти нет ──
            if (!hasInMem && hasOnExch) {
                // Throttle warnings — пишем не чаще раза в минуту
                if (now - (session._zombieWarnedAt || 0) > 60 * 1000) {
                    console.warn(`[LIVE-SYNC ${ts()}] 🧟 ZOMBIE detected: ${symbol} on exchange (amt=${exchAmt}, entry=${exchEntry}), but no position in memory. Adopting.`);
                    session._zombieWarnedAt = now;
                    pushDesyncAlert(session, `Zombie позиция ${symbol}: на бирже ${exchAmt}, в памяти нет. Подобрана в журнал, проверь стоп.`);
                }
                session._syncBusy = true;
                try {
                    await adoptZombiePosition(session, posOnExch);
                } catch (e) {
                    console.error(`[LIVE-SYNC ${ts()}] zombie-adopt exception: ${e.message}`);
                } finally {
                    session._syncBusy = false;
                    session._syncLastActionAt = Date.now();
                }
                return;
            }

            // ── Если позиции нет и в памяти и на бирже — на этом всё ──
            if (!hasInMem && !hasOnExch) return;

            // Дальше: позиция есть и в памяти, и на бирже. Проверяем согласованность.
            const memQty  = Math.abs(curPos.liveFillQty || (curPos.size / curPos.entryPrice));
            const exchQty = Math.abs(exchAmt);

            // ── Проверка #3: SIZE MISMATCH ──
            if (memQty > 0 && exchQty > 0) {
                const diffRel = Math.abs(memQty - exchQty) / Math.max(memQty, exchQty);
                if (diffRel > SYNC_QTY_EPS_REL) {
                    if (now - (session._syncSizeWarnedAt || 0) > 60 * 1000) {
                        console.warn(`[LIVE-SYNC ${ts()}] ⚠️  SIZE MISMATCH on ${symbol}: memory=${memQty}, exchange=${exchQty} (diff=${(diffRel*100).toFixed(2)}%). Adjusting memory to exchange.`);
                        session._syncSizeWarnedAt = now;
                        pushDesyncAlert(session, `Размер ${symbol}: в памяти ${memQty}, на бирже ${exchQty}. Скорректировано.`);
                    }
                    // Корректируем память под биржу — биржа источник правды
                    curPos.liveFillQty = exchQty;
                    // pos.size — это USDT-нотионал на момент входа, его не пересчитываем
                    // (P&L всё равно будет считаться по реальной exitPrice * exchQty)
                    session._syncLastActionAt = Date.now(); // считаем за тяжёлое действие
                    // не return — даём проверке #4 отработать на этом же тике
                }
            }

            // ── Проверка #4: STOP MISSING ──
            if (curPos.liveStopOrderId) {
                let stopFound = false;
                let algoFetchOk = false;
                try {
                    const algoRes = await client.getOpenAlgoOrders(symbol);
                    if (algoRes.ok && Array.isArray(algoRes.data)) {
                        algoFetchOk = true;
                        // Ищем наш стоп. Фильтр по orderId/algoId — самый надёжный
                        // (algoType/type у разных биржевых эндпоинтов отличается, поэтому
                        // не полагаемся на тип, а просто ищем по идентификатору).
                        const wantedId = String(curPos.liveStopOrderId);
                        for (const o of algoRes.data) {
                            if (o.symbol && o.symbol !== symbol) continue;
                            const oid = String(o.algoId || o.orderId || '');
                            if (oid === wantedId) {
                                stopFound = true;
                                break;
                            }
                        }
                    } else {
                        console.warn(`[LIVE-SYNC ${ts()}] getOpenAlgoOrders failed: ${algoRes.error || 'unknown'} — пропускаем проверку стопа`);
                    }
                } catch (e) {
                    console.warn(`[LIVE-SYNC ${ts()}] getOpenAlgoOrders exception: ${e.message} — пропускаем проверку стопа`);
                }

                if (algoFetchOk && !stopFound) {
                    // Ещё раз проверяем что pos не успел стать _pending/_closing
                    const stillSamePos = session.position === curPos &&
                        !curPos._pending && !curPos._closing && !curPos._stepTpPending;
                    if (stillSamePos) {
                        if (now - (session._syncStopWarnedAt || 0) > 60 * 1000) {
                            console.warn(`[LIVE-SYNC ${ts()}] 🛡️  STOP MISSING on ${symbol}: liveStopOrderId=${curPos.liveStopOrderId} not found on exchange. Re-placing at ${curPos.stop}.`);
                            session._syncStopWarnedAt = now;
                        }
                        session._syncBusy = true;
                        try {
                            await replaceMissingStop(session, curPos);
                        } catch (e) {
                            console.error(`[LIVE-SYNC ${ts()}] re-place stop exception: ${e.message}`);
                        } finally {
                            session._syncBusy = false;
                            session._syncLastActionAt = Date.now();
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[LIVE-SYNC ${ts()}] Exception: ${e.message}`);
        } finally {
            session._syncInFlight = false;
        }
    }

    /**
     * PHANTOM: позиция была в памяти, но на бирже её нет. Значит сработал стоп,
     * либо ликвидация, либо ручное закрытие на Binance UI. Достаём реальный
     * fill из истории сделок и финализируем как external_close.
     *
     * Логика повторяет ветку externallyClosed в executeCloseLive (строки ~1996-2058),
     * но без попытки placeMarketOrder (мы уже знаем что позиции нет).
     */
    async function handlePhantomClose(session, pos) {
        const client = getLiveClient(session);
        if (!client) return;
        const symbol = session.symbol;

        // Помечаем _closing чтобы основной пайплайн не лез
        pos._closing = true;
        pos._closingReason = 'external_close';
        pos._closingPriceHint = session.currentPrice || pos.entryPrice;

        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';

        // Снимаем оставшийся стоп (если ещё висит)
        await cancelStopIfExists(client, symbol, pos.liveStopOrderId);

        // Recovery fill из истории сделок (последние 5 минут, противоположная сторона)
        let realFillPrice = pos._closingPriceHint;
        let realFillQty   = pos.liveFillQty || (pos.size / pos.entryPrice);
        let realCommission = 0;
        let realCommissionAsset = pos.liveCommissionAsset || 'USDT';

        try {
            const fiveMinAgo = Date.now() - 5 * 60 * 1000;
            const histRes = await client.getUserTrades(symbol, { limit: 50 });
            if (histRes.ok && Array.isArray(histRes.data) && histRes.data.length > 0) {
                const closeFills = histRes.data.filter(t =>
                    t.side === closeSide &&
                    parseFloat(t.time || t.timestamp || 0) >= fiveMinAgo
                );
                if (closeFills.length > 0) {
                    let notional = 0, totalQty = 0;
                    for (const t of closeFills) {
                        const p = parseFloat(t.price);
                        const q = parseFloat(t.qty);
                        notional += p * q;
                        totalQty += q;
                        realCommission += parseFloat(t.commission) || 0;
                        realCommissionAsset = t.commissionAsset || realCommissionAsset;
                    }
                    if (totalQty > 0) {
                        realFillPrice = notional / totalQty;
                        realFillQty   = totalQty;
                    }
                    console.log(`[LIVE-SYNC ${ts()}] 📊 Phantom fill recovered: ${closeFills.length} trades, qty=${totalQty}, avgPrice=${realFillPrice.toFixed(6)}, fee=${realCommission} ${realCommissionAsset}`);
                } else {
                    console.warn(`[LIVE-SYNC ${ts()}] ⚠️  No matching ${closeSide} fills in last 5 min — fee=0 for this trade`);
                }
            }
        } catch (e) {
            console.warn(`[LIVE-SYNC ${ts()}] ⚠️  History fetch failed for phantom-fill: ${e.message}. fee=0 for this trade`);
        }

        const liveResult = {
            ok: true,
            externallyClosed: true,
            fillPrice:        realFillPrice,
            fillQty:          realFillQty,
            commission:       realCommission,
            commissionAsset:  realCommissionAsset,
            slippage:         realFillPrice - (pos._closingPriceHint || pos.entryPrice),
            reason:           'external_close',
        };

        finalizeClosePosition(session, pos, liveResult, 'external_close');
        pushDesyncAlert(session, `Phantom: ${symbol} ${pos.side} закрылась на бирже без нашего ведома. Записано как external_close.`);
    }

    /**
     * ZOMBIE: на бирже есть позиция, в памяти нет. Подбираем: создаём session.position
     * на основе биржевых данных, ставим стоп если его нет.
     *
     * Это «компромиссный» сценарий — мы не знаем стратегических параметров (level,
     * riskReward, target и т.д.), поэтому ставим минимальный безопасный набор:
     * стоп — на основе ATR, target=null, source='zombie'.
     */
    async function adoptZombiePosition(session, posOnExch) {
        const client = getLiveClient(session);
        if (!client) return;
        const symbol = session.symbol;

        const exchAmt    = parseFloat(posOnExch.positionAmt);
        const exchEntry  = parseFloat(posOnExch.entryPrice) || session.currentPrice;
        const side       = exchAmt > 0 ? 'LONG' : 'SHORT';
        const qty        = Math.abs(exchAmt);
        const closeSide  = side === 'LONG' ? 'SELL' : 'BUY';

        // Считаем условный стоп на основе ATR (1xATR от entry в проигрышную сторону)
        const atr = session.candles && session.candles.length > 0
            ? (session.candles[session.candles.length - 1].atr || (exchEntry * 0.005))
            : (exchEntry * 0.005);
        const stopPrice = side === 'LONG'
            ? exchEntry - atr
            : exchEntry + atr;

        // Размер в USDT для журнала
        const sizeUsdt = qty * exchEntry;

        // Проверяем, есть ли уже стоп на бирже
        let existingStopId = null;
        try {
            const algoRes = await client.getOpenAlgoOrders(symbol);
            if (algoRes.ok && Array.isArray(algoRes.data)) {
                const stopOrder = algoRes.data.find(o =>
                    (o.symbol === symbol || !o.symbol) &&
                    (String(o.side || '').toUpperCase() === closeSide) &&
                    (o.closePosition === true || o.closePosition === 'true' ||
                     String(o.type || '').includes('STOP') || String(o.algoType || '').includes('STOP'))
                );
                if (stopOrder) {
                    existingStopId = stopOrder.algoId || stopOrder.orderId;
                    console.log(`[LIVE-SYNC ${ts()}] 🧟 Found existing stop on exchange for adopted position: id=${existingStopId}`);
                }
            }
        } catch (e) {
            console.warn(`[LIVE-SYNC ${ts()}] ⚠️  Cannot check existing stops for zombie: ${e.message}`);
        }

        let stopOrderId = existingStopId;
        if (!existingStopId) {
            // Ставим новый стоп
            const stopRounded = Math.round(stopPrice * 1e6) / 1e6;
            console.log(`[LIVE-SYNC ${ts()}] 🛡️  Placing safety stop for zombie ${side} ${symbol} @ ${stopRounded}`);
            try {
                const stopRes = await client.placeStopMarketOrder(symbol, closeSide, stopRounded, {
                    closePosition: true,
                });
                if (stopRes.ok) {
                    stopOrderId = stopRes.data.orderId || stopRes.data.algoId;
                    console.log(`[LIVE-SYNC ${ts()}] ✅ Safety stop placed for zombie: id=${stopOrderId}`);
                } else {
                    console.error(`[LIVE-SYNC ${ts()}] ❌ Safety stop FAILED for zombie: ${stopRes.error}. Position adopted without stop!`);
                    pushDesyncAlert(session, `Не удалось поставить safety stop для подобранной zombie позиции ${symbol}: ${stopRes.error}. Поставь стоп вручную в Binance!`);
                }
            } catch (e) {
                console.error(`[LIVE-SYNC ${ts()}] ❌ Safety stop EXCEPTION for zombie: ${e.message}`);
                pushDesyncAlert(session, `Не удалось поставить safety stop для zombie ${symbol}: ${e.message}. Поставь стоп вручную в Binance!`);
            }
        }

        // Создаём минимальный объект позиции
        session.position = {
            side,
            entryPrice: exchEntry,
            stop:       stopPrice,
            target:     null,
            size:       sizeUsdt,
            openedAt:   Date.now(),
            candlesHeld: 0,
            level:      null,
            riskReward: null,
            entryType:  'zombie',
            source:     'zombie',
            trailingActive: false,
            clusterExitCount: 0,
            entryRsi: null, entryBbUpper: null, entryBbMiddle: null, entryBbLower: null,
            entryAtr: atr,
            entryClusterBuy: null,
            entryMode: session.entryMode || 'candle',
            strategy:  session.strategy || 'scalper',
            direction: session.direction || 'both',
            clusterEntryFilter:  session.clusterEntryFilter || false,
            regimeFilterEnabled: session.regimeFilterEnabled || false,
            entryRegime: null,
            // ── Снэпшот окна торговли при входе ──
            tradingWindowAtEntry: getActiveWindowLabel(session),
            entryHourUTC:        new Date().getUTCHours(),
            entryMinuteUTC:      new Date().getUTCMinutes(),
            maxUnrealized: 0,
            maxDrawdown: 0,
            maxUnrealizedAt: null, maxUnrealizedPrice: null,
            maxDrawdownAt: null, maxDrawdownPrice: null,
            firstMoveSide: null,
            trailingActivatedAt: null, trailingActivatedPrice: null, trailingActivatedPnl: null,
            stepTpActive: false, stepTpLastLevel: -1,
            stepTpActivatedAt: null, stepTpActivatedPrice: null, stepTpActivatedPnl: null,
            stepTpMaxLevel: null,
            // Live fields
            liveEntryOrderId: null,
            liveStopOrderId:  stopOrderId,
            liveFillQty:      qty,
            liveEntryCommission: 0,
            liveCommissionAsset: 'USDT',
            signalEntry:      exchEntry,
            slippageEntry:    0,
        };

        console.log(`[LIVE-SYNC ${ts()}] 🧟 Adopted zombie: ${side} ${symbol} qty=${qty} entry=${exchEntry} stop=${stopPrice} (stopId=${stopOrderId || 'NONE'})`);
    }

    /**
     * STOP MISSING: pos.liveStopOrderId есть в памяти, но на бирже не нашли.
     * Переподнимаем стоп на цене pos.stop. Защита: если placeStopMarketOrder упал —
     * пишем алерт юзеру, позицию не трогаем (не закрываем автоматически — пусть юзер
     * решит сам, в т.ч. и через сайт).
     */
    async function replaceMissingStop(session, pos) {
        const client = getLiveClient(session);
        if (!client) return;
        const symbol = session.symbol;

        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const stopRounded = Math.round(pos.stop * 1e6) / 1e6;

        try {
            const stopRes = await client.placeStopMarketOrder(symbol, closeSide, stopRounded, {
                closePosition: true,
            });
            if (stopRes.ok) {
                const newId = stopRes.data.orderId || stopRes.data.algoId;
                console.log(`[LIVE-SYNC ${ts()}] ✅ Stop re-placed: ${pos.side} ${symbol} @ ${stopRounded}, new id=${newId} (was ${pos.liveStopOrderId})`);
                pos.liveStopOrderId = newId;
                pushDesyncAlert(session, `Стоп ${symbol} переподнят: был потерян на бирже, поставлен заново на ${stopRounded}.`);
            } else {
                console.error(`[LIVE-SYNC ${ts()}] ❌ Stop re-place FAILED: ${stopRes.error} (code ${stopRes.apiCode || '?'})`);
                pushDesyncAlert(session, `Не удалось переподнять стоп ${symbol} (${stopRes.error}). Позиция без защиты — закрой вручную или поставь стоп в Binance!`);
            }
        } catch (e) {
            console.error(`[LIVE-SYNC ${ts()}] ❌ Stop re-place EXCEPTION: ${e.message}`);
            pushDesyncAlert(session, `Не удалось переподнять стоп ${symbol} (${e.message}). Позиция без защиты — закрой вручную или поставь стоп в Binance!`);
        }
    }

    /**
     * Финализирует закрытие позиции: считает P&L, пишет сделку в журнал, лог.
     * В paper-ветке вызывается сразу из closePosition.
     * В live-ветке вызывается после успешной цепочки executeCloseLive.
     *
     * liveResult: null для paper, объект с биржевыми данными для live.
     */
    function finalizeClosePosition(session, pos, liveResult, reason) {
        // Реальная цена и комиссия выхода — для live из биржи, для paper из расчёта.
        const exitPrice = liveResult ? liveResult.fillPrice : pos._closingPriceHint;
        const price = exitPrice; // алиас для совместимости с остальным кодом

        const priceDiff = pos.side === 'LONG'
            ? (price - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - price) / pos.entryPrice;

        const grossPnl = pos.size * priceDiff;

        // ── Комиссия ──
        // Live: реальные комиссии входа и выхода из ответов биржи (USDT).
        // Paper: расчёт по таксе maker/taker.
        let entryFee, exitFee, totalFee;
        if (liveResult) {
            entryFee = pos.liveEntryCommission || 0;
            exitFee  = liveResult.commission   || 0;
            totalFee = entryFee + exitFee;
        } else {
            const entryFeeRate = 0.00055;  // taker
            const exitFeeRate  = reason === 'take_profit' ? 0.0002 : 0.00055;
            entryFee = pos.size * entryFeeRate;
            exitFee  = pos.size * exitFeeRate;
            totalFee = entryFee + exitFee;
        }

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
            reason:      (liveResult && liveResult.externallyClosed) ? 'external_close' : reason,
            entryType:   pos.entryType || 'bot',
            source:      pos.source || 'auto',
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
            entryRegime:      pos.entryRegime || null,
            tradingWindowAtEntry: pos.tradingWindowAtEntry || 'all',
            entryHourUTC:     pos.entryHourUTC != null ? pos.entryHourUTC : null,
            entryMinuteUTC:   pos.entryMinuteUTC != null ? pos.entryMinuteUTC : null,
            entryRsi:         pos.entryRsi,
            entryBbUpper:     pos.entryBbUpper,
            entryBbMiddle:    pos.entryBbMiddle,
            entryBbLower:     pos.entryBbLower,
            entryAtr:         pos.entryAtr,
            entryClusterBuy:  pos.entryClusterBuy,
            exitClusterBuy:   null, // заполним ниже
            exitRsi:          null,
            exitAtr:          null,
            exitBbUpper:      null,
            exitBbMiddle:     null,
            exitBbLower:      null,
            maxUnrealized:    pos.maxUnrealized || 0,
            maxDrawdown:      pos.maxDrawdown || 0,
            maxUnrealizedAt:    pos.maxUnrealizedAt || null,
            maxUnrealizedPrice: pos.maxUnrealizedPrice || null,
            maxDrawdownAt:      pos.maxDrawdownAt || null,
            maxDrawdownPrice:   pos.maxDrawdownPrice || null,
            firstMoveSide:      pos.firstMoveSide || null,
            // ── Трейлинг ──
            trailingActivated:      pos.trailingActive || false,
            trailingActivatedAt:    pos.trailingActivatedAt || null,
            trailingActivatedPrice: pos.trailingActivatedPrice || null,
            trailingActivatedPnl:   pos.trailingActivatedPnl || null,
            // ── Step TP ──
            stepTpActivated:        pos.stepTpActive || false,
            stepTpActivatedAt:      pos.stepTpActivatedAt || null,
            stepTpActivatedPrice:   pos.stepTpActivatedPrice || null,
            stepTpActivatedPnl:     pos.stepTpActivatedPnl || null,
            stepTpMaxLevel:         pos.stepTpMaxLevel || null,
            durationMin:      Math.round((Date.now() - pos.openedAt) / 60000),
            // ── Live: данные с биржи ──
            // Сохраняем для последующей сверки и анализа проскальзывания.
            mode:                session.mode || 'paper',
            liveEntryOrderId:    pos.liveEntryOrderId   || null,
            liveStopOrderId:     pos.liveStopOrderId    || null,
            liveExitOrderId:     null,                    // эта функция не знает orderId выхода; можно прокинуть из liveResult, но пока не нужно
            liveEntryCommission: pos.liveEntryCommission || 0,
            liveExitCommission:  liveResult ? liveResult.commission : 0,
            liveCommissionAsset: pos.liveCommissionAsset || (liveResult && liveResult.commissionAsset) || null,
            signalEntry:         pos.signalEntry        || pos.entryPrice,
            slippageEntry:       pos.slippageEntry      || 0,
            slippageExit:        liveResult ? liveResult.slippage : 0,
            externallyClosed:    !!(liveResult && liveResult.externallyClosed),
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

        // ── Индикаторы на момент выхода: RSI, ATR, BB ──
        try {
            const closedForExit = session.candles.filter(c => c.closed);
            if (closedForExit.length >= 30) {
                const exitRsi = calcRSI(closedForExit, session.rsiPeriod || 14);
                if (exitRsi != null && !isNaN(exitRsi)) trade.exitRsi = Math.round(exitRsi * 10) / 10;

                const exitAtr = calcATR(session.candles, 20);
                if (exitAtr > 0) trade.exitAtr = exitAtr;

                const exitBb = calcBollingerBands(closedForExit, session.bbPeriod || 20, session.bbMultiplier || 2.0);
                if (exitBb) {
                    trade.exitBbUpper  = exitBb.upper;
                    trade.exitBbMiddle = exitBb.middle;
                    trade.exitBbLower  = exitBb.lower;
                }
            }
        } catch(e) {}

        session.trades.unshift(trade);
        if (session.trades.length > 1000) session.trades.pop();

        try { saveSessionsToDisk(); } catch(e) {}

        if (netPnl < 0) {
            session.consecutiveLosses++;
        } else {
            session.consecutiveLosses = 0;
        }

        session.cooldownUntil = session.cooldownCandles || 5;

        const mfa = pos.maxUnrealized !== undefined ? ` | MaxFav: $${pos.maxUnrealized.toFixed(2)}` : '';
        const mdd = pos.maxDrawdown !== undefined ? ` | MaxDD: $${pos.maxDrawdown.toFixed(2)}` : '';

        const emoji = netPnl >= 0 ? '🟢' : '🔴';
        const modeTag = session.mode === 'live' ? '🔴 LIVE' : '📄 PAPER';
        const slipInfo = liveResult ? ` | SlipExit: ${liveResult.slippage >= 0 ? '+' : ''}${liveResult.slippage.toFixed(4)}` : '';
        const extInfo  = trade.externallyClosed ? ' [externally closed]' : '';
        console.log(`[BOT ${ts()}] ${emoji} ${modeTag} CLOSED ${pos.side} @ ${price} | Gross: $${grossPnl.toFixed(2)} | Fee: $${totalFee.toFixed(2)} | Net: $${netPnl.toFixed(2)} (${trade.pnlPct}%) | ${trade.reason} | ${pos.candlesHeld} candles${mfa}${mdd}${exitClusterDetails}${slipInfo}${extInfo}`);

        // ── Push-уведомление ──
        pushTradeClosed(session, trade);

        session.position = null;
        if (session.pendingExit) {
            session.pendingExit = null;
        }
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
        // Плейсхолдер _pending — позиция ещё открывается на бирже, ничего не считаем
        if (pos._pending) return;
        // _closing — позиция уже закрывается на бирже, не дёргаем стопы / Step TP
        if (pos._closing) return;

        session.currentPrice = price;

        // ── Трекинг max unrealized P&L и max drawdown с timestamp-ами ──
        // В Live предпочитаем биржевой unrealized (если sync уже обновил его):
        // он учитывает mark price, funding, резерв на закрытие — это то же самое
        // число, которое юзер видит в карточке позиции и в Binance UI.
        // Расчётная формула через pos.size может расходиться с биржей в разы
        // из-за плеча/округления qty/расхождения entryPrice — и тогда Step TP
        // никогда не активируется при достижении настроенного триггера.
        // В paper биржи нет — считаем по формуле как раньше.
        let unrealized;
        if (session.mode === 'live' && typeof session.exchangeUnrealizedPnl === 'number' && session.exchangeUnrealizedPnl !== 0) {
            unrealized = session.exchangeUnrealizedPnl;
        } else {
            unrealized = pos.side === 'LONG'
                ? (price - pos.entryPrice) / pos.entryPrice * pos.size
                : (pos.entryPrice - price) / pos.entryPrice * pos.size;
        }

        // Пик в плюс
        if (unrealized > (pos.maxUnrealized || 0)) {
            pos.maxUnrealized = Math.round(unrealized * 100) / 100;
            pos.maxUnrealizedAt = Date.now();
            pos.maxUnrealizedPrice = price;
        }
        // Пик в минус
        if (unrealized < (pos.maxDrawdown || 0)) {
            pos.maxDrawdown = Math.round(unrealized * 100) / 100;
            pos.maxDrawdownAt = Date.now();
            pos.maxDrawdownPrice = price;
        }

        // ── Первое значимое движение (порог: 0.1% от размера позиции) ──
        if (pos.firstMoveSide === null) {
            const threshold = pos.size * 0.001; // 0.1% от размера = $1 на позиции $1000
            if (unrealized >= threshold) {
                pos.firstMoveSide = 'favor';
            } else if (unrealized <= -threshold) {
                pos.firstMoveSide = 'adverse';
            }
        }

        // ── Стоп-лосс (включая трейлинг и Step TP) ──
        // Приоритет reason: step_tp > trailing_stop > stop_loss
        // (оба не могут быть активны одновременно, но на всякий случай)
        function stopReason() {
            if (pos.stepTpActive) return 'step_tp';
            if (pos.trailingActive) return 'trailing_stop';
            return 'stop_loss';
        }
        // Закрываемся по текущей цене тика, а не по цене стопа — это симулирует
        // реальное проскальзывание (в реальной торговле цена может пройти стоп).
        if (pos.side === 'LONG' && price <= pos.stop) {
            closePosition(session, price, stopReason());
            return;
        }
        if (pos.side === 'SHORT' && price >= pos.stop) {
            closePosition(session, price, stopReason());
            return;
        }

        // ── Лимитный выход (pendingExit) — только для manual-стратегии ──
        // Срабатывает, когда цена достигла заданного уровня.
        // LONG exit: закрываем когда цена поднялась ДО или ВЫШЕ exit-цены.
        // SHORT exit: закрываем когда цена опустилась ДО или НИЖЕ exit-цены.
        // Закрываем по цене pendingExit (а не рыночной), как работают настоящие лимит-ордера.
        if (session.strategy === 'manual' && session.pendingExit) {
            const pe = session.pendingExit;
            const triggered =
                (pos.side === 'LONG'  && price >= pe.price) ||
                (pos.side === 'SHORT' && price <= pe.price);
            if (triggered) {
                console.log(`[BOT ${ts()}] 🎯 LIMIT EXIT FILLED: ${pos.side} @ ${pe.price} (market: ${price})`);
                session.pendingExit = null;
                closePosition(session, pe.price, 'manual_limit_exit');
                return;
            }
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

                    // --- SMA-RETURN (работает в обоих режимах, если включён тумблер) ---
                    // Шаг 1: поднимаем флаг wasBeyondSma если цена глубоко зашла за SMA
                    if (session.smaReturnEnabled) {
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
        }

        // ── Трейлинг-стоп ──
        // Трейлинг использует pos.target для расчёта прогресса, поэтому
        // в manual (где target=null) он не работает — это ожидаемое поведение.
        if (session.trailingEnabled && pos.target != null) {
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
                            pos.trailingActivatedAt    = Date.now();
                            pos.trailingActivatedPrice = price;
                            pos.trailingActivatedPnl   = Math.round(unrealized * 100) / 100;
                        }
                        pos.stop = newStop;
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
                            pos.trailingActivatedAt    = Date.now();
                            pos.trailingActivatedPrice = price;
                            pos.trailingActivatedPnl   = Math.round(unrealized * 100) / 100;
                        }
                        pos.stop = newStop;
                        pos.trailingActive = true;
                    }
                }
            }
        }

        // ── Шаговый TP (Step TP / STP) ──
        // Вариант А: стоп переставляется дискретно при пересечении каждой ступеньки.
        // Ступени: trigger, trigger+step, trigger+2*step, ...
        // Стоп на уровне N = trigger + N*step − tolerance.
        // Допуск активации (10% от step) — ступенька считается достигнутой чуть раньше,
        // чтобы $5.99 засчитывало уровень $6.00, а не ждало ровно $6.00.
        // Взаимоисключает трейлинг (в UI нельзя включить оба одновременно).
        if (session.stepTpEnabled && !session.trailingEnabled) {
            const trigger   = session.stepTpTrigger;
            const step      = session.stepTpStep;
            const tolerance = session.stepTpTolerance;
            const activationTolerance = step * 0.10; // 10% от шага

            const peakPnl = pos.maxUnrealized || 0;
            const effectivePeak = peakPnl + activationTolerance;

            if (effectivePeak >= trigger && step > 0) {
                // Индекс максимальной пройденной ступеньки с учётом допуска активации
                const maxLevelReached = Math.floor((effectivePeak - trigger) / step);

                // Если достигнут новый (более высокий) уровень — переставляем стоп
                if (maxLevelReached > (pos.stepTpLastLevel ?? -1) && maxLevelReached >= 0) {
                    const stopProfit = trigger + maxLevelReached * step - tolerance;

                    // Переводим прибыль в $ обратно в цену стопа.
                    // В paper: размер pos.size — это полный нотионал, формула:
                    //   unrealized = (price - entry) * pos.size / entry  → priceDelta = stopProfit * entry / size
                    // В Live: реальный размер на бирже может отличаться от pos.size
                    // (плечо, округление qty, маржа). Используем реальный fillQty:
                    //   unrealized = (price - entry) * qty  → priceDelta = stopProfit / qty
                    let priceDelta;
                    if (session.mode === 'live' && pos.liveFillQty && pos.liveFillQty > 0) {
                        priceDelta = stopProfit / pos.liveFillQty;
                    } else {
                        priceDelta = stopProfit * pos.entryPrice / pos.size;
                    }
                    const newStop = pos.side === 'LONG'
                        ? pos.entryPrice + priceDelta
                        : pos.entryPrice - priceDelta;

                    // Стоп двигается только в нашу пользу
                    const stopImproved = pos.side === 'LONG'
                        ? newStop > pos.stop
                        : newStop < pos.stop;

                    if (stopImproved) {
                        if (!pos.stepTpActive) {
                            console.log(`[BOT ${ts()}] 🎯 Step TP ACTIVATED for ${pos.side} @ ${price} | Peak $${peakPnl.toFixed(2)} | Stop → $${stopProfit.toFixed(2)} profit (price ${newStop.toFixed(2)})`);
                            pos.stepTpActivatedAt    = Date.now();
                            pos.stepTpActivatedPrice = price;
                            pos.stepTpActivatedPnl   = Math.round(unrealized * 100) / 100;
                        } else {
                            console.log(`[BOT ${ts()}] 🎯 Step TP level ${maxLevelReached} | Peak $${peakPnl.toFixed(2)} | Stop → $${stopProfit.toFixed(2)} profit`);
                        }
                        pos.stop = newStop;
                        pos.stepTpActive     = true;
                        pos.stepTpLastLevel  = maxLevelReached;
                        pos.stepTpMaxLevel   = Math.round(stopProfit * 100) / 100;

                        // ── LIVE: подтянуть STOP_MARKET на бирже ──
                        // Память (pos.stop) уже обновили выше — так paper-логика продолжает
                        // работать, и при сетевой ошибке у нас всё ещё есть локальный стоп
                        // для проверки на тиках. На бирже подтянем асинхронно.
                        // Флаг _stepTpPending защищает от гонки: на следующем тике пока
                        // подтяжка не завершилась — не запускаем ещё одну.
                        if (session.mode === 'live' && !pos._stepTpPending) {
                            pos._stepTpPending = true;
                            const targetStop = newStop;  // снимок на момент решения
                            executeStepTpUpdateLive(session, pos, targetStop)
                                .then(result => {
                                    if (result.ok) {
                                        pos.liveStopOrderId = result.newAlgoId;
                                    } else if (result.positionGone) {
                                        // Позиция уже закрыта на бирже (стоп сработал
                                        // в ходе подтяжки). Запустим финальное закрытие
                                        // нашим closePosition — он увидит external_close
                                        // через executeCloseLive и корректно запишет в журнал.
                                        console.log(`[BOT ${ts()}] ℹ️  Step TP saw position gone — triggering close flow`);
                                        closePosition(session, price, 'external_close');
                                    } else if (result.emergencyClosed) {
                                        // Аварийное закрытие сработало в executeStepTpUpdateLive.
                                        // Записываем сделку. closePosition увидит ext_closed.
                                        closePosition(session, price, 'step_tp_failed');
                                    } else {
                                        console.error(`[BOT ${ts()}] ❌ Step TP exchange update failed: ${result.error} — local stop is set, exchange may be out of sync`);
                                    }
                                })
                                .catch(err => {
                                    console.error(`[BOT ${ts()}] 💥 Step TP exception: ${err.message}`);
                                    console.error(err.stack);
                                })
                                .finally(() => {
                                    if (pos) pos._stepTpPending = false;
                                });
                        }
                    }
                }
            }
        }
        // ── Тейк-профит ──
        // В manual-стратегии pos.target = null (таргета нет), выход только
        // по стопу или по ручному close. Пропускаем TP-проверку.
        if (pos.target != null) {
            if (pos.side === 'LONG' && price >= pos.target) {
                closePosition(session, price, 'take_profit');
                return;
            }
            if (pos.side === 'SHORT' && price <= pos.target) {
                closePosition(session, price, 'take_profit');
                return;
            }
        }

    }

    // Проверка таймаута (вызывается при закрытии каждой свечи)
    function checkTimeout(session) {
        const pos = session.position;
        if (!pos) return;
        if (pos._pending) return;  // плейсхолдер не считаем
        if (pos._closing) return;  // позиция уже закрывается

        pos.candlesHeld++;

        // В manual-стратегии таймаут работает только при явно включённом тумблере.
        // В авто-стратегиях (scalper/mean_reversion) — всегда как раньше.
        if (session.strategy === 'manual' && !session.manualTimeoutEnabled) return;

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

        // Пересчитываем режим волатильности (ATR): дёшево, не требует сети.
        // Обновляется даже если фильтр выключен — чтобы панель в виджете всегда
        // показывала актуальное состояние (пользователь может включить тумблер
        // не перезапуская бота).
        try {
            session.atrRegime = detectATRRegime(session.candles, session.atrFilterThreshold || 2.0);
        } catch (e) {
            session.atrRegime = { multiplier: 1.0, level: 'calm', blocked: false };
        }

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
        if (session.position && !session.position._pending && !session.position._closing && session.strategy === 'mean_reversion') {
            const closedCandles = session.candles.filter(c => c.closed);
            const bb = calcBollingerBands(closedCandles, session.bbPeriod || 20, session.bbMultiplier || 2.0);
            if (bb) {
                const pos = session.position;

                let newTarget;
                if (session.bbExitEnabled) {
                    // РЕЖИМ 2: цель = противоположная ББ. Target на шкале = реальная цель выхода.
                    newTarget = pos.side === 'LONG'
                        ? bb.upper
                        : bb.lower;
                } else {
                    // РЕЖИМ 1: цель = max(SMA, minProfit)
                    const smaTarget = bb.middle;
                    const minProfitPct = session.maxProfitPct || 1.0;
                    const minTarget = pos.side === 'LONG'
                        ? pos.entryPrice * (1 + minProfitPct / 100)
                        : pos.entryPrice * (1 - minProfitPct / 100);
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
        // Работает только если тумблер "Учитывать кластеры" включён.
        // В manual-стратегии кластерные автовыходы отключены — пользователь
        // сам решает, когда закрывать.
        if (session.position && session.strategy !== 'manual' && (session.clusterEntryFilter || (session.strategy !== 'mean_reversion' && session.clusterEnabled))) {
            checkClusterExit(session);
        }

        // Cooldown: уменьшаем счётчик
        if (session.cooldownUntil > 0) {
            session.cooldownUntil--;
        }

        // Если нет позиции и нет cooldown — ищем сигнал
        // В manual-стратегии автосигналы не генерируются вовсе —
        // входы только через /api/bot/manual-trade (Market/Limit).
        if (!session.position && session.cooldownUntil <= 0 && session.strategy !== 'manual') {
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
        if (pos._pending) return;  // плейсхолдер не считаем
        if (pos._closing) return;  // позиция уже закрывается

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

                // ── Срабатывание pending limit (manual-стратегия) ──
                // LONG limit срабатывает когда цена опустилась до или ниже limit,
                // SHORT limit — когда цена поднялась до или выше limit.
                // Открываем позицию по цене limit (так работают настоящие лимит-ордера),
                // а не по текущей рыночной — это даёт более предсказуемый вход.
                if (!session.position && session.pendingLimit && session.strategy === 'manual' && !session.paused) {
                    const pl = session.pendingLimit;
                    const triggered =
                        (pl.side === 'LONG'  && candle.close <= pl.price) ||
                        (pl.side === 'SHORT' && candle.close >= pl.price);
                    if (triggered) {
                        const entryPrice = pl.price;
                        const stopPct = (session.manualStopPct || 0.5) / 100;
                        const stop = pl.side === 'LONG'
                            ? entryPrice * (1 - stopPct)
                            : entryPrice * (1 + stopPct);
                        const atr = calcATR(session.candles, 20);
                        const signal = {
                            side: pl.side,
                            entry: entryPrice,
                            stop: stop,
                            target: null,
                            atr: atr,
                            level: null,
                            riskReward: null,
                            triggerBuyPct: 50,
                            backgroundBuyPct: 50,
                            concentration: 'manual',
                            volumeRatio: 0,
                        };
                        console.log(`[BOT ${ts()}] 🎯 LIMIT FILLED: ${pl.side} @ ${entryPrice} (market: ${candle.close})`);
                        session.pendingLimit = null;
                        openPosition(session, signal);
                    }
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

        // ── Live-guard: проверяем ключи ДО любых действий ──
        // Если бот в Live-режиме, ему нужны валидные API ключи Binance.
        // Загружаем из шифрованного хранилища, проверяем актуальность через биржу,
        // и только потом разрешаем запуск. Если ключей нет или они отозваны —
        // отказываем; бот никогда не пытается торговать без подтверждённых ключей.
        if (settings && settings.mode === 'live') {
            const loaded = credsStore.loadCredentials(uid);
            if (!loaded.ok) {
                return {
                    ok: false,
                    error: 'Для Live-режима нужны API ключи Binance. Откройте настройки бота, введите ключи и нажмите "Сохранить".'
                };
            }
            // Проверяем что ключи всё ещё рабочие (могли отозвать на стороне Binance)
            const client = createBinanceClient({
                apiKey:    loaded.apiKey,
                apiSecret: loaded.apiSecret,
                testnet:   !!loaded.testnet,
            });
            const acc = await client.getAccountInfo();
            if (!acc.ok) {
                return {
                    ok: false,
                    error: 'Сохранённые API ключи отвергнуты Binance: ' + acc.error +
                           ' Откройте настройки и обновите ключи.'
                };
            }
            // Подгружаем в session — отсюда их будут читать openPosition / closePosition
            session.apiKey       = loaded.apiKey;
            session.apiSecret    = loaded.apiSecret;
            session.apiTestnet   = !!loaded.testnet;
            session.apiConnected = true;
        }

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
        // startBalance фиксируется ОДИН РАЗ — при самом первом запуске бота.
        // При следующих перезапусках (STOP → LIVE) не перезаписывается,
        // чтобы totalPnl = virtualBalance - startBalance продолжал показывать
        // прибыль за всё время работы бота.
        // Флаг _startBalanceInit защищает от повторной установки и не зависит
        // от значений по умолчанию в дефолтах сессии (было: startBalance=10000 в дефолте,
        // а virtualBalance из UI = 500 → totalPnl = -9500$).
        //
        // ИСКЛЮЧЕНИЕ: если у бота нулевая история (ни одной сделки) — это значит
        // никакой "накопленной прибыли" защищать не надо, и пользователь по сути
        // настраивает свежего бота. В этом случае разрешаем переинициализацию,
        // иначе при создании бота с балансом $500 и сохранённым в JSON
        // startBalance=$10000 totalPnl сразу покажет −$9500.
        const hasHistory = (session.trades && session.trades.length > 0);
        if (!session._startBalanceInit || !hasHistory) {
            session.startBalance = session.virtualBalance;
            session._startBalanceInit = true;
        }
        session.volumeMultiplier = parseFloat(settings.volumeMultiplier) || 1.5;
        session.positionTimeout  = parseInt(settings.positionTimeout)    || 6;

        // Трейлинг-стоп
        session.trailingEnabled    = !!settings.trailingEnabled;
        session.trailingOffset     = parseFloat(settings.trailingOffset)     || 0.25;
        session.trailingActivation = parseFloat(settings.trailingActivation) || 70;

        // Шаговый TP (Step TP / STP) — конкурент трейлингу
        session.stepTpEnabled   = !!settings.stepTpEnabled;
        session.stepTpTrigger   = parseFloat(settings.stepTpTrigger);
        if (!Number.isFinite(session.stepTpTrigger) || session.stepTpTrigger <= 0) session.stepTpTrigger = 5.00;
        session.stepTpStep      = parseFloat(settings.stepTpStep);
        if (!Number.isFinite(session.stepTpStep) || session.stepTpStep <= 0) session.stepTpStep = 0.50;
        session.stepTpTolerance = parseFloat(settings.stepTpTolerance);
        if (!Number.isFinite(session.stepTpTolerance) || session.stepTpTolerance < 0) session.stepTpTolerance = 0.50;
        // Взаимоисключение: если включены оба — приоритет у Step TP, трейлинг выключаем
        if (session.stepTpEnabled && session.trailingEnabled) {
            session.trailingEnabled = false;
            console.log('[BOT] ⚠ Step TP enabled — trailing force-disabled (mutual exclusion)');
        }

        // Выход по противоположной полосе Боллинджера (MR) + толерансы возврата/касания
        session.bbExitEnabled      = !!settings.bbExitEnabled;
        session.bbExitTolerance    = parseFloat(settings.bbExitTolerance);
        if (!Number.isFinite(session.bbExitTolerance)) session.bbExitTolerance = 5;
        session.smaReturnEnabled   = !!settings.smaReturnEnabled;
        session.smaReturnTolerance = parseFloat(settings.smaReturnTolerance);
        if (!Number.isFinite(session.smaReturnTolerance)) session.smaReturnTolerance = 5;

        // ATR-фильтр волатильности
        session.atrFilterEnabled   = !!settings.atrFilterEnabled;
        session.atrFilterThreshold = parseFloat(settings.atrFilterThreshold);
        if (!Number.isFinite(session.atrFilterThreshold)) session.atrFilterThreshold = 2.0;

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
        session.strategy = settings.strategy || 'scalper'; // 'scalper' | 'mean_reversion' | 'manual'
        session.direction = settings.direction || 'both'; // 'both' | 'long' | 'short'
        session.entryMode = settings.entryMode || 'candle'; // 'candle' | 'tick'

        // ── Manual-стратегия параметры ──
        session.manualStopPct       = parseFloat(settings.manualStopPct)      || 0.5;   // % от цены входа
        session.manualSizeMode      = settings.manualSizeMode  === 'fixed' ? 'fixed' : 'risk'; // 'risk' | 'fixed'
        session.manualFixedSizePct  = parseFloat(settings.manualFixedSizePct) || 10;    // % баланса при fixed
        session.manualTimeoutEnabled = !!settings.manualTimeoutEnabled;                 // опциональный таймаут
        session.pendingLimit        = null;  // { side, price, createdAt } — ожидающий лимит-ордер на ВХОД
        session.pendingExit         = null;  // { price, createdAt } — ожидающий лимитный ВЫХОД из открытой позиции

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

        // ── Режим рынка V2 (4h + 15m + 5m, согласованность всех трёх) ──
        // Первичный расчёт — до WebSocket, чтобы первая же свеча проверялась с режимом.
        // Дальше обновляем раз в 5 минут (внутри сами кэши с разной частотой: 4h=1ч, 15m=10м, 5m=5м).
        try {
            session.regime = await detectMarketRegimeV2(session.symbol);
            const r = session.regime;
            console.log(`[BOT] 🧭 Regime V2 for ${session.pair}: 4h=${r.tf4h.state}, 15m=${r.tf15m.state}, 5m=${r.tf5m.state} → allowed ${r.allowed}`);
        } catch (e) {
            console.error(`[BOT] Failed initial regime detection V2:`, e.message);
            session.regime = {
                tf4h:  { state: 'flat', reason: 'init_error' },
                tf15m: { state: 'flat', reason: 'init_error' },
                tf5m:  { state: 'flat', reason: 'init_error' },
                allowed: 'BLOCK',
                updatedAt: Date.now(),
            };
        }

        // ── ATR-режим волатильности ──
        // Первичный расчёт сразу при старте, чтобы панель в виджете показывалась
        // с первой секунды (а не ждала закрытия свечи через onCandleClose).
        // Дальше пересчитываем в onCandleClose на каждой закрытой свече.
        try {
            session.atrRegime = detectATRRegime(session.candles, session.atrFilterThreshold || 2.0);
            console.log(`[BOT] 📊 ATR for ${session.pair}: ×${session.atrRegime.multiplier} ${session.atrRegime.level}`);
        } catch (e) {
            session.atrRegime = { multiplier: 1.0, level: 'calm', blocked: false, threshold: session.atrFilterThreshold || 2.0 };
        }

        // Фоновое обновление каждые 5 минут (минимальный TTL из всех ТФ — 5m)
        if (session._regimeInterval) clearInterval(session._regimeInterval);
        session._regimeInterval = setInterval(async () => {
            if (!session.running) return;
            try {
                session.regime = await detectMarketRegimeV2(session.symbol);
                const r = session.regime;
                console.log(`[BOT] 🧭 Regime V2 refreshed for ${session.pair}: 4h=${r.tf4h.state}, 15m=${r.tf15m.state}, 5m=${r.tf5m.state} → allowed ${r.allowed}`);
            } catch (e) {
                console.error(`[BOT] Regime V2 refresh failed:`, e.message);
            }
        }, 5 * 60 * 1000);

        // ── LIVE: периодический sync с биржей (UI snapshot + 4 reconciliation-проверки) ──
        // На каждом тике: phantom / zombie / size mismatch / stop missing.
        // Подробности — в syncLiveStateWithExchange.
        if (session._liveSyncInterval) clearInterval(session._liveSyncInterval);
        if (session.mode === 'live') {
            console.log(`[LIVE-SYNC] ▶️  Starting reconciliation sync for ${session.pair} (every 10s)`);
            // Initial sync сразу — на случай если сервер перезапустился и в памяти
            // нет позиции, а на бирже она есть; или наоборот.
            syncLiveStateWithExchange(session).catch(e => {
                console.error(`[LIVE-SYNC] Initial sync failed: ${e.message}`);
            });
            session._liveSyncInterval = setInterval(() => {
                syncLiveStateWithExchange(session).catch(e => {
                    console.error(`[LIVE-SYNC] Tick failed: ${e.message}`);
                });
            }, 10 * 1000);
        }

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

        // Отменяем ожидающую лимитку — иначе она осталась бы активной в памяти,
        // но без работающего WebSocket-потока никогда бы не сработала.
        if (session.pendingLimit) {
            console.log(`[BOT] 🖐 LIMIT CANCELLED on stop: ${session.pendingLimit.side} @ ${session.pendingLimit.price}`);
            session.pendingLimit = null;
        }
        // Аналогично — лимитный выход (если был). closePosition выше уже должен был
        // его очистить, но на всякий случай.
        if (session.pendingExit) {
            console.log(`[BOT] 🖐 LIMIT EXIT CANCELLED on stop: ${session.pendingExit.price}`);
            session.pendingExit = null;
        }

        // Отключаем WebSocket
        disconnectWebSocket(uid, botId);

        // Останавливаем обновление режима
        if (session._regimeInterval) {
            clearInterval(session._regimeInterval);
            session._regimeInterval = null;
        }

        // Останавливаем live-sync таймер
        if (session._liveSyncInterval) {
            clearInterval(session._liveSyncInterval);
            session._liveSyncInterval = null;
        }

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

    // POST /api/bot/emergency-close-live — аварийно закрыть Live-позицию и остановить бота
    // body: { uid, botId, silent? }
    // Шаги:
    //   1. Проверяем что бот в Live-режиме (paper отвергаем)
    //   2. Если есть pendingLimit — обнуляем
    //   3. Если есть открытая позиция — market reduceOnly close
    //   4. На всякий случай — отменяем все остальные алго-ордера на символе
    //      (если бот "потерял" algoId — стопы могли остаться висеть)
    //   5. Останавливаем бота (stopBot)
    // Возвращает { ok, steps: { closedPosition, cancelledOrders, errors[] } }
    app.post('/api/bot/emergency-close-live', async (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const silent = !!req.body.silent;

            const session = getSession(uid, botId);
            if (!session) {
                return res.status(404).json({ ok: false, error: 'Бот не найден' });
            }
            if (session.mode !== 'live') {
                return res.status(400).json({ ok: false, error: 'Аварийный стоп доступен только для Live-режима' });
            }

            const steps = {
                closedPosition: false,
                cancelledOrders: 0,
                errors: [],
            };

            // 1. Сбросить pendingLimit
            if (session.pendingLimit) {
                console.log(`[EMERGENCY ${ts()}] 🖐 Cancelling pendingLimit for ${session.pair}`);
                session.pendingLimit = null;
            }

            const client = getLiveClient(session);

            // 2. Закрыть позицию если есть
            if (session.position && !session.position._pending && !session.position._closing) {
                console.log(`[EMERGENCY ${ts()}] 🚨 Closing position ${session.position.side} ${session.symbol}`);
                try {
                    // Market price hint — последняя котировка
                    const priceHint = session.currentPrice || session.position.entryPrice;
                    closePosition(session, priceHint, 'emergency_stop');
                    // closePosition в live — асинхронный, ждём пока флаг _closing снимется или истечёт таймаут
                    const start = Date.now();
                    while (session.position && session.position._closing && (Date.now() - start) < 10000) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                    steps.closedPosition = !session.position;
                    if (session.position) {
                        steps.errors.push('Закрытие позиции не завершилось за 10 секунд');
                    }
                } catch (e) {
                    console.error(`[EMERGENCY ${ts()}] ❌ closePosition exception: ${e.message}`);
                    steps.errors.push('closePosition: ' + e.message);
                }
            }

            // 3. Подстраховка — отменить все алго-ордера на символе
            //    (даже если позиции не было, могли остаться висеть)
            if (client) {
                try {
                    const algoRes = await client.getOpenAlgoOrders(session.symbol);
                    if (algoRes.ok && Array.isArray(algoRes.data)) {
                        for (const o of algoRes.data) {
                            if (o.symbol !== session.symbol) continue;
                            const id = o.algoId || o.orderId;
                            if (!id) continue;
                            try {
                                const cancelRes = await client.cancelAlgoOrder(session.symbol, id);
                                if (cancelRes.ok) {
                                    steps.cancelledOrders++;
                                    console.log(`[EMERGENCY ${ts()}] ✅ Cancelled algo order ${id}`);
                                } else if (cancelRes.apiCode !== -2011 && cancelRes.apiCode !== -2026) {
                                    // -2011/-2026: уже отменён/не существует — не считаем за ошибку
                                    steps.errors.push(`cancel algo ${id}: ${cancelRes.error}`);
                                }
                            } catch (e) {
                                steps.errors.push(`cancel algo ${id} exception: ${e.message}`);
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[EMERGENCY ${ts()}] ⚠️  getOpenAlgoOrders failed: ${e.message}`);
                    steps.errors.push('getOpenAlgoOrders: ' + e.message);
                }
            }

            // 4. Остановить бота
            try {
                stopBot(uid, botId, silent);
            } catch (e) {
                steps.errors.push('stopBot: ' + e.message);
            }

            console.log(`[EMERGENCY ${ts()}] ✅ DONE bot=${botId}: closedPosition=${steps.closedPosition} cancelledOrders=${steps.cancelledOrders} errors=${steps.errors.length}`);
            // ok=true если ВСЁ прошло без ошибок; иначе ok=false но всё равно возвращаем 200
            // (фронт смотрит на res.ok из json, а не на http-статус)
            res.json({
                ok: steps.errors.length === 0,
                steps: steps,
                error: steps.errors.length > 0 ? steps.errors.join('; ') : undefined,
            });
        } catch(e) {
            console.error(`[EMERGENCY] Top-level exception: ${e.message}`);
            res.status(500).json({ ok: false, error: e.message });
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
            const orderType = req.body.orderType === 'limit' ? 'limit' : 'market';
            const limitPrice = parseFloat(req.body.limitPrice);
            const session = getSession(uid, botId);

            if (!session.running) return res.status(400).json({ error: 'Бот не запущен' });
            if (session.paused) return res.status(400).json({ error: 'Бот на паузе (дневной лимит убытков)' });
            if (session.position) return res.status(400).json({ error: 'Уже есть открытая позиция' });
            if (session.pendingLimit) return res.status(400).json({ error: 'Уже есть ожидающая лимитка — сначала отмените' });
            if (!side || (side !== 'LONG' && side !== 'SHORT')) return res.status(400).json({ error: 'Укажите side: LONG или SHORT' });
            if (session.market === 'spot' && side === 'SHORT') return res.status(400).json({ error: 'SHORT недоступен на споте' });
            if (session.direction === 'long' && side === 'SHORT') return res.status(400).json({ error: 'Направление ограничено: только LONG' });
            if (session.direction === 'short' && side === 'LONG') return res.status(400).json({ error: 'Направление ограничено: только SHORT' });
            if (!session.currentPrice || session.currentPrice <= 0) return res.status(400).json({ error: 'Нет данных о цене' });

            const isManualStrategy = session.strategy === 'manual';

            // ── Валидация limit-ордера ──
            if (orderType === 'limit') {
                if (!isManualStrategy) {
                    return res.status(400).json({ error: 'Limit-ордера доступны только в ручной стратегии' });
                }
                if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
                    return res.status(400).json({ error: 'Некорректная limit-цена' });
                }
                // Защита от очевидно ошибочных лимиток:
                // LONG limit должен быть ниже текущей цены (ждём отката вниз),
                // SHORT limit — выше (ждём отскока вверх). Иначе ордер мгновенно сработает.
                if (side === 'LONG' && limitPrice >= session.currentPrice) {
                    return res.status(400).json({ error: 'LONG limit должен быть ниже текущей цены' });
                }
                if (side === 'SHORT' && limitPrice <= session.currentPrice) {
                    return res.status(400).json({ error: 'SHORT limit должен быть выше текущей цены' });
                }

                // Ставим pending limit, позиция не открывается — ждём касания цены в tick-цикле
                session.pendingLimit = {
                    side,
                    price: limitPrice,
                    createdAt: Date.now(),
                };
                console.log(`[BOT ${ts()}] 🖐 MANUAL ${side} LIMIT @ ${session.pendingLimit.price} (current: ${session.currentPrice})`);
                return res.json({ ok: true, pendingLimit: session.pendingLimit });
            }

            // ── Market-ордер: считаем стоп и таргет ──
            const price = session.currentPrice;
            const atr = calcATR(session.candles, 20);
            const stopDistFallback = atr > 0 ? atr * (session.stopAtrMultiplier || 1.5) : price * 0.002;

            let stop, tp;

            if (isManualStrategy) {
                // Manual: стоп по manualStopPct (% от цены входа), таргета нет
                const stopPct = (session.manualStopPct || 0.5) / 100;
                stop = side === 'LONG' ? price * (1 - stopPct) : price * (1 + stopPct);
                tp = null; // таргета в manual нет — выход только по стопу или по ручному close
            } else if (session.strategy === 'mean_reversion') {
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
                    stop = side === 'LONG' ? price - stopDistFallback : price + stopDistFallback;
                }
            } else {
                // Скальпер: старая логика
                stop = side === 'LONG' ? price - stopDistFallback : price + stopDistFallback;
                tp = side === 'LONG'
                    ? price * (1 + session.maxProfitPct / 100)
                    : price * (1 - session.maxProfitPct / 100);
            }

            const signal = {
                side,
                entry: price,
                stop: stop,
                target: tp,
                atr: atr,
                level: null,
                riskReward: tp == null ? null : Math.round((Math.abs(tp - price) / Math.abs(price - stop)) * 100) / 100,
                triggerBuyPct: 50,
                backgroundBuyPct: 50,
                concentration: 'manual',
                volumeRatio: 0,
            };

            openPosition(session, signal);
            console.log(`[BOT ${ts()}] 🖐 MANUAL ${side} @ ${price} | Stop: ${signal.stop} | Target: ${signal.target == null ? '—' : signal.target}`);

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

    // POST /api/bot/cancel-limit — отменить ожидающий лимит-ордер (только manual)
    app.post('/api/bot/cancel-limit', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            if (!session.pendingLimit) return res.status(400).json({ error: 'Нет ожидающей лимитки' });
            const cancelled = session.pendingLimit;
            session.pendingLimit = null;
            console.log(`[BOT ${ts()}] 🖐 LIMIT CANCELLED: ${cancelled.side} @ ${cancelled.price}`);
            res.json({ ok: true, cancelled });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/set-exit-limit — поставить лимитный выход из открытой позиции (только manual)
    // Срабатывает как take-profit: когда цена касается exit-price, позиция закрывается.
    app.post('/api/bot/set-exit-limit', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const price = parseFloat(req.body.price);
            const session = getSession(uid, botId);

            if (!session.running) return res.status(400).json({ error: 'Бот не запущен' });
            if (session.strategy !== 'manual') return res.status(400).json({ error: 'Лимитный выход доступен только в ручной стратегии' });
            if (session.mode === 'live') return res.status(400).json({ error: 'Лимитный выход в Live-режиме пока не поддерживается. Используй ручное закрытие.' });
            if (!session.position) return res.status(400).json({ error: 'Нет открытой позиции' });
            if (session.position._pending) return res.status(400).json({ error: 'Позиция ещё открывается на бирже, подожди несколько секунд' });
            if (session.position._closing) return res.status(400).json({ error: 'Позиция уже закрывается' });
            if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Некорректная цена лимитного выхода' });
            if (!session.currentPrice || session.currentPrice <= 0) return res.status(400).json({ error: 'Нет данных о цене' });

            const pos = session.position;
            // Валидация: exit-цена должна быть "в правильную сторону" от текущей,
            // иначе лимит сработает мгновенно (это не лимит, а market).
            // LONG: exit должна быть ВЫШЕ текущей (закрываем в плюс).
            // SHORT: exit должна быть НИЖЕ текущей.
            if (pos.side === 'LONG' && price <= session.currentPrice) {
                return res.status(400).json({ error: 'Для LONG лимитный выход должен быть выше текущей цены' });
            }
            if (pos.side === 'SHORT' && price >= session.currentPrice) {
                return res.status(400).json({ error: 'Для SHORT лимитный выход должен быть ниже текущей цены' });
            }
            // Также защитимся от exit-цены, которая стоит ПРОТИВ позиции, глубже стопа —
            // это бессмыслица (позиция уже закроется по стопу раньше).
            if (pos.side === 'LONG' && price <= pos.stop) {
                return res.status(400).json({ error: 'Лимитный выход не должен быть ниже стопа' });
            }
            if (pos.side === 'SHORT' && price >= pos.stop) {
                return res.status(400).json({ error: 'Лимитный выход не должен быть выше стопа' });
            }

            session.pendingExit = {
                price: price,
                createdAt: Date.now(),
            };
            console.log(`[BOT ${ts()}] 🖐 LIMIT EXIT SET: ${pos.side} @ ${session.pendingExit.price} (current: ${session.currentPrice})`);
            res.json({ ok: true, pendingExit: session.pendingExit });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/cancel-exit-limit — отменить лимитный выход
    app.post('/api/bot/cancel-exit-limit', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId || 'default';
            const session = getSession(uid, botId);
            if (!session.pendingExit) return res.status(400).json({ error: 'Нет лимитного выхода' });
            const cancelled = session.pendingExit;
            session.pendingExit = null;
            console.log(`[BOT ${ts()}] 🖐 LIMIT EXIT CANCELLED: @ ${cancelled.price}`);
            res.json({ ok: true, cancelled });
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

            // Фильтр режима рынка (EMA50/EMA200)
            if (s.regimeFilterEnabled !== undefined) {
                session.regimeFilterEnabled = !!s.regimeFilterEnabled;
                changed.push(`regimeFilter:${session.regimeFilterEnabled ? 'ON' : 'OFF'}`);
            }

            // Окно торговли (W) — два независимых подтумблера
            if (s.tradingWindowEU !== undefined) {
                session.tradingWindowEU = !!s.tradingWindowEU;
                changed.push(`windowEU:${session.tradingWindowEU ? 'ON' : 'OFF'}`);
            }
            if (s.tradingWindowUS !== undefined) {
                session.tradingWindowUS = !!s.tradingWindowUS;
                changed.push(`windowUS:${session.tradingWindowUS ? 'ON' : 'OFF'}`);
            }

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

            // Шаговый TP (Step TP / STP)
            if (s.stepTpEnabled !== undefined) { session.stepTpEnabled = !!s.stepTpEnabled; changed.push(`stepTp:${session.stepTpEnabled ? 'ON' : 'OFF'}`); }
            if (s.stepTpTrigger !== undefined) {
                const v = parseFloat(s.stepTpTrigger);
                if (Number.isFinite(v) && v > 0) { session.stepTpTrigger = v; changed.push('stepTpTrigger'); }
            }
            if (s.stepTpStep !== undefined) {
                const v = parseFloat(s.stepTpStep);
                if (Number.isFinite(v) && v > 0) { session.stepTpStep = v; changed.push('stepTpStep'); }
            }
            if (s.stepTpTolerance !== undefined) {
                const v = parseFloat(s.stepTpTolerance);
                if (Number.isFinite(v) && v >= 0) { session.stepTpTolerance = v; changed.push('stepTpTolerance'); }
            }
            // Взаимоисключение Trailing ↔ StepTP
            if (session.stepTpEnabled && session.trailingEnabled) {
                session.trailingEnabled = false;
                changed.push('trailing:OFF(excl)');
            }

            // SMA-возврат (MR)
            if (s.smaReturnEnabled !== undefined) {
                session.smaReturnEnabled = !!s.smaReturnEnabled;
                changed.push(`smaReturn:${session.smaReturnEnabled ? 'ON' : 'OFF'}`);
            }

            // ATR-фильтр волатильности
            if (s.atrFilterEnabled !== undefined) {
                session.atrFilterEnabled = !!s.atrFilterEnabled;
                changed.push(`atrFilter:${session.atrFilterEnabled ? 'ON' : 'OFF'}`);
            }
            if (s.atrFilterThreshold !== undefined) {
                const t = parseFloat(s.atrFilterThreshold);
                if (Number.isFinite(t) && t > 1.0 && t < 10.0) {
                    session.atrFilterThreshold = t;
                    changed.push(`atrThreshold:${t}`);
                }
            }

            // Bollinger / RSI (Mean Reversion)
            if (s.bbPeriod) { session.bbPeriod = parseInt(s.bbPeriod); changed.push('bbPeriod'); }
            if (s.bbMultiplier) { session.bbMultiplier = parseFloat(s.bbMultiplier); changed.push('bbMultiplier'); }
            if (s.rsiPeriod) { session.rsiPeriod = parseInt(s.rsiPeriod); changed.push('rsiPeriod'); }
            if (s.rsiOverbought) { session.rsiOverbought = parseFloat(s.rsiOverbought); changed.push('rsiOverbought'); }
            if (s.rsiOversold) { session.rsiOversold = parseFloat(s.rsiOversold); changed.push('rsiOversold'); }

            // Manual-стратегия
            if (s.manualStopPct !== undefined) {
                const v = parseFloat(s.manualStopPct);
                if (Number.isFinite(v) && v > 0 && v < 20) {
                    session.manualStopPct = v; changed.push('manualStopPct');
                }
            }
            if (s.manualSizeMode !== undefined) {
                session.manualSizeMode = s.manualSizeMode === 'fixed' ? 'fixed' : 'risk';
                changed.push(`manualSizeMode:${session.manualSizeMode}`);
            }
            if (s.manualFixedSizePct !== undefined) {
                const v = parseFloat(s.manualFixedSizePct);
                if (Number.isFinite(v) && v > 0 && v <= 100) {
                    session.manualFixedSizePct = v; changed.push('manualFixedSizePct');
                }
            }
            if (s.manualTimeoutEnabled !== undefined) {
                session.manualTimeoutEnabled = !!s.manualTimeoutEnabled;
                changed.push(`manualTimeout:${session.manualTimeoutEnabled ? 'ON' : 'OFF'}`);
            }

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
            if (session.position._pending) return res.status(400).json({ error: 'Позиция ещё открывается на бирже, подожди несколько секунд' });
            if (session.position._closing) return res.status(400).json({ error: 'Позиция уже закрывается, подожди' });

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

            // Если фронтенд передал стартовый баланс — фиксируем его сразу,
            // не дожидаясь первого startBot. Иначе при последующем запуске
            // сработает защита _startBalanceInit и totalPnl покажет
            // virtualBalance(новый) − startBalance(дефолтный 10000) = большой минус.
            if (req.body.virtualBalance !== undefined) {
                const vb = parseFloat(req.body.virtualBalance);
                if (Number.isFinite(vb) && vb > 0) {
                    session.virtualBalance = vb;
                    session.startBalance = vb;
                    session._startBalanceInit = true;
                }
            }
            // Гарантия чистого листа для нового бота: сброс истории/счётчиков.
            // getSession ставит дефолты только при ПЕРВОМ создании ключа в Map,
            // но если botId совпадёт с уже существующим (или сюда придут стейлы из persist),
            // — лучше явно зачистить.
            session.trades = [];
            session.dayPnl = 0;
            session.dayStartDate = null;
            session.consecutiveLosses = 0;
            session.position = null;

            console.log(`[BOT ${ts()}] ➕ Created bot ${botId} for uid=${uid} (${session.pair} / ${session.strategy || 'scalper'}) start=$${session.startBalance}`);
            res.json({ ok: true, botId, bots: getUserBots(uid) });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/reset-stats — сбросить статистику бота (баланс, сделки, dayPnl)
    // НЕ удаляет бота и его настройки — только обнуляет историю и баланс.
    // Используется когда нужно "начать заново" с теми же настройками.
    app.post('/api/bot/reset-stats', (req, res) => {
        try {
            const uid = req.body.uid || 'anonymous';
            const botId = req.body.botId;
            if (!botId) return res.status(400).json({ error: 'botId required' });

            const key = uid + ':' + botId;
            const session = sessions.get(key);
            if (!session) return res.status(404).json({ error: 'bot not found' });

            // Если бот сейчас в позиции — не даём ресетить (иначе теряется баланс изменения)
            if (session.position) {
                return res.status(400).json({ error: 'Close open position before reset' });
            }

            const newBalance = parseFloat(req.body.virtualBalance);
            if (Number.isFinite(newBalance) && newBalance > 0) {
                session.virtualBalance = newBalance;
                session.startBalance   = newBalance;
            } else {
                // По умолчанию — сбросить к текущему startBalance (то есть totalPnl станет 0)
                session.virtualBalance = session.startBalance;
            }
            session._startBalanceInit = true;
            session.trades = [];
            session.dayPnl = 0;
            session.dayStartDate = null;
            session.consecutiveLosses = 0;

            try { saveSessionsToDisk(); } catch(e) {}
            console.log(`[BOT ${ts()}] 🔄 Reset stats for bot ${botId} (uid=${uid}), balance=$${session.virtualBalance}`);
            res.json({ ok: true, balance: session.virtualBalance, startBalance: session.startBalance });
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
            // API ключи теперь хранятся на уровне пользователя (uid), не бота.
            // Удалять их при удалении одного бота НЕ нужно — у пользователя
            // могут быть другие боты, использующие те же ключи.
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
                stepTpEnabled: session.stepTpEnabled || false,
                stepTpTrigger: session.stepTpTrigger || 5.00,
                stepTpStep: session.stepTpStep || 0.50,
                stepTpTolerance: session.stepTpTolerance || 0.50,
                bbExitEnabled: session.bbExitEnabled,
                bbExitTolerance: session.bbExitTolerance,
                smaReturnEnabled: session.smaReturnEnabled || false,
                smaReturnTolerance: session.smaReturnTolerance,
                maxProfitPct: session.maxProfitPct,
                cooldownCandles: session.cooldownCandles,
                stopAtrMultiplier: session.stopAtrMultiplier,
                clusterEnabled: session.clusterEnabled,
                clusterEntryFilter: session.clusterEntryFilter || false,
                regimeFilterEnabled: session.regimeFilterEnabled || false,
                tradingWindowEU: !!session.tradingWindowEU,
                tradingWindowUS: !!session.tradingWindowUS,
                atrFilterEnabled: session.atrFilterEnabled || false,
                atrFilterThreshold: session.atrFilterThreshold || 2.0,
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
                    stepTpActive:   session.position.stepTpActive || false,
                    stepTpMaxLevel: session.position.stepTpMaxLevel || null,
                    // Live: дополнительные данные с биржи (если есть)
                    pending:        !!session.position._pending,
                    closing:        !!session.position._closing,
                } : null,
                // Live: данные с биржи из периодической синхронизации
                exchangeMarkPrice:     session.mode === 'live' ? (session.exchangeMarkPrice || null) : null,
                exchangeUnrealizedPnl: session.mode === 'live' ? (session.exchangeUnrealizedPnl || 0) : 0,
                levels:      session.levels,
                levelsCount: session.levels.length,
                consecutiveLosses: session.consecutiveLosses,
                maxLosses: session.maxLosses,
                cooldownUntil: session.cooldownUntil || 0,
                entryMode: session.entryMode || 'candle',
                direction: session.direction || 'both',
                rsiOversold: session.rsiOversold || 35,
                rsiOverbought: session.rsiOverbought || 65,
                dayLimitPct: session.dayLimitPct,
                tradeCount:  session.trades.length,
                winRate:     calcWinRate(session.trades),
                wsConnected: session.ws && session.ws.readyState === WebSocket.OPEN,
                candlesLoaded: session.candles.length,
                volumeInfo: getVolumeInfo(session),
                clusterInfo: getClusterInfo(session),
                strategy: session.strategy || 'scalper',
                regime: session.regime || null,
                atrRegime: session.atrRegime || null,
                // Manual-стратегия: настройки + ожидающая лимитка
                manualStopPct:       session.manualStopPct || 0.5,
                manualSizeMode:      session.manualSizeMode || 'risk',
                manualFixedSizePct:  session.manualFixedSizePct || 10,
                manualTimeoutEnabled: !!session.manualTimeoutEnabled,
                pendingLimit:        session.pendingLimit || null,
                pendingExit:         session.pendingExit || null,
                // BB/RSI рассчитываем и для MR, и для manual — виджет в обоих случаях их показывает
                bbData: (session.strategy === 'mean_reversion' || session.strategy === 'manual') ? (() => {
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
            const limit = parseInt(req.query.limit) || 1000;
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
            const limit = parseInt(req.query.limit) || 1000;
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

    /* ════════════════════════════════════════════
       АНАЛИТИКА — агрегированная статистика по сделкам.
       GET /api/bot/analytics?uid=X&hours=24
       Возвращает разбивки по стратегии, паре, стороне, окну, режиму, часу.
       ════════════════════════════════════════════ */
    app.get('/api/bot/analytics', (req, res) => {
        try {
            const uid = req.query.uid || 'anonymous';
            const hours = parseInt(req.query.hours);  // 0 или не задано = всё время
            const botId = req.query.botId || null;    // null = все боты юзера
            const useTimeFilter = Number.isFinite(hours) && hours > 0;
            const since = useTimeFilter ? Date.now() - hours * 60 * 60 * 1000 : 0;

            // Собираем сделки юзера за период (по всем ботам или по конкретному)
            const trades = [];
            let scopeBotLabel = null;
            for (const [key, session] of sessions) {
                if (!key.startsWith(uid + ':')) continue;
                const sessionBotId = key.split(':')[1];
                // Если задан botId — берём только этого бота
                if (botId && sessionBotId !== botId) continue;
                if (botId && sessionBotId === botId) {
                    scopeBotLabel = getFullBotLabel(session);
                }
                const label = getFullBotLabel(session);
                session.trades.forEach(t => {
                    if (useTimeFilter && t.openedAt && t.openedAt < since) return;
                    trades.push(Object.assign({}, t, { botId: sessionBotId, botLabel: label }));
                });
            }

            if (trades.length === 0) {
                return res.json({
                    empty: true,
                    hours: useTimeFilter ? hours : 0,
                    totalTrades: 0,
                    scope: botId ? { type: 'bot', botId: botId, label: scopeBotLabel } : { type: 'all' },
                });
            }

            // ── Утилиты ──
            const num = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;

            function computeBucket(arr) {
                const n = arr.length;
                if (n === 0) return null;
                let wins = 0, losses = 0, pnl = 0, fees = 0, sumWin = 0, sumLoss = 0;
                arr.forEach(t => {
                    const p = num(t.pnl);
                    pnl += p;
                    fees += num(t.fee);
                    if (p > 0) { wins++; sumWin += p; }
                    else { losses++; sumLoss += p; }
                });
                const avgWin = wins > 0 ? sumWin / wins : 0;
                const avgLoss = losses > 0 ? sumLoss / losses : 0;
                return {
                    n: n,
                    wins: wins,
                    losses: losses,
                    winRate: Math.round((wins / n) * 1000) / 10, // 1 знак
                    pnl: Math.round(pnl * 100) / 100,
                    fees: Math.round(fees * 100) / 100,
                    avgPnl: Math.round((pnl / n) * 100) / 100,
                    avgWin: Math.round(avgWin * 100) / 100,
                    avgLoss: Math.round(avgLoss * 100) / 100,
                };
            }

            function groupBy(keyFn) {
                const groups = {};
                trades.forEach(t => {
                    const k = keyFn(t);
                    if (k == null || k === '') return;
                    if (!groups[k]) groups[k] = [];
                    groups[k].push(t);
                });
                const out = {};
                Object.keys(groups).forEach(k => { out[k] = computeBucket(groups[k]); });
                return out;
            }

            // Общая статистика
            const overall = computeBucket(trades);
            // Break-even WR из текущих win/loss
            const beWR = overall.avgLoss !== 0
                ? Math.round((Math.abs(overall.avgLoss) / (overall.avgWin + Math.abs(overall.avgLoss))) * 1000) / 10
                : null;
            // Общий P&L Gross (без комиссий)
            const grossPnl = trades.reduce((s, t) => s + num(t.grossPnl), 0);
            const totalFees = trades.reduce((s, t) => s + num(t.fee), 0);

            // Группировки
            const byStrategy = groupBy(t => t.strategy || 'unknown');
            const bySide     = groupBy(t => t.side);
            const byPair     = groupBy(t => t.pair);
            const byBot      = groupBy(t => t.botLabel || 'unknown');

            // Окна торговли — используем tradingWindowAtEntry
            const byWindow   = groupBy(t => t.tradingWindowAtEntry || 'unknown');

            // Часы UTC
            const byHour     = groupBy(t => t.entryHourUTC != null ? `${String(t.entryHourUTC).padStart(2,'0')}:00 UTC` : null);

            // По режиму V2 — степень согласованности 4h/15m/5m
            // Ключи: 'all_up' | 'all_down' | 'two_agree' | 'disagree' | 'no_regime' | 'legacy'
            const byRegimeAgreement = groupBy(t => {
                const r = t.entryRegime;
                if (!r) return 'no_regime';
                // V2 формат
                if (r.tf4hState != null || r.tf15mState != null || r.tf5mState != null) {
                    const s = [r.tf4hState, r.tf15mState, r.tf5mState];
                    const ups = s.filter(x => x === 'up').length;
                    const downs = s.filter(x => x === 'down').length;
                    if (ups === 3) return 'all_up';
                    if (downs === 3) return 'all_down';
                    if (ups === 2 || downs === 2) return 'two_agree';
                    return 'disagree';
                }
                return 'legacy';
            });

            // По выходу
            const byExit = groupBy(t => t.reason || 'unknown');

            // Выявление инсайтов — топ-3 наблюдения для пользователя
            // type: 'good' | 'warn' | 'bad' — UI рисует соответствующую SVG-иконку
            const insights = [];

            // Проверка: окна торговли
            const winEU = byWindow['EU'];
            const winUS = byWindow['US'];
            const winAll = byWindow['all'];
            if (winEU && winEU.n >= 3 && winEU.winRate >= 70) {
                insights.push({ text: `Окно EU даёт WR ${winEU.winRate}% (n=${winEU.n}, $${winEU.pnl >= 0 ? '+' : ''}${winEU.pnl})`, type: 'good' });
            }
            if (winAll && winAll.n >= 5 && winAll.pnl < 0) {
                insights.push({ text: `Сделки вне окон: WR ${winAll.winRate}% net $${winAll.pnl} — рассмотри включение фильтра окон`, type: 'warn' });
            }

            // Проверка: пары
            Object.keys(byPair).forEach(pair => {
                const b = byPair[pair];
                if (b.n >= 5) {
                    if (b.winRate <= 35 && b.pnl < -5) {
                        insights.push({ text: `${pair}: WR ${b.winRate}% net $${b.pnl} — пара убыточна`, type: 'bad' });
                    } else if (b.winRate >= 70 && b.pnl > 0) {
                        insights.push({ text: `${pair}: WR ${b.winRate}% net $${b.pnl > 0 ? '+' : ''}${b.pnl} — лучшая пара`, type: 'good' });
                    }
                }
            });

            // Проверка: стороны
            const longB = bySide['LONG'];
            const shortB = bySide['SHORT'];
            if (longB && longB.n >= 5 && longB.winRate <= 35) {
                insights.push({ text: `LONG-сделки: WR ${longB.winRate}% net $${longB.pnl} — рынок медвежий?`, type: 'bad' });
            }
            if (shortB && shortB.n >= 5 && shortB.winRate <= 35) {
                insights.push({ text: `SHORT-сделки: WR ${shortB.winRate}% net $${shortB.pnl} — рынок бычий?`, type: 'bad' });
            }

            // Проверка: согласованность режима
            const allUp = byRegimeAgreement['all_up'];
            const allDn = byRegimeAgreement['all_down'];
            const disagree = byRegimeAgreement['disagree'];
            if (allUp && allUp.n >= 3 && allUp.winRate >= 70) {
                insights.push({ text: `Когда все 3 ТФ вверх: WR ${allUp.winRate}% (n=${allUp.n}) — режим работает`, type: 'good' });
            }
            if (allDn && allDn.n >= 3 && allDn.winRate >= 70) {
                insights.push({ text: `Когда все 3 ТФ вниз: WR ${allDn.winRate}% (n=${allDn.n}) — режим работает`, type: 'good' });
            }
            if (disagree && disagree.n >= 5 && disagree.pnl < 0) {
                insights.push({ text: `На расхождении ТФ: WR ${disagree.winRate}% net $${disagree.pnl} — включи R-фильтр`, type: 'warn' });
            }

            // Проверка: WR ниже break-even
            if (beWR != null && overall.winRate < beWR) {
                insights.push({ text: `WR ${overall.winRate}% ниже break-even ${beWR}% — текущий R:R математически проигрышный`, type: 'warn' });
            }

            res.json({
                hours: useTimeFilter ? hours : 0,
                totalTrades: trades.length,
                scope: botId ? { type: 'bot', botId: botId, label: scopeBotLabel } : { type: 'all' },
                overall: overall,
                breakEvenWR: beWR,
                grossPnl: Math.round(grossPnl * 100) / 100,
                totalFees: Math.round(totalFees * 100) / 100,
                feesAsPercentOfGross: grossPnl !== 0 ? Math.round((totalFees / Math.abs(grossPnl)) * 1000) / 10 : null,
                byStrategy: byStrategy,
                bySide: bySide,
                byPair: byPair,
                byBot: byBot,
                byWindow: byWindow,
                byHour: byHour,
                byRegimeAgreement: byRegimeAgreement,
                byExit: byExit,
                insights: insights.slice(0, 5),
            });
        } catch(e) {
            console.error('[ANALYTICS] error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/bot/clear-trades — очистка журнала сделок
    // Если указан botId — чистим только у этого бота, иначе у всех ботов пользователя.
    // Открытые позиции не трогаем.
    app.post('/api/bot/clear-trades', (req, res) => {
        try {
            const uid   = req.body.uid || 'anonymous';
            const botId = req.body.botId || null;
            let cleared = 0;
            let botsAffected = 0;

            for (const [key, session] of sessions) {
                if (!key.startsWith(uid + ':')) continue;
                const sessBotId = key.split(':')[1];
                if (botId && sessBotId !== botId) continue;
                cleared += session.trades.length;
                session.trades = [];
                // Сбрасываем дневной PnL и счётчик проигрышей подряд —
                // иначе статистика будет "кривой" относительно пустого журнала.
                session.dayPnl = 0;
                session.consecutiveLosses = 0;
                botsAffected++;
            }

            console.log(`[BOT ${ts()}] 🗑️  Cleared ${cleared} trades across ${botsAffected} bot(s) for uid=${uid}${botId ? ` botId=${botId}` : ' (all bots)'}`);
            res.json({ ok: true, cleared, botsAffected });
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
        if (pos._pending || pos._closing) return 0;  // плейсхолдер не считаем

        // Live: если есть свежие данные с биржи — используем их.
        // Они учитывают mark price + funding + резерв exit-комиссии,
        // именно так Binance показывает unrealized в своём UI.
        if (session.mode === 'live' && typeof session.exchangeUnrealizedPnl === 'number') {
            return Math.round(session.exchangeUnrealizedPnl * 100) / 100;
        }

        const diff = pos.side === 'LONG'
            ? (session.currentPrice - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - session.currentPrice) / pos.entryPrice;

        return Math.round(pos.size * diff * 100) / 100;
    }

    /* ══════════════════════════════════════════════════════════════
       LIVE: проверка API ключей Binance Futures
       
       Принимает ключи и опциональный флаг testnet, делает три
       последовательные проверки:
         1. ping        — биржа в принципе достижима
         2. server time — расхождение часов <recvWindow
         3. account     — ключи валидны, есть права на Futures
       
       Не привязан к боту: можно вызывать на этапе настройки
       до создания/запуска бота. Ничего не сохраняет.
       
       Ответ: { ok, host, time, balance, error?, errorCode? }
       На UI кнопка "Проверить подключение" вызывает этот эндпоинт.
    ══════════════════════════════════════════════════════════════ */
    app.post('/api/bot/test-binance-keys', async (req, res) => {
        try {
            const { apiKey, apiSecret, testnet } = req.body || {};
            if (!apiKey || !apiSecret) {
                return res.json({ ok: false, error: 'API Key и API Secret обязательны' });
            }
            const client = createBinanceClient({
                apiKey:    String(apiKey).trim(),
                apiSecret: String(apiSecret).trim(),
                testnet:   !!testnet,
            });

            // 1. Ping — без подписи. Если упадёт здесь, проблема с сетью
            //    или хостом, а не с ключами.
            const pingResult = await client.ping();
            if (!pingResult.ok) {
                return res.json({
                    ok:    false,
                    host:  client.getHost(),
                    error: 'Биржа недоступна: ' + pingResult.error,
                });
            }

            // 2. Server time — проверяем расхождение часов.
            //    Если >2.5с (половина recvWindow), все signed-запросы
            //    будут падать с -1021. Сервер должен быть синхронизирован
            //    через NTP, но на всякий случай явно проверяем.
            const timeResult = await client.getServerTime();
            let timeSkewMs = null;
            if (timeResult.ok && timeResult.data && timeResult.data.serverTime) {
                timeSkewMs = Date.now() - timeResult.data.serverTime;
                if (Math.abs(timeSkewMs) > 2500) {
                    return res.json({
                        ok: false,
                        host: client.getHost(),
                        error: `Часы сервера расходятся с биржей на ${timeSkewMs}мс. Нужно синхронизировать NTP.`,
                    });
                }
            }

            // 3. Account info — главная проверка. Если ключ невалидный
            //    или без прав на Futures — упадёт здесь с понятным кодом.
            const accountResult = await client.getAccountInfo();
            if (!accountResult.ok) {
                let hint = '';
                if (accountResult.apiCode === -2015) {
                    hint = ' Проверь: ключ верный, IP в whitelist, права Enable Futures включены.';
                } else if (accountResult.apiCode === -2014) {
                    hint = ' Похоже API Key введён с пробелом или не полностью.';
                } else if (accountResult.apiCode === -1022) {
                    hint = ' Подпись не прошла. Проверь API Secret.';
                }
                return res.json({
                    ok:        false,
                    host:      client.getHost(),
                    error:     accountResult.error + hint,
                    errorCode: accountResult.apiCode,
                });
            }

            // Успех — возвращаем баланс и кол-во открытых позиций для UX.
            const acc = accountResult.data || {};
            const totalWalletBalance  = parseFloat(acc.totalWalletBalance  || 0);
            const availableBalance    = parseFloat(acc.availableBalance    || 0);
            const openPositions       = (acc.positions || []).filter(p => parseFloat(p.positionAmt) !== 0).length;
            const canTrade            = !!acc.canTrade;

            return res.json({
                ok:                true,
                host:              client.getHost(),
                testnet:           client.isTestnet(),
                timeSkewMs:        timeSkewMs,
                canTrade:          canTrade,
                totalWalletBalance: totalWalletBalance,
                availableBalance:   availableBalance,
                openPositions:      openPositions,
            });
        } catch (e) {
            console.error('[BOT] test-binance-keys failed:', e);
            return res.json({ ok: false, error: e.message || 'Internal error' });
        }
    });

    /* ══════════════════════════════════════════════════════════════
       LIVE: сохранить API ключи
       
       Принимает { uid, botId, apiKey, apiSecret, testnet } и
       шифрует их в bot-credentials.json через credentials-store.
       
       Перед сохранением — обязательная проверка через Binance,
       чтобы не сохранить заведомо невалидные ключи. Если проверка
       не прошла — ключи НЕ сохраняются.
    ══════════════════════════════════════════════════════════════ */
    app.post('/api/bot/save-binance-keys', async (req, res) => {
        try {
            const { uid, apiKey, apiSecret, testnet } = req.body || {};
            if (!uid)                       return res.json({ ok: false, error: 'uid обязателен' });
            if (!apiKey || !apiSecret)      return res.json({ ok: false, error: 'apiKey и apiSecret обязательны' });

            // Сначала проверяем что ключи рабочие — через тот же клиент
            const client = createBinanceClient({
                apiKey:    String(apiKey).trim(),
                apiSecret: String(apiSecret).trim(),
                testnet:   !!testnet,
            });
            const accountResult = await client.getAccountInfo();
            if (!accountResult.ok) {
                return res.json({
                    ok:    false,
                    error: 'Ключи не прошли проверку: ' + accountResult.error,
                });
            }

            // Сохраняем на уровне пользователя (один набор ключей на всех ботов)
            const result = credsStore.saveCredentials(uid, apiKey, apiSecret, !!testnet);
            if (!result.ok) {
                return res.json({ ok: false, error: result.error });
            }

            // Обновляем ключи во ВСЕХ активных сессиях этого пользователя.
            // Каждый бот будет использовать новые ключи при следующем ордере.
            const prefix = uid + ':';
            for (const [key, session] of sessions) {
                if (key.indexOf(prefix) === 0) {
                    session.apiKey       = String(apiKey).trim();
                    session.apiSecret    = String(apiSecret).trim();
                    session.apiTestnet   = !!testnet;
                    session.apiConnected = true;
                    // Сбросить кешированный binance-client чтобы он пересоздался с новыми ключами
                    session._binanceClient = null;
                }
            }

            return res.json({ ok: true, savedAt: Date.now() });
        } catch (e) {
            console.error('[BOT] save-binance-keys failed:', e);
            return res.json({ ok: false, error: e.message || 'Internal error' });
        }
    });

    /* ══════════════════════════════════════════════════════════════
       LIVE: статус сохранённых ключей
       
       Ключи хранятся на уровне пользователя (uid). Параметр botId
       принимается для совместимости со старым UI, но игнорируется.
       Возвращает { saved, testnet?, updatedAt? } БЕЗ самого ключа.
    ══════════════════════════════════════════════════════════════ */
    app.get('/api/bot/binance-keys-status', (req, res) => {
        try {
            const { uid } = req.query || {};
            if (!uid) return res.json({ saved: false, error: 'uid обязателен' });
            const status = credsStore.hasCredentials(uid);
            return res.json(status);
        } catch (e) {
            return res.json({ saved: false, error: e.message });
        }
    });

    /* ══════════════════════════════════════════════════════════════
       LIVE: удалить сохранённые ключи (на уровне пользователя)
       После удаления — все боты этого пользователя в Live режиме
       не смогут запуститься, пока ключи не будут введены заново.
    ══════════════════════════════════════════════════════════════ */
    app.post('/api/bot/delete-binance-keys', (req, res) => {
        try {
            const { uid } = req.body || {};
            if (!uid) return res.json({ ok: false, error: 'uid обязателен' });
            const result = credsStore.deleteCredentials(uid);
            // Чистим ключи во ВСЕХ активных сессиях этого пользователя
            const prefix = uid + ':';
            for (const [key, session] of sessions) {
                if (key.indexOf(prefix) === 0) {
                    session.apiKey       = '';
                    session.apiSecret    = '';
                    session.apiConnected = false;
                    session._binanceClient = null;
                }
            }
            return res.json(result);
        } catch (e) {
            return res.json({ ok: false, error: e.message });
        }
    });

    console.log('🤖 Bot Server v2 (Algo Scalper) routes loaded');

    // Загружаем сохранённые сессии в конце инициализации,
    // когда getSession и все функции уже определены
    loadSessionsFromDisk();
};
