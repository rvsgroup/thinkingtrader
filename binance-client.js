/* ══════════════════════════════════════════════════════════════
   BINANCE FUTURES CLIENT — Thinking Trader
   
   Тонкая обёртка над Binance Futures REST API.
   Знает только биржу — никакой логики ботов/стратегий/сессий.
   
   Использование:
       const { createClient } = require('./binance-client');
       const client = createClient({
           apiKey:    '...',
           apiSecret: '...',
           testnet:   false,
       });
       
       await client.ping();              // проверка что биржа доступна
       await client.getAccountInfo();    // проверка что ключи валидны
   
   На этом шаге реализованы только два метода: ping и getAccountInfo.
   Методы ордеров будут добавлены на следующем шаге.
   ══════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const HOSTS = {
    mainnet: 'https://fapi.binance.com',
    testnet: 'https://testnet.binancefuture.com',
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RECV_WINDOW = 5000; // окно валидности подписи в мс

function createClient(opts) {
    const apiKey    = (opts && opts.apiKey)    || '';
    const apiSecret = (opts && opts.apiSecret) || '';
    const testnet   = !!(opts && opts.testnet);
    const host      = testnet ? HOSTS.testnet : HOSTS.mainnet;

    /* ══════════════════════════════════════════
       Подпись запроса
       Binance Futures требует HMAC-SHA256 подпись
       строки query/body параметров. Подписываем
       секретом и добавляем как параметр signature.
    ══════════════════════════════════════════ */
    function sign(queryString) {
        return crypto
            .createHmac('sha256', apiSecret)
            .update(queryString)
            .digest('hex');
    }

    /* ══════════════════════════════════════════
       Сборка query-строки из объекта
       Сохраняет порядок ключей, корректно
       кодирует значения. Пустые значения
       (undefined/null/'') пропускаются.
    ══════════════════════════════════════════ */
    function buildQuery(params) {
        if (!params) return '';
        const parts = [];
        for (const key of Object.keys(params)) {
            const v = params[key];
            if (v === undefined || v === null || v === '') continue;
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
        }
        return parts.join('&');
    }

    /* ══════════════════════════════════════════
       Низкоуровневый запрос с таймаутом
       Возвращает { ok, status, data, error } —
       никогда не бросает, всегда даёт результат
       с понятной структурой.
    ══════════════════════════════════════════ */
    async function rawRequest(method, url, headers, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method,
                headers: headers || {},
                body: body || undefined,
                signal: controller.signal,
            });
            const text = await res.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
            
            if (!res.ok) {
                // Binance возвращает { code, msg } при ошибках. Сохраняем оба для понятного лога.
                const apiCode = data && data.code;
                const apiMsg  = data && data.msg;
                return {
                    ok:      false,
                    status:  res.status,
                    data:    null,
                    error:   apiMsg || ('HTTP ' + res.status),
                    apiCode: apiCode || null,
                };
            }
            return { ok: true, status: res.status, data, error: null };
        } catch (e) {
            const isAbort = e && e.name === 'AbortError';
            return {
                ok:     false,
                status: 0,
                data:   null,
                error:  isAbort ? 'Timeout (биржа не ответила за 10с)' : (e.message || 'Network error'),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /* ══════════════════════════════════════════
       Публичный запрос (без подписи)
       Используется для ping/server time/символов.
    ══════════════════════════════════════════ */
    async function publicGet(path, params) {
        const qs = buildQuery(params);
        const url = host + path + (qs ? ('?' + qs) : '');
        return rawRequest('GET', url, {}, null);
    }

    /* ══════════════════════════════════════════
       Приватный запрос (с подписью)
       Подписывается query-строка. Заголовок
       X-MBX-APIKEY обязателен. Параметры
       timestamp и recvWindow добавляются автоматом.
    ══════════════════════════════════════════ */
    async function signedRequest(method, path, params) {
        if (!apiKey || !apiSecret) {
            return { ok: false, status: 0, data: null, error: 'API ключи не заданы' };
        }
        const enrichedParams = Object.assign({}, params || {}, {
            timestamp:  Date.now(),
            recvWindow: DEFAULT_RECV_WINDOW,
        });
        const qs = buildQuery(enrichedParams);
        const signature = sign(qs);
        const fullQs = qs + '&signature=' + signature;
        const url = host + path + '?' + fullQs;
        const headers = { 'X-MBX-APIKEY': apiKey };
        return rawRequest(method, url, headers, null);
    }

    /* ══════════════════════════════════════════
       PUBLIC METHODS
    ══════════════════════════════════════════ */
    
    /**
     * Ping — простейший публичный эндпоинт.
     * Возвращает {} при успехе. Используется чтобы убедиться,
     * что мы вообще можем достучаться до Binance Futures.
     */
    async function ping() {
        return publicGet('/fapi/v1/ping');
    }
    
    /**
     * Server time — для отладки расхождений местного и биржевого времени.
     * Если разница больше recvWindow — все подписанные запросы будут
     * отвергаться с ошибкой -1021.
     */
    async function getServerTime() {
        return publicGet('/fapi/v1/time');
    }

    /**
     * Account info — приватный эндпоинт. Возвращает баланс,
     * открытые позиции, доступное плечо. Главное использование
     * на этом шаге — проверка что ключи валидны и имеют
     * права на Futures.
     */
    async function getAccountInfo() {
        return signedRequest('GET', '/fapi/v2/account');
    }

    /* ══════════════════════════════════════════════════════════
       MARKET DATA
       Информация о символах, ценах. Без подписи.
    ══════════════════════════════════════════════════════════ */

    /**
     * Кеш exchange info. Эти данные редко меняются (раз в недели),
     * но критичны для каждого ордера: tick size, step size, минимальные
     * нотионалы и количества. Без них биржа отвергнет ордер с ошибкой.
     * Кеш живёт в рамках экземпляра клиента; перечитывается раз в час.
     */
    let _exchangeInfoCache = null;
    let _exchangeInfoFetchedAt = 0;
    const EXCHANGE_INFO_TTL_MS = 60 * 60 * 1000; // 1 час

    async function getExchangeInfo(force = false) {
        const now = Date.now();
        if (!force && _exchangeInfoCache && (now - _exchangeInfoFetchedAt) < EXCHANGE_INFO_TTL_MS) {
            return { ok: true, data: _exchangeInfoCache, cached: true };
        }
        const result = await publicGet('/fapi/v1/exchangeInfo');
        if (result.ok) {
            _exchangeInfoCache = result.data;
            _exchangeInfoFetchedAt = now;
        }
        return result;
    }

    /**
     * Извлечь правила фильтров для конкретного символа.
     * Возвращает { tickSize, stepSize, minQty, minNotional, pricePrecision, quantityPrecision }.
     * Эти числа используются для округления количества и цены перед ордером.
     */
    async function getSymbolFilters(symbol) {
        const ei = await getExchangeInfo();
        if (!ei.ok) return { ok: false, error: ei.error };
        const sym = (ei.data.symbols || []).find(s => s.symbol === symbol);
        if (!sym) return { ok: false, error: `Symbol ${symbol} not found in exchangeInfo` };

        const filters = sym.filters || [];
        const priceFilter   = filters.find(f => f.filterType === 'PRICE_FILTER');
        const lotSizeFilter = filters.find(f => f.filterType === 'LOT_SIZE');
        const marketLotFilter = filters.find(f => f.filterType === 'MARKET_LOT_SIZE');
        const minNotional   = filters.find(f => f.filterType === 'MIN_NOTIONAL');

        return {
            ok: true,
            data: {
                symbol:             sym.symbol,
                pricePrecision:     sym.pricePrecision,
                quantityPrecision:  sym.quantityPrecision,
                tickSize:           priceFilter   ? parseFloat(priceFilter.tickSize)     : null,
                stepSize:           lotSizeFilter ? parseFloat(lotSizeFilter.stepSize)   : null,
                marketStepSize:     marketLotFilter ? parseFloat(marketLotFilter.stepSize) : null,
                minQty:             lotSizeFilter ? parseFloat(lotSizeFilter.minQty)     : null,
                minNotional:        minNotional   ? parseFloat(minNotional.notional)     : null,
            },
        };
    }

    /**
     * Округлить количество вниз до stepSize. Округление ВНИЗ — критично,
     * чтобы итог был не больше задуманного риска и не превышал доступную маржу.
     */
    function roundDownToStep(value, step) {
        if (!step || step <= 0) return value;
        const inverse = 1 / step;
        return Math.floor(value * inverse) / inverse;
    }

    /**
     * Округлить цену до tickSize. Округление к ближайшему — биржа
     * принимает цены ровно на сетке тика; "не до" и "сверху" одинаково
     * валидны, поэтому берём ближайший.
     */
    function roundToTick(value, tick) {
        if (!tick || tick <= 0) return value;
        const inverse = 1 / tick;
        return Math.round(value * inverse) / inverse;
    }

    /**
     * Текущая mark price символа. Используется для UI/логов и расчёта
     * номинального размера позиции при проверках перед ордером.
     */
    async function getMarkPrice(symbol) {
        return publicGet('/fapi/v1/premiumIndex', { symbol });
    }

    /* ══════════════════════════════════════════════════════════
       ACCOUNT CONFIG
       Перед открытием позиции нужно один раз настроить
       leverage и marginType для символа.
    ══════════════════════════════════════════════════════════ */

    /**
     * Установить плечо для символа. Binance вернёт ошибку если плечо
     * больше максимального для данного notional bracket'а — обработать выше.
     * Можно вызывать перед каждым входом, биржа просто ничего не делает
     * если плечо уже такое.
     */
    async function setLeverage(symbol, leverage) {
        return signedRequest('POST', '/fapi/v1/leverage', {
            symbol,
            leverage: parseInt(leverage),
        });
    }

    /**
     * Установить тип маржи (ISOLATED / CROSSED).
     * ВАЖНО: Binance возвращает ошибку -4046 "No need to change margin type",
     * если тип уже такой — это НЕ ошибка, нужно игнорировать.
     */
    async function setMarginType(symbol, marginType) {
        const result = await signedRequest('POST', '/fapi/v1/marginType', {
            symbol,
            marginType: String(marginType).toUpperCase(),
        });
        if (!result.ok && result.apiCode === -4046) {
            return { ok: true, data: { msg: 'already set' }, alreadySet: true };
        }
        return result;
    }

    /**
     * Установить режим позиций dual/single side.
     * Нам нужен SINGLE (one-way mode): dualSidePosition=false.
     * Аналогично setMarginType — если уже выставлен, игнорируем -4059.
     */
    async function setPositionMode(dualSide) {
        const result = await signedRequest('POST', '/fapi/v1/positionSide/dual', {
            dualSidePosition: !!dualSide,
        });
        if (!result.ok && (result.apiCode === -4059 || result.apiCode === -4046)) {
            return { ok: true, data: { msg: 'already set' }, alreadySet: true };
        }
        return result;
    }

    /* ══════════════════════════════════════════════════════════
       ORDERS
       Всё что про ордера: открыть, поставить стоп, отменить.
       Используется openPosition / closePosition / Step TP подтяжкой.
    ══════════════════════════════════════════════════════════ */

    /**
     * Маркет-ордер — основной способ открыть/закрыть позицию.
     * side: 'BUY' (для LONG входа или SHORT выхода) или 'SELL' (наоборот).
     * quantity ОБЯЗАН быть округлён до stepSize заранее.
     * reduceOnly=true — ордер только закроет позицию, не откроет новую
     *                  в противоположную сторону. Используем при close.
     */
    async function placeMarketOrder(symbol, side, quantity, reduceOnly = false) {
        const params = {
            symbol,
            side:        String(side).toUpperCase(),
            type:        'MARKET',
            quantity:    String(quantity),
        };
        if (reduceOnly) params.reduceOnly = 'true';
        return signedRequest('POST', '/fapi/v1/order', params);
    }

    /**
     * STOP_MARKET — наш стоп-лосс и Step TP подтянутый стоп.
     * Висит на бирже как условный ордер; при касании triggerPrice
     * АВТОМАТИЧЕСКИ превращается в MARKET и исполняется.
     * Гарантирует выход даже если бот/сервер упали.
     *
     * ВАЖНО: с 2025-12-09 Binance Futures обязательно требует, чтобы
     * условные ордера (STOP_MARKET, TAKE_PROFIT_MARKET, STOP, TAKE_PROFIT,
     * TRAILING_STOP_MARKET) шли через новый Algo Order API:
     *     POST /fapi/v1/algoOrder
     * со специальным параметром algoType=CONDITIONAL.
     * Старый /fapi/v1/order возвращает -4120 для этих типов.
     * В ответе приходит algoId вместо orderId.
     *
     * side противоположна стороне позиции:
     *   LONG позиция → стоп = SELL
     *   SHORT позиция → стоп = BUY
     *
     * closePosition=true (по умолчанию) — биржа закрывает всю позицию,
     * даже если её размер изменился. Это надёжнее. С closePosition=true
     * нельзя передавать quantity и reduceOnly (Binance не примет).
     *
     * Возвращает {ok, data:{algoId, ...}, error?}.
     */
    async function placeStopMarketOrder(symbol, side, triggerPrice, opts = {}) {
        const params = {
            algoType:       'CONDITIONAL',
            type:           'STOP_MARKET',
            symbol,
            side:           String(side).toUpperCase(),
            triggerPrice:   String(triggerPrice),
            workingType:    opts.workingType || 'MARK_PRICE', // MARK_PRICE надёжнее CONTRACT_PRICE
            priceProtect:   'TRUE',                            // защита от триггера на манипулятивных тиках
        };
        // closePosition=true (закрыть всю позицию) — режим по умолчанию.
        // С ним нельзя передавать quantity и reduceOnly.
        if (opts.quantity != null) {
            params.quantity = String(opts.quantity);
            if (opts.reduceOnly !== false) params.reduceOnly = 'true';
        } else {
            params.closePosition = 'true';
        }
        return signedRequest('POST', '/fapi/v1/algoOrder', params);
    }

    /**
     * Take-profit market — то же что STOP_MARKET, но триггерится в обратную
     * сторону. Тот же Algo API.
     */
    async function placeTakeProfitMarketOrder(symbol, side, triggerPrice, opts = {}) {
        const params = {
            algoType:       'CONDITIONAL',
            type:           'TAKE_PROFIT_MARKET',
            symbol,
            side:           String(side).toUpperCase(),
            triggerPrice:   String(triggerPrice),
            workingType:    opts.workingType || 'MARK_PRICE',
            priceProtect:   'TRUE',
        };
        if (opts.quantity != null) {
            params.quantity = String(opts.quantity);
            if (opts.reduceOnly !== false) params.reduceOnly = 'true';
        } else {
            params.closePosition = 'true';
        }
        return signedRequest('POST', '/fapi/v1/algoOrder', params);
    }

    /**
     * Отменить алго-ордер по algoId.
     * Используется при подтяжке Step TP (cancel + new) и при закрытии
     * позиции (отменить остаточный стоп).
     */
    async function cancelAlgoOrder(symbol, algoId) {
        return signedRequest('DELETE', '/fapi/v1/algoOrder', {
            symbol,
            algoId: String(algoId),
        });
    }

    /**
     * Отменить все алго-ордера по символу.
     * Используется при закрытии позиции и аварийном стопе.
     */
    async function cancelAllAlgoOrders(symbol) {
        return signedRequest('DELETE', '/fapi/v1/allOpenAlgoOrders', { symbol });
    }

    /**
     * Получить открытые алго-ордера. Используется для синхронизации
     * после рестарта сервера.
     */
    async function getOpenAlgoOrders(symbol) {
        const params = symbol ? { symbol } : {};
        return signedRequest('GET', '/fapi/v1/openAlgoOrders', params);
    }

    /**
     * Отменить ордер по orderId.
     * ВНИМАНИЕ: только для обычных (не condition) ордеров. Для STOP_MARKET
     * и других condition-ордеров используй cancelAlgoOrder(symbol, algoId).
     */
    async function cancelOrder(symbol, orderId) {
        return signedRequest('DELETE', '/fapi/v1/order', {
            symbol,
            orderId: String(orderId),
        });
    }

    /**
     * Отменить все обычные ордера по символу.
     * Не отменяет condition-ордера (для них cancelAllAlgoOrders).
     */
    async function cancelAllOrders(symbol) {
        return signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
    }

    /**
     * Получить детали конкретного ордера. Главное использование:
     * после market-входа — узнать реальную fill-цену (avgPrice),
     * комиссию и точное исполненное количество.
     */
    async function getOrder(symbol, orderId) {
        return signedRequest('GET', '/fapi/v1/order', {
            symbol,
            orderId: String(orderId),
        });
    }

    /**
     * Сделки по конкретному ордеру (fill-история). Содержит точные
     * комиссии и цены каждого fill'а. Один market-ордер может состоять
     * из нескольких fill'ов; средняя цена считается по их notional.
     */
    async function getUserTrades(symbol, opts = {}) {
        const params = { symbol };
        if (opts.orderId != null) params.orderId = String(opts.orderId);
        if (opts.limit   != null) params.limit   = String(opts.limit);
        if (opts.startTime != null) params.startTime = String(opts.startTime);
        return signedRequest('GET', '/fapi/v1/userTrades', params);
    }

    /**
     * Все открытые ордера (опционально по символу).
     * Используется при синхронизации после рестарта сервера —
     * чтобы понять какие стопы реально стоят на бирже.
     */
    async function getOpenOrders(symbol) {
        const params = symbol ? { symbol } : {};
        return signedRequest('GET', '/fapi/v1/openOrders', params);
    }

    /**
     * Текущие открытые позиции. Каждая позиция содержит positionAmt
     * (>0 для LONG, <0 для SHORT, 0 если позиции нет), entryPrice,
     * unRealizedProfit, leverage. Для синхронизации после рестарта.
     */
    async function getPositionRisk(symbol) {
        const params = symbol ? { symbol } : {};
        return signedRequest('GET', '/fapi/v2/positionRisk', params);
    }

    /* ══════════════════════════════════════════
       МЕТА: возвращаем какой хост используется
       (полезно для логов и UI «вы на testnet»)
    ══════════════════════════════════════════ */
    function getHost() {
        return host;
    }
    function isTestnet() {
        return testnet;
    }

    return {
        // публичные / меты
        ping,
        getServerTime,
        getHost,
        isTestnet,
        // аккаунт / market data
        getAccountInfo,
        getExchangeInfo,
        getSymbolFilters,
        getMarkPrice,
        // конфиг символа
        setLeverage,
        setMarginType,
        setPositionMode,
        // обычные ордера (market и т.п.)
        placeMarketOrder,
        cancelOrder,
        cancelAllOrders,
        getOrder,
        getUserTrades,
        getOpenOrders,
        getPositionRisk,
        // condition (algo) ордера — STOP_MARKET, TAKE_PROFIT_MARKET и т.д.
        // С 2025-12-09 идут через отдельный Algo Order API.
        placeStopMarketOrder,
        placeTakeProfitMarketOrder,
        cancelAlgoOrder,
        cancelAllAlgoOrders,
        getOpenAlgoOrders,
        // утилиты округления (экспонируем для тестов и openPosition)
        roundDownToStep,
        roundToTick,
    };
}

module.exports = { createClient, HOSTS };
