// ══════════════════════════════════════════════════════════════
// AI SCANNER v2 — кружочек (!) + тултип внутри графика + кэш
// ══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ── Кэш результатов AI ──────────────────────────────────────
    window._aiCache = {};
    window._aiLastPrompt = null;

    function getCacheKey() {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        var pd = (typeof currentPeriod !== 'undefined') ? currentPeriod : 1;
        var tf = '1D';
        if (pd <= 0.042) tf = '1H';
        else if (pd <= 0.17) tf = '4H';
        return coinId + '_' + tf;
    }

    // ── Кэш 1D якорных уровней ─────────────────────────────────
    window._aiAnchorCache = {}; // v2 — 900d history

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
                return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] };
            });
            if (typeof PatternScanner === 'undefined' || !PatternScanner.scanLevels) return null;
            var levels = PatternScanner.scanLevels(candles, 1);
            if (!levels) return null;

            // Считаем тренд по 1D свечам — актуально для всех таймфреймов
            var currentClose = candles[candles.length - 1].close;
            var trend1d = {};
            var pct = function(from) { return Math.round((currentClose - from) / from * 1000) / 10; };
            if (candles.length >= 60)  trend1d.change60d  = pct(candles[candles.length - 60].close);
            if (candles.length >= 100) trend1d.change100d = pct(candles[candles.length - 100].close);
            if (candles.length >= 200) trend1d.change200d = pct(candles[candles.length - 200].close);
            if (candles.length >= 400) trend1d.change400d = pct(candles[candles.length - 400].close);
            if (candles.length >= 600) trend1d.change600d = pct(candles[candles.length - 600].close);
            if (candles.length >= 800) trend1d.change800d = pct(candles[candles.length - 800].close);
            if (candles.length >= 900) trend1d.change900d = pct(candles[candles.length - 900].close);

            if (candles.length >= 60)  trend1d.priceAt60d  = Math.round(candles[candles.length - 60].close);
            if (candles.length >= 100) trend1d.priceAt100d = Math.round(candles[candles.length - 100].close);
            if (candles.length >= 200) trend1d.priceAt200d = Math.round(candles[candles.length - 200].close);
            if (candles.length >= 400) trend1d.priceAt400d = Math.round(candles[candles.length - 400].close);
            if (candles.length >= 600) trend1d.priceAt600d = Math.round(candles[candles.length - 600].close);
            if (candles.length >= 800) trend1d.priceAt800d = Math.round(candles[candles.length - 800].close);
            if (candles.length >= 900) trend1d.priceAt900d = Math.round(candles[candles.length - 900].close);

            var c365 = candles.slice(-365);
            var high365 = Math.round(Math.max.apply(null, c365.map(function(c) { return c.high; })));
            var low365  = Math.round(Math.min.apply(null, c365.map(function(c) { return c.low; })));
            trend1d.high365d = high365;
            trend1d.low365d  = low365;
            trend1d.positionIn365dRange = high365 !== low365 ? Math.round((currentClose - low365) / (high365 - low365) * 1000) / 10 : 50;

            var c900 = candles.slice(-900);
            var high900 = Math.round(Math.max.apply(null, c900.map(function(c) { return c.high; })));
            var low900  = Math.round(Math.min.apply(null, c900.map(function(c) { return c.low; })));
            trend1d.high900d = high900;
            trend1d.low900d  = low900;
            trend1d.positionIn900dRange = high900 !== low900 ? Math.round((currentClose - low900) / (high900 - low900) * 1000) / 10 : 50;

            var result = { support: levels.support, resistance: levels.resistance, positionPct: levels.positionPct, trend1d: trend1d, ts: Date.now() };
            window._aiAnchorCache[coinId] = result;
            return result;
        } catch(e) { return null; }
    };

    setInterval(function() {
        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : null;
        if (coinId && !window._aiAnchorCache[coinId]) window.loadAnchorLevels(coinId);
    }, 10000);

    // ── Сбор контекста ──────────────────────────────────────────
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

        var levels = null;
        if (window._lastLevels) {
            levels = {
                support: Math.round(window._lastLevels.support * 100) / 100,
                resistance: Math.round(window._lastLevels.resistance * 100) / 100,
                positionPct: Math.round(window._lastLevels.positionPct * 10) / 10,
            };
        }

        var trend = {};
        // Пересчитываем количество свечей в зависимости от таймфрейма
        // 1H: 100 дней = 2400 свечей; 4H: 100 дней = 600; 1D: 100 свечей
        var candlesPerDay = tfLabel === '1H' ? 24 : (tfLabel === '4H' ? 6 : 1);
        var c100 = 100 * candlesPerDay;
        var c200 = 200 * candlesPerDay;
        // Считаем только если данных реально хватает — иначе не передаём в промпт
        if (candles.length >= c100) trend.change100d = Math.round((price - candles[candles.length - c100].close) / candles[candles.length - c100].close * 1000) / 10;
        if (candles.length >= c200) trend.change200d = Math.round((price - candles[candles.length - c200].close) / candles[candles.length - c200].close * 1000) / 10;

        var last10raw = candles.slice(-11, -1);
        var last10 = {};
        if (last10raw.length >= 5) {
            last10.changePercent = Math.round((last10raw[last10raw.length-1].close - last10raw[0].open) / last10raw[0].open * 1000) / 10;
            last10.direction = last10.changePercent >= 0 ? 'up' : 'down';
            last10.greenCandles = last10raw.filter(function(c) { return c.close >= c.open; }).length;
            last10.redCandles = last10raw.filter(function(c) { return c.close < c.open; }).length;
            var consec = 0, lastDir = null;
            for (var i = last10raw.length - 1; i >= 0; i--) {
                var d = last10raw[i].close >= last10raw[i].open ? 'green' : 'red';
                if (!lastDir) lastDir = d;
                if (d === lastDir) consec++; else break;
            }
            last10.consecutiveDirection = consec + ' ' + (lastDir === 'green' ? (isEn ? 'green' : 'зелёных') : (isEn ? 'red' : 'красных'));
        }

        // ── Структура последних 5 закрытых свечей ──
        var last5structure = null;
        var last5raw = candles.slice(-6, -1); // 5 закрытых, без текущей
        if (last5raw.length === 5) {
            last5structure = last5raw.map(function(c) {
                return Math.round((c.close - c.open) / c.open * 1000) / 10;
            });
        }

        // ── ВСЕ паттерны за последние 10 свечей ──
        var recentPatterns = [];
        if (typeof PatternScanner !== 'undefined') {
            PatternScanner.enableAll();
            var allP = PatternScanner.scan(candles);
            var cutoff = candles[Math.max(0, candles.length - 11)].time;
            var recent = allP.filter(function(p) { return p.time >= cutoff; });

            // Берём ВСЕ паттерны — без дедупликации
            // Два бычьих поглощения = важный контекст (первое не сработало, второе сработало и т.д.)
            recent.forEach(function(p) {
                var idx = candles.findIndex(function(c) { return c.time === p.time; });
                var candlesAgo = idx >= 0 ? candles.length - 1 - idx : 0;
                var pat = {
                    type: (isEn && p.typeEn) ? p.typeEn : p.type,
                    direction: p.direction,
                    candlesAgo: candlesAgo,
                    winRate: null,
                    patternClose: candles[idx] ? Math.round(candles[idx].close * 100) / 100 : 0,
                    workedOut: null, // рассчитаем ниже
                };
                // Win rate
                if (window._fsWinRateCache) {
                    var wr = window._fsWinRateCache[p.key || p.type];
                    if (wr) pat.winRate = wr.pct;
                }
                // Отработал ли паттерн
                if (p.direction === 'neutral') {
                    // Доджи и нейтральные — winRate нет, workedOut всегда null
                    pat.workedOut = null;
                } else if (candlesAgo <= 2) {
                    // Паттерн свежий (≤2 свечи назад) — рано оценивать результат,
                    // AI должен опираться только на winRate
                    pat.workedOut = null;
                } else if (idx >= 0 && idx < candles.length - 1) {
                    // Считаем только ЗАКРЫТЫЕ свечи после паттерна (без текущей незакрытой)
                    var closedAfter = candles.slice(idx + 1, candles.length - 1); // -1 = исключаем текущую
                    var patClose = candles[idx].close;

                    if (closedAfter.length < 2) {
                        // Меньше 2 закрытых свечей — рано оценивать
                        pat.workedOut = null;
                    } else {
                        // Берём первые 3 закрытые свечи (или сколько есть)
                        var check = closedAfter.slice(0, 3);
                        var aboveCount = check.filter(function(c) { return c.close > patClose; }).length;
                        var belowCount = check.filter(function(c) { return c.close < patClose; }).length;
                        var lastCheck = check[check.length - 1].close;

                        if (p.direction === 'bullish') {
                            // Отработал: минимум 2 из 3 закрылись выше И последняя выше
                            pat.workedOut = aboveCount >= 2 && lastCheck > patClose;
                        } else if (p.direction === 'bearish') {
                            // Отработал: минимум 2 из 3 закрылись ниже И последняя ниже
                            pat.workedOut = belowCount >= 2 && lastCheck < patClose;
                        }
                    }
                }
                recentPatterns.push(pat);
            });
        }

        // ── Расстояние до уровней в % ──
        var distanceToLevels = null;
        if (levels && price > 0) {
            distanceToLevels = {
                toSupport: Math.round((price - levels.support) / price * 1000) / 10,
                toResistance: Math.round((levels.resistance - price) / price * 1000) / 10,
            };
        }

        var coinId = (typeof selectedCoin !== 'undefined' && selectedCoin) ? selectedCoin.id : 'bitcoin';
        var anchorLevels = null;
        if (periodDays < 1 && window._aiAnchorCache[coinId]) {
            var a = window._aiAnchorCache[coinId];
            anchorLevels = { support: a.support, resistance: a.resistance,
                positionPct: a.resistance !== a.support ? Math.round((price - a.support) / (a.resistance - a.support) * 1000) / 10 : 50 };
        }

        return { coin: coinSymbol + '/USDT', timeframe: tfLabel, currentPrice: price, lang: isEn ? 'en' : 'ru',
            levels: levels, distanceToLevels: distanceToLevels, trend: trend, last10: last10,
            last5structure: last5structure,
            recentPatterns: recentPatterns.length > 0 ? recentPatterns : null,
            anchorLevels: anchorLevels };
    };

    // ── API ─────────────────────────────────────────────────────
    window.callAiScanner = async function(ctx) {
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
            '<button class="ai-chat-open-btn" id="aiChatOpenBtn">💬 Чат</button>';

        // Чат-панель — сразу под тултипом в том же контейнере
        _chatPanelEl = document.createElement('div');
        _chatPanelEl.id = 'aiChatPanel';
        _chatPanelEl.innerHTML =
            '<div class="ai-chat-header" id="aiChatHeaderLabel">ЧАТ</div>' +
            '<div class="ai-tt-chat" id="aiChatMessages"></div>' +
            '<div class="ai-tt-chat-input-wrap" id="aiChatInputWrap">' +
                '<textarea class="ai-tt-chat-input" id="aiChatInput" placeholder="..." maxlength="400" rows="1"></textarea>' +
                '<button class="ai-tt-chat-send" id="aiChatSend">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
                '</button>' +
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
                if (btn) btn.textContent = isEn ? '✕ Close chat' : '✕ Закрыть чат';
            } else {
                panel.classList.remove('visible', 'chat-side', 'chat-empty');
                panel.style.height = '';
                if (btn) btn.textContent = isEn ? '💬 Chat' : '💬 Чат';
            }
        }
    }
    function _initChatHandlers() {
        var input = document.getElementById('aiChatInput');
        var sendBtn = document.getElementById('aiChatSend');
        if (!input || !sendBtn) return;

        function sendMsg() {
            var text = input.value.trim();
            if (!text) return;
            input.value = '';
            input.style.height = 'auto';
            _positionChatPanel();
            _sendChatMessage(text);
            // Возвращаем фокус после отправки
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

        // Авторастяжение textarea
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
            _positionChatPanel();
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
            if (_chatOpen) {
                chatBtn.textContent = isEn ? '✕ Close chat' : '✕ Закрыть чат';
            } else {
                chatBtn.textContent = isEn ? '💬 Chat' : '💬 Чат';
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

        // Situation
        _tooltipEl.querySelector('.ai-tt-text').textContent = data.situation || data.text || '';

        // Verdict — colored based on signal
        var verdictEl = _tooltipEl.querySelector('.ai-tt-verdict');
        var longPct = data.longPct || 50;
        var shortPct = data.shortPct || 50;
        var diff = Math.abs(longPct - shortPct);
        var dominant = longPct >= shortPct ? 'long' : 'short';
        var longData = data.long || {};
        var shortData = data.short || {};
        var isEn = ctx && ctx.lang === 'en';

        if (data.verdict) {
            var verdictColor = diff < 15 ? '#FBBF24' : (dominant === 'long' ? '#26A69A' : '#EF5350');
            verdictEl.style.cssText = 'padding:0 10px 8px;margin:0 10px;font-size:11.5px;font-weight:600;color:' + verdictColor + ';line-height:1.45;';
            verdictEl.textContent = data.verdict;
        } else {
            verdictEl.style.cssText = '';
            verdictEl.textContent = '';
        }

        // #2 #3 #4 — переключаем рамку и цвет кнопки по сигналу
        _tooltipEl.classList.remove('signal-long', 'signal-short', 'signal-loading');
        _tooltipEl.classList.add(dominant === 'short' ? 'signal-short' : 'signal-long');
        _btnEl.classList.remove('signal-long', 'signal-short');
        _btnEl.classList.add(dominant === 'short' ? 'signal-short' : 'signal-long');

        var ae = _tooltipEl.querySelector('.ai-tt-action');
        ae.style.cssText = 'padding:0;background:transparent;border:none;margin:0 10px 8px;';

        var html = '<div style="display:flex;gap:2px;margin-bottom:8px;height:28px;border-radius:4px;overflow:hidden;">';
        html += '<div id="aiBarLong" style="flex:' + longPct + ';background:rgba(38,166,154,' + (dominant === 'long' ? '0.18' : '0.06') + ');display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#26A69A;min-width:44px;cursor:pointer;transition:all 0.15s;border-bottom:2px solid ' + (dominant === 'long' ? '#26A69A' : 'transparent') + ';">↑ Long ' + longPct + '%</div>';
        html += '<div id="aiBarShort" style="flex:' + shortPct + ';background:rgba(239,83,80,' + (dominant === 'short' ? '0.18' : '0.06') + ');display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#EF5350;min-width:44px;cursor:pointer;transition:all 0.15s;border-bottom:2px solid ' + (dominant === 'short' ? '#EF5350' : 'transparent') + ';">↓ Short ' + shortPct + '%</div>';
        html += '</div>';
        html += '<div id="aiDetails"></div>';

        ae.innerHTML = html;

        function showDetails(side) {
            var d = side === 'long' ? longData : shortData;
            var mainC = side === 'long' ? '#26A69A' : '#EF5350';
            var bg = '#131722';
            var bd = '#2A2E39';
            var label = side === 'long' ? 'Long' : 'Short';
            var box = document.getElementById('aiDetails');
            if (!box) return;

            // Извлекаем только число из строки (убираем текстовые пояснения)
            function extractNum(val) {
                if (!val) return null;
                var s = String(val).replace(/[$\s]/g, '').replace(/,/g, '');
                // Берём первое число из строки (до пробела/скобки/буквы)
                var m = s.match(/[\d]+\.?[\d]*/);
                return m ? parseFloat(m[0]) : null;
            }

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

        _tooltipEl.querySelector('.ai-tt-price').textContent = ctx ? (ctx.coin + ' · $' + ctx.currentPrice.toLocaleString('en-US')) : '';
        var _now = new Date(); var _timeStr = _now.toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit'}) + ' ' + _now.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
        var _timeEl = _tooltipEl.querySelector('.ai-tt-time'); if (_timeEl) _timeEl.textContent = _timeStr;
    }

    // ── Фоновый расчёт уровней и winRate независимо от Scan ────
    window._ensureLevelsAndWinRate = async function(coinId, periodDays) {
        var sym = (typeof BINANCE_SYMBOLS !== 'undefined') ? BINANCE_SYMBOLS[coinId] : null;
        if (!sym || typeof PatternScanner === 'undefined') return;

        // Уровни — если _lastLevels пустой
        if (!window._lastLevels && typeof rawOhlcCache !== 'undefined' && rawOhlcCache.length >= 20) {
            try {
                var candles = rawOhlcCache.map(function(k) {
                    return { time: Math.floor(k[0]/1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] };
                });
                if (PatternScanner.scanLevels) {
                    var levels = PatternScanner.scanLevels(candles, 1);
                    if (levels) window._lastLevels = levels;
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
                // Для 4H и 1H — якорные уровни
                if (ctx.timeframe !== '1D') {
                    ctx.anchorLevels = { support: anchor.support, resistance: anchor.resistance,
                        positionPct: anchor.resistance !== anchor.support
                            ? Math.round((ctx.currentPrice - anchor.support) / (anchor.resistance - anchor.support) * 1000) / 10 : 50 };
                }
                // Для всех таймфреймов — мёрджим историческую траекторию
                if (anchor.trend1d) {
                    ctx.trend = Object.assign({}, anchor.trend1d, ctx.trend);
                }
            }

            // Кэш — 3 минуты (пропускаем если forceRefresh или смена монеты/таймфрейма)
            var key = getCacheKey();
            var cached = window._aiCache[key];
            if (!forceRefresh && cached && Date.now() - cached.ts < 180000) {
                showBtn();
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
            window._aiCache[key] = { result: result, ctx: ctx, ts: Date.now() };
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
