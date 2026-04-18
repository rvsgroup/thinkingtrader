/* ══════════════════════════════════════════
   BOT PANEL JS v2 — Thinking Trader
   Algo Scalper UI — виджет + модальное окно
   ══════════════════════════════════════════ */

(function () {
    'use strict';

    var _state = {
        active: false,
        mode: null,
        market: 'futures',
        timeframe: '5m',
        running: false,
        paused: false,
        modalStep: 0,
        completedSteps: [],
        apiKey: '',
        apiSecret: '',
        apiConnected: false,
        pair: 'BTC/USDT',
        riskPct: '2',
        dayLimitPct: '5',
        maxLosses: '3',
        volumeMultiplier: '1.5',
        positionTimeout: '30',
        maxLeverage: '5',
        trailingEnabled: false,
        trailingOffset: '0.25',
        trailingActivation: '70',
        bbExitEnabled: false,
        bbExitTolerance: '5',
        smaReturnTolerance: '5',
        maxProfitPct: '1.0',
        cooldownCandles: '5',
        stopAtrMultiplier: '1.5',
        clusterExitConfirm: '1',
        strategy: 'scalper',        // 'scalper' | 'mean_reversion'
        direction: 'both',          // 'both' | 'long' | 'short'
        entryMode: 'candle',        // 'candle' | 'tick'
        bbPeriod: '20',
        bbMultiplier: '2.0',
        rsiPeriod: '14',
        rsiOverbought: '65',
        rsiOversold: '35',
        virtualBalance: 10000,
        trades: [],
        // Данные с сервера
        levels: [],
        currentPrice: 0,
        position: null,
        balance: 10000,
        dayPnl: 0,
        totalPnl: 0,
        tradeCount: 0,
        winRate: null,
        wsConnected: false,
        // ── Multi-bot ──
        botId: 'default',
        botName: null,
        bots: [],               // список ботов [{botId, pair, strategy, running, ...}]
    };

    function injectCSS() {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'bot-panel.css';
        document.head.appendChild(link);
    }

    /* ── Кнопка БОТ (только для админа) ── */
    function createBotButton() {
        var btn = document.createElement('button');
        btn.id = 'botBtnApp';
        btn.className = 'admin-only';
        btn.style.display = 'none'; // скрыта по умолчанию, показывается для админа
        btn.innerHTML = '<span class="bot-btn-dot"></span>БОТ';
        btn.onclick = toggleBot;
        var aiBtn = document.getElementById('aiBtnApp');
        if (aiBtn && aiBtn.parentNode) {
            var sep = document.createElement('div');
            sep.className = 'admin-only';
            sep.style.cssText = 'width:1px;height:14px;background:rgba(255,255,255,0.08);flex-shrink:0;margin:0 3px;display:none;';
            aiBtn.parentNode.insertBefore(sep, aiBtn.nextSibling);
            aiBtn.parentNode.insertBefore(btn, sep.nextSibling);
        }
    }

    /* ══════════════════════════════════════════
       ВИДЖЕТ (заменяет watchlist)
    ══════════════════════════════════════════ */

    function createBotWidget() {
        var widget = document.createElement('div');
        widget.id = 'botWidget';
        widget.innerHTML = '\
            <div class="bot-w-header">\
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;">\
                    <rect x="2" y="4" width="10" height="7" rx="1.5" stroke="#26a69a" stroke-width="1"/>\
                    <rect x="4.5" y="5.8" width="2" height="2" rx="0.4" fill="#26a69a"/>\
                    <rect x="7.5" y="5.8" width="2" height="2" rx="0.4" fill="#26a69a"/>\
                    <line x1="7" y1="1.5" x2="7" y2="4" stroke="#26a69a" stroke-width="1"/>\
                    <circle cx="7" cy="1.2" r="0.8" fill="#26a69a"/>\
                    <line x1="2" y1="9" x2="0.5" y2="9" stroke="#26a69a" stroke-width="1"/>\
                    <line x1="12" y1="9" x2="13.5" y2="9" stroke="#26a69a" stroke-width="1"/>\
                </svg>\
                <span class="bot-w-title">Algo Scalper</span>\
                <span id="botStopAllBtn" title="Остановить всех ботов" style="cursor:pointer;margin-left:6px;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid rgba(239,68,68,0.4);border-radius:4px;color:#EF4444;font-size:10px;font-weight:600;letter-spacing:0.5px;opacity:0.75;transition:opacity 0.2s, background 0.2s;" onmouseover="this.style.opacity=1;this.style.background=\'rgba(239,68,68,0.08)\'" onmouseout="this.style.opacity=0.75;this.style.background=\'transparent\'">\
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg">\
                        <rect x="0.5" y="0.5" width="8" height="8" rx="1"/>\
                    </svg>\
                    STOP\
                </span>\
                <span class="bot-w-badge idle" id="botWidgetBadge">ВЫКЛ</span>\
                <span id="botJournalBtn" title="Журнал сделок" style="cursor:pointer;margin-left:6px;opacity:0.5;transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">\
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">\
                        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#94A3B8" stroke-width="1.2" fill="none"/>\
                        <line x1="5" y1="4.5" x2="11" y2="4.5" stroke="#94A3B8" stroke-width="1" stroke-linecap="round"/>\
                        <line x1="5" y1="7" x2="11" y2="7" stroke="#94A3B8" stroke-width="1" stroke-linecap="round"/>\
                        <line x1="5" y1="9.5" x2="9" y2="9.5" stroke="#94A3B8" stroke-width="1" stroke-linecap="round"/>\
                        <path d="M2 4 L0.5 4 L0.5 13.5 C0.5 14.3 1.2 15 2 15" stroke="#94A3B8" stroke-width="1.2" fill="none" stroke-linecap="round"/>\
                    </svg>\
                </span>\
            </div>\
            \
            <div id="botSelectorWrap" style="padding:4px 10px 2px;position:relative;">\
                <div id="botSelectorBtn" style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-radius:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:border-color 0.2s;">\
                    <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">\
                        <span id="botSelectorDot" style="width:6px;height:6px;border-radius:50%;background:#636B76;flex-shrink:0;"></span>\
                        <span id="botSelectorLabel" style="font-size:11px;color:#D1D5DB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">BTC/USDT · SC · 5m</span>\
                    </div>\
                    <span style="font-size:9px;color:#636B76;margin-left:6px;flex-shrink:0;"><svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor"><polygon points="0,0 6,0 3,4"/></svg></span>\
                </div>\
                <div id="botSelectorDropdown" style="display:none;position:absolute;left:10px;right:10px;top:100%;z-index:100;background:#1a1d26;border:1px solid rgba(255,255,255,0.1);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.5);max-height:240px;overflow-y:auto;margin-top:2px;">\
                    <div id="botSelectorList"></div>\
                    <div id="botSelectorAdd" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid rgba(255,255,255,0.06);cursor:pointer;color:#26a69a;font-size:11px;transition:background 0.15s;">\
                        <span style="font-size:14px;">+</span> Создать нового\
                    </div>\
                </div>\
            </div>\
            \
            <div class="bot-w-section">\
                <div class="bot-w-section-title">Режим</div>\
                <div class="bot-w-mode-row">\
                    <div class="bot-w-mode-btn" id="botModeWidgetPaper"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="5" r="1" fill="currentColor"/></svg> Paper</div>\
                    <div class="bot-w-mode-btn" id="botModeWidgetLive"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="vertical-align:-1px;"><polygon points="1,0 10,5 1,10"/></svg> Live</div>\
                </div>\
            </div>\
            \
            <div class="bot-w-section" id="botWidgetLevelsSection">\
                <div class="bot-w-section-title" id="botLevelsToggle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">\
                    <span>Микроуровни <span id="botLevelCount" style="color:#636B76;font-weight:400;text-transform:none;letter-spacing:0;">—</span></span>\
                    <span id="botLevelsArrow" style="font-size:10px;color:#636B76;transition:transform 0.2s;display:inline-flex;"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="0,2 8,2 4,7"/></svg></span>\
                </div>\
                <div id="botWidgetLevelsList" class="bot-w-levels-list">\
                    <div class="bot-w-log-empty">Бот не запущен</div>\
                </div>\
            </div>\
            \
            <div class="bot-w-section" id="botBBSection" style="display:none;">\
                <div class="bot-w-section-title">Bollinger Bands / RSI</div>\
                <div id="botBBContainer" style="font-size:11px;color:#94A3B8;line-height:1.8;"></div>\
            </div>\
            \
            <div class="bot-w-section" id="botWidgetStatusSection" style="display:none;">\
                <div id="botWidgetStatusLine" class="bot-w-status-line">—</div>\
            </div>\
            \
            <div class="bot-w-section" id="botClusterSection" style="display:none;">\
                <div id="botClusterContainer"></div>\
                <div id="botClusterToggleWrap" style="display:none;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;">\
                    <span style="font-size:10px;color:#636B76;">Учитывать при входе</span>\
                    <label style="position:relative;width:32px;height:18px;cursor:pointer;">\
                        <input type="checkbox" id="botClusterEntryToggle" style="opacity:0;width:0;height:0;">\
                        <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.1);border-radius:9px;transition:0.2s;"></span>\
                        <span style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#636B76;border-radius:50%;transition:0.2s;" id="botClusterToggleDot"></span>\
                    </label>\
                </div>\
            </div>\
            \
            <div class="bot-w-section" id="botManualBtnsSection" style="display:none;">\
                <div id="botManualBtnsContainer"></div>\
            </div>\
            \
            <div class="bot-w-section" id="botWidgetPositionSection" style="display:none;">\
                <div class="bot-w-section-title">Открытая позиция</div>\
                <div id="botWidgetPosition" class="bot-w-position"></div>\
            </div>\
            \
            <div class="bot-w-section">\
                <div class="bot-w-section-title">Сегодня</div>\
                <div class="bot-w-stats-grid">\
                    <div class="bot-w-stat-card">\
                        <div class="bot-w-stat-card-val" id="wBalance">$10,000</div>\
                        <div class="bot-w-stat-card-lbl">Баланс</div>\
                    </div>\
                    <div class="bot-w-stat-card">\
                        <div class="bot-w-stat-card-val" id="wPnl">—</div>\
                        <div class="bot-w-stat-card-lbl">P&L сегодня</div>\
                    </div>\
                    <div class="bot-w-stat-card">\
                        <div class="bot-w-stat-card-val" id="wTrades">0</div>\
                        <div class="bot-w-stat-card-lbl">Сделок</div>\
                    </div>\
                </div>\
                <div class="bot-w-stats-footer">\
                    <span class="bot-w-stats-foot-item">Win rate <span class="bot-w-stats-foot-val" id="wWinrate">—</span></span>\
                    <span class="bot-w-stats-foot-item">WS <span class="bot-w-stats-foot-val" id="wWsStatus">—</span></span>\
                </div>\
            </div>\
            \
            <div class="bot-w-log" id="botWidgetLog">\
                <div class="bot-w-log-empty">Сделок пока нет</div>\
            </div>\
            \
            <div class="bot-w-btns">\
                <div class="bot-w-btn settings" id="botOpenSettings"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.1 2.1l1.1 1.1M8.8 8.8l1.1 1.1M9.9 2.1L8.8 3.2M3.2 8.8L2.1 9.9" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg> Настройки</div>\
                <div class="bot-w-btn save" id="botSaveSettings" style="display:none;background:rgba(38,166,154,0.15);color:#26a69a;border:1px solid rgba(38,166,154,0.3);"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1h6.5L10 2.5V10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1"/><rect x="4" y="7" width="4" height="2.5" rx="0.5" stroke="currentColor" stroke-width="0.8"/><path d="M4 1v2.5h3V1" stroke="currentColor" stroke-width="0.8"/></svg> Сохранить</div>\
                <div class="bot-w-btn start" id="botWidgetStart" style="display:none;"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="1,0 10,5 1,10"/></svg> Запустить</div>\
                <div class="bot-w-btn stop"  id="botWidgetStop"  style="display:none;"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1"/></svg> Остановить</div>\
                <div class="bot-w-btn paper" id="botWidgetPaper" style="display:none;"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="5" r="1" fill="currentColor"/></svg> Paper trading</div>\
                <div class="bot-w-btn resume" id="botWidgetResume" style="display:none;"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="1,0 10,5 1,10"/></svg> Возобновить</div>\
            </div>';

        widget.querySelector('#botOpenSettings').onclick = function() { openModal(); };
        widget.querySelector('#botJournalBtn').onclick = openJournal;
        var stopAllBtn = widget.querySelector('#botStopAllBtn');
        if (stopAllBtn) stopAllBtn.onclick = confirmStopAll;
        widget.querySelector('#botClusterEntryToggle').onchange = function() {
            var on = this.checked;
            var dot = document.getElementById('botClusterToggleDot');
            if (dot) {
                dot.style.left = on ? '16px' : '2px';
                dot.style.background = on ? '#26a69a' : '#636B76';
                dot.parentElement.querySelector('span').style.background = on ? 'rgba(38,166,154,0.3)' : 'rgba(255,255,255,0.1)';
            }
            // Отправляем на сервер
            var uid = getUid();
            fetch('/api/bot/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: _state.botId, clusterEntryFilter: on })
            }).then(function() { loadBotList(); }).catch(function() {});
        };
        widget.querySelector('#botWidgetStart').onclick = startBot;
        widget.querySelector('#botWidgetStop').onclick  = stopBot;
        widget.querySelector('#botSaveSettings').onclick = saveSettingsHot;
        widget.querySelector('#botWidgetResume').onclick = resumeBot;
        widget.querySelector('#botSelectorBtn').onclick = toggleBotDropdown;
        widget.querySelector('#botSelectorAdd').onclick = function() { closeBotDropdown(); createNewBot(); };
        widget.querySelector('#botSelectorAdd').onmouseover = function() { this.style.background = 'rgba(38,166,154,0.1)'; };
        widget.querySelector('#botSelectorAdd').onmouseout = function() { this.style.background = 'transparent'; };
        widget.querySelector('#botLevelsToggle').onclick = function() {
            var list = document.getElementById('botWidgetLevelsList');
            var arrow = document.getElementById('botLevelsArrow');
            if (list.style.display === 'none') {
                list.style.display = '';
                arrow.style.transform = 'rotate(0deg)';
            } else {
                list.style.display = 'none';
                arrow.style.transform = 'rotate(-90deg)';
            }
        };
        widget.querySelector('#botModeWidgetPaper').onclick = function() { setMode('paper'); openModal(); };
        widget.querySelector('#botModeWidgetLive').onclick  = function() { setMode('live');  openModal(); };

        var wlWrap = document.getElementById('watchlistWrap');
        if (wlWrap) wlWrap.parentNode.insertBefore(widget, wlWrap);
    }


    /* ══════════════════════════════════════════
       ОБНОВЛЕНИЕ ВИДЖЕТА (данные с сервера)
    ══════════════════════════════════════════ */

    function updateWidgetFromStatus(data) {
        _state.levels       = data.levels       || [];
        _state.currentPrice = data.currentPrice  || 0;
        _state.position     = data.position      || null;
        _state.balance      = data.balance       || 0;
        _state.dayPnl       = data.dayPnl        || 0;
        _state.totalPnl     = data.totalPnl      || 0;
        _state.tradeCount   = data.tradeCount    || 0;
        _state.winRate      = data.winRate;
        _state.wsConnected  = data.wsConnected   || false;
        _state.volumeInfo   = data.volumeInfo    || null;
        _state.clusterInfo  = data.clusterInfo   || null;
        _state.running      = data.running       || false;
        _state.paused       = data.paused        || false;
        _state.bbData       = data.bbData        || null;

        // Синхронизируем параметры трейлинга — нужны для отрисовки метки TR на шкале позиции
        if (data.trailingEnabled !== undefined) _state.trailingEnabled = !!data.trailingEnabled;
        if (data.trailingActivation !== undefined) _state.trailingActivation = data.trailingActivation;
        if (data.trailingOffset !== undefined) _state.trailingOffset = data.trailingOffset;
        if (data.bbExitEnabled !== undefined) _state.bbExitEnabled = !!data.bbExitEnabled;
        if (data.bbExitTolerance !== undefined) _state.bbExitTolerance = data.bbExitTolerance;
        if (data.smaReturnTolerance !== undefined) _state.smaReturnTolerance = data.smaReturnTolerance;

        // Не перезаписываем настройки из polling если модалка открыта (пользователь выбирает)
        var modalOpen = document.querySelector('#botModal.visible');
        if (!modalOpen) {
            _state.strategy = data.strategy || 'scalper';
        }

        // Обновляем bot selector dot (running/stopped)
        var selectorDot = document.getElementById('botSelectorDot');

        // Обновляем тумблер кластеров из данных бота
        if (data.clusterEntryFilter !== undefined) {
            var clToggle = document.getElementById('botClusterEntryToggle');
            var clDot = document.getElementById('botClusterToggleDot');
            if (clToggle) clToggle.checked = !!data.clusterEntryFilter;
            if (clDot) {
                var on = !!data.clusterEntryFilter;
                clDot.style.left = on ? '16px' : '2px';
                clDot.style.background = on ? '#26a69a' : '#636B76';
                if (clDot.parentElement) {
                    var track = clDot.parentElement.querySelector('span');
                    if (track) track.style.background = on ? 'rgba(38,166,154,0.3)' : 'rgba(255,255,255,0.1)';
                }
            }
        }
        if (selectorDot) selectorDot.style.background = _state.running ? '#26a69a' : '#636B76';

        // ── Обновляем пару в виджете ──
        var pairLabel = document.getElementById('botWidgetPairLabel');
        if (pairLabel && _state.pair) pairLabel.textContent = _state.pair;

        // ── Переключение секций по стратегии ──
        var levelsSection = document.getElementById('botWidgetLevelsSection');
        var bbSection = document.getElementById('botBBSection');
        var clusterToggleWrap = document.getElementById('botClusterToggleWrap');
        if (_state.strategy === 'mean_reversion') {
            if (levelsSection) levelsSection.style.display = 'none';
            if (bbSection) bbSection.style.display = '';
            if (clusterToggleWrap) clusterToggleWrap.style.display = 'flex';
            // Рисуем BB/RSI данные
            var bbContainer = document.getElementById('botBBContainer');
            if (bbContainer && _state.bbData) {
                var bb = _state.bbData;
                var price = _state.currentPrice;
                var rsiColor = bb.rsi >= 70 ? '#EF4444' : bb.rsi <= 30 ? '#10B981' : '#94A3B8';
                var posInBand = price > 0 && bb.upper > bb.lower
                    ? Math.round((price - bb.lower) / (bb.upper - bb.lower) * 100) : 50;
                bbContainer.innerHTML = '\
                    <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#EF4444;"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,7 8,7 4,1"/></svg> Верхняя</span><span style="color:#E2E8F0;font-weight:600;">' + bb.upper.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span></div>\
                    <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#FBBF24;">─ Средняя (SMA)</span><span style="color:#E2E8F0;font-weight:600;">' + bb.middle.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span></div>\
                    <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#10B981;"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,1 8,1 4,7"/></svg> Нижняя</span><span style="color:#E2E8F0;font-weight:600;">' + bb.lower.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span></div>\
                    <div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;position:relative;">\
                        <div style="position:absolute;left:' + posInBand + '%;top:-2px;width:8px;height:8px;border-radius:50%;background:#3B82F6;transform:translateX(-50%);"></div>\
                    </div>\
                    <div style="display:flex;justify-content:space-between;padding:5px 0 0;"><span>Позиция в канале</span><span style="color:#E2E8F0;font-weight:600;">' + posInBand + '%</span></div>\
                    <div style="display:flex;justify-content:space-between;padding:3px 0;"><span>RSI (' + (_state.rsiPeriod || 14) + ')</span><span style="color:' + rsiColor + ';font-weight:700;">' + bb.rsi + '</span></div>';
            } else if (bbContainer) {
                bbContainer.innerHTML = '<span style="color:#475569;font-style:italic;">Ожидание данных...</span>';
            }
        } else {
            if (levelsSection) levelsSection.style.display = '';
            if (bbSection) bbSection.style.display = 'none';
            if (clusterToggleWrap) clusterToggleWrap.style.display = 'none';
        }

        // ── Баланс ──
        var balEl = document.getElementById('wBalance');
        if (balEl) {
            balEl.textContent = '$' + _state.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            if (_state.totalPnl !== 0) {
                balEl.className = 'bot-w-stat-card-val ' + (_state.totalPnl >= 0 ? 'green' : 'red');
            } else {
                balEl.className = 'bot-w-stat-card-val';
            }
        }

        // ── P&L ──
        var pnlEl = document.getElementById('wPnl');
        if (pnlEl) {
            var pnl = _state.dayPnl;
            var startBal = _state.balance - _state.dayPnl;
            var pnlPct = startBal > 0 ? (pnl / startBal * 100).toFixed(2) : '0.00';
            pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
            pnlEl.className = 'bot-w-stat-card-val ' + (pnl >= 0 ? 'green' : 'red');
        }

        // ── Сделки и winrate ──
        var trEl = document.getElementById('wTrades');
        var wrEl = document.getElementById('wWinrate');
        if (trEl) trEl.textContent = _state.tradeCount;
        if (wrEl) wrEl.textContent = _state.winRate != null ? _state.winRate + '%' : '—';

        // ── WebSocket статус ──
        var wsEl = document.getElementById('wWsStatus');
        if (wsEl) {
            wsEl.innerHTML = _state.wsConnected
                ? '<svg width="6" height="6" viewBox="0 0 6 6" style="vertical-align:0px;"><circle cx="3" cy="3" r="3" fill="#26a69a"/></svg>'
                : '<svg width="6" height="6" viewBox="0 0 6 6" style="vertical-align:0px;"><circle cx="3" cy="3" r="2.5" stroke="#636B76" stroke-width="1" fill="none"/></svg>';
        }

        // ── Микроуровни ──
        renderLevels();

        // ── Позиция ──
        renderPosition();

        // ── Статус-строка (что бот делает) ──
        renderStatusLine();

        // ── Кластерная панель ──
        renderClusterPanel();

        // ── Ручные кнопки LONG/SHORT ──
        renderManualButtons();

        // ── Badge ──
        updateBadge();

        // ── Кнопки ──
        updateButtons();
    }

    function renderLevels() {
        var container = document.getElementById('botWidgetLevelsList');
        var countEl   = document.getElementById('botLevelCount');
        if (!container) return;

        if (!_state.levels || _state.levels.length === 0) {
            container.innerHTML = '<div class="bot-w-log-empty">' + (_state.running ? 'Уровни рассчитываются...' : 'Бот не запущен') + '</div>';
            if (countEl) countEl.textContent = '—';
            return;
        }

        if (countEl) countEl.textContent = '(' + _state.levels.length + ')';

        // Сортировка: от высокой цены к низкой (сопротивление сверху, поддержка снизу)
        var sorted = _state.levels.slice().sort(function(a, b) { return b.price - a.price; });

        var isSpot = _state.market === 'spot';

        // Заголовки колонок
        var html = '<div class="bot-w-level-header">' +
            '<span class="bot-w-level-hcol type">Тип</span>' +
            '<span class="bot-w-level-hcol price">Цена</span>' +
            '<span class="bot-w-level-hcol touches">Касания</span>' +
            '<span class="bot-w-level-hcol dist">От цены</span>' +
            '</div>';

        sorted.forEach(function(l) {
            var isSupport = l.type === 'support';
            var cls = isSupport ? 'support' : 'resistance';
            var typeName = isSupport ? 'Поддержка' : 'Сопротивление';

            // Действие бота на этом уровне
            var action = '';
            if (isSupport) {
                action = 'LONG';
            } else {
                action = isSpot ? 'пропуск' : 'SHORT';
            }

            // Расстояние от текущей цены
            var dist = _state.currentPrice > 0
                ? ((l.price - _state.currentPrice) / _state.currentPrice * 100).toFixed(2)
                : '—';
            var distStr = dist > 0 ? '+' + dist + '%' : dist + '%';

            // Подсветка если цена близко к уровню (< 0.05%)
            var absDist = Math.abs(parseFloat(dist));
            var isNear = absDist < 0.05;
            var rowExtra = isNear ? ' bot-w-level-near' : '';

            // Цвет действия
            var actionCls = isSupport ? 'action-long' : 'action-short';

            html += '<div class="bot-w-level-row ' + cls + rowExtra + '">' +
                '<span class="bot-w-level-type ' + cls + '">' + typeName + '</span>' +
                '<span class="bot-w-level-price">' + l.price.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span>' +
                '<span class="bot-w-level-touches">' + (l.totalTouches || l.touches) + '</span>' +
                '<span class="bot-w-level-dist">' + distStr + '</span>' +
                '</div>';

            // Детали касаний + действие
            var touchInfo = '';
            if (l.touchesFromAbove !== undefined) {
                touchInfo = ' · <svg width="8" height="8" viewBox="0 0 8 8" fill="#EF5350" style="vertical-align:-1px;"><polygon points="0,1 8,1 4,7"/></svg>' + l.touchesFromAbove + ' <svg width="8" height="8" viewBox="0 0 8 8" fill="#26a69a" style="vertical-align:-1px;"><polygon points="0,7 8,7 4,1"/></svg>' + l.touchesFromBelow;
            }
            html += '<div class="bot-w-level-action ' + actionCls + '">Бот: ' + action + touchInfo + '</div>';
        });

        container.innerHTML = html;
    }

    function renderManualButtons() {
        var section = document.getElementById('botManualBtnsSection');
        var container = document.getElementById('botManualBtnsContainer');
        if (!section || !container) return;

        if (!_state.running) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        var html = '';

        if (_state.position) {
            html = '<div style="display:flex;gap:6px;">' +
                '<div id="botManualClose" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(239,83,80,0.15);color:#EF5350;border:1px solid rgba(239,83,80,0.3);">' +
                '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> CLOSE ' + _state.position.side + '</div></div>';
        } else {
            var isSpotMode = _state.market === 'spot';
            html = '<div style="display:flex;gap:6px;">' +
                '<div id="botManualLong" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(38,166,154,0.15);color:#26a69a;border:1px solid rgba(38,166,154,0.3);"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,7 8,7 4,1"/></svg> LONG</div>' +
                (isSpotMode ? '' :
                '<div id="botManualShort" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(239,83,80,0.15);color:#EF5350;border:1px solid rgba(239,83,80,0.3);"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,1 8,1 4,7"/></svg> SHORT</div>') +
                '</div>';
        }

        container.innerHTML = html;

        var longBtn = container.querySelector('#botManualLong');
        var shortBtn = container.querySelector('#botManualShort');
        var closeBtn = container.querySelector('#botManualClose');

        if (longBtn) longBtn.onclick = function() { manualTrade('LONG'); };
        if (shortBtn) shortBtn.onclick = function() { manualTrade('SHORT'); };
        if (closeBtn) closeBtn.onclick = function() { manualClose(); };
    }

    function renderClusterPanel() {
        var section = document.getElementById('botClusterSection');
        var container = document.getElementById('botClusterContainer');
        if (!section || !container) return;

        if (!_state.running || !_state.clusterInfo) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        var ci = _state.clusterInfo;
        var domLabel = ci.concentration === 'buyers' ? '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,7 8,7 4,1"/></svg> Покупатели' : ci.concentration === 'sellers' ? '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,1 8,1 4,7"/></svg> Продавцы' : '<svg width="8" height="6" viewBox="0 0 8 6" fill="none" style="vertical-align:-1px;"><line x1="0" y1="3" x2="8" y2="3" stroke="currentColor" stroke-width="1.2"/><polygon points="6,1 8,3 6,5" fill="currentColor"/><polygon points="2,1 0,3 2,5" fill="currentColor"/></svg> Баланс';
        var domColor = ci.concentration === 'buyers' ? '#26a69a' : ci.concentration === 'sellers' ? '#EF5350' : '#636B76';

        container.innerHTML = '<div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:11px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="color:#636B76;">Кластеры (' + ci.lookback + ' свечей)</span>' +
            '<span style="color:' + domColor + ';font-weight:600;">' + domLabel + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:0;height:6px;border-radius:3px;overflow:hidden;">' +
            '<div style="width:' + ci.buyPct + '%;background:#26a69a;"></div>' +
            '<div style="width:' + ci.sellPct + '%;background:#EF5350;"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px;color:#636B76;font-size:10px;">' +
            '<span>Buy ' + ci.buyPct + '%</span>' +
            '<span>Sell ' + ci.sellPct + '%</span>' +
            '</div>' +
            '</div>';
    }

    function renderPosition() {
        var section = document.getElementById('botWidgetPositionSection');
        var container = document.getElementById('botWidgetPosition');
        if (!section || !container) return;

        if (!_state.position) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        var pos = _state.position;
        var isLong = pos.side === 'LONG';
        // Подсветка рамки позиции зелёной для LONG, красной для SHORT
        container.className = 'bot-w-position' + (isLong ? ' long-pos' : '');
        var sideColor = isLong ? '#26a69a' : '#EF5350';
        var unrealizedPnl = pos.unrealizedPnl || 0;
        var pnlColor = unrealizedPnl >= 0 ? '#26a69a' : '#EF5350';
        var pnlStr = (unrealizedPnl >= 0 ? '+' : '') + '$' + unrealizedPnl.toFixed(2);
        var pnlPct = pos.entryPrice > 0 ? (((_state.currentPrice - pos.entryPrice) / pos.entryPrice) * (isLong ? 100 : -100)).toFixed(2) : '0.00';
        var elapsed = pos.openedAt ? Math.floor((Date.now() - pos.openedAt) / 60000) : 0;

        // Прогресс-бар: позиция цены между стопом и тейком
        var totalRange = Math.abs(pos.target - pos.stop);
        var progressPct = 50;
        if (totalRange > 0) {
            var fromStop = isLong
                ? (_state.currentPrice - pos.stop)
                : (pos.stop - _state.currentPrice);
            progressPct = Math.max(0, Math.min(100, (fromStop / totalRange) * 100));
        }
        var barColor = unrealizedPnl >= 0 ? '#26a69a' : '#EF5350';

        // Общий янтарный цвет для обеих меток
        var amber = '#F59E0B';

        // ── Метка активации трейлинга (янтарная ПУНКТИРНАЯ, подпись СНИЗУ) ──
        var trailMarkerHtml = '';
        if (_state.trailingEnabled && pos.entryPrice && totalRange > 0) {
            var activationPct = parseFloat(_state.trailingActivation) || 70;
            var pathToTarget = pos.target - pos.entryPrice;
            var trailPrice = pos.entryPrice + pathToTarget * (activationPct / 100);
            var trailOnBar = isLong
                ? ((trailPrice - pos.stop) / totalRange) * 100
                : ((pos.stop - trailPrice) / totalRange) * 100;
            if (trailOnBar >= 0 && trailOnBar <= 100) {
                var markerOpacity = pos.trailingActive ? '0.4' : '0.9';
                var trailPriceFmt = trailPrice >= 1000 ? trailPrice.toFixed(2)
                                  : trailPrice >= 1    ? trailPrice.toFixed(2)
                                  : trailPrice.toFixed(4);
                trailMarkerHtml =
                    '<div class="bot-w-pos-bar-trail" style="position:absolute;top:-2px;left:' + trailOnBar.toFixed(1) + '%;transform:translateX(-50%);pointer-events:none;opacity:' + markerOpacity + ';z-index:2;">' +
                        '<div style="width:1px;height:12px;margin:0 auto;background-image:repeating-linear-gradient(to bottom,' + amber + ' 0 2px,transparent 2px 4px);"></div>' +
                        '<div style="font-size:9px;font-weight:600;line-height:1;margin-top:4px;text-align:center;letter-spacing:0.3px;color:' + amber + ';white-space:nowrap;">TR ' + trailPriceFmt + '</div>' +
                    '</div>';
            }
        }

        // ── Метка SMA + зона (янтарная СПЛОШНАЯ, подпись СВЕРХУ) ──
        var smaMarkerHtml = '';
        var smaZoneHtml = '';
        if (_state.strategy === 'mean_reversion' && _state.bbData && totalRange > 0) {
            var smaPrice = _state.bbData.middle;
            var channelWidth = (_state.bbData.upper || 0) - (_state.bbData.lower || 0);
            if (smaPrice && channelWidth > 0) {
                var smaOnBar = isLong
                    ? ((smaPrice - pos.stop) / totalRange) * 100
                    : ((pos.stop - smaPrice) / totalRange) * 100;
                var smaTolPct = parseFloat(_state.smaReturnTolerance);
                if (!isFinite(smaTolPct)) smaTolPct = 5;
                var smaDeepDist = channelWidth * (smaTolPct / 100);
                var smaZonePrice = isLong ? smaPrice + smaDeepDist : smaPrice - smaDeepDist;
                var smaZoneOnBar = isLong
                    ? ((smaZonePrice - pos.stop) / totalRange) * 100
                    : ((pos.stop - smaZonePrice) / totalRange) * 100;

                // Зона — заметнее: opacity 0.25 (было 0.12)
                if (smaOnBar >= 0 && smaOnBar <= 100 && smaZoneOnBar >= 0 && smaZoneOnBar <= 100) {
                    var zoneLeft = Math.min(smaOnBar, smaZoneOnBar);
                    var zoneWidth = Math.abs(smaZoneOnBar - smaOnBar);
                    smaZoneHtml = '<div style="position:absolute;top:0;left:' + zoneLeft.toFixed(1) + '%;width:' + zoneWidth.toFixed(1) + '%;height:100%;background:' + amber + ';opacity:0.25;pointer-events:none;z-index:1;"></div>';
                }

                if (smaOnBar >= 0 && smaOnBar <= 100) {
                    var smaPriceFmt = smaPrice >= 1000 ? smaPrice.toFixed(2)
                                    : smaPrice >= 1    ? smaPrice.toFixed(2)
                                    : smaPrice.toFixed(4);
                    // Подпись СВЕРХУ, чтобы разойтись с TR (у того снизу)
                    smaMarkerHtml =
                        '<div class="bot-w-pos-bar-sma" style="position:absolute;bottom:-2px;left:' + smaOnBar.toFixed(1) + '%;transform:translateX(-50%);pointer-events:none;z-index:3;">' +
                            '<div style="font-size:9px;font-weight:600;line-height:1;margin-bottom:4px;text-align:center;letter-spacing:0.3px;color:' + amber + ';white-space:nowrap;">SMA ' + smaPriceFmt + '</div>' +
                            '<div style="width:1px;height:12px;margin:0 auto;background:' + amber + ';opacity:0.95;"></div>' +
                        '</div>';
                }
            }
        }

        // Форматирование size покороче
        var sizeStr;
        var sizeVal = pos.size || 0;
        if (sizeVal >= 1000) sizeStr = '$' + (sizeVal / 1000).toFixed(1) + 'k';
        else sizeStr = '$' + sizeVal.toFixed(0);

        var entryPriceFmt = pos.entryPrice >= 1000 ? pos.entryPrice.toFixed(2)
                          : pos.entryPrice >= 1    ? pos.entryPrice.toFixed(2)
                          : pos.entryPrice.toFixed(4);

        container.innerHTML = '\
            <div class="bot-w-pos-header">\
                <span class="bot-w-pos-side" style="color:' + sideColor + ';">' + pos.side + ' @ ' + entryPriceFmt + '</span>\
                <span class="bot-w-pos-pnl-big" style="color:' + pnlColor + ';">' + pnlStr + ' <span style="font-size:11px;font-weight:500;opacity:0.75;">(' + pnlPct + '%)</span></span>\
            </div>\
            \
            <div class="bot-w-pos-bar-wrap">\
                <div class="bot-w-pos-bar-track" style="position:relative;overflow:visible;">\
                    <div class="bot-w-pos-bar-fill" style="width:' + progressPct.toFixed(1) + '%;background:' + barColor + ';"></div>\
                    ' + smaZoneHtml + '\
                    ' + trailMarkerHtml + '\
                    ' + smaMarkerHtml + '\
                    <div class="bot-w-pos-bar-thumb" style="left:' + progressPct.toFixed(1) + '%;"></div>\
                </div>\
                <div class="bot-w-pos-bar-labels">\
                    <span style="color:#EF5350;">' + (pos.trailingActive ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;"><polyline points="1,8 3,5 5,6 9,2" stroke="#EF5350" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="6,2 9,2 9,5" stroke="#EF5350" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Трейл ' : 'Стоп ') + pos.stop + '</span>\
                    <span style="color:#26a69a;">Тейк ' + pos.target + '</span>\
                </div>\
            </div>\
            \
            <div class="bot-w-pos-details">\
                <div class="bot-w-pos-detail">\
                    <span class="bot-w-pos-dlabel">Текущая</span>\
                    <span class="bot-w-pos-dval" style="color:' + barColor + ';">' + (_state.currentPrice || '—') + '</span>\
                </div>\
                <div class="bot-w-pos-detail">\
                    <span class="bot-w-pos-dlabel">Размер</span>\
                    <span class="bot-w-pos-dval">' + sizeStr + '</span>\
                </div>\
                <div class="bot-w-pos-detail">\
                    <span class="bot-w-pos-dlabel">Время</span>\
                    <span class="bot-w-pos-dval">' + elapsed + ' мин</span>\
                </div>\
            </div>';
    }

    function renderStatusLine() {
        var section = document.getElementById('botWidgetStatusSection');
        var line = document.getElementById('botWidgetStatusLine');
        if (!section || !line) return;

        if (!_state.running && !_state.paused) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        var isSpot = _state.market === 'spot';

        if (_state.paused) {
            line.innerHTML = 'Пауза — лимит убытков достигнут';
            line.className = 'bot-w-status-line status-paused';
            return;
        }

        if (_state.position) {
            var pos = _state.position;
            var unrealized = pos.unrealizedPnl || 0;
            var pnlStr = (unrealized >= 0 ? '+' : '') + '$' + unrealized.toFixed(2);
            line.innerHTML = pos.side + ' открыт @ ' + pos.entryPrice + ' · ' + pnlStr;
            line.className = 'bot-w-status-line ' + (unrealized >= 0 ? 'status-profit' : 'status-loss');
            return;
        }

        if (_state.levels && _state.levels.length > 0 && _state.currentPrice > 0) {
            var nearest = null;
            var minDist = Infinity;
            _state.levels.forEach(function(l) {
                var dist = Math.abs(_state.currentPrice - l.price) / l.price;
                if (dist < minDist) { minDist = dist; nearest = l; }
            });

            if (nearest) {
                var distPct = (minDist * 100).toFixed(2);
                var isSupport = nearest.type === 'support';
                var levelName = isSupport ? 'поддержки' : 'сопротивления';
                var action = isSupport ? 'LONG' : (isSpot ? 'пропуск' : 'SHORT');

                if (minDist < 0.001) {
                    var volHtml = '';
                    var vol = _state.volumeInfo;
                    if (vol) {
                        var volColor = vol.confirmed ? '#26a69a' : '#636B76';
                        volHtml = '<div class="bot-w-status-vol">' +
                            'Объём: <span style="color:' + volColor + '">' + vol.ratio.toFixed(1) + 'x</span>' +
                            ' (нужно ' + vol.needed.toFixed(1) + 'x)' +
                            '</div>';
                    }
                    line.innerHTML = 'Цена у ' + levelName + ' ' +
                        nearest.price.toLocaleString('en-US') +
                        ' — ожидание объёма для ' + action +
                        volHtml;
                    line.className = 'bot-w-status-line ' + (isSupport ? 'status-long' : 'status-short');
                } else {
                    line.innerHTML = 'Ближайший уровень ' + levelName + ': ' +
                        nearest.price.toLocaleString('en-US') +
                        ' (' + distPct + '%) — ' + action;
                    line.className = 'bot-w-status-line ' + (isSupport ? 'status-long' : 'status-short');
                }
                return;
            }
        }

        line.innerHTML = 'Загрузка данных...';
        line.className = 'bot-w-status-line status-waiting';
    }

    function updateBadge() {
        var badge = document.getElementById('botWidgetBadge');
        if (!badge) return;

        if (_state.paused) {
            badge.className = 'bot-w-badge idle';
            badge.textContent = 'ПАУЗА';
        } else if (_state.running) {
            if (_state.mode === 'paper') {
                badge.className = 'bot-w-badge paper';
                badge.textContent = 'PAPER';
            } else {
                badge.className = 'bot-w-badge live';
                badge.textContent = 'LIVE';
            }
        } else {
            badge.className = 'bot-w-badge idle';
            badge.textContent = 'ВЫКЛ';
        }
    }

    function updateButtons() {
        var startBtn  = document.getElementById('botWidgetStart');
        var stopBtn   = document.getElementById('botWidgetStop');
        var paperBtn  = document.getElementById('botWidgetPaper');
        var resumeBtn = document.getElementById('botWidgetResume');
        var saveBtn   = document.getElementById('botSaveSettings');

        if (!startBtn) return;

        // Кнопка "Сохранить" видна только когда бот запущен
        if (saveBtn) saveBtn.style.display = _state.running ? '' : 'none';

        if (_state.paused) {
            startBtn.style.display  = 'none';
            stopBtn.style.display   = '';
            paperBtn.style.display  = 'none';
            resumeBtn.style.display = '';
        } else if (_state.running) {
            startBtn.style.display  = 'none';
            stopBtn.style.display   = '';
            paperBtn.style.display  = 'none';
            resumeBtn.style.display = 'none';
        } else if (_state.mode) {
            startBtn.style.display  = '';
            stopBtn.style.display   = 'none';
            paperBtn.style.display  = 'none';
            resumeBtn.style.display = 'none';
        } else {
            startBtn.style.display  = 'none';
            stopBtn.style.display   = 'none';
            paperBtn.style.display  = '';
            resumeBtn.style.display = 'none';
        }
    }


    /* ══════════════════════════════════════════
       МОДАЛЬНОЕ ОКНО
       Шаги:
       0 — Приветствие (выбор Paper/Live)
       1 — API ключи Bybit (только для Live)
       2 — Настройки алгоритма (пара, рынок, объём)
       3 — Риск-менеджмент
       4 — Готово + запуск
    ══════════════════════════════════════════ */

    function createBotModal() {
        var modal = document.createElement('div');
        modal.id = 'botModal';
        modal.innerHTML = '\
            <div class="bot-modal-box">\
                <div class="bot-modal-header">\
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">\
                        <rect x="2" y="4" width="10" height="7" rx="1.5" stroke="#26a69a" stroke-width="1"/>\
                        <rect x="4.5" y="5.8" width="2" height="2" rx="0.4" fill="#26a69a"/>\
                        <rect x="7.5" y="5.8" width="2" height="2" rx="0.4" fill="#26a69a"/>\
                        <line x1="7" y1="1.5" x2="7" y2="4" stroke="#26a69a" stroke-width="1"/>\
                        <circle cx="7" cy="1.2" r="0.8" fill="#26a69a"/>\
                    </svg>\
                    <span class="bot-modal-title" id="botModalTitle">Настройки бота</span>\
                    <div class="bot-modal-close" id="botModalClose"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="#636B76" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="#636B76" stroke-width="1.5" stroke-linecap="round"/></svg></div>\
                </div>\
                <div class="bot-modal-body" id="botModalBody"></div>\
                <div class="bot-modal-footer" id="botModalFooter"></div>\
            </div>';
        modal.querySelector('#botModalClose').onclick = closeModal;
        modal.onclick = function(e) { if (e.target === modal) closeModal(); };
        var leftCol = document.querySelector('.left-column');
        if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }
    }


    /* ══ РЕНДЕР НАСТРОЕК — ЕДИНАЯ СТРАНИЦА ══ */

    function renderStep(step) {
        // Backward compat — all calls now go to renderSettings
        renderSettings();
    }

    function renderSettings() {
        var body   = document.getElementById('botModalBody');
        var footer = document.getElementById('botModalFooter');
        if (!body || !footer) return;

        var pairOptions = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT','DOGE/USDT','ADA/USDT','AVAX/USDT','LINK/USDT','DOT/USDT','MATIC/USDT','ARB/USDT','OP/USDT','APT/USDT','SUI/USDT','NEAR/USDT','FIL/USDT','ATOM/USDT','UNI/USDT','LTC/USDT'];
        var pairSelectHtml = pairOptions.map(function(p) {
            return '<option value="' + p + '"' + (p === _state.pair ? ' selected' : '') + '>' + p + '</option>';
        }).join('');

        var rsiOB = parseInt(_state.rsiOverbought) || 65;
        var rsiOS = parseInt(_state.rsiOversold) || 35;

        function togBtn(val, current, label, sub) {
            var active = val === current;
            return '<div class="bst-tog' + (active ? ' bst-tog-on' : '') + '" data-v="' + val + '">' +
                '<div class="bst-tog-label">' + label + '</div>' +
                (sub ? '<div class="bst-tog-sub">' + sub + '</div>' : '') +
                '</div>';
        }

        body.innerHTML = '\
            <div class="bst-scroll">\
                \
                <!-- 1. СТРАТЕГИЯ -->\
                <div class="bst-row bst-row-2" id="bstStrategySeg">' +
                    togBtn('mean_reversion', _state.strategy, 'Mean Reversion', 'BB + RSI') +
                    togBtn('scalper', _state.strategy, 'Скальпер', 'Кластеры + объём') +
                '</div>\
                \
                <!-- 2. ПАРА + ТАЙМФРЕЙМ -->\
                <div class="bst-row bst-row-2">\
                    <div class="bst-col">\
                        <div class="bst-lbl">Пара</div>\
                        <select class="bst-select" id="bstPair">' + pairSelectHtml + '</select>\
                    </div>\
                    <div class="bst-col">\
                        <div class="bst-lbl">Таймфрейм</div>\
                        <div class="bst-row bst-row-2 bst-inner" id="bstTfSeg">' +
                            togBtn('1m', _state.timeframe, '1m', '') +
                            togBtn('5m', _state.timeframe, '5m', '') +
                        '</div>\
                    </div>\
                </div>\
                \
                <!-- 3. НАПРАВЛЕНИЕ + ВХОД -->\
                <div class="bst-row bst-row-2">\
                    <div class="bst-col">\
                        <div class="bst-lbl">Направление</div>\
                        <div class="bst-row bst-row-3 bst-inner" id="bstDirSeg">' +
                            togBtn('both', _state.direction, 'Оба', '') +
                            togBtn('long', _state.direction, 'L', '') +
                            togBtn('short', _state.direction, 'S', '') +
                        '</div>\
                    </div>\
                    <div class="bst-col">\
                        <div class="bst-lbl">Вход</div>\
                        <div class="bst-row bst-row-2 bst-inner" id="bstEntrySeg">' +
                            togBtn('candle', _state.entryMode, 'Свеча', '') +
                            togBtn('tick', _state.entryMode, 'Тик', '') +
                        '</div>\
                    </div>\
                </div>\
                \
                <!-- 4. ПАРАМЕТРЫ СТРАТЕГИИ -->\
                <div class="bst-section">\
                    <div class="bst-section-title">Параметры стратегии</div>\
                    <div class="bst-row bst-row-3">\
                        <div class="bst-col">\
                            <div class="bst-lbl">BB период</div>\
                            <input class="bst-input" id="bstBbPeriod" type="number" min="10" max="50" step="1" value="' + _state.bbPeriod + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">BB множ.</div>\
                            <input class="bst-input" id="bstBbMult" type="number" min="1.0" max="3.0" step="0.1" value="' + _state.bbMultiplier + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">RSI период</div>\
                            <input class="bst-input" id="bstRsiPeriod" type="number" min="5" max="30" step="1" value="' + _state.rsiPeriod + '">\
                        </div>\
                    </div>\
                    \
                    <!-- RSI диапазон (один ползунок — влево строже, вправо мягче) -->\
                    <div class="bst-rsi-wrap">\
                        <div class="bst-rsi-header">\
                            <span class="bst-lbl">RSI диапазон</span>\
                            <span class="bst-rsi-vals"><span class="bst-rsi-os" id="bstRsiOSVal">' + rsiOS + '</span><span class="bst-rsi-dash"> — </span><span class="bst-rsi-ob" id="bstRsiOBVal">' + rsiOB + '</span></span>\
                        </div>\
                        <input type="range" class="bst-rsi-single" id="bstRsiSlider" min="55" max="80" step="1" value="' + rsiOB + '">\
                        <div class="bst-rsi-scale"><span>строже</span><span></span><span>мягче</span></div>\
                    </div>\
                </div>\
                \
                <!-- 5. УПРАВЛЕНИЕ ПОЗИЦИЕЙ -->\
                <div class="bst-section">\
                    <div class="bst-section-title">Управление позицией</div>\
                    <div class="bst-row bst-row-2">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Фильтр объёма</div>\
                            <div class="bst-slider-wrap">\
                                <input type="range" class="bst-slider" id="bstVolSlider" min="1.0" max="3.0" step="0.1" value="' + _state.volumeMultiplier + '">\
                                <span class="bst-slider-val" id="bstVolVal">' + parseFloat(_state.volumeMultiplier).toFixed(1) + 'x</span>\
                            </div>\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Таймаут (свечей)</div>\
                            <div class="bst-stepper" id="bstTimeoutStepper">\
                                <div class="bst-step-btn bst-step-dec"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                <input class="bst-step-input" id="bstTimeout" type="number" min="3" max="60" step="1" value="' + _state.positionTimeout + '">\
                                <div class="bst-step-btn bst-step-inc"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="2,0 8,4 2,8"/></svg></div>\
                            </div>\
                        </div>\
                    </div>\
                    <div class="bst-row bst-row-3">\
                        <div class="bst-col" id="bstTakeProfitCol" style="' + (_state.bbExitEnabled ? 'opacity:0.55;pointer-events:none;' : '') + '">\
                            <div class="bst-lbl">Тейк-профит %</div>\
                            <input class="bst-input" id="bstTakeProfit" type="number" min="0.1" max="5" step="0.05" value="' + _state.maxProfitPct + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Cooldown</div>\
                            <input class="bst-input" id="bstCooldown" type="number" min="1" max="20" step="1" value="' + _state.cooldownCandles + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Стоп (×ATR)</div>\
                            <input class="bst-input" id="bstStopAtr" type="number" min="0.5" max="5" step="0.1" value="' + _state.stopAtrMultiplier + '">\
                        </div>\
                    </div>\
                </div>\
                \
                <!-- 6. ТРЕЙЛИНГ-СТОП -->\
                <div class="bst-section" id="bstTrailSection">\
                    <div class="bst-trail-header">\
                        <span class="bst-section-label">Трейлинг-стоп</span>\
                        <label class="bst-switch">\
                            <input type="checkbox" id="bstTrailToggle" ' + (_state.trailingEnabled ? 'checked' : '') + (_state.bbExitEnabled ? ' disabled' : '') + '>\
                            <span class="bst-switch-slider"></span>\
                        </label>\
                    </div>\
                    <div class="bst-trail-body" id="bstTrailBody" style="' + ((_state.trailingEnabled && !_state.bbExitEnabled) ? '' : 'opacity:0.55;pointer-events:none;') + '">\
                        <div class="bst-row bst-row-2">\
                            <div class="bst-col">\
                                <div class="bst-lbl">Отступ трейла</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstTrailOffset" data-step="0.05" data-min="0.05"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstTrailOffset" type="number" min="0.05" max="1.0" step="0.05" value="' + _state.trailingOffset + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstTrailOffset" data-step="0.05" data-max="1.0">▶</div>\
                                </div>\
                            </div>\
                            <div class="bst-col">\
                                <div class="bst-lbl">Активация</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstTrailAct" data-step="5" data-min="30"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstTrailAct" type="number" min="30" max="95" step="5" value="' + _state.trailingActivation + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstTrailAct" data-step="5" data-max="95">▶</div>\
                                </div>\
                            </div>\
                        </div>\
                    </div>\
                </div>\
                \
                <!-- 6b. ВЫХОД ПО ПРОТИВОПОЛОЖНОЙ BB (MR) -->\
                <div class="bst-section" id="bstBbExitSection">\
                    <div class="bst-trail-header">\
                        <span class="bst-section-label">Выход по противоположной BB</span>\
                        <label class="bst-switch">\
                            <input type="checkbox" id="bstBbExitToggle" ' + (_state.bbExitEnabled ? 'checked' : '') + '>\
                            <span class="bst-switch-slider"></span>\
                        </label>\
                    </div>\
                    <div class="bst-trail-body" id="bstBbExitBody" style="' + (_state.bbExitEnabled ? '' : 'opacity:0.55;pointer-events:none;') + '">\
                        <div class="bst-row bst-row-2">\
                            <div class="bst-col">\
                                <div class="bst-lbl">Толеранс касания BB (% канала)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstBbTol" data-step="1" data-min="0"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstBbTol" type="number" min="0" max="20" step="1" value="' + (_state.bbExitTolerance != null ? _state.bbExitTolerance : 5) + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstBbTol" data-step="1" data-max="20">▶</div>\
                                </div>\
                            </div>\
                            <div class="bst-col">\
                                <div class="bst-lbl">Толеранс захода за SMA (% канала)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstSmaTol" data-step="1" data-min="0"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstSmaTol" type="number" min="0" max="20" step="1" value="' + (_state.smaReturnTolerance != null ? _state.smaReturnTolerance : 5) + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstSmaTol" data-step="1" data-max="20">▶</div>\
                                </div>\
                            </div>\
                        </div>\
                        <div style="font-size:10px;color:#636B76;margin-top:6px;line-height:1.4;">При включении — цель выхода = противоположная BB, минимальный тейк-профит и трейлинг отключаются автоматически.</div>\
                    </div>\
                </div>\
                \
                <!-- 7. РИСК-МЕНЕДЖМЕНТ -->\
                <div class="bst-section">\
                    <div class="bst-section-title">Риск-менеджмент</div>\
                    <div class="bst-row bst-row-2">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Риск на сделку %</div>\
                            <input class="bst-input" id="bstRiskPct" type="number" min="0.5" max="10" step="0.5" value="' + _state.riskPct + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Макс. плечо</div>\
                            <div class="bst-stepper bst-stepper-lev">\
                                <div class="bst-step-btn bst-step-dec" data-target="bstLeverage" data-step="1" data-min="1"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                <input class="bst-step-input bst-lev-val" id="bstLeverage" type="number" min="1" max="10" step="1" value="' + _state.maxLeverage + '">\
                                <div class="bst-step-btn bst-step-inc" data-target="bstLeverage" data-step="1" data-max="10">▶</div>\
                            </div>\
                        </div>\
                    </div>\
                    <div class="bst-row bst-row-2">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Дневной лимит %</div>\
                            <input class="bst-input" id="bstDayLimit" type="number" min="1" max="50" step="0.5" value="' + _state.dayLimitPct + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Пауза после потерь</div>\
                            <input class="bst-input" id="bstMaxLosses" type="number" min="1" max="10" step="1" value="' + _state.maxLosses + '">\
                        </div>\
                    </div>\
                </div>\
                \
                <!-- 8. БАЛАНС + РЕЖИМ -->\
                <div class="bst-section">\
                    <div class="bst-row bst-row-2">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Баланс (USDT)</div>\
                            <input class="bst-input" id="bstBalance" type="number" min="100" step="100" value="' + (_state.virtualBalance || 10000) + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Режим</div>\
                            <div class="bst-row bst-row-2 bst-inner" id="bstModeSeg">' +
                                togBtn('paper', _state.mode || 'paper', 'Paper', '') +
                                togBtn('live', _state.mode, 'Live', '') +
                            '</div>\
                        </div>\
                    </div>\
                </div>\
                \
                <!-- Push-уведомления -->\
                <div class="bst-section">\
                    <div class="bst-notif-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">\
                        <div class="bst-notif-info" style="flex:1;min-width:0;">\
                            <div class="bst-notif-title" style="font-size:13px;color:#E2E8F0;font-weight:500;line-height:1.3;">Push-уведомления</div>\
                            <div class="bst-notif-sub" style="font-size:11px;color:rgba(226,232,240,0.5);line-height:1.3;margin-top:2px;">Уведомлять о сделках и остановке бота</div>\
                        </div>\
                        <label class="bst-switch" style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0;">\
                            <input type="checkbox" id="bstNotify"' + (_state.notifyEnabled !== false ? ' checked' : '') + ' style="opacity:0;width:0;height:0;">\
                            <span class="bst-switch-slider" style="position:absolute;cursor:pointer;inset:0;background:' + (_state.notifyEnabled !== false ? '#26a69a' : 'rgba(255,255,255,0.12)') + ';border-radius:24px;transition:background 0.2s;"><span style="position:absolute;height:18px;width:18px;left:' + (_state.notifyEnabled !== false ? '21px' : '3px') + ';top:3px;background:#E2E8F0;border-radius:50%;transition:left 0.2s;display:block;"></span></span>\
                        </label>\
                    </div>\
                    <div class="bst-notif-test" id="bstNotifyTest" style="margin-top:10px;padding:8px 12px;border:0.5px solid rgba(255,255,255,0.12);border-radius:5px;background:rgba(255,255,255,0.02);font-size:12px;color:rgba(226,232,240,0.75);text-align:center;cursor:pointer;user-select:none;transition:border-color 0.15s, background 0.15s, color 0.15s;">Отправить тестовое уведомление</div>\
                </div>\
                \
                <!-- 9. СВОДКА -->\
                <div class="bst-section">\
                    <div class="bst-section-title">Сводка</div>\
                    <div class="bst-summary" id="bstSummary"></div>\
                </div>\
            </div>';

        // ── Кнопка запуска (fixed footer) ──
        footer.innerHTML = '<div class="bst-launch-btn" id="bstLaunchBtn"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="vertical-align:-1px;"><polygon points="1,0 10,5 1,10"/></svg> Запустить бота</div>';

        // ══════════════════════════════════════
        // EVENT BINDING
        // ══════════════════════════════════════

        function bindToggleGroup(containerId, stateKey, onChange) {
            var container = body.querySelector('#' + containerId);
            if (!container) return;
            container.querySelectorAll('.bst-tog').forEach(function(el) {
                el.onclick = function() {
                    container.querySelectorAll('.bst-tog').forEach(function(o) { o.classList.remove('bst-tog-on'); });
                    el.classList.add('bst-tog-on');
                    _state[stateKey] = el.dataset.v;
                    if (onChange) onChange(el.dataset.v);
                    updateSummary();
                };
            });
        }

        bindToggleGroup('bstStrategySeg', 'strategy');
        bindToggleGroup('bstTfSeg', 'timeframe');
        bindToggleGroup('bstDirSeg', 'direction');
        bindToggleGroup('bstEntrySeg', 'entryMode');
        bindToggleGroup('bstModeSeg', 'mode', function(v) { setMode(v); });

        // Pair select
        var pairSel = body.querySelector('#bstPair');
        if (pairSel) pairSel.onchange = function() { _state.pair = pairSel.value; updateSummary(); };

        // RSI slider (single thumb — value = overbought, 100-value = oversold)
        var rsiSlider = body.querySelector('#bstRsiSlider');
        if (rsiSlider) rsiSlider.oninput = function() {
            var ob = parseInt(rsiSlider.value);
            var os = 100 - ob;
            _state.rsiOverbought = String(ob);
            _state.rsiOversold = String(os);
            var obEl = body.querySelector('#bstRsiOBVal');
            var osEl = body.querySelector('#bstRsiOSVal');
            if (obEl) obEl.textContent = ob;
            if (osEl) osEl.textContent = os;
            updateSummary();
        };

        // Volume slider
        var volSlider = body.querySelector('#bstVolSlider');
        if (volSlider) volSlider.oninput = function() {
            _state.volumeMultiplier = volSlider.value;
            body.querySelector('#bstVolVal').textContent = parseFloat(volSlider.value).toFixed(1) + 'x';
            updateSummary();
        };

        // Trailing toggle
        var trailToggle = body.querySelector('#bstTrailToggle');
        if (trailToggle) trailToggle.onchange = function() {
            _state.trailingEnabled = trailToggle.checked;
            var tb = body.querySelector('#bstTrailBody');
            if (tb) {
                tb.style.opacity = trailToggle.checked ? '1' : '0.55';
                tb.style.pointerEvents = trailToggle.checked ? 'auto' : 'none';
            }
            updateSummary();
        };

        // BB-Exit toggle: включение блокирует trailing и take-profit поля
        var bbExitToggle = body.querySelector('#bstBbExitToggle');
        if (bbExitToggle) bbExitToggle.onchange = function() {
            var on = bbExitToggle.checked;
            _state.bbExitEnabled = on;

            // Тело секции BB
            var bbBody = body.querySelector('#bstBbExitBody');
            if (bbBody) {
                bbBody.style.opacity = on ? '1' : '0.55';
                bbBody.style.pointerEvents = on ? 'auto' : 'none';
            }

            // Если включили BB — принудительно отключаем trailing и блокируем его тумблер
            if (on && trailToggle) {
                trailToggle.checked = false;
                trailToggle.disabled = true;
                _state.trailingEnabled = false;
                var tbody = body.querySelector('#bstTrailBody');
                if (tbody) {
                    tbody.style.opacity = '0.55';
                    tbody.style.pointerEvents = 'none';
                }
            } else if (trailToggle) {
                trailToggle.disabled = false;
            }

            // Блокируем/разблокируем поле Тейк-профит
            var tpCol = body.querySelector('#bstTakeProfitCol');
            if (tpCol) {
                tpCol.style.opacity = on ? '0.55' : '';
                tpCol.style.pointerEvents = on ? 'none' : '';
            }

            updateSummary();
        };

        // Steppers (generic)
        body.querySelectorAll('.bst-step-btn').forEach(function(btn) {
            btn.onclick = function() {
                var targetId = btn.dataset.target;
                if (!targetId) {
                    // For timeout stepper without data attrs
                    var inp = btn.parentElement.querySelector('.bst-step-input');
                    if (!inp) return;
                    var step = parseFloat(inp.step) || 1;
                    var min = parseFloat(inp.min) || 0;
                    var max = parseFloat(inp.max) || 999;
                    var cur = parseFloat(inp.value) || 0;
                    var isInc = btn.classList.contains('bst-step-inc');
                    inp.value = Math.max(min, Math.min(max, isInc ? cur + step : cur - step));
                    inp.dispatchEvent(new Event('change'));
                    updateSummary();
                    return;
                }
                var input = body.querySelector('#' + targetId);
                if (!input) return;
                var s = parseFloat(btn.dataset.step) || 1;
                var mn = parseFloat(btn.dataset.min) || 0;
                var mx = parseFloat(btn.dataset.max) || 999;
                var c = parseFloat(input.value) || 0;
                var isInc = btn.classList.contains('bst-step-inc');
                var nv = isInc ? c + s : c - s;
                // Round to avoid floating point issues
                nv = Math.round(nv * 100) / 100;
                input.value = Math.max(mn, Math.min(mx, nv));
                input.dispatchEvent(new Event('change'));
                updateSummary();
            };
        });

        // Timeout stepper
        var timeoutInput = body.querySelector('#bstTimeout');
        if (timeoutInput) timeoutInput.onchange = function() { _state.positionTimeout = timeoutInput.value; updateSummary(); };

        // All input fields sync to state on change
        var inputMap = {
            bstBbPeriod: 'bbPeriod', bstBbMult: 'bbMultiplier', bstRsiPeriod: 'rsiPeriod',
            bstTakeProfit: 'maxProfitPct', bstCooldown: 'cooldownCandles', bstStopAtr: 'stopAtrMultiplier',
            bstRiskPct: 'riskPct', bstDayLimit: 'dayLimitPct', bstMaxLosses: 'maxLosses',
            bstBalance: 'virtualBalance', bstTrailOffset: 'trailingOffset', bstTrailAct: 'trailingActivation',
            bstLeverage: 'maxLeverage',
            bstBbTol: 'bbExitTolerance', bstSmaTol: 'smaReturnTolerance'
        };
        Object.keys(inputMap).forEach(function(id) {
            var inp = body.querySelector('#' + id);
            if (inp) {
                inp.onchange = function() { _state[inputMap[id]] = inp.value; updateSummary(); };
                inp.oninput = function() { _state[inputMap[id]] = inp.value; updateSummary(); };
            }
        });

        // ── Push-уведомления: тумблер ──
        var notifyEl = body.querySelector('#bstNotify');
        if (notifyEl) {
            notifyEl.onchange = function() {
                _state.notifyEnabled = !!notifyEl.checked;
                // Визуальная синхронизация тумблера (inline, без CSS)
                var slider = notifyEl.parentElement.querySelector('.bst-switch-slider');
                if (slider) {
                    slider.style.background = notifyEl.checked ? '#26a69a' : 'rgba(255,255,255,0.12)';
                    var knob = slider.querySelector('span');
                    if (knob) knob.style.left = notifyEl.checked ? '21px' : '3px';
                }
                // Если бот уже запущен — сразу применяем на сервере
                var uid   = (window.currentUser && window.currentUser.uid) || 'anonymous';
                var botId = _state.botId || 'default';
                if (_state.running) {
                    fetch('/api/bot/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid: uid, botId: botId, enabled: _state.notifyEnabled })
                    }).catch(function() {});
                }
            };
        }

        // ── Push-уведомления: кнопка "Отправить тестовое" ──
        var notifyTestEl = body.querySelector('#bstNotifyTest');
        if (notifyTestEl) {
            notifyTestEl.onclick = function() {
                var uid   = (window.currentUser && window.currentUser.uid) || 'anonymous';
                var botId = _state.botId || 'default';
                notifyTestEl.classList.add('bst-notif-test-busy');
                var origText = notifyTestEl.textContent;
                notifyTestEl.textContent = 'Отправляю...';
                fetch('/api/bot/test-notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uid, botId: botId })
                })
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    notifyTestEl.textContent = d && d.ok ? 'Отправлено ✓' : 'Ошибка';
                    setTimeout(function() {
                        notifyTestEl.textContent = origText;
                        notifyTestEl.classList.remove('bst-notif-test-busy');
                    }, 2000);
                })
                .catch(function() {
                    notifyTestEl.textContent = 'Ошибка';
                    setTimeout(function() {
                        notifyTestEl.textContent = origText;
                        notifyTestEl.classList.remove('bst-notif-test-busy');
                    }, 2000);
                });
            };
        }

        // Launch button
        footer.querySelector('#bstLaunchBtn').onclick = function() {
            // Ensure mode is set
            if (!_state.mode) _state.mode = 'paper';
            startBot();
            closeModal();
        };

        // Initial summary
        updateSummary();
    }


    function updateSummary() {
        var el = document.getElementById('bstSummary');
        if (!el) return;

        var stratLabel = _state.strategy === 'mean_reversion' ? 'Mean Reversion (BB+RSI)' : 'Скальпер (Кластеры)';
        var dirLabel = _state.direction === 'both' ? 'Оба' : (_state.direction === 'long' ? 'Long' : 'Short');
        var entryLabel = _state.entryMode === 'tick' ? 'По тику' : 'По свече';
        var trailLabel = _state.trailingEnabled
            ? 'Вкл (' + parseFloat(_state.trailingOffset).toFixed(2) + '%, акт. ' + _state.trailingActivation + '%)'
            : 'Выкл';
        var modeLabel = (_state.mode === 'live' ? 'Live' : 'Paper');

        var rsiOS = 100 - (parseInt(_state.rsiOverbought) || 65);
        var rsiOB = parseInt(_state.rsiOverbought) || 65;

        el.innerHTML = '\
            <div class="bst-sum-row"><span class="bst-sum-key">Стратегия</span><span class="bst-sum-val bst-sum-accent">' + stratLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Пара / ТФ</span><span class="bst-sum-val">' + _state.pair + ' · ' + _state.timeframe + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Направление / Вход</span><span class="bst-sum-val">' + dirLabel + ' · ' + entryLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">RSI</span><span class="bst-sum-val"><span class="bst-rsi-os">' + rsiOS + '</span><span class="bst-rsi-dash"> / </span><span class="bst-rsi-ob">' + rsiOB + '</span></span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Стоп / Тейк</span><span class="bst-sum-val">' + _state.stopAtrMultiplier + '× ATR / ' + _state.maxProfitPct + '%</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Трейлинг</span><span class="bst-sum-val ' + (_state.trailingEnabled ? 'bst-sum-accent' : '') + '">' + trailLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Риск / Плечо</span><span class="bst-sum-val">' + _state.riskPct + '% / ' + _state.maxLeverage + 'x</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Баланс</span><span class="bst-sum-val">' + (parseFloat(_state.virtualBalance) || 10000) + ' USDT · ' + modeLabel + '</span></div>';
    }


    /* ══════════════════════════════════════════
       ДЕЙСТВИЯ: СТАРТ / СТОП / РЕЗЮМЕ
    ══════════════════════════════════════════ */

    function getUid() {
        return (window.firebase && window.firebase.auth && window.firebase.auth().currentUser)
            ? window.firebase.auth().currentUser.uid : 'anonymous';
    }

    function startBot() {
        if (_state._starting) return; // защита от двойного клика
        _state._starting = true;

        var uid = getUid();
        var startBtn = document.getElementById('botWidgetStart');
        if (startBtn) { startBtn.disabled = true; startBtn.textContent = '...'; }

        fetch('/api/bot/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: uid,
                botId: _state.botId,
                mode: _state.mode,
                market: _state.market,
                pair: _state.pair,
                timeframe: _state.timeframe,
                riskPct: _state.riskPct,
                dayLimitPct: _state.dayLimitPct,
                maxLosses: _state.maxLosses,
                maxLeverage: _state.market === 'spot' ? '1' : _state.maxLeverage,
                volumeMultiplier: _state.volumeMultiplier,
                positionTimeout: _state.positionTimeout,
                virtualBalance: _state.virtualBalance,
                trailingEnabled: _state.trailingEnabled,
                trailingOffset: _state.trailingOffset,
                trailingActivation: _state.trailingActivation,
                maxProfitPct: _state.maxProfitPct,
                cooldownCandles: _state.cooldownCandles,
                stopAtrMultiplier: _state.stopAtrMultiplier,
                clusterExitConfirm: _state.clusterExitConfirm,
                strategy: _state.strategy,
                direction: _state.direction,
                entryMode: _state.entryMode,
                bbPeriod: _state.bbPeriod,
                bbMultiplier: _state.bbMultiplier,
                rsiPeriod: _state.rsiPeriod,
                rsiOverbought: _state.rsiOverbought,
                rsiOversold: _state.rsiOversold,
                bbExitEnabled: !!_state.bbExitEnabled,
                bbExitTolerance: _state.bbExitTolerance,
                smaReturnTolerance: _state.smaReturnTolerance,
                notifyEnabled: _state.notifyEnabled !== false,
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _state._starting = false;
            var startBtn = document.getElementById('botWidgetStart');
            if (startBtn) { startBtn.disabled = false; }
            if (data.ok) {
                if (data.botId) _state.botId = data.botId;
                _state.running = true;
                _state.paused = false;
                updateBadge();
                updateButtons();
                startStatusPolling(uid);
                loadBotList();
                // Начинаем рисовать уровни бота на графике
                window._botCurrentBotId = _state.botId;
                if (typeof window._startBotLevels === 'function') window._startBotLevels();
            } else {
                alert('Ошибка запуска: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) {
            _state._starting = false;
            var startBtn = document.getElementById('botWidgetStart');
            if (startBtn) { startBtn.disabled = false; }
            updateButtons();
            console.warn('[BOT] start error', e);
        });
    }

    function stopBot() {
        var uid = getUid();

        fetch('/api/bot/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId })
        })
        .then(function() {
            _state.running = false;
            _state.paused = false;
            _state.position = null;
            updateBadge();
            updateButtons();
            renderPosition();
            stopStatusPolling();
            loadBotList();
            // Убираем уровни бота с графика
            if (typeof window._stopBotLevels === 'function') window._stopBotLevels();
        })
        .catch(function(e) { console.warn('[BOT] stop error', e); });
    }

    /* ══════════════════════════════════════════
       МАССОВАЯ ОСТАНОВКА ВСЕХ АКТИВНЫХ БОТОВ
       - confirmStopAll: модалка подтверждения
       - doStopAll: последовательный стоп с индикатором прогресса
       После всех стопов шлёт ОДИН сводный push
    ══════════════════════════════════════════ */
    function confirmStopAll() {
        // Удаляем старую модалку если вдруг осталась
        var old = document.getElementById('botStopAllModal');
        if (old) old.remove();

        // Считаем только запущенных ботов
        var running = (_state.bots || []).filter(function(b) { return b.running; });
        var count = running.length;

        // Если запущенных нет — мигаем иконкой и выходим
        if (count === 0) {
            var btn = document.getElementById('botStopAllBtn');
            if (btn) {
                btn.style.opacity = '1';
                setTimeout(function() { btn.style.opacity = '0.5'; }, 800);
            }
            return;
        }

        // Считаем суммарный дневной PnL
        var dayPnlTotal = running.reduce(function(s, b) { return s + (b.dayPnl || 0); }, 0);
        var pnlSign = dayPnlTotal >= 0 ? '+' : '−';
        var pnlAbs = Math.abs(dayPnlTotal).toFixed(2);

        // Склонение "бот/бота/ботов"
        var word = pluralBotsRu(count);

        var modal = document.createElement('div');
        modal.id = 'botStopAllModal';
        modal.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = '\
            <div style="background:#1A1D23;border-radius:12px;border:1px solid rgba(255,255,255,0.08);width:90%;max-width:380px;padding:20px;">\
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">\
                        <rect x="1.5" y="3.5" width="6" height="9" rx="1" stroke="#EF4444" stroke-width="1.2" fill="none"/>\
                        <rect x="8.5" y="3.5" width="6" height="9" rx="1" stroke="#EF4444" stroke-width="1.2" fill="none"/>\
                    </svg>\
                    <span style="font-size:14px;font-weight:700;color:#E2E8F0;">Остановить всех ботов?</span>\
                </div>\
                <div style="font-size:13px;color:#94A3B8;line-height:1.5;margin-bottom:18px;">\
                    Будет остановлено <span style="color:#E2E8F0;font-weight:600;">' + count + ' ' + word + '</span>.<br>\
                    Суммарный P&L за сегодня: <span style="color:' + (dayPnlTotal >= 0 ? '#10B981' : '#EF4444') + ';font-weight:600;">' + pnlSign + '$' + pnlAbs + '</span>\
                </div>\
                <div id="botStopAllProgress" style="display:none;margin-bottom:14px;">\
                    <div style="font-size:12px;color:#94A3B8;margin-bottom:6px;">Останавливаю: <span id="botStopAllCounter">0 / ' + count + '</span></div>\
                    <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">\
                        <div id="botStopAllBar" style="height:100%;width:0%;background:#EF4444;transition:width 0.2s;"></div>\
                    </div>\
                </div>\
                <div style="display:flex;gap:8px;justify-content:flex-end;" id="botStopAllActions">\
                    <button id="botStopAllCancel" style="padding:8px 14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94A3B8;font-size:12px;cursor:pointer;">Отмена</button>\
                    <button id="botStopAllConfirm" style="padding:8px 14px;background:#EF4444;border:none;border-radius:5px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Остановить все</button>\
                </div>\
            </div>';

        var leftCol = document.querySelector('.left-col') || document.body;
        if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }

        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#botStopAllCancel').onclick = function() { modal.remove(); };
        modal.querySelector('#botStopAllConfirm').onclick = function() {
            doStopAll(running, modal);
        };
    }

    // Склонение для русского: 1 бот, 2-4 бота, 5+ ботов
    function pluralBotsRu(n) {
        var n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return 'бот';
        if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return 'бота';
        return 'ботов';
    }

    // Последовательный стоп с паузой 200мс + сводный push в конце
    function doStopAll(runningBots, modal) {
        var uid = getUid();
        var total = runningBots.length;

        // Считаем суммарный PnL до старта (сервер закроет позиции и PnL изменится)
        var dayPnlTotal = runningBots.reduce(function(s, b) { return s + (b.dayPnl || 0); }, 0);

        // Показываем прогресс, прячем кнопки
        modal.querySelector('#botStopAllProgress').style.display = 'block';
        modal.querySelector('#botStopAllActions').style.display = 'none';

        var counterEl = modal.querySelector('#botStopAllCounter');
        var barEl = modal.querySelector('#botStopAllBar');

        // Рекурсивный последовательный стоп с задержкой 200мс
        var i = 0;
        function stopNext() {
            if (i >= total) {
                // Все остановлены — шлём сводный push
                fetch('/api/bot/notify-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uid, count: total, dayPnlTotal: dayPnlTotal })
                }).catch(function() {});

                // Обновляем локальный state, UI, список
                if (_state.running) {
                    _state.running = false;
                    _state.paused = false;
                    _state.position = null;
                    updateBadge();
                    updateButtons();
                    renderPosition();
                    stopStatusPolling();
                    if (typeof window._stopBotLevels === 'function') window._stopBotLevels();
                }
                loadBotList();

                // Закрываем модалку с небольшой задержкой чтобы пользователь увидел 100%
                setTimeout(function() { if (modal.parentNode) modal.remove(); }, 500);
                return;
            }

            var bot = runningBots[i];
            fetch('/api/bot/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: bot.botId, silent: true })
            })
            .catch(function(e) { console.warn('[BOT] stop-all error for', bot.botId, e); })
            .finally(function() {
                i++;
                if (counterEl) counterEl.textContent = i + ' / ' + total;
                if (barEl) barEl.style.width = (i / total * 100) + '%';
                setTimeout(stopNext, 200);
            });
        }
        stopNext();
    }

    function resumeBot() {
        var uid = getUid();

        fetch('/api/bot/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.running = true;
                _state.paused = false;
                updateBadge();
                updateButtons();
            }
        })
        .catch(function(e) { console.warn('[BOT] resume error', e); });
    }

    function manualTrade(side) {
        var uid = getUid();
        fetch('/api/bot/manual-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId, side: side })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                pollStatus(uid);
            } else {
                console.warn('[BOT] manual trade error:', data.error);
            }
        })
        .catch(function(e) { console.warn('[BOT] manual trade error', e); });
    }

    function manualClose() {
        var uid = getUid();
        fetch('/api/bot/manual-close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.position = null;
                renderManualButtons();
                renderPosition();
                pollStatus(uid);
            } else {
                alert('Ошибка закрытия: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) { alert('Ошибка закрытия: ' + e.message); });
    }


    /* ══════════════════════════════════════════
       ЖУРНАЛ СДЕЛОК БОТА
    ══════════════════════════════════════════ */

    function openJournal(showAll) {
        var uid = getUid();
        var url = showAll
            ? '/api/bot/trades-all?uid=' + uid + '&limit=200'
            : '/api/bot/trades?uid=' + uid + '&botId=' + _state.botId + '&limit=200';
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var trades = (data && data.trades) ? data.trades : [];
                showJournalModal(trades, !!showAll);
            })
            .catch(function() { showJournalModal([], !!showAll); });
    }

    function showJournalModal(trades, isAllBots) {
        // Удаляем старый если есть
        var old = document.getElementById('botJournalModal');
        if (old) old.remove();

        // Статистика
        var totalTrades = trades.length;
        var wins = trades.filter(function(t) { return t.pnl > 0; });
        var losses = trades.filter(function(t) { return t.pnl <= 0; });
        var totalPnl = trades.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
        var totalFees = trades.reduce(function(s, t) { return s + (t.fee || 0); }, 0);
        var winRate = totalTrades > 0 ? Math.round(wins.length / totalTrades * 100) : 0;
        var avgPnl = totalTrades > 0 ? (totalPnl / totalTrades) : 0;
        var best = trades.length ? Math.max.apply(null, trades.map(function(t) { return t.pnl || 0; })) : 0;
        var worst = trades.length ? Math.min.apply(null, trades.map(function(t) { return t.pnl || 0; })) : 0;

        var reasonMap = {
            'stop_loss': 'Стоп', 'take_profit': 'Тейк', 'timeout': 'Таймаут',
            'manual_stop': 'Стоп бота', 'trailing_stop': 'Трейлинг', 'cluster_exit': 'Кластер',
            'manual_close': 'Ручной', 'bb_touch': 'BB', 'sma_return': 'SMA'
        };

        // Колонка бота — всегда видна с полным лейблом
        var botColHeader = '<th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Бот</th>';

        // Строим таблицу
        var rowsHtml = '';
        var colSpan = 11;
        if (trades.length === 0) {
            rowsHtml = '<tr><td colspan="' + colSpan + '" style="text-align:center;color:#475569;padding:20px;">Сделок пока нет</td></tr>';
        } else {
            trades.forEach(function(t, i) {
                var openTime = t.openedAt ? new Date(t.openedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
                var closeTime = t.closedAt ? new Date(t.closedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
                var sideColor = t.side === 'SHORT' ? '#EF5350' : '#26a69a';
                var pnlColor = t.pnl >= 0 ? '#10B981' : '#EF4444';
                var reason = reasonMap[t.reason] || t.reason || '—';
                var entryP = t.entryPrice ? t.entryPrice.toFixed(2) : '—';
                var exitP = t.closePrice ? t.closePrice.toFixed(2) : '—';
                var pnlPct = t.pnlPct !== undefined ? ('(' + (t.pnlPct >= 0 ? '+' : '') + t.pnlPct + '%)') : '';
                var entryLabel = t.entryType === 'manual' ? 'Ручной' : (t.entryType === 'bot_tick' ? 'Бот (тик)' : 'Бот');
                var entryColor = t.entryType === 'manual' ? '#FBBF24' : '#3B82F6';
                var botCol = '<td style="padding:6px 4px;font-size:9px;color:#94A3B8;vertical-align:top;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (t.botLabel || '—') + '">' + (t.botLabel || '—') + '</td>';
                // Детали строка
                var details = [];
                if (t.entryRsi != null) details.push('RSI: ' + t.entryRsi);
                if (t.entryClusterBuy != null) details.push('Класт.вх: B' + t.entryClusterBuy + '%');
                if (t.exitClusterBuy != null) details.push('Класт.вых: B' + t.exitClusterBuy + '%');
                if (t.entryAtr != null) details.push('ATR: ' + t.entryAtr);
                if (t.maxUnrealized) details.push('Макс.+$' + t.maxUnrealized.toFixed(2));
                if (t.maxDrawdown) details.push('Макс.-$' + Math.abs(t.maxDrawdown).toFixed(2));
                if (t.durationMin != null) details.push(t.durationMin + ' мин');
                if (t.strategy) details.push(t.strategy === 'mean_reversion' ? 'MR' : 'Scalp');
                if (t.clusterEntryUsed) details.push('Класт.фильтр');
                var detailsHtml = details.length ? '<div style="font-size:8px;color:#475569;margin-top:2px;">' + details.join(' · ') + '</div>' : '';

                rowsHtml += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">' +
                    '<td style="padding:6px 4px;color:#636B76;font-size:10px;vertical-align:top;">' + (i + 1) + '</td>' +
                    botCol +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + (t.pair || '—') + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + openTime + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + closeTime + '</td>' +
                    '<td style="padding:6px 4px;vertical-align:top;"><span style="color:' + sideColor + ';font-weight:600;font-size:10px;">' + (t.side || '—') + '</span></td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:' + entryColor + ';vertical-align:top;">' + entryLabel + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + entryP + ' → ' + exitP + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:' + pnlColor + ';font-weight:600;vertical-align:top;">' + (t.pnl >= 0 ? '+' : '') + '$' + (t.pnl || 0).toFixed(2) + ' <span style="font-weight:400;font-size:9px;">' + pnlPct + '</span></td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#636B76;vertical-align:top;">$' + (t.fee || 0).toFixed(2) + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + reason + detailsHtml + '</td>' +
                    '</tr>';
            });
        }

        // Кнопка переключения
        var toggleBtnLabel = isAllBots ? 'Этот бот' : 'Все боты';
        var toggleBtnColor = isAllBots ? '#26a69a' : '#94A3B8';

        var modal = document.createElement('div');
        modal.id = 'botJournalModal';
        modal.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = '\
            <div style="background:#1A1D23;border-radius:12px;border:1px solid rgba(255,255,255,0.08);width:90%;max-width:900px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">\
                <div style="padding:14px 18px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.06);">\
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#26a69a" stroke-width="1.2" fill="none"/><line x1="5" y1="4.5" x2="11" y2="4.5" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/><line x1="5" y1="7" x2="11" y2="7" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/><line x1="5" y1="9.5" x2="9" y2="9.5" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/></svg>\
                    <span style="font-size:13px;font-weight:700;color:#E2E8F0;flex:1;">Журнал сделок</span>\
                    <div id="botJournalCsv" style="cursor:pointer;font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);color:#94A3B8;transition:all 0.2s;display:flex;align-items:center;gap:4px;" title="Скачать CSV"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v6M2.5 4.5L5 7l2.5-2.5M1 8.5h8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>CSV</div>\
                    <div id="botJournalToggle" style="cursor:pointer;font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);color:' + toggleBtnColor + ';transition:all 0.2s;">' + toggleBtnLabel + '</div>\
                    <div id="botJournalClose" style="cursor:pointer;color:#636B76;padding:0 4px;display:flex;align-items:center;"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="#636B76" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="#636B76" stroke-width="1.5" stroke-linecap="round"/></svg></div>\
                </div>\
                <div style="padding:12px 18px;display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.04);">\
                    <div style="font-size:10px;color:#636B76;">Сделок <span style="color:#E2E8F0;font-weight:700;">' + totalTrades + '</span></div>\
                    <div style="font-size:10px;color:#636B76;">Win rate <span style="color:' + (winRate >= 50 ? '#10B981' : '#EF4444') + ';font-weight:700;">' + winRate + '%</span></div>\
                    <div style="font-size:10px;color:#636B76;">P&L <span style="color:' + (totalPnl >= 0 ? '#10B981' : '#EF4444') + ';font-weight:700;">' + (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2) + '</span></div>\
                    <div style="font-size:10px;color:#636B76;">Комиссии <span style="color:#FBBF24;font-weight:700;">$' + totalFees.toFixed(2) + '</span></div>\
                    <div style="font-size:10px;color:#636B76;">Сред. <span style="color:#94A3B8;font-weight:700;">' + (avgPnl >= 0 ? '+' : '') + '$' + avgPnl.toFixed(2) + '</span></div>\
                    <div style="font-size:10px;color:#636B76;">Лучшая <span style="color:#10B981;font-weight:700;">+$' + best.toFixed(2) + '</span></div>\
                    <div style="font-size:10px;color:#636B76;">Худшая <span style="color:#EF4444;font-weight:700;">$' + worst.toFixed(2) + '</span></div>\
                </div>\
                <div style="flex:1;overflow-y:auto;padding:0 18px;">\
                    <table style="width:100%;border-collapse:collapse;">\
                        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08);">\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">#</th>\
                            ' + botColHeader + '\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Пара</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Вход</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Выход</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Напр.</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Вход</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Цена</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">P&L</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Ком.</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Выход по</th>\
                        </tr></thead>\
                        <tbody>' + rowsHtml + '</tbody>\
                    </table>\
                </div>\
            </div>';

        // Привязываем к контейнеру графика (как настройки)
        var leftCol = document.querySelector('.left-col') || document.body;
        if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }

        modal.querySelector('#botJournalClose').onclick = function() { modal.remove(); };
        modal.querySelector('#botJournalToggle').onclick = function() { openJournal(!isAllBots); };
        modal.querySelector('#botJournalCsv').onclick = function() { exportTradesToCSV(trades, isAllBots); };
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    }

    // ── CSV-экспорт журнала сделок ──
    // Выгружает список сделок в .csv-файл с UTF-8 BOM (для корректного открытия в Excel).
    function exportTradesToCSV(trades, isAllBots) {
        if (!trades || !trades.length) return;

        var reasonMap = {
            'stop_loss': 'Стоп', 'take_profit': 'Тейк', 'timeout': 'Таймаут',
            'manual_stop': 'Стоп бота', 'trailing_stop': 'Трейлинг', 'cluster_exit': 'Кластер',
            'manual_close': 'Ручной', 'bb_touch': 'BB', 'sma_return': 'SMA'
        };

        // Экранирование для CSV (RFC 4180): поле в кавычках, внутренние кавычки удваиваются
        function csvCell(v) {
            if (v == null) return '';
            var s = String(v);
            if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }

        var headers = ['#','Бот','Пара','Вход','Выход','Направление','Тип входа','Цена входа','Цена выхода','P&L','Комиссия','Выход по'];
        var lines = [headers.map(csvCell).join(',')];

        trades.forEach(function(t, i) {
            var pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
            if (t.pnlPct !== undefined && t.pnlPct !== null) {
                pnlStr += ' (' + (t.pnlPct >= 0 ? '+' : '') + t.pnlPct + '%)';
            }
            var entryLabel = t.entryType === 'manual' ? 'Ручной' : (t.entryType === 'bot_tick' ? 'Бот (тик)' : 'Бот');
            var reason = reasonMap[t.reason] || t.reason || '';
            var row = [
                i + 1,
                t.botLabel || '',
                t.pair || '',
                t.openedAt ? new Date(t.openedAt).toISOString().slice(0, 16) + 'Z' : '',
                t.closedAt ? new Date(t.closedAt).toISOString().slice(0, 16) + 'Z' : '',
                t.side || '',
                entryLabel,
                t.entryPrice != null ? t.entryPrice.toFixed(2) : '',
                t.closePrice != null ? t.closePrice.toFixed(2) : '',
                pnlStr,
                t.fee != null ? t.fee.toFixed(2) : '',
                reason
            ];
            lines.push(row.map(csvCell).join(','));
        });

        // UTF-8 BOM чтобы Excel корректно отображал кириллицу
        var bom = '\uFEFF';
        var csvText = bom + lines.join('\r\n');
        var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });

        // Имя файла с датой: bot-trades-YYYY-MM-DD.csv
        var today = new Date();
        var yyyy = today.getFullYear();
        var mm = String(today.getMonth() + 1).padStart(2, '0');
        var dd = String(today.getDate()).padStart(2, '0');
        var filename = (isAllBots ? 'bot-trades-all-' : 'bot-trades-') + yyyy + '-' + mm + '-' + dd + '.csv';

        // Триггерим скачивание
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(url); }, 100);
    }


    /* ══════════════════════════════════════════
       POLLING — опрос статуса каждые 10 секунд
    ══════════════════════════════════════════ */

    var _pollInterval = null;

    function startStatusPolling(uid) {
        if (_pollInterval) clearInterval(_pollInterval);
        _pollInterval = setInterval(function() { pollStatus(uid); }, 10000);
        pollStatus(uid);
    }

    function stopStatusPolling() {
        if (_pollInterval) {
            clearInterval(_pollInterval);
            _pollInterval = null;
        }
    }

    function pollStatus(uid) {
        fetch('/api/bot/status?uid=' + uid + '&botId=' + _state.botId)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                updateWidgetFromStatus(data);
                if (data.tradeCount > 0) fetchTrades(uid);
            })
            .catch(function(e) { console.warn('[BOT] poll error', e); });
    }

    function fetchTrades(uid) {
        fetch('/api/bot/trades?uid=' + uid + '&botId=' + _state.botId + '&limit=10')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var log = document.getElementById('botWidgetLog');
                if (!log || !data.trades || !data.trades.length) return;
                log.innerHTML = data.trades.map(function(t) {
                    var isProfit = t.pnl >= 0;
                    var pnlClass = isProfit ? 'green' : 'red';
                    var pnlStr = (isProfit ? '+' : '') + '$' + t.pnl.toFixed(2);
                    var pnlPctStr = (t.pnlPct >= 0 ? '+' : '') + t.pnlPct + '%';
                    var feeStr = t.fee ? ' · ком. $' + t.fee.toFixed(2) : '';
                    var time = new Date(t.closedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    var reasonMap = {
                        'stop_loss': 'стоп', 'take_profit': 'тейк', 'timeout': 'таймаут',
                        'manual_stop': 'стоп бота', 'trailing_stop': 'трейлинг', 'cluster_exit': 'кластер',
                        'manual_close': 'ручной выход', 'bb_touch': 'BB', 'sma_return': 'SMA'
                    };
                    var reason = reasonMap[t.reason] || t.reason;
                    return '<div class="bot-w-trade"><div class="bot-w-trade-row">' +
                        '<span class="bot-w-trade-pair">' + t.pair + '</span>' +
                        '<span class="bot-w-trade-side ' + t.side.toLowerCase() + '">' + t.side + '</span>' +
                        '<span class="bot-w-trade-pnl ' + pnlClass + '">' + pnlStr + ' (' + pnlPctStr + ')</span>' +
                        '</div><div class="bot-w-trade-time">' + time + ' · ' + reason +
                        ' · R:R ' + (t.riskReward || '—') +
                        ' · ' + (t.candlesHeld || 0) + ' свечей' + feeStr + '</div></div>';
                }).join('');
            })
            .catch(function(e) { console.warn('[BOT] trades error', e); });
    }


    /* ══════════════════════════════════════════
       ВСПОМОГАТЕЛЬНЫЕ
    ══════════════════════════════════════════ */

    function setMode(mode) {
        _state.mode = mode;
        updateWidgetMode();
    }


    /* ══════════════════════════════════════════
       MULTI-BOT: dropdown, создание, переключение
    ══════════════════════════════════════════ */

    function loadBotList() {
        var uid = getUid();
        fetch('/api/bot/list?uid=' + uid)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _state.bots = data.bots || [];
                updateBotSelector();
            })
            .catch(function() {});
    }

    function getBotLabel(bot) {
        if (bot.botName) return bot.botName;
        var s = '\u00b7'; // ·
        var strat = bot.strategy === 'mean_reversion' ? 'MR' : 'SC';
        var mode = (bot.entryMode === 'tick') ? 'T' : 'C';
        var dir = bot.direction === 'long' ? 'L' : bot.direction === 'short' ? 'S' : 'L+S';
        var trail = bot.trailingEnabled ? ' ' + s + ' TR' : '';
        var bbExit = bot.bbExitEnabled ? ' ' + s + ' BB' : '';
        var cluster = bot.clusterEntryFilter ? ' ' + s + ' Cl' : '';
        var rsiStr = '';
        if (bot.rsiOversold || bot.rsiOverbought) {
            rsiStr = ' ' + s + ' ' + (bot.rsiOversold || 35) + '/' + (bot.rsiOverbought || 65);
        }
        return (bot.pair || 'BTC/USDT') + ' ' + s + ' ' + strat + ' ' + s + ' ' + (bot.timeframe || '5m') + ' ' + s + ' ' + mode + ' ' + s + ' ' + dir + trail + bbExit + cluster + rsiStr;
    }

    function updateBotSelector() {
        var dot = document.getElementById('botSelectorDot');
        var label = document.getElementById('botSelectorLabel');
        if (!label) return;

        var current = _state.bots.find(function(b) { return b.botId === _state.botId; });
        if (current) {
            label.textContent = getBotLabel(current);
            if (dot) dot.style.background = current.running ? '#26a69a' : '#636B76';
        } else {
            var fallback = {
                pair: _state.pair, strategy: _state.strategy, timeframe: _state.timeframe,
                entryMode: _state.entryMode, direction: _state.direction,
                trailingEnabled: _state.trailingEnabled,
                rsiOversold: _state.rsiOversold, rsiOverbought: _state.rsiOverbought
            };
            label.textContent = getBotLabel(fallback);
            if (dot) dot.style.background = _state.running ? '#26a69a' : '#636B76';
        }
    }

    function toggleBotDropdown() {
        var dd = document.getElementById('botSelectorDropdown');
        if (!dd) return;
        if (dd.style.display === 'none') {
            renderBotDropdown();
            dd.style.display = 'block';
            setTimeout(function() {
                document.addEventListener('click', _closeDDHandler, { once: true });
            }, 10);
        } else {
            closeBotDropdown();
        }
    }

    var _closeDDHandler = function(e) {
        var dd = document.getElementById('botSelectorDropdown');
        var btn = document.getElementById('botSelectorBtn');
        if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
            closeBotDropdown();
        } else if (dd && dd.style.display !== 'none') {
            document.addEventListener('click', _closeDDHandler, { once: true });
        }
    };

    function closeBotDropdown() {
        var dd = document.getElementById('botSelectorDropdown');
        if (dd) dd.style.display = 'none';
    }

    function renderBotDropdown() {
        var list = document.getElementById('botSelectorList');
        if (!list) return;
        list.innerHTML = '';

        if (_state.bots.length === 0) {
            list.innerHTML = '<div style="padding:8px 10px;font-size:10px;color:#636B76;">Нет ботов</div>';
            return;
        }

        _state.bots.forEach(function(bot) {
            var row = document.createElement('div');
            var isActive = bot.botId === _state.botId;
            var label = getBotLabel(bot);
            var dotColor = bot.running ? '#26a69a' : '#636B76';
            var pnlStr = bot.dayPnl >= 0 ? '+$' + bot.dayPnl.toFixed(2) : '-$' + Math.abs(bot.dayPnl).toFixed(2);
            var pnlColor = bot.dayPnl >= 0 ? '#26a69a' : '#EF5350';

            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;transition:background 0.15s;' +
                (isActive ? 'background:rgba(38,166,154,0.08);' : '');

            row.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>' +
                '<span style="flex:1;font-size:11px;color:' + (isActive ? '#26a69a' : '#D1D5DB') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + label + '</span>' +
                '<span style="font-size:10px;color:' + pnlColor + ';flex-shrink:0;margin-right:4px;">' + pnlStr + '</span>' +
                '<span class="bot-dd-delete" data-botid="' + bot.botId + '" style="flex-shrink:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;cursor:pointer;opacity:0.3;transition:opacity 0.15s;" title="Удалить">' +
                    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3.5h6M4.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M5 5.5v3M7 5.5v3M3.5 3.5l.3 5.5a1 1 0 001 .9h2.4a1 1 0 001-.9l.3-5.5" stroke="#EF5350" stroke-width="0.8" stroke-linecap="round"/></svg>' +
                '</span>';

            row.onmouseover = function() {
                this.style.background = 'rgba(255,255,255,0.04)';
                this.querySelector('.bot-dd-delete').style.opacity = '1';
            };
            row.onmouseout = function() {
                this.style.background = isActive ? 'rgba(38,166,154,0.08)' : '';
                this.querySelector('.bot-dd-delete').style.opacity = '0.3';
            };

            row.onclick = function(e) {
                if (e.target.closest('.bot-dd-delete')) return;
                closeBotDropdown();
                switchBot(bot.botId);
            };

            row.querySelector('.bot-dd-delete').onclick = function(e) {
                e.stopPropagation();
                if (confirm('Удалить бота «' + label + '»?')) {
                    closeBotDropdown();
                    deleteBot(bot.botId);
                }
            };

            list.appendChild(row);
        });
    }

    function createNewBot() {
        var uid = getUid();
        fetch('/api/bot/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, pair: 'BTC/USDT' })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.bots = data.bots || [];
                _state.botId = data.botId;
                // Сбрасываем настройки для нового бота — модалка определит
                _state.strategy = 'scalper';
                _state.direction = 'both';
                _state.entryMode = 'candle';
                _state.trailingEnabled = false;
                _state.pair = 'BTC/USDT';
                updateBotSelector();
                openModal(0);
            }
        })
        .catch(function(e) { console.warn('[BOT] create error', e); });
    }

    function deleteBot(botId) {
        var uid = getUid();
        fetch('/api/bot/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: botId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.bots = data.bots || [];
                if (_state.botId === botId) {
                    _state.botId = _state.bots.length > 0 ? _state.bots[0].botId : 'default';
                }
                updateBotSelector();
                pollStatus(uid);
            }
        })
        .catch(function(e) { console.warn('[BOT] delete error', e); });
    }

    function switchBot(botId) {
        if (_state.botId === botId) return;
        _state.botId = botId;

        var bot = _state.bots.find(function(b) { return b.botId === botId; });
        if (bot) {
            _state.pair = bot.pair;
            _state.running = bot.running;
            _state.strategy = bot.strategy || 'scalper';
            var pairLabel = document.getElementById('botWidgetPairLabel');
            if (pairLabel) pairLabel.textContent = bot.pair;

            // Переключаем график на пару бота
            var symbol = bot.pair ? bot.pair.replace('/USDT', '').replace('USDT', '') : null;
            if (symbol && typeof window._switchChartCoin === 'function') {
                window._switchChartCoin(symbol);
            }

            // Обновляем botId для отрисовки уровней
            if (typeof window._botCurrentBotId !== 'undefined') {
                window._botCurrentBotId = botId;
            }

            // Перерисовываем уровни для нового бота
            if (bot.running && typeof window._startBotLevels === 'function') {
                window._startBotLevels();
            }
        }

        updateBotSelector();
        var uid = getUid();
        pollStatus(uid);
        updateButtons();
    }

    /* ══════════════════════════════════════════
       HOT SAVE — сохранение настроек без перезапуска
    ══════════════════════════════════════════ */

    function saveSettingsHot() {
        var uid = getUid();
        var btn = document.getElementById('botSaveSettings');
        if (btn) { btn.textContent = '...'; btn.style.pointerEvents = 'none'; }

        fetch('/api/bot/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: uid,
                botId: _state.botId,
                direction: _state.direction,
                entryMode: _state.entryMode,
                riskPct: _state.riskPct,
                dayLimitPct: _state.dayLimitPct,
                maxLosses: _state.maxLosses,
                maxLeverage: _state.maxLeverage,
                volumeMultiplier: _state.volumeMultiplier,
                positionTimeout: _state.positionTimeout,
                maxProfitPct: _state.maxProfitPct,
                cooldownCandles: _state.cooldownCandles,
                stopAtrMultiplier: _state.stopAtrMultiplier,
                trailingEnabled: _state.trailingEnabled,
                trailingOffset: _state.trailingOffset,
                trailingActivation: _state.trailingActivation,
                clusterEnabled: _state.clusterEnabled,
                clusterThreshold: _state.clusterThreshold,
                clusterExitConfirm: _state.clusterExitConfirm,
                bbPeriod: _state.bbPeriod,
                bbMultiplier: _state.bbMultiplier,
                rsiPeriod: _state.rsiPeriod,
                rsiOverbought: _state.rsiOverbought,
                rsiOversold: _state.rsiOversold,
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (btn) {
                btn.textContent = 'Сохранено';
                btn.style.pointerEvents = '';
                setTimeout(function() { btn.textContent = 'Сохранить'; }, 1500);
            }
            if (data.changed) console.log('[BOT] Hot save:', data.changed.join(', '));
            loadBotList();
        })
        .catch(function(e) {
            if (btn) { btn.textContent = 'Ошибка'; btn.style.pointerEvents = ''; }
            console.warn('[BOT] save error', e);
        });
    }

    function updateWidgetMode() {
        var paperBtn = document.getElementById('botModeWidgetPaper');
        var liveBtn  = document.getElementById('botModeWidgetLive');
        if (_state.mode === 'paper') {
            if (paperBtn) paperBtn.className = 'bot-w-mode-btn selected-paper';
            if (liveBtn)  liveBtn.className  = 'bot-w-mode-btn';
        } else if (_state.mode === 'live') {
            if (liveBtn)  liveBtn.className  = 'bot-w-mode-btn selected-live';
            if (paperBtn) paperBtn.className = 'bot-w-mode-btn';
        }
    }

    function openModal(step) {
        var modal = document.getElementById('botModal');
        if (modal) modal.classList.add('visible');
        var leftCol = document.querySelector('.left-column');
        if (leftCol) leftCol.classList.add('bot-modal-active');
        renderSettings();
    }

    function closeModal() {
        var modal = document.getElementById('botModal');
        if (modal) modal.classList.remove('visible');
        var leftCol = document.querySelector('.left-column');
        if (leftCol) leftCol.classList.remove('bot-modal-active');
    }

    function toggleBot() {
        _state.active ? deactivateBot() : activateBot();
    }

    function activateBot() {
        _state.active = true;
        var btn = document.getElementById('botBtnApp');
        if (btn) btn.classList.add('bot-active');
        var wlWrap = document.getElementById('watchlistWrap');
        if (wlWrap) wlWrap.style.display = 'none';
        var newsWidget = document.getElementById('newsWidget');
        if (newsWidget) newsWidget.style.display = 'none';
        var widget = document.getElementById('botWidget');
        if (widget) widget.classList.add('visible');

        updateButtons();
        loadBotList();

        if (!_state.mode) {
            openModal();
        } else if (_state.running) {
            startStatusPolling(getUid());
        }
    }

    function deactivateBot() {
        _state.active = false;
        var btn = document.getElementById('botBtnApp');
        if (btn) btn.classList.remove('bot-active');
        var widget = document.getElementById('botWidget');
        if (widget) widget.classList.remove('visible');
        var wlWrap = document.getElementById('watchlistWrap');
        if (wlWrap) wlWrap.style.display = '';
        var newsWidget = document.getElementById('newsWidget');
        if (newsWidget) newsWidget.style.display = '';
        closeModal();
        stopStatusPolling();
    }


    /* ── Init ── */
    function init() {
        injectCSS();
        createBotButton();
        createBotWidget();
        createBotModal();

        // Глобальный хук — возвращает символ пары текущего бота (BTC, ETH, SOL...)
        window._getBotPairSymbol = function() {
            return _state.pair ? _state.pair.replace('/USDT', '').replace('USDT', '') : null;
        };

        // При загрузке страницы проверяем — может бот уже запущен на сервере
        setTimeout(function() {
            var uid = getUid();
            fetch('/api/bot/status?uid=' + uid)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.running || data.paused) {
                        // Бот уже работает — восстанавливаем виджет
                        _state.running = data.running;
                        _state.paused = data.paused;
                        _state.mode = data.mode || 'paper';
                        _state.market = data.market || 'futures';
                        _state.pair = data.pair || 'BTC/USDT';

                        // Обновляем виджет данными
                        updateWidgetFromStatus(data);
                        updateWidgetMode();

                        // Показываем кнопку БОТ как активную
                        var btn = document.getElementById('botBtnApp');
                        if (btn) {
                            var dot = btn.querySelector('.bot-btn-dot');
                            if (dot) dot.style.background = '#26a69a';
                        }

                        // Запускаем поллинг
                        startStatusPolling(uid);

                        // Рисуем уровни бота на графике
                        window._botCurrentBotId = _state.botId;
                        if (typeof window._startBotLevels === 'function') window._startBotLevels();

                        // Подгружаем историю сделок
                        if (data.tradeCount > 0) fetchTrades(uid);
                    }
                })
                .catch(function() {});
        }, 1500); // Даём Firebase auth время инициализироваться
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
