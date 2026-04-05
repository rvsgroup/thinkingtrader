// ══════════════════════════════════════════════════════════════
// AI SCANNER v2 — кружочек (!) + тултип внутри графика + кэш
// ══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ── Кэш результатов AI ──────────────────────────────────────
    window._aiCache = {};
    window._aiLastPrompt = null;

    // ── Определение администратора ───────────────────────────────
    function isAdmin() {
        return window._isAdminUser === true;
    }

    async function getAdminIdToken() {
        try {
            var auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
            if (!auth || !auth.currentUser) return null;
            return await auth.currentUser.getIdToken();
        } catch(e) {
            console.error('[AI] getAdminIdToken error:', e);
            return null;
        }
    }

    window._isAdmin = isAdmin;
    window._getAdminIdToken = getAdminIdToken;

    function getCacheKey() {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        var pd = (typeof currentPeriod !== 'undefined') ? currentPeriod : 1;
        var tf = '1D';
        if (pd <= 0.042) tf = '1H';
        else if (pd <= 0.17) tf = '4H';
        return coinId + '_' + tf;
    }

    // ── Кэш 1D расширенных данных ──────────────────────────────
    window._aiAnchorCache = {}; // v3 — enriched 1D data

    // Вспомогательные функции расчёта
    function _calcPriceProfile(candles, segments) {
        var segLen = Math.floor(candles.length / segments);
        var profile = [];
        for (var i = 0; i < segments; i++) {
            var start = i * segLen;
            var end = Math.min(start + segLen, candles.length);
            var slice = candles.slice(start, end);
            var opens = slice[0].open;
            var closes = slice[slice.length - 1].close;
            var highs = -Infinity, lows = Infinity, volSum = 0, bodySum = 0;
            for (var j = 0; j < slice.length; j++) {
                if (slice[j].high > highs) highs = slice[j].high;
                if (slice[j].low < lows) lows = slice[j].low;
                volSum += (slice[j].volume || 0);
                bodySum += Math.abs(slice[j].close - slice[j].open) / (slice[j].open || 1) * 100;
            }
            var d0 = new Date(slice[0].time * 1000).toISOString().slice(0, 10);
            var d1 = new Date(slice[slice.length - 1].time * 1000).toISOString().slice(0, 10);
            profile.push({
                period: d0 + ' → ' + d1,
                days: slice.length,
                o: Math.round(opens * 100) / 100,
                c: Math.round(closes * 100) / 100,
                h: Math.round(highs * 100) / 100,
                l: Math.round(lows * 100) / 100,
                chg: Math.round((closes - opens) / (opens || 1) * 1000) / 10,
                avgVol: Math.round(volSum / slice.length),
                avgBody: Math.round(bodySum / slice.length * 10) / 10
            });
        }
        return profile;
    }

    function _calcHeavyZones(candles, price, zones) {
        var allHigh = -Infinity, allLow = Infinity;
        for (var i = 0; i < candles.length; i++) {
            if (candles[i].high > allHigh) allHigh = candles[i].high;
            if (candles[i].low < allLow) allLow = candles[i].low;
        }
        var zoneSize = (allHigh - allLow) / zones;
        var volArr = [];
        var totalVol = 0;
        for (var z = 0; z < zones; z++) {
            var bottom = allLow + z * zoneSize;
            var top = bottom + zoneSize;
            var vol = 0;
            for (var j = 0; j < candles.length; j++) {
                var c = candles[j];
                var overlap = Math.max(0, Math.min(c.high, top) - Math.max(c.low, bottom));
                var range = c.high - c.low || 1;
                vol += (c.volume || 0) * (overlap / range);
            }
            totalVol += vol;
            volArr.push({ bottom: Math.round(bottom), top: Math.round(top), mid: Math.round((bottom + top) / 2 * 100) / 100, vol: Math.round(vol) });
        }
        volArr.sort(function(a, b) { return b.vol - a.vol; });
        return volArr.slice(0, 5).map(function(z) {
            return {
                zone: '$' + z.bottom + '–$' + z.top,
                mid: z.mid,
                share: Math.round(z.vol / (totalVol || 1) * 1000) / 10 + '%',
                vs: z.mid < price ? 'below' : 'above'
            };
        });
    }

    function _calcVolatility(candles) {
        function avg(arr) {
            if (!arr.length) return 0;
            var s = 0;
            for (var i = 0; i < arr.length; i++) s += (arr[i].high - arr[i].low) / (arr[i].close || 1) * 100;
            return Math.round(s / arr.length * 100) / 100;
        }
        var v10 = avg(candles.slice(-10));
        var v30 = avg(candles.slice(-30));
        var v100 = avg(candles.slice(-100));
        var trend = 'normal';
        if (v10 < v100 * 0.7) trend = 'compression';
        else if (v10 > v100 * 1.3) trend = 'expansion';
        return { last10: v10 + '%', last30: v30 + '%', last100: v100 + '%', trend: trend };
    }

    function _calcSuggestedLevels(candles, price) {
        var last20 = candles.slice(-20);
        var sum = 0;
        for (var i = 0; i < last20.length; i++) sum += (last20[i].high - last20[i].low);
        var avg = sum / last20.length;
        return {
            avgCandleSize: Math.round(avg * 100) / 100,
            avgCandlePct: Math.round(avg / (price || 1) * 1000) / 10 + '%',
            long: { entry: Math.round(price * 100) / 100, stop: Math.round((price - avg * 1.5) * 100) / 100, target: Math.round((price + avg * 2.5) * 100) / 100 },
            short: { entry: Math.round(price * 100) / 100, stop: Math.round((price + avg * 1.5) * 100) / 100, target: Math.round((price - avg * 2.5) * 100) / 100 }
        };
    }

    window.loadAnchorLevels = async function(coinId) {
        if (!coinId) return null;
        var cached = window._aiAnchorCache[coinId];
        if (cached && Date.now() - cached.ts < 300000) return cached;
        try {
            var sym = (typeof BINANCE_SYMBOLS !== 'undefined') ? BINANCE_SYMBOLS[coinId] : null;
            if (!sym) return null;
            var res = await fetch('/api/ohlc?symbol=' + sym + '&interval=1d&limit=1000');
            var data = await res.json();
            if (!Array.isArray(data) || data.length < 30) return null;
            var candles = data.map(function(k) {
                return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +(k[5]||0) };
            });

            var currentClose = candles[candles.length - 1].close;
            var levels = null;
            if (typeof PatternScanner !== 'undefined' && PatternScanner.scanLevels) {
                levels = PatternScanner.scanLevels(candles, 1);
            }

            // Ключевые точки
            var c365 = candles.slice(-365);
            var c180 = candles.slice(-180);
            var c90 = candles.slice(-90);
            var c30 = candles.slice(-30);
            var allHigh = -Infinity, allLow = Infinity;
            for (var i = 0; i < candles.length; i++) {
                if (candles[i].high > allHigh) allHigh = candles[i].high;
                if (candles[i].low < allLow) allLow = candles[i].low;
            }
            var h365 = -Infinity, l365 = Infinity;
            for (var i = 0; i < c365.length; i++) {
                if (c365[i].high > h365) h365 = c365[i].high;
                if (c365[i].low < l365) l365 = c365[i].low;
            }

            var keyPoints = {
                price900dAgo: candles.length >= 900 ? Math.round(candles[candles.length - 900].close) : null,
                price365dAgo: c365.length >= 365 ? Math.round(c365[0].close) : null,
                price180dAgo: c180.length >= 180 ? Math.round(c180[0].close) : null,
                price90dAgo: c90.length >= 90 ? Math.round(c90[0].close) : null,
                price30dAgo: c30.length >= 30 ? Math.round(c30[0].close) : null,
                currentPrice: Math.round(currentClose * 100) / 100,
                high365d: Math.round(h365), low365d: Math.round(l365),
                highAllTime: Math.round(allHigh), lowAllTime: Math.round(allLow),
                positionIn365dRange: h365 !== l365 ? Math.round((currentClose - l365) / (h365 - l365) * 1000) / 10 + '%' : '50%',
                positionInAllTimeRange: allHigh !== allLow ? Math.round((currentClose - allLow) / (allHigh - allLow) * 1000) / 10 + '%' : '50%'
            };

            var result = {
                levels: levels ? { support: levels.support, resistance: levels.resistance, positionPct: levels.positionPct } : null,
                keyPoints: keyPoints,
                priceProfile: _calcPriceProfile(candles, 30),
                heavyZones: _calcHeavyZones(candles, currentClose, 20),
                volatility: _calcVolatility(candles),
                suggestedLevels: _calcSuggestedLevels(candles, currentClose),
                ts: Date.now()
            };
            window._aiAnchorCache[coinId] = result;
            return result;
        } catch(e) { console.error('[AI] loadAnchorLevels error:', e); return null; }
    };

    setInterval(function() {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : null;
        if (coinId && !window._aiAnchorCache[coinId]) window.loadAnchorLevels(coinId);
    }, 10000);

    // ── Сбор контекста (v3 — enriched) ─────────────────────────
    window.collectAiContext = function() {
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var coinSymbol = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.symbol : 'BTC';
        var price = (typeof currentCoinPrice !== 'undefined' && currentCoinPrice) ? currentCoinPrice : 0;
        var periodDays = (typeof currentPeriod !== 'undefined') ? currentPeriod : 1;

        var tfLabel = '1D';
        if (periodDays <= 0.042) tfLabel = '1H';
        else if (periodDays <= 0.17) tfLabel = '4H';

        if (periodDays > 1) return null;
        if (typeof rawOhlcCache === 'undefined' || !rawOhlcCache.length) return null;

        var candles = rawOhlcCache.map(function(k) {
            return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +(k[5]||0) };
        });
        if (candles.length < 20) return null;

        // ── Уровни поддержки/сопротивления ──
        var levels = null;
        if (window._lastLevels) {
            // Санити-чек: уровни должны быть в адекватном диапазоне от текущей цены
            var sup = window._lastLevels.support;
            var res = window._lastLevels.resistance;
            var priceOk = price > 0 && sup > 0 && res > 0;
            var ratio = priceOk ? Math.max(price / sup, sup / price, price / res, res / price) : 999;
            if (priceOk && ratio < 5) {
                levels = {
                    support: Math.round(sup * 100) / 100,
                    resistance: Math.round(res * 100) / 100,
                    positionPct: Math.round(window._lastLevels.positionPct * 10) / 10,
                };
            } else {
                // Уровни от другой монеты — сбрасываем
                window._lastLevels = null;
                window._lastLevelsCoin = null;
            }
        }

        // ── Ценовой профиль (30 отрезков из текущего таймфрейма) ──
        var priceProfile = _calcPriceProfile(candles, Math.min(30, Math.floor(candles.length / 5)));

        // ── Объёмные зоны (20 зон) ──
        var heavyZones = _calcHeavyZones(candles, price, 20);

        // ── Волатильность ──
        var volatility = _calcVolatility(candles);

        // ── Математические уровни entry/stop/target ──
        var suggestedLevels = _calcSuggestedLevels(candles, price);

        // ── Последние 20 свечей детально ──
        var last20 = candles.slice(-20).map(function(c) {
            var d = new Date(c.time * 1000).toISOString().slice(0, 10);
            return {
                date: d,
                o: Math.round(c.open * 100) / 100,
                h: Math.round(c.high * 100) / 100,
                l: Math.round(c.low * 100) / 100,
                c: Math.round(c.close * 100) / 100,
                chg: Math.round((c.close - c.open) / (c.open || 1) * 1000) / 10 + '%',
                dir: c.close >= c.open ? 'green' : 'red'
            };
        });

        // ── Паттерны за последние 20 свечей ──
        var recentPatterns = [];
        if (typeof PatternScanner !== 'undefined') {
            PatternScanner.enableAll();
            var allP = PatternScanner.scan(candles);
            var cutoff = candles[Math.max(0, candles.length - 21)].time;
            var recent = allP.filter(function(p) { return p.time >= cutoff; });

            recent.forEach(function(p) {
                var idx = candles.findIndex(function(c) { return c.time === p.time; });
                var candlesAgo = idx >= 0 ? candles.length - 1 - idx : 0;
                var pat = {
                    type: (isEn && p.typeEn) ? p.typeEn : p.type,
                    direction: p.direction,
                    candlesAgo: candlesAgo,
                    winRate: null,
                    patternClose: candles[idx] ? Math.round(candles[idx].close * 100) / 100 : 0,
                    workedOut: null,
                };
                if (window._fsWinRateCache) {
                    var wr = window._fsWinRateCache[p.key || p.type];
                    if (wr) pat.winRate = wr.pct;
                }
                if (p.direction === 'neutral') {
                    pat.workedOut = null;
                } else if (candlesAgo <= 2) {
                    pat.workedOut = null;
                } else if (idx >= 0 && idx < candles.length - 1) {
                    var closedAfter = candles.slice(idx + 1, candles.length - 1);
                    var patClose = candles[idx].close;
                    if (closedAfter.length < 2) {
                        pat.workedOut = null;
                    } else {
                        var check = closedAfter.slice(0, 3);
                        var aboveCount = check.filter(function(c) { return c.close > patClose; }).length;
                        var belowCount = check.filter(function(c) { return c.close < patClose; }).length;
                        var lastCheck = check[check.length - 1].close;
                        if (p.direction === 'bullish') pat.workedOut = aboveCount >= 2 && lastCheck > patClose;
                        else if (p.direction === 'bearish') pat.workedOut = belowCount >= 2 && lastCheck < patClose;
                    }
                }
                recentPatterns.push(pat);
            });
        }

        // ── Ключевые точки (для текущего таймфрейма) ──
        var allHigh = -Infinity, allLow = Infinity;
        for (var i = 0; i < candles.length; i++) {
            if (candles[i].high > allHigh) allHigh = candles[i].high;
            if (candles[i].low < allLow) allLow = candles[i].low;
        }

        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';

        return {
            coin: coinSymbol + '/USDT',
            timeframe: tfLabel,
            currentPrice: price,
            lang: isEn ? 'en' : 'ru',
            totalCandles: candles.length,
            levels: levels,
            priceProfile: priceProfile,
            heavyZones: heavyZones,
            volatility: volatility,
            suggestedLevels: suggestedLevels,
            last20candles: last20,
            patterns: recentPatterns.length > 0 ? recentPatterns : null
        };
    };

    // ── Загрузка admin context из Firebase (клиентская) ────────
    async function _fetchAdminContext(coinId, lang) {
        try {
            if (typeof firebase === 'undefined') return null;
            var db = firebase.firestore();
            var doc = await db.collection('admin_context').doc(coinId).get();
            if (!doc.exists) return null;
            var items = (doc.data().items || []).filter(function(i) { return i.active !== false; });
            if (!items.length) return null;
            var isEn = lang === 'en';
            var lines = items.map(function(i) {
                var text = isEn ? (i.text_en || i.text_ru) : i.text_ru;
                var date = new Date(i.createdAt).toISOString().slice(0, 10);
                return '[' + date + '] ' + text;
            });
            return lines.join('\n');
        } catch(e) {
            console.warn('[AI] fetchAdminContext error:', e.message);
            return null;
        }
    }

    // ── API ─────────────────────────────────────────────────────
    window.callAiScanner = async function(ctx) {
        // Подгружаем admin context из Firebase и добавляем в ctx
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        var adminCtx = await _fetchAdminContext(coinId, ctx.lang || 'ru');
        if (adminCtx) {
            ctx.adminContext = adminCtx;
            console.log('[AI] Admin context loaded:', adminCtx.slice(0, 80) + '...');
        }

        // Для альткоинов — дополнительно подгружаем BTC admin context как якорный
        if (coinId !== 'bitcoin') {
            var btcAdminCtx = await _fetchAdminContext('bitcoin', ctx.lang || 'ru');
            if (btcAdminCtx) {
                ctx.btcAdminContext = btcAdminCtx;
                console.log('[AI] BTC anchor context loaded:', btcAdminCtx.slice(0, 80) + '...');
            }
        }

        var res = await fetch('/api/ai-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ctx) });
        if (!res.ok) throw new Error('AI Scanner error: ' + res.status);
        return res.json();
    };

    // ══════════════════════════════════════════════════════════════
    // UI — кнопка (!) и тултип внутри графика
    // ══════════════════════════════════════════════════════════════

    var _btnEl = null, _tooltipEl = null, _chatPanelEl = null, _containerEl = null, _tooltipVisible = false;
    var _aiChatHistory = [];

    function _isMobile() { return window.innerWidth <= 900; }

    function ensureUI() {
        if (_btnEl) return;
        var wrap = document.getElementById('ourChartWrap');
        if (!wrap) return;

        // Кружочек (!) — на мобилке скрыт, роль играет кнопка AI в тулбаре
        _btnEl = document.createElement('div');
        _btnEl.id = 'aiBtnCircle';
        _btnEl.innerHTML = '!';
        _btnEl.style.display = 'none';
        _btnEl.addEventListener('click', function(e) { e.stopPropagation(); toggleTooltip(); });
        wrap.appendChild(_btnEl);

        // Единый контейнер
        _containerEl = document.createElement('div');
        _containerEl.id = 'aiContainer';

        // Тултип
        _tooltipEl = document.createElement('div');
        _tooltipEl.id = 'aiTooltip';
        _tooltipEl.innerHTML =
            '<div class="ai-tt-header">' +
                '<div class="ai-tt-logo"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="white" stroke-width="1.8"/><path d="M11 11l3.5 3.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></div>' +
                '<span class="ai-tt-label">AI SCANNER</span>' +
                '<span class="ai-tt-tf"></span>' +
                '<span class="ai-tt-time" style="color:#475569;font-size:10px;margin-left:auto;margin-right:6px;"></span>' +
                '<div class="ai-tt-info-wrap">' +
                    '<div class="ai-tt-info-btn">i</div>' +
                    '<div class="ai-tt-info-popup">This is not financial advice. AI Scanner provides analytical information based on technical analysis. All trading decisions are made at your own risk. Past performance does not guarantee future results.</div>' +
                '</div>' +
            '</div>' +
            '<div class="ai-tt-text"></div>' +
            '<div class="ai-tt-verdict"></div>' +
            '<div class="ai-tt-action"></div>' +
            '<div class="ai-tt-footer"><span>THINKING TRADER</span><span class="ai-tt-time" style="color:#475569;font-size:10px;margin-left:auto;margin-right:6px;"></span><span class="ai-tt-price"></span></div>' +
            '<button class="ai-chat-open-btn" id="aiChatOpenBtn"><svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="#2962FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5C1 2.8 2.8 1 5 1H17C19.2 1 21 2.8 21 5V13C21 15.2 19.2 17 17 17H9L4 21V17H5C2.8 17 1 15.2 1 13V5Z"/><circle cx="7" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="11" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="15" cy="11" r="1.2" fill="#2962FF" stroke="none"/></svg> AI Chat</button>';

        // Чат-панель — сразу под тултипом в том же контейнере
        _chatPanelEl = document.createElement('div');
        _chatPanelEl.id = 'aiChatPanel';

        // Шапка чата — кнопки админа только для администратора
        var chatHeaderHTML;
        if (isAdmin()) {
            chatHeaderHTML =
                '<div class="ai-chat-header ai-chat-header-admin">' +
                    '<span id="aiChatHeaderLabel">ЧАТ</span>' +
                    '<div class="ai-admin-btns">' +
                        '<button class="ai-admin-btn-ctx" id="aiAdminAddCtx">+ Контекст</button>' +
                        '<button class="ai-admin-btn-list" id="aiAdminListCtx">Список</button>' +
                    '</div>' +
                '</div>';
        } else {
            chatHeaderHTML = '<div class="ai-chat-header" id="aiChatHeaderLabel">ЧАТ</div>';
        }

        _chatPanelEl.innerHTML =
            chatHeaderHTML +
            '<div class="ai-tt-chat" id="aiChatMessages"></div>' +
            '<div id="aiChatInputWrap">' +
                '<div class="ai-ctx-mode-label" id="aiCtxModeLabel" style="display:none;"></div>' +
                '<div class="ai-tt-chat-input-wrap">' +
                    '<textarea class="ai-tt-chat-input" id="aiChatInput" placeholder="..." maxlength="600" rows="1"></textarea>' +
                    '<button class="ai-tt-chat-send" id="aiChatSend">' +
                        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
                    '</button>' +
                '</div>' +
            '</div>';

        _containerEl.appendChild(_tooltipEl);
        _containerEl.appendChild(_chatPanelEl);

        // На мобилке — вешаем на body как fixed overlay, иначе внутрь графика
        if (_isMobile()) {
            document.body.appendChild(_containerEl);
            // Backdrop клик — закрывает панель
            _containerEl.addEventListener('click', function(e) {
                if (e.target === _containerEl) toggleTooltip();
            });
            // Swipe вниз на handle/тултипе — закрывает панель
            _addSwipeDown(_tooltipEl);
        } else {
            wrap.appendChild(_containerEl);
        }

        // Кнопка AI в тулбаре — на мобилке тоже переключает панель
        var aiBtnApp = document.getElementById('aiBtnApp');
        if (aiBtnApp && _isMobile()) {
            // убираем старый обработчик через замену на клон
            var newBtn = aiBtnApp.cloneNode(true);
            aiBtnApp.parentNode.replaceChild(newBtn, aiBtnApp);
            newBtn.addEventListener('click', function() {
                var alreadyActive = newBtn.classList.contains('ai-active');
                if (alreadyActive) {
                    newBtn.classList.remove('ai-active');
                    if (_tooltipVisible) toggleTooltip();
                } else {
                    newBtn.classList.add('ai-active');
                    if (typeof runAiScan === 'function') runAiScan(true);
                }
            });
        }

        _initChatHandlers();
        setTimeout(_updateChatPlaceholder, 0);
        if (isAdmin()) setTimeout(_initAdminListBtn, 0);

        // Кнопка открытия/закрытия чата
        setTimeout(function() {
            var openBtn = document.getElementById('aiChatOpenBtn');
            if (openBtn) {
                openBtn.addEventListener('click', function() {
                    _toggleChat();
                });
            }
        }, 0);
    }

    // Свайп вниз для закрытия
    function _addSwipeDown(el) {
        var startY = 0, startX = 0, isDragging = false;
        el.addEventListener('touchstart', function(e) {
            startY = e.touches[0].clientY;
            startX = e.touches[0].clientX;
            isDragging = false;
        }, { passive: true });
        el.addEventListener('touchmove', function(e) {
            var dy = e.touches[0].clientY - startY;
            var dx = Math.abs(e.touches[0].clientX - startX);
            if (dy > 10 && dy > dx) {
                isDragging = true;
                // Визуальный сдвиг
                var shift = Math.min(dy - 10, 120);
                _containerEl.style.transition = 'none';
                _tooltipEl.style.transform = 'translateY(' + shift + 'px)';
                _chatPanelEl.style.transform = 'translateY(' + shift + 'px)';
            }
        }, { passive: true });
        el.addEventListener('touchend', function(e) {
            var dy = e.changedTouches[0].clientY - startY;
            _containerEl.style.transition = '';
            _tooltipEl.style.transform = '';
            _chatPanelEl.style.transform = '';
            if (isDragging && dy > 80) {
                toggleTooltip();
            }
            isDragging = false;
        }, { passive: true });
    }

    function _fitContainer() {
        if (!_containerEl || !_isMobile()) {
            var coinBar = document.querySelector('.chart-coin-bar');
            if (coinBar && _containerEl) {
                var coinTop = coinBar.getBoundingClientRect().top;
                var contTop = _containerEl.getBoundingClientRect().top;
                var maxH = coinTop - contTop - 10;
                if (maxH > 100) {
                    _containerEl.style.maxHeight = maxH + 'px';
                    if (_tooltipEl) {
                        _tooltipEl.style.overflowY = 'auto';
                        _tooltipEl.style.flexShrink = '1';
                        _tooltipEl.style.minHeight = '0';
                    }
                    if (_chatPanelEl) _chatPanelEl.style.flexShrink = '0';
                }
            }
        }
    }

    function toggleTooltip() {
        if (!_tooltipEl) return;
        _tooltipVisible = !_tooltipVisible;
        _tooltipEl.classList.toggle('visible', _tooltipVisible);
        _btnEl.classList.toggle('active', _tooltipVisible);
        if (_containerEl) _containerEl.classList.toggle('visible', _tooltipVisible);
        if (_tooltipVisible) setTimeout(_fitContainer, 50);
    }

    window.hideAiTooltip = function() {
        _tooltipVisible = false;
        if (_containerEl) _containerEl.classList.remove('visible');
        if (_chatPanelEl) _chatPanelEl.classList.remove('visible');
        if (_btnEl) { _btnEl.classList.remove('active'); _btnEl.style.display = 'none'; }
        // Сбрасываем ai-active на кнопке тулбара
        var aiBtnApp = document.getElementById('aiBtnApp');
        if (aiBtnApp) aiBtnApp.classList.remove('ai-active');
    };

    function _positionChatPanel() { /* позиция управляется контейнером */ }

    var _chatOpen = false;
    function _toggleChat() {
        if (!_isMobile()) {
            _chatOpen = !_chatOpen;
            var panel = _chatPanelEl;
            var btn = document.getElementById('aiChatOpenBtn');
            var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
            if (_chatOpen) {
                panel.classList.add('visible', 'chat-side');
                // Подстраиваем высоту чата под высоту блока анализа
                var tooltipH = _tooltipEl ? _tooltipEl.offsetHeight : 0;
                if (tooltipH > 0) panel.style.height = tooltipH + 'px';
                // Проверяем есть ли сообщения
                var msgs = panel.querySelector('#aiChatMessages');
                if (!msgs || msgs.children.length === 0) {
                    panel.classList.add('chat-empty');
                } else {
                    panel.classList.remove('chat-empty');
                }
                if (btn) btn.innerHTML = isEn ? '✕ Close' : '✕ Закрыть';
            } else {
                panel.classList.remove('visible', 'chat-side', 'chat-empty');
                panel.style.height = '';
                if (btn) btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="#2962FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5C1 2.8 2.8 1 5 1H17C19.2 1 21 2.8 21 5V13C21 15.2 19.2 17 17 17H9L4 21V17H5C2.8 17 1 15.2 1 13V5Z"/><circle cx="7" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="11" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="15" cy="11" r="1.2" fill="#2962FF" stroke="none"/></svg> AI Chat';
            }
        }
    }
    // ── Режим контекста (переключение поля ввода) ────────────
    var _ctxMode = false;
    var _editingCtxId = null; // id редактируемого контекста

    function _setCtxMode(on) {
        _ctxMode = on;
        _editingCtxId = null;
        var input = document.getElementById('aiChatInput');
        var sendBtn = document.getElementById('aiChatSend');
        var label = document.getElementById('aiCtxModeLabel');
        var addBtn = document.getElementById('aiAdminAddCtx');
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';

        if (on) {
            if (input) {
                input.classList.add('ctx-mode');
                input.placeholder = isEn ? 'Write analyst context (RU → auto-translated to EN)...' : 'Напишите контекст для AI-сканера (RU → авто-перевод на EN)...';
                input.value = '';
                input.focus();
            }
            if (label) {
                label.style.display = 'flex';
                label.textContent = isEn ? 'Context mode — save to Firebase' : 'Режим контекста — сохраняется в Firebase';
            }
            if (sendBtn) {
                sendBtn.classList.add('save-mode');
                sendBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2962FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
            }
            if (addBtn) addBtn.classList.add('active');
        } else {
            if (input) {
                input.classList.remove('ctx-mode');
                input.placeholder = isEn ? 'Ask a question...' : 'Задать вопрос...';
                input.value = '';
            }
            if (label) label.style.display = 'none';
            if (sendBtn) {
                sendBtn.classList.remove('save-mode');
                sendBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
            }
            if (addBtn) addBtn.classList.remove('active');
        }
    }

    async function _saveContext(text) {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        try {
            var db = firebase.firestore();
            var docRef = db.collection('admin_context').doc(coinId);
            var doc = await docRef.get();
            var existing = doc.exists ? (doc.data().items || []) : [];

            if (_editingCtxId) {
                // Обновляем существующий
                var items = existing.map(function(i) {
                    return i.id === _editingCtxId
                        ? Object.assign({}, i, { text_ru: text.trim(), updatedAt: Date.now() })
                        : i;
                });
                await docRef.set({ items: items });
            } else {
                // Создаём новый
                var item = {
                    id: 'ctx_' + Date.now(),
                    text_ru: text.trim(),
                    text_en: '',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    active: true
                };
                await docRef.set({ items: existing.concat([item]) });
                // Переводим на EN асинхронно через сервер
                _translateContextItem(coinId, item.id, text.trim());
            }
            console.log('[AI Admin] Context saved OK');
            return true;
        } catch(e) {
            console.error('[AI Admin] Save context error:', e);
            alert('Ошибка сохранения: ' + e.message);
            return false;
        }
    }

    async function _translateContextItem(coinId, itemId, text) {
        try {
            var res = await fetch('/api/admin/context/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coinId: coinId, itemId: itemId, text: text })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            console.log('[AI Admin] Translation requested for', itemId);
        } catch(e) {
            console.error('[AI Admin] Translate error:', e.message);
        }
    }

    function _initChatHandlers() {
        var input = document.getElementById('aiChatInput');
        var sendBtn = document.getElementById('aiChatSend');
        if (!input || !sendBtn) return;

        // Кнопка "Контекст" — переключает режим
        var addCtxBtn = document.getElementById('aiAdminAddCtx');
        if (addCtxBtn) {
            addCtxBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _setCtxMode(!_ctxMode);
            });
        }

        async function sendMsg() {
            var text = input.value.trim();
            if (!text) return;

            // Режим контекста — сохраняем в Firebase
            if (_ctxMode) {
                var ok = await _saveContext(text);
                if (ok) {
                    _setCtxMode(false);
                    // Обновляем список если открыт
                    if (typeof _loadContextList === 'function') _loadContextList();
                }
                return;
            }

            // Обычный режим — отправляем в чат
            input.value = '';
            input.style.height = 'auto';
            _positionChatPanel();
            _sendChatMessage(text);
            setTimeout(function() { input.focus(); }, 50);
        }

        sendBtn.addEventListener('click', function(e) { e.stopPropagation(); sendMsg(); });
        input.addEventListener('keydown', function(e) {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMsg();
            }
        });
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
            _positionChatPanel();
        });
        input.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    // ── Панель списка контекстов (пункты 10 + 11) ───────────
    var _ctxListPanelEl = null;

    async function _loadContextList() {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        try {
            var db = firebase.firestore();
            var doc = await db.collection('admin_context').doc(coinId).get();
            var items = doc.exists ? (doc.data().items || []).filter(function(i) { return i.active !== false; }) : [];
            _renderContextList(items, coinId);
        } catch(e) {
            console.error('[AI Admin] Load context list error:', e);
        }
    }

    function _renderContextList(items, coinId) {
        if (!_ctxListPanelEl) return;
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var list = _ctxListPanelEl.querySelector('#aiCtxList');
        if (!list) return;

        if (items.length === 0) {
            list.innerHTML = '<div style="color:#475569;font-size:11px;text-align:center;padding:20px 10px;">' + (isEn ? 'No contexts yet' : 'Контекстов пока нет') + '</div>';
            return;
        }

        list.innerHTML = items.map(function(item) {
            var date = new Date(item.createdAt).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            var updated = item.updatedAt !== item.createdAt
                ? '<span style="color:#2962ff;font-size:9px;margin-left:4px;">изм.</span>'
                : '';
            return '<div class="ai-ctx-item" data-id="' + item.id + '">' +
                '<div class="ai-ctx-item-meta">' +
                    '<span class="ai-ctx-active-dot"></span>' +
                    '<span class="ai-ctx-date">' + date + updated + '</span>' +
                '</div>' +
                '<div class="ai-ctx-text">' + _escapeHtml(item.text_ru) + '</div>' +
                '<div class="ai-ctx-actions">' +
                    '<button class="ai-ctx-btn-edit" data-id="' + item.id + '" data-text="' + _escapeAttr(item.text_ru) + '">' + (isEn ? 'Edit' : 'Изменить') + '</button>' +
                    '<button class="ai-ctx-btn-del" data-id="' + item.id + '" data-coin="' + coinId + '">' + (isEn ? 'Delete' : 'Удалить') + '</button>' +
                '</div>' +
            '</div>';
        }).join('');

        // Обработчики кнопок
        list.querySelectorAll('.ai-ctx-btn-edit').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                var text = btn.getAttribute('data-text');
                _editContext(id, text);
            });
        });
        list.querySelectorAll('.ai-ctx-btn-del').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                var coin = btn.getAttribute('data-coin');
                _deleteContext(id, coin);
            });
        });
    }

    function _escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function _escapeAttr(str) {
        return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function _editContext(id, text) {
        // Подгружаем текст в поле ввода и переключаем в режим редактирования
        _editingCtxId = id;
        _ctxMode = true;
        var input = document.getElementById('aiChatInput');
        var label = document.getElementById('aiCtxModeLabel');
        var sendBtn = document.getElementById('aiChatSend');
        var addBtn = document.getElementById('aiAdminAddCtx');
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';

        if (input) {
            input.classList.add('ctx-mode');
            input.value = text;
            input.placeholder = isEn ? 'Edit context...' : 'Редактируйте контекст...';
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
            input.focus();
        }
        if (label) {
            label.style.display = 'flex';
            label.textContent = isEn ? 'Edit mode — save to update' : 'Режим редактирования — сохранить для обновления';
        }
        if (sendBtn) {
            sendBtn.classList.add('save-mode');
            sendBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2962FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
        }
        if (addBtn) addBtn.classList.add('active');
    }

    async function _deleteContext(id, coinId) {
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var confirm_msg = isEn ? 'Delete this context?' : 'Удалить этот контекст?';
        if (!window.confirm(confirm_msg)) return;
        try {
            var db = firebase.firestore();
            var docRef = db.collection('admin_context').doc(coinId);
            var doc = await docRef.get();
            if (!doc.exists) return;
            var items = (doc.data().items || []).filter(function(i) { return i.id !== id; });
            await docRef.set({ items: items });
            _loadContextList();
            console.log('[AI Admin] Context deleted:', id);
        } catch(e) {
            console.error('[AI Admin] Delete error:', e);
            alert('Ошибка удаления: ' + e.message);
        }
    }

    function _toggleContextListPanel() {
        var listBtn = document.getElementById('aiAdminListCtx');
        if (_ctxListPanelEl) {
            // Закрываем
            _ctxListPanelEl.remove();
            _ctxListPanelEl = null;
            if (listBtn) listBtn.classList.remove('active');

            return;
        }

        // Открываем — создаём панель слева от чата
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        var coinName = coinId.toUpperCase();

        _ctxListPanelEl = document.createElement('div');
        _ctxListPanelEl.id = 'aiCtxListPanel';
        _ctxListPanelEl.innerHTML =
            '<div class="ai-ctx-panel-header">' +
                '<div class="ai-ctx-panel-title">' +
                    '<span class="ai-ctx-panel-dot"></span>' +
                    (isEn ? 'Contexts · ' : 'Контексты · ') + coinName +
                '</div>' +
                '<button class="ai-ctx-panel-close" id="aiCtxPanelClose">✕</button>' +
            '</div>' +
            '<div class="ai-ctx-list" id="aiCtxList">' +
                '<div style="color:#475569;font-size:11px;text-align:center;padding:20px;">' + (isEn ? 'Loading...' : 'Загрузка...') + '</div>' +
            '</div>';

        // Добавляем панель в body и позиционируем fixed слева от чат-панели
        document.body.appendChild(_ctxListPanelEl);

        // Вычисляем позицию и высоту после рендера
        setTimeout(function() {
            if (!_ctxListPanelEl || !_chatPanelEl) return;
            var chatRect = _chatPanelEl.getBoundingClientRect();
            // Высота = высота AI блока (tooltipEl) или чата — берём большее
            var refEl = _tooltipEl || _chatPanelEl;
            var refRect = refEl.getBoundingClientRect();
            var panelH = refRect.height || chatRect.height || 400;
            _ctxListPanelEl.style.top = chatRect.top + 'px';
            _ctxListPanelEl.style.left = (chatRect.left - 260 - 8) + 'px';
            _ctxListPanelEl.style.height = panelH + 'px';
            _ctxListPanelEl.style.maxHeight = panelH + 'px';
        }, 0);

        // Кнопка закрыть
        var closeBtn = _ctxListPanelEl.querySelector('#aiCtxPanelClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _toggleContextListPanel();
            });
        }

        if (listBtn) listBtn.classList.add('active');

        // Загружаем данные
        _loadContextList();
    }

    // Инициализация кнопки Список — вызывается после рендера чат-панели
    function _initAdminListBtn() {
        var listBtn = document.getElementById('aiAdminListCtx');
        if (!listBtn) return;
        listBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _toggleContextListPanel();
        });
    }

    function _updateChatEmptyState() {
        if (!_chatPanelEl || !_chatPanelEl.classList.contains('chat-side')) return;
        var msgs = _chatPanelEl.querySelector('#aiChatMessages');
        if (msgs && msgs.children.length > 0) {
            _chatPanelEl.classList.remove('chat-empty');
            // Сбрасываем justify-content чтобы инпут упал вниз
            _chatPanelEl.style.justifyContent = 'flex-start';
        }
    }

    function _appendChatBubble(role, text) {
        var box = document.getElementById('aiChatMessages');
        if (!box) return;
        var bubble = document.createElement('div');
        bubble.className = 'ai-chat-bubble ai-chat-' + role;
        // Парсим базовый markdown: **bold**, *italic*, убираем лишние звёздочки
        var html = text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        bubble.innerHTML = html;
        box.appendChild(bubble);
        box.scrollTop = box.scrollHeight;
        _positionChatPanel();
        _updateChatEmptyState();
    }

    function _setChatInputLoading(on) {
        var btn = document.getElementById('aiChatSend');
        var input = document.getElementById('aiChatInput');
        if (btn) btn.disabled = on;
        if (input) input.disabled = on;
        if (btn) btn.style.opacity = on ? '0.4' : '1';
    }

    async function _sendChatMessage(userText) {
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';

        if (_questionCount >= _MAX_QUESTIONS) return;

        // Добавляем в историю и рендерим
        _aiChatHistory.push({ role: 'user', content: userText });
        _appendChatBubble('user', userText);
        _questionCount++;

        // Обрезаем до 7 сообщений
        if (_aiChatHistory.length > 7) _aiChatHistory = _aiChatHistory.slice(-7);

        _setChatInputLoading(true);
        _updateChatPlaceholder();

        // Показываем typing индикатор
        var box = document.getElementById('aiChatMessages');
        var typing = document.createElement('div');
        typing.className = 'ai-chat-bubble ai-chat-assistant ai-chat-typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        if (box) box.appendChild(typing);
        if (box) box.scrollTop = box.scrollHeight;

        try {
            var res = await fetch('/api/ai-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: _aiChatHistory, lang: isEn ? 'en' : 'ru' })
            });
            if (!res.ok) {
                var errText = await res.text();
                throw new Error('Chat error ' + res.status);
            }
            var data = await res.json();
            var reply = data.text || '...';

            if (box && typing.parentNode) box.removeChild(typing);
            _aiChatHistory.push({ role: 'assistant', content: reply });
            _appendChatBubble('assistant', reply);
        } catch(e) {
            if (box && typing.parentNode) box.removeChild(typing);
            _appendChatBubble('assistant', isEn ? 'Error. Try again.' : 'Ошибка. Попробуй ещё раз.');
            // Убираем последний user message из истории чтобы можно было повторить
            _aiChatHistory.pop();
        } finally {
            _setChatInputLoading(false);
            _updateChatPlaceholder();
        }
    }

    var _MAX_QUESTIONS = 7;
    var _questionCount = 0;

    function _updateChatPlaceholder() {
        var input = document.getElementById('aiChatInput');
        if (!input) return;
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var remaining = _MAX_QUESTIONS - _questionCount;
        if (_questionCount === 0) {
            input.placeholder = isEn ? 'Ask a question...' : 'Задать вопрос...';
            input.disabled = false;
        } else if (remaining > 0) {
            input.placeholder = isEn
                ? 'Ask a question (' + remaining + ' of ' + _MAX_QUESTIONS + ' left)'
                : 'Задать вопрос (' + remaining + ' из ' + _MAX_QUESTIONS + ')';
            input.disabled = false;
        } else {
            input.placeholder = isEn ? 'Question limit reached' : 'Лимит вопросов исчерпан';
            input.disabled = true;
            var btn = document.getElementById('aiChatSend');
            if (btn) btn.disabled = true;
        }
        // Заголовок чата
        var header = document.getElementById('aiChatHeaderLabel');
        if (header) header.textContent = isEn ? 'CHAT' : 'ЧАТ';
        // Кнопка открытия/закрытия чата
        var chatBtn = document.getElementById('aiChatOpenBtn');
        if (chatBtn) {
            var _chatIcon = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="#2962FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5C1 2.8 2.8 1 5 1H17C19.2 1 21 2.8 21 5V13C21 15.2 19.2 17 17 17H9L4 21V17H5C2.8 17 1 15.2 1 13V5Z"/><circle cx="7" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="11" cy="11" r="1.2" fill="#2962FF" stroke="none"/><circle cx="15" cy="11" r="1.2" fill="#2962FF" stroke="none"/></svg>';
            if (_chatOpen) {
                chatBtn.innerHTML = isEn ? '✕ Close' : '✕ Закрыть';
            } else {
                chatBtn.innerHTML = _chatIcon + ' AI Chat';
            }
        }
    }

    // Экспорт для вызова из applyLang
    window.updateAiChatLang = function() { _updateChatPlaceholder(); };

    // Сброс истории чата (при смене монеты/таймфрейма)
    window.resetAiChat = function() {
        _aiChatHistory = [];
        _questionCount = 0;
        var box = document.getElementById('aiChatMessages');
        if (box) box.innerHTML = '';
        var btn = document.getElementById('aiChatSend');
        if (btn) btn.disabled = false;
        _updateChatPlaceholder();
    };

    function showBtn() { ensureUI(); if (_btnEl && !_isMobile()) _btnEl.style.display = 'flex'; }

    function renderLoading(ctx) {
        ensureUI();
        // #5 — синяя пульсирующая рамка пока AI думает
        _tooltipEl.classList.remove('signal-long', 'signal-short', 'signal-loading');
        _tooltipEl.classList.add('signal-loading');
        _btnEl.classList.remove('signal-long', 'signal-short');
        var isEn = ctx && ctx.lang === 'en';
        _tooltipEl.querySelector('.ai-tt-tf').textContent = '· ' + (ctx ? ctx.timeframe : '1D');
        _tooltipEl.querySelector('.ai-tt-text').innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div class="ai-tt-spinner"></div>' +
            '<span style="color:#94A3B8;font-size:11px;">' + (isEn ? 'Analyzing...' : 'Анализирую...') + '</span></div>';
        // Очищаем verdict и action чтобы не оставался старый текст
        var ve = _tooltipEl.querySelector('.ai-tt-verdict');
        if (ve) { ve.textContent = ''; ve.style.cssText = ''; }
        var ae = _tooltipEl.querySelector('.ai-tt-action'); ae.innerHTML = ''; ae.style.cssText = '';
        _tooltipEl.querySelector('.ai-tt-price').textContent = ctx ? (ctx.coin + ' · $' + ctx.currentPrice.toLocaleString('en-US')) : '';
        var _now = new Date(); var _timeStr = _now.toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit'}) + ' ' + _now.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
        var _timeEl = _tooltipEl.querySelector('.ai-tt-time'); if (_timeEl) _timeEl.textContent = _timeStr;
    }

    function calcProfit(entry, target) {
        var e = parseFloat(String(entry).replace(/[$\s]/g, '').replace(/,/g, ''));
        var t = parseFloat(String(target).replace(/[$\s]/g, '').replace(/,/g, ''));
        if (!e || !t || e === 0) return null;
        return Math.round(Math.abs((t - e) / e) * 1000) / 10;
    }

    function fmtPrice(val) {
        var s = String(val).replace(/[$\s]/g, '').replace(/,/g, '');
        var n = parseFloat(s);
        if (!n || isNaN(n)) return val;
        return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function extractCondition(str) {
        if (!str) return '';
        return String(str).replace(/[^0-9.,\s\u0430-\u044f\u0410-\u042fa-zA-Z\-><↑↓]/g, '').trim();
    }

    function renderResult(data, ctx) {
        ensureUI();
        _tooltipEl.querySelector('.ai-tt-tf').textContent = '· ' + (ctx ? ctx.timeframe : '1D');

        var longPct = data.longPct || 50;
        var shortPct = data.shortPct || 50;
        var diff = Math.abs(longPct - shortPct);
        var dominant = longPct >= shortPct ? 'long' : 'short';
        var longData = data.long || {};
        var shortData = data.short || {};
        var isEn = ctx && ctx.lang === 'en';

        // Determine signal strength — use AI response or fallback to diff
        var strength = data.signalStrength || (diff >= 20 ? 'strong' : diff >= 10 ? 'weak' : 'neutral');

        // Signal colors
        var signalColor = strength === 'neutral' ? '#FBBF24' : (dominant === 'long' ? '#26A69A' : '#EF5350');
        var signalBg = strength === 'neutral' ? 'rgba(251,191,36,0.06)' : (dominant === 'long' ? 'rgba(38,166,154,0.08)' : 'rgba(239,83,80,0.08)');

        // ── Trend Row ──
        var trendIcon = strength === 'neutral' ? '⏸' : (dominant === 'long' ? '▲' : '▼');
        var trendLabel = data.trendLabel || (strength === 'neutral' ? (isEn ? 'Consolidation' : 'Консолидация') : (dominant === 'long' ? (isEn ? 'Bullish' : 'Бычий') : (isEn ? 'Bearish' : 'Медвежий')));
        var trendDetail = data.trendDetail || '';

        // Build trend row HTML
        var trendHtml = '<div class="ai-tt-trend" style="display:flex;align-items:center;gap:8px;margin:0 10px 8px;padding:8px 10px;background:' + signalBg + ';border-radius:8px;border-left:3px solid ' + signalColor + ';">';
        trendHtml += '<span style="font-size:14px;">' + trendIcon + '</span>';
        trendHtml += '<span style="font-size:12px;font-weight:600;color:' + signalColor + ';">' + trendLabel + '</span>';
        if (trendDetail) trendHtml += '<span style="font-size:11px;color:#9598A1;margin-left:auto;">' + trendDetail + '</span>';
        trendHtml += '</div>';

        // ── Price Scale ──
        var support = ctx && ctx.levels ? ctx.levels.support : null;
        var resistance = ctx && ctx.levels ? ctx.levels.resistance : null;
        var price = ctx ? ctx.currentPrice : 0;
        var scaleHtml = '';
        if (support && resistance && resistance > support) {
            var pct = Math.max(2, Math.min(98, Math.round((price - support) / (resistance - support) * 100)));
            scaleHtml = '<div class="ai-tt-scale" style="margin:0 10px 10px;position:relative;">';
            scaleHtml += '<div style="display:flex;justify-content:space-between;font-size:10px;color:#636B76;margin-bottom:4px;">';
            scaleHtml += '<span>' + (isEn ? 'Support' : 'Поддержка') + ' $' + Math.round(support).toLocaleString('en-US') + '</span>';
            scaleHtml += '<span>' + (isEn ? 'Resistance' : 'Сопротивление') + ' $' + Math.round(resistance).toLocaleString('en-US') + '</span>';
            scaleHtml += '</div>';
            scaleHtml += '<div style="height:6px;background:linear-gradient(to right,rgba(239,83,80,0.3) 0%,rgba(239,83,80,0.3) 30%,#2A2E39 30%,#2A2E39 70%,rgba(38,166,154,0.3) 70%,rgba(38,166,154,0.3) 100%);border-radius:3px;position:relative;">';
            scaleHtml += '<span style="position:absolute;top:-18px;left:' + pct + '%;transform:translateX(-50%);font-size:10px;font-weight:600;color:' + signalColor + ';background:#1E222D;padding:0 4px;">$' + Math.round(price).toLocaleString('en-US') + '</span>';
            scaleHtml += '<div style="position:absolute;width:12px;height:12px;background:' + signalColor + ';border:2px solid #D1D4DC;border-radius:50%;top:-3px;left:' + pct + '%;transform:translateX(-50%);"></div>';
            scaleHtml += '</div></div>';
        }

        // ── Situation text (insert trend + scale before text) ──
        var textEl = _tooltipEl.querySelector('.ai-tt-text');
        textEl.style.fontStyle = 'normal';
        textEl.style.color = '#9598A1';
        textEl.style.borderLeftColor = '';
        textEl.innerHTML = trendHtml + scaleHtml + '<div style="padding:0 10px 4px;font-size:12px;line-height:1.55;color:#9598A1;">' + (data.situation || data.text || '') + '</div>';

        // ── Verdict ──
        var verdictEl = _tooltipEl.querySelector('.ai-tt-verdict');
        if (data.verdict) {
            verdictEl.style.cssText = 'padding:8px 10px;margin:0 10px 8px;font-size:11.5px;font-weight:600;color:' + signalColor + ';line-height:1.45;background:' + signalBg + ';border-radius:6px;';
            verdictEl.textContent = data.verdict;
        } else {
            verdictEl.style.cssText = '';
            verdictEl.textContent = '';
        }

        // ── Border animation class ──
        _tooltipEl.classList.remove('signal-long', 'signal-short', 'signal-neutral', 'signal-loading');
        _btnEl.classList.remove('signal-long', 'signal-short', 'signal-neutral');
        if (strength === 'neutral') {
            _tooltipEl.classList.add('signal-neutral');
            _btnEl.classList.add('signal-neutral');
        } else {
            _tooltipEl.classList.add(dominant === 'short' ? 'signal-short' : 'signal-long');
            _btnEl.classList.add(dominant === 'short' ? 'signal-short' : 'signal-long');
        }

        // ── Action area ──
        var ae = _tooltipEl.querySelector('.ai-tt-action');
        ae.style.cssText = 'padding:0;background:transparent;border:none;margin:0 10px 8px;';

        // Helper: extract number from entry/stop/target
        function extractNum(val) {
            if (!val) return null;
            var s = String(val).replace(/[$\s]/g, '').replace(/,/g, '');
            var m = s.match(/[\d]+\.?[\d]*/);
            return m ? parseFloat(m[0]) : null;
        }

        // ═══ MODE: NEUTRAL — no bars, show activation conditions ═══
        if (strength === 'neutral') {
            var actHtml = '<div style="padding:10px;background:rgba(251,191,36,0.04);border:1px solid #2A2E39;border-radius:8px;">';
            actHtml += '<div style="font-size:11px;font-weight:600;color:#FBBF24;margin-bottom:8px;display:flex;align-items:center;gap:6px;">';
            actHtml += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
            actHtml += (isEn ? 'Signal activation conditions' : 'Условия активации сигнала') + '</div>';

            var activation = data.activation || {};
            var longTarget = extractNum(longData.target);
            var longStop = extractNum(longData.stop);
            var shortTarget = extractNum(shortData.target);
            var shortStop = extractNum(shortData.stop);

            // Long condition
            actHtml += '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #1E222D;">';
            actHtml += '<div style="width:20px;height:20px;border-radius:4px;background:rgba(38,166,154,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#26A69A;flex-shrink:0;margin-top:1px;">L</div>';
            actHtml += '<div><div style="font-size:11px;line-height:1.4;color:#9598A1;"><strong style="color:#D1D4DC;font-weight:600;">Long</strong> — ' + (activation.long || (isEn ? 'Confirm above resistance' : 'Подтверждение выше сопротивления')) + '</div>';
            if (longTarget || longStop) actHtml += '<div style="font-size:11px;color:#636B76;margin-top:2px;">' + (isEn ? 'Target' : 'Цель') + ' $' + (longTarget ? longTarget.toLocaleString('en-US', {maximumFractionDigits:0}) : '—') + ' · ' + (isEn ? 'Stop' : 'Стоп') + ' $' + (longStop ? longStop.toLocaleString('en-US', {maximumFractionDigits:0}) : '—') + '</div>';
            actHtml += '</div></div>';

            // Short condition
            actHtml += '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;">';
            actHtml += '<div style="width:20px;height:20px;border-radius:4px;background:rgba(239,83,80,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#EF5350;flex-shrink:0;margin-top:1px;">S</div>';
            actHtml += '<div><div style="font-size:11px;line-height:1.4;color:#9598A1;"><strong style="color:#D1D4DC;font-weight:600;">Short</strong> — ' + (activation.short || (isEn ? 'Confirm below support' : 'Подтверждение ниже поддержки')) + '</div>';
            if (shortTarget || shortStop) actHtml += '<div style="font-size:11px;color:#636B76;margin-top:2px;">' + (isEn ? 'Target' : 'Цель') + ' $' + (shortTarget ? shortTarget.toLocaleString('en-US', {maximumFractionDigits:0}) : '—') + ' · ' + (isEn ? 'Stop' : 'Стоп') + ' $' + (shortStop ? shortStop.toLocaleString('en-US', {maximumFractionDigits:0}) : '—') + '</div>';
            actHtml += '</div></div>';

            actHtml += '</div>';
            ae.innerHTML = actHtml;

        // ═══ MODE: WEAK or STRONG — show bars + details ═══
        } else {
            var html = '<div style="display:flex;gap:2px;margin-bottom:8px;height:28px;border-radius:4px;overflow:hidden;">';
            html += '<div id="aiBarLong" style="flex:' + longPct + ';background:rgba(38,166,154,' + (dominant === 'long' ? '0.18' : '0.06') + ');display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#26A69A;min-width:44px;cursor:pointer;transition:all 0.15s;border-bottom:2px solid ' + (dominant === 'long' ? '#26A69A' : 'transparent') + ';">↑ Long ' + longPct + '%</div>';
            html += '<div id="aiBarShort" style="flex:' + shortPct + ';background:rgba(239,83,80,' + (dominant === 'short' ? '0.18' : '0.06') + ');display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#EF5350;min-width:44px;cursor:pointer;transition:all 0.15s;border-bottom:2px solid ' + (dominant === 'short' ? '#EF5350' : 'transparent') + ';">↓ Short ' + shortPct + '%</div>';
            html += '</div>';

            // Weak signal badge
            if (strength === 'weak') {
                html += '<div style="text-align:center;margin-bottom:6px;"><span style="font-size:10px;color:#FBBF24;background:rgba(251,191,36,0.1);padding:2px 8px;border-radius:4px;">' + (isEn ? 'Weak signal — caution' : 'Слабый сигнал — осторожно') + '</span></div>';
            }

            html += '<div id="aiDetails"></div>';

            // Activation hint for weak signals
            if (strength === 'weak' && data.activation) {
                var actText = dominant === 'long' ? (data.activation.long || '') : (data.activation.short || '');
                if (actText) {
                    html += '<div style="margin-top:6px;padding:6px 8px;background:rgba(251,191,36,0.04);border:1px solid #2A2E39;border-radius:6px;font-size:10px;color:#9598A1;line-height:1.4;">';
                    html += '<span style="color:#FBBF24;font-weight:600;">' + (isEn ? 'Activation: ' : 'Активация: ') + '</span>' + actText;
                    html += '</div>';
                }
            }

            ae.innerHTML = html;

            function showDetails(side) {
                var d = side === 'long' ? longData : shortData;
                var mainC = side === 'long' ? '#26A69A' : '#EF5350';
                var bg = '#131722';
                var bd = '#2A2E39';
                var label = side === 'long' ? 'Long' : 'Short';
                var box = document.getElementById('aiDetails');
                if (!box) return;

                var entryNum = extractNum(d.entry);
                var targetNum = extractNum(d.target);
                var stopNum = extractNum(d.stop);
                var profit = (entryNum && targetNum && entryNum > 0)
                    ? Math.round(Math.abs((targetNum - entryNum) / entryNum) * 1000) / 10
                    : null;

                var h = '';
                if (d.entry || d.target || d.stop) {
                    h = '<div style="background:' + bg + ';border:1px solid ' + bd + ';border-radius:4px;overflow:hidden;">';
                    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid ' + bd + ';">';
                    h += '<span style="font-size:11.5px;font-weight:700;color:' + mainC + ';">' + label + '</span>';
                    if (profit !== null) h += '<span style="font-size:10.5px;font-weight:700;color:' + mainC + ';">profit +' + profit + '%</span>';
                    h += '</div>';
                    h += '<div style="padding:5px 10px 7px;">';
                    if (entryNum) h += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#636B76;font-size:11px;">' + (isEn ? 'Entry' : 'Вход') + '</span><span style="color:#9598A1;font-size:11px;font-weight:500;">$' + entryNum.toLocaleString('en-US', {maximumFractionDigits:2}) + '</span></div>';
                    if (targetNum) h += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#636B76;font-size:11px;">' + (isEn ? 'Target' : 'Цель') + '</span><span style="color:#D1D4DC;font-size:11px;font-weight:500;">$' + targetNum.toLocaleString('en-US', {maximumFractionDigits:2}) + '</span></div>';
                    if (stopNum) h += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#636B76;font-size:11px;">' + (isEn ? 'Stop' : 'Стоп') + '</span><span style="color:#D1D4DC;font-size:11px;font-weight:500;">$' + stopNum.toLocaleString('en-US', {maximumFractionDigits:2}) + '</span></div>';
                    h += '</div></div>';
                }
                box.innerHTML = h;

                var bl = document.getElementById('aiBarLong');
                var bs = document.getElementById('aiBarShort');
                if (bl) { bl.style.background = side === 'long' ? 'rgba(38,166,154,0.18)' : 'rgba(38,166,154,0.06)'; bl.style.borderBottom = side === 'long' ? '2px solid #26A69A' : '2px solid transparent'; }
                if (bs) { bs.style.background = side === 'short' ? 'rgba(239,83,80,0.18)' : 'rgba(239,83,80,0.06)'; bs.style.borderBottom = side === 'short' ? '2px solid #EF5350' : '2px solid transparent'; }
            }

            showDetails(dominant);

            var barL = document.getElementById('aiBarLong');
            var barS = document.getElementById('aiBarShort');
            if (barL) barL.addEventListener('click', function(e) { e.stopPropagation(); showDetails('long'); });
            if (barS) barS.addEventListener('click', function(e) { e.stopPropagation(); showDetails('short'); });
        }

        // ── Footer price + time ──
        _tooltipEl.querySelector('.ai-tt-price').textContent = ctx ? (ctx.coin + ' · $' + ctx.currentPrice.toLocaleString('en-US')) : '';
        var _tsToUse = window._lastAnalysisTs ? new Date(window._lastAnalysisTs) : new Date();
        var _timeStr = _tsToUse.toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit'}) + ' ' + _tsToUse.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
        var _timeEl = _tooltipEl.querySelector('.ai-tt-time'); if (_timeEl) _timeEl.textContent = _timeStr;
    }

    // ── Фоновый расчёт уровней и winRate независимо от Scan ────
    window._ensureLevelsAndWinRate = async function(coinId, periodDays) {
        var sym = (typeof BINANCE_SYMBOLS !== 'undefined') ? BINANCE_SYMBOLS[coinId] : null;
        if (!sym || typeof PatternScanner === 'undefined') return;

        // Уровни — пересчитываем если пустой ИЛИ если сменилась монета
        var levelsStale = !window._lastLevels || window._lastLevelsCoin !== coinId;
        if (levelsStale && typeof rawOhlcCache !== 'undefined' && rawOhlcCache.length >= 20) {
            try {
                var candles = rawOhlcCache.map(function(k) {
                    return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] };
                });
                if (PatternScanner.scanLevels) {
                    var levels = PatternScanner.scanLevels(candles, 1);
                    if (levels) {
                        window._lastLevels = levels;
                        window._lastLevelsCoin = coinId;
                    }
                }
            } catch(e) {}
        }

        // WinRate — если кэш пустой или другая монета/таймфрейм
        var wrInterval, wrLimit;
        if (periodDays <= 0.04)      { wrInterval = '1h'; wrLimit = 1000; }
        else if (periodDays <= 0.17) { wrInterval = '4h'; wrLimit = 1000; }
        else if (periodDays <= 1)    { wrInterval = '1d'; wrLimit = 730; }
        else if (periodDays <= 7)    { wrInterval = '1w'; wrLimit = 200; }
        else                         { wrInterval = '1M'; wrLimit = 100; }

        var wrCacheKey = coinId + '_' + wrInterval;
        if ((!window._fsWinRateCache || window._fsWinRateCacheKey !== wrCacheKey)
            && !window._fsWinRateLoading
            && typeof PatternScanner.calcWinRate === 'function') {
            try {
                window._fsWinRateLoading = true;
                var res = await fetch('/api/ohlc?symbol=' + sym + '&interval=' + wrInterval + '&limit=' + wrLimit);
                var data = await res.json();
                if (Array.isArray(data) && data.length > 50) {
                    var wrCandles = data.map(function(k) {
                        return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] };
                    });
                    window._fsWinRateCache = PatternScanner.calcWinRate(wrCandles, periodDays);
                    window._fsWinRateCacheKey = wrCacheKey;
                }
            } catch(e) {}
            finally { window._fsWinRateLoading = false; }
        }
    };

    // ── Главная функция ─────────────────────────────────────────
    var _aiScanInFlight = false;

    function _startScanAnim() {
        var el = document.getElementById('aiScanGlow');
        if (el) el.classList.add('on');
    }
    function _stopScanAnim() {
        var el = document.getElementById('aiScanGlow');
        if (el) el.classList.remove('on');
    }

    window.runAiScan = async function(forceRefresh) {
        if (_aiScanInFlight) return;
        try {
            _aiScanInFlight = true;
            _startScanAnim();

            var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
            var periodDays = (typeof currentPeriod !== 'undefined') ? currentPeriod : 1;

            // Гарантируем наличие уровней и winRate независимо от Scan
            await window._ensureLevelsAndWinRate(coinId, periodDays);

            var ctx = window.collectAiContext();
            if (!ctx) { _aiScanInFlight = false; return; }

            var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
            var anchor = await window.loadAnchorLevels(coinId);
            if (anchor) {
                // Для 4H и 1H — добавляем 1D данные как anchorData
                if (ctx.timeframe !== '1D') {
                    ctx.anchorData = {
                        levels: anchor.levels,
                        keyPoints: anchor.keyPoints,
                        priceProfile: anchor.priceProfile,
                        heavyZones: anchor.heavyZones
                    };
                } else {
                    // Для 1D — мёрджим keyPoints из anchor (там есть 900d/365d данные)
                    ctx.keyPoints = anchor.keyPoints;
                    // Если priceProfile с текущего TF совпадает (1D=1D), используем anchor (он из 1000 свечей)
                    if (anchor.priceProfile) ctx.priceProfile = anchor.priceProfile;
                    if (anchor.heavyZones) ctx.heavyZones = anchor.heavyZones;
                    if (anchor.volatility) ctx.volatility = anchor.volatility;
                    if (anchor.suggestedLevels) ctx.suggestedLevels = anchor.suggestedLevels;
                }
            }

            // ── BTC якорный контекст для альткоинов ──
            if (coinId !== 'bitcoin') {
                var btcAnchor = await window.loadAnchorLevels('bitcoin');
                if (btcAnchor) {
                    ctx.btcAnchor = {
                        price: btcAnchor.keyPoints ? btcAnchor.keyPoints.currentPrice : null,
                        levels: btcAnchor.levels,
                        keyPoints: btcAnchor.keyPoints,
                        volatility: btcAnchor.volatility,
                        heavyZones: btcAnchor.heavyZones ? btcAnchor.heavyZones.slice(0, 3) : null
                    };
                }
            }

            // Кэш — 3 минуты (пропускаем если forceRefresh или смена монеты/таймфрейма)
            var key = getCacheKey();
            var cached = window._aiCache[key];
            if (!forceRefresh && cached && Date.now() - cached.ts < 180000) {
                showBtn();
                window._lastAnalysisTs = cached.ts;
                renderResult(cached.result, cached.ctx);
                _tooltipVisible = true;
                _containerEl && _containerEl.classList.add('visible');
                _btnEl.classList.add('active');
                _aiScanInFlight = false;
                return;
            }

            // Сбрасываем старый кэш и очищаем тултип перед новым запросом
            delete window._aiCache[key];
            if (typeof window.resetAiChat === 'function') window.resetAiChat();
            if (_tooltipEl) {
                var textEl = _tooltipEl.querySelector('.ai-tt-text');
                var actionEl = _tooltipEl.querySelector('.ai-tt-action');
                if (textEl) { textEl.textContent = ''; textEl.style.fontStyle = 'italic'; textEl.style.color = '#B2B5BE'; textEl.style.borderLeftColor = ''; }
                if (actionEl) actionEl.innerHTML = '';
                _tooltipEl.className = _tooltipEl.className.replace(/signal-\S+/g, '').trim();
            }

            showBtn();
            renderLoading(ctx);
            _tooltipVisible = true;
            _containerEl && _containerEl.classList.add('visible');
            _btnEl.classList.add('active');
            if (_chatPanelEl) _chatPanelEl.classList.remove('visible');

            // Лог промпта
            window._aiLastPrompt = ctx;
            console.log('[AI Scanner] Prompt:', JSON.stringify(ctx, null, 2));

            var result = await window.callAiScanner(ctx);
            var _resultTs = Date.now();
            window._aiCache[key] = { result: result, ctx: ctx, ts: _resultTs };
            window._lastAnalysisTs = _resultTs;
            console.log('[AI Scanner] Result:', JSON.stringify(result, null, 2));

            // Сохраняем анализ как первое сообщение в истории чата
            _aiChatHistory = [
                { role: 'user', content: 'Данные рынка: ' + JSON.stringify(ctx) },
                { role: 'assistant', content: (result.situation || '') + ' ' + (result.verdict || '') }
            ];

            renderResult(result, ctx);
            // На десктопе чат скрыт по умолчанию — открывается кнопкой
            if (_isMobile()) {
                if (_chatPanelEl) _chatPanelEl.classList.add('visible');
            }
            setTimeout(_positionChatPanel, 50);
            setTimeout(_positionChatPanel, 300);
        } catch(e) {
            console.error('AI Scanner error:', e);
            if (_tooltipEl) {
                var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
                var textEl = _tooltipEl.querySelector('.ai-tt-text');
                var aeEl = _tooltipEl.querySelector('.ai-tt-action');
                textEl.style.fontStyle = 'normal';
                textEl.style.color = '#9598A1';
                textEl.textContent = isEn
                    ? 'Server temporarily unavailable.'
                    : 'Сервер временно недоступен.';
                aeEl.style.cssText = 'margin:0 10px 8px;';
                var retryBtn = document.createElement('button');
                retryBtn.style.cssText = 'background:rgba(41,98,255,0.12);border:1px solid rgba(41,98,255,0.3);border-radius:6px;color:#2962FF;font-size:11px;font-weight:600;padding:6px 20px;cursor:pointer;';
                retryBtn.textContent = isEn ? '↺ Retry' : '↺ Повторить';
                retryBtn.onclick = function() { if (typeof runAiScan === 'function') runAiScan(true); };
                var errWrap = document.createElement('div');
                errWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
                var errHint = document.createElement('span');
                errHint.style.cssText = 'color:#636B76;font-size:11px;';
                errHint.textContent = isEn ? 'Please try again in a moment' : 'Попробуйте через минуту';
                errWrap.appendChild(errHint);
                errWrap.appendChild(retryBtn);
                aeEl.innerHTML = '';
                aeEl.appendChild(errWrap);
                if (!_tooltipVisible) {
                    _tooltipVisible = true;
                    _containerEl && _containerEl.classList.add('visible');
                    _btnEl && _btnEl.classList.add('active');
                }
            }
        } finally {
            _aiScanInFlight = false;
            _stopScanAnim();
        }
    };

    // ── Таймер истечения кэша — оверлей через 10 мин ───────────
    var _expiryTimer = null;
    var _tickTimer = null;
    var _analysisTs = null; // время последнего анализа
    var AI_CACHE_LIFETIME = 10 * 60 * 1000; // 10 минут

    function _timeAgo(ts) {
        var diff = Math.floor((Date.now() - ts) / 1000);
        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        if (diff < 60) return isEn ? 'just now' : 'только что';
        var mins = Math.floor(diff / 60);
        if (isEn) return mins + ' min ago';
        if (mins === 1) return '1 минуту назад';
        if (mins < 5) return mins + ' минуты назад';
        return mins + ' минут назад';
    }

    function _showStaleOverlay() {
        if (!_tooltipEl) return;
        // Убираем старый оверлей если был
        var old = _tooltipEl.querySelector('#aiStaleOverlay');
        if (old) old.remove();

        var isEn = (typeof currentLang !== 'undefined') && currentLang === 'en';
        var overlay = document.createElement('div');
        overlay.id = 'aiStaleOverlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(13,17,28,0.85);border-radius:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;';

        var timeEl = document.createElement('span');
        timeEl.id = 'aiStaleTime';
        timeEl.style.cssText = 'color:#636B76;font-size:12px;';
        timeEl.textContent = (isEn ? 'Analysis from ' : 'Анализ от ') + new Date(_analysisTs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' · ' + _timeAgo(_analysisTs);

        // Запускаем тик — обновляем время каждую минуту
        clearInterval(_tickTimer);
        _tickTimer = setInterval(function() {
            var el = document.getElementById('aiStaleTime');
            if (el && _analysisTs) {
                el.textContent = (isEn ? 'Analysis from ' : 'Анализ от ') + new Date(_analysisTs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' · ' + _timeAgo(_analysisTs);
            }
        }, 30000);

        var icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F7A600" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        var title = document.createElement('div');
        title.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
        title.innerHTML = icon + '<span style="color:#D1D4DC;font-size:14px;font-weight:500;">' + (isEn ? 'Data outdated' : 'Данные устарели') + '</span>';

        var btnUpdate = document.createElement('button');
        btnUpdate.style.cssText = 'background:#2962FF;border:none;border-radius:8px;color:white;font-size:13px;font-weight:500;padding:10px 28px;cursor:pointer;';
        btnUpdate.textContent = isEn ? 'Update analysis' : 'Обновить анализ';
        btnUpdate.onclick = function() {
            overlay.remove();
            clearInterval(_tickTimer);
            if (typeof runAiScan === 'function') runAiScan(true);
        };

        var btnOld = document.createElement('button');
        btnOld.style.cssText = 'background:transparent;border:1px solid #2A2E39;border-radius:8px;color:#636B76;font-size:12px;padding:7px 20px;cursor:pointer;';
        btnOld.textContent = isEn ? 'View old analysis' : 'Посмотреть старый';
        btnOld.onclick = function() {
            overlay.remove();
            clearInterval(_tickTimer);
            // Разблокируем чат
            if (_chatPanelEl) {
                var inp = _chatPanelEl.querySelector('.ai-tt-chat-input');
                var btn = _chatPanelEl.querySelector('.ai-tt-chat-send');
                if (inp) inp.disabled = false;
                if (btn) btn.disabled = false;
            }
            // Добавляем маленькую кнопку "Обновить" в футер
            var footer = _tooltipEl.querySelector('.ai-tt-footer');
            if (footer && !footer.querySelector('#aiRefreshBtn')) {
                var refreshBtn = document.createElement('button');
                refreshBtn.id = 'aiRefreshBtn';
                refreshBtn.style.cssText = 'background:transparent;border:1px solid rgba(41,98,255,0.4);border-radius:4px;color:#2962FF;font-size:10px;padding:2px 8px;cursor:pointer;margin-left:6px;';
                refreshBtn.textContent = '↺ ' + (isEn ? 'Update' : 'Обновить');
                refreshBtn.onclick = function() {
                    refreshBtn.remove();
                    if (typeof runAiScan === 'function') runAiScan(true);
                };
                footer.appendChild(refreshBtn);
            }
        };

        overlay.appendChild(title);
        overlay.appendChild(timeEl);
        overlay.appendChild(btnUpdate);
        overlay.appendChild(btnOld);

        // Блокируем чат пока оверлей активен
        if (_chatPanelEl) {
            var inp = _chatPanelEl.querySelector('.ai-tt-chat-input');
            var btn = _chatPanelEl.querySelector('.ai-tt-chat-send');
            if (inp) { inp.disabled = true; inp.placeholder = isEn ? 'Update analysis to continue' : 'Обновите анализ для продолжения'; }
            if (btn) btn.disabled = true;
        }

        // Позиционирование относительно тултипа
        _tooltipEl.style.position = 'relative';
        _tooltipEl.appendChild(overlay);

        // Кнопка expired на кружочке
        _btnEl.classList.add('expired');
        _tooltipVisible = true;
        _containerEl && _containerEl.classList.add('visible');
        _btnEl.classList.add('active');

        // Инвалидируем фронт-кэш
        var key = getCacheKey();
        delete window._aiCache[key];
    }

    function startExpiryTimer() {
        clearTimeout(_expiryTimer);
        clearInterval(_tickTimer);
        // Убираем старый оверлей если был
        if (_tooltipEl) { var o = _tooltipEl.querySelector('#aiStaleOverlay'); if (o) o.remove(); }
        _expiryTimer = setTimeout(function() {
            if (!_tooltipEl || !_btnEl) return;
            if (_btnEl.style.display === 'none') return;
            _showStaleOverlay();
        }, AI_CACHE_LIFETIME);
    }

    // Перехватываем момент сохранения в кэш — запускаем таймер
    var _origRunAiScan = window.runAiScan;
    window.runAiScan = async function() {
        await _origRunAiScan.apply(this, arguments);
        var key = getCacheKey();
        if (window._aiCache[key]) {
            _analysisTs = window._aiCache[key].ts || Date.now();
            startExpiryTimer();
            if (_btnEl) _btnEl.classList.remove('expired');
            // Убираем старый оверлей и кнопку обновления при успешном обновлении
            if (_tooltipEl) {
                var o = _tooltipEl.querySelector('#aiStaleOverlay'); if (o) o.remove();
                var r = _tooltipEl.querySelector('#aiRefreshBtn'); if (r) r.remove();
            }
            // Разблокируем чат
            if (_chatPanelEl) {
                var inp = _chatPanelEl.querySelector('.ai-tt-chat-input');
                var snd = _chatPanelEl.querySelector('.ai-tt-chat-send');
                if (inp) inp.disabled = false;
                if (snd) snd.disabled = false;
            }
        }
    };

})();
