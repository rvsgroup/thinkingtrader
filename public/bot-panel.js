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
        // ── Live mode: API ключи Binance Futures ──
        // Заполняются только когда выбран mode='live'. На сервер отправляются
        // отдельным запросом и хранятся в зашифрованном виде.
        apiKey: '',
        apiSecret: '',
        apiTestnet: false,        // true → testnet.binancefuture.com
        apiConnected: false,      // true после успешной проверки ключей
        pair: 'BTC/USDT',
        pairs: ['BTC/USDT'],
        riskPct: '2',
        dayLimitPct: '5',
        maxLosses: '3',
        volumeMultiplier: '1.5',
        positionTimeout: '30',
        maxLeverage: '5',
        trailingEnabled: false,
        trailingOffset: '0.25',
        trailingActivation: '70',
        stepTpEnabled: false,
        stepTpTrigger: '5.00',
        stepTpStep: '0.50',
        stepTpTolerance: '0.50',
        bbExitEnabled: false,
        bbExitTolerance: '5',
        smaReturnEnabled: false,
        smaReturnTolerance: '5',
        atrFilterEnabled: false,
        atrFilterThreshold: '2.0',
        // Manual: визуализация (по умолчанию обе выкл — пользователь сам включает что нужно)
        manualShowBB:     false,
        manualShowLevels: false,
        maxProfitPct: '1.0',
        cooldownCandles: '5',
        stopAtrMultiplier: '1.5',
        stopMode: 'atr',          // 'atr' | 'fixed' — режим стоп-лосса
        stopFixedPct: '0.5',      // % от цены входа при stopMode='fixed'
        clusterExitConfirm: '1',
        strategy: 'scalper',        // 'scalper' | 'mean_reversion' | 'manual'
        direction: 'both',          // 'both' | 'long' | 'short'
        entryMode: 'candle',        // 'candle' | 'tick'
        bbPeriod: '20',
        bbMultiplier: '2.0',
        rsiPeriod: '14',
        rsiOverbought: '65',
        rsiOversold: '35',
        // ── Manual-стратегия ──
        manualStopPct: '0.5',          // стоп в % от цены входа
        manualSizeMode: 'risk',        // 'risk' (riskPct от стопа) | 'fixed' (фикс % баланса)
        manualFixedSizePct: '10',      // % баланса при manualSizeMode='fixed'
        manualTimeoutEnabled: false,   // опциональный таймаут позиции в manual
        manualOrderType: 'market',     // 'market' | 'limit' — выбирается прямо в виджете
        pendingLimit: null,            // ожидающая лимитка с сервера {side, price, createdAt}
        pendingExit: null,             // ожидающий лимитный выход {price, createdAt}
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

    /* Утилита: ставит точке состояние. state: 'stopped' | 'idle' | 'in-position'.
       Снимает inline background/animation (могут остаться с прошлых версий кода)
       и выставляет один из трёх классов. Так состояние всегда управляется CSS. */
    function setBotDotState(dotEl, state) {
        if (!dotEl) return;
        dotEl.classList.remove('bot-dot-stopped', 'bot-dot-idle', 'bot-dot-in-position');
        // Чистим inline стили, которые могли быть выставлены старым кодом —
        // иначе они перебили бы наши CSS-классы.
        dotEl.style.background = '';
        dotEl.style.backgroundColor = '';
        dotEl.style.animation = '';
        dotEl.classList.add('bot-dot-' + state);
    }

    /* Управление видимостью групп секций ("Рынок"/"Торговля") в виджете.
       Группа появляется только если внутри есть хотя бы одна видимая секция.
       Иначе остаётся пустая шапка с заголовком — некрасиво.
       Вызывается в конце updateWidgetFromStatus(). */
    function updateGroupVisibility() {
        function toggle(groupId, sectionIds) {
            var any = sectionIds.some(function(id) {
                var el = document.getElementById(id);
                return el && el.style.display !== 'none';
            });
            var group = document.getElementById(groupId);
            if (group) group.style.display = any ? '' : 'none';
        }
        toggle('botMarketGroup',  ['botAtrSection', 'botRegimeSection', 'botWindowSection', 'botClusterSection']);
        toggle('botTradingGroup', ['botManualBtnsSection', 'botWidgetPositionSection']);
    }

    /* HTML мини-тумблера для встраивания справа от метрики в блоке "Рынок".
       Состояние (вкл/выкл) задаётся параметром on (true/false).
       targetCheckboxId — id оригинального чекбокса в скрытом wrap'е, который
       переключается при клике на этот тумблер (делегирование через event listener).
       Не показывается в Manual — там тумблеров вообще нет. */
    function renderInlineToggle(on, targetCheckboxId) {
        var trackBg  = on ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
        var dotBg    = on ? '#26a69a' : '#636B76';
        var dotLeft  = on ? '14px' : '2px';
        return '<label class="bot-w-inline-toggle" data-target="' + targetCheckboxId + '" ' +
               'style="position:relative;width:26px;height:14px;display:inline-block;cursor:pointer;flex-shrink:0;margin-left:8px;">' +
                   '<span style="position:absolute;inset:0;background:' + trackBg + ';border-radius:7px;transition:0.2s;"></span>' +
                   '<span style="position:absolute;top:2px;left:' + dotLeft + ';width:10px;height:10px;background:' + dotBg + ';border-radius:50%;transition:0.2s;"></span>' +
               '</label>';
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
                <span id="botStartAllBtn" title="Запустить всех Paper-ботов" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid rgba(38,166,154,0.4);border-radius:4px;color:#26a69a;font-size:10px;font-weight:600;letter-spacing:0.5px;opacity:0.75;transition:opacity 0.2s, background 0.2s;" onmouseover="this.style.opacity=1;this.style.background=\'rgba(38,166,154,0.08)\'" onmouseout="this.style.opacity=0.75;this.style.background=\'transparent\'">\
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg">\
                        <polygon points="1,0 9,4.5 1,9"/>\
                    </svg>\
                    START\
                </span>\
                <span id="botStopAllBtn" title="Остановить всех ботов" style="cursor:pointer;margin-left:4px;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid rgba(239,68,68,0.4);border-radius:4px;color:#EF4444;font-size:10px;font-weight:600;letter-spacing:0.5px;opacity:0.75;transition:opacity 0.2s, background 0.2s;" onmouseover="this.style.opacity=1;this.style.background=\'rgba(239,68,68,0.08)\'" onmouseout="this.style.opacity=0.75;this.style.background=\'transparent\'">\
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg">\
                        <rect x="0.5" y="0.5" width="8" height="8" rx="1"/>\
                    </svg>\
                    STOP\
                </span>\
                <span id="botStopAllLiveBtn" title="Аварийно закрыть все Live-позиции и остановить Live-ботов" style="cursor:pointer;margin-left:4px;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid rgba(239,68,68,0.7);border-radius:4px;background:rgba(239,68,68,0.1);color:#EF4444;font-size:10px;font-weight:700;letter-spacing:0.5px;opacity:0.85;transition:opacity 0.2s, background 0.2s;" onmouseover="this.style.opacity=1;this.style.background=\'rgba(239,68,68,0.18)\'" onmouseout="this.style.opacity=0.85;this.style.background=\'rgba(239,68,68,0.1)\'">\
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" xmlns="http://www.w3.org/2000/svg">\
                        <circle cx="5" cy="5" r="4.5"/>\
                    </svg>\
                    LIVE\
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
                    <div id="botSelectorDeleteAll" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid rgba(255,255,255,0.06);cursor:pointer;color:#EF5350;font-size:11px;transition:background 0.15s;">\
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0;"><path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1"/></svg> Удалить всех ботов\
                    </div>\
                </div>\
            </div>\
            \
            <!-- Чипы "BB / Уровни" — отображаются только в ручном режиме (manual).\
                 Расположены сразу под лейблом-селектором бота, перед остальными секциями. -->\
            <div id="botManualVizToggles" style="display:none;padding:0 10px;"></div>\
            \
            <div class="bot-w-section" id="botWidgetLevelsSection">\
                <div class="bot-w-collapsible-title" id="botLevelsToggle">\
                    <span class="bot-w-collapsible-label">Микроуровни <span id="botLevelCount" style="color:#475569;font-weight:400;">—</span></span>\
                    <svg id="botLevelsArrow" class="bot-w-collapsible-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 7,8.5 10,5"/></svg>\
                </div>\
                <div id="botWidgetLevelsList" class="bot-w-levels-list">\
                    <div class="bot-w-log-empty">Бот не запущен</div>\
                </div>\
                <div id="botWidgetStatusLine" class="bot-w-status-line" style="margin-top:8px;display:none;">—</div>\
            </div>\
            \
            <div class="bot-w-section" id="botBBSection" style="display:none;">\
                <div class="bot-w-collapsible-title" id="botBBToggle">\
                    <span class="bot-w-collapsible-label">Bollinger Bands / RSI</span>\
                    <svg id="botBBArrow" class="bot-w-collapsible-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 7,8.5 10,5"/></svg>\
                </div>\
                <div id="botBBCollapsible">\
                    <div id="botBBContainer" style="font-size:11px;color:#94A3B8;line-height:1.8;"></div>\
                </div>\
            </div>\
            \
            <!-- Группа "РЫНОК": ATR / Режим рынка / Кластеры под одной шапкой. Сворачиваемая. -->\
            <div class="bot-w-group" id="botMarketGroup" style="display:none;">\
                <div class="bot-w-collapsible-title" id="botMarketToggle">\
                    <span class="bot-w-collapsible-label">Рынок</span>\
                    <svg id="botMarketArrow" class="bot-w-collapsible-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 7,8.5 10,5"/></svg>\
                </div>\
                <div id="botMarketCollapsible">\
                <div class="bot-w-group-body">\
                    <div class="bot-w-section" id="botAtrSection" style="display:none;">\
                        <div id="botAtrContainer"></div>\
                        <div id="botAtrToggleWrap" class="bot-w-mini-toggle-wrap" style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;">\
                            <span style="font-size:10px;color:#636B76;">Учитывать при входе</span>\
                            <label style="position:relative;width:32px;height:18px;cursor:pointer;">\
                                <input type="checkbox" id="botAtrEntryToggle" style="opacity:0;width:0;height:0;">\
                                <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.1);border-radius:9px;transition:0.2s;"></span>\
                                <span style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#636B76;border-radius:50%;transition:0.2s;" id="botAtrToggleDot"></span>\
                            </label>\
                        </div>\
                    </div>\
                    \
                    <div class="bot-w-section" id="botRegimeSection" style="display:none;">\
                        <div id="botRegimeContainer"></div>\
                        <div id="botRegimeToggleWrap" class="bot-w-mini-toggle-wrap" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;">\
                            <span style="font-size:10px;color:#636B76;">Учитывать при входе</span>\
                            <label style="position:relative;width:32px;height:18px;cursor:pointer;">\
                                <input type="checkbox" id="botRegimeEntryToggle" style="opacity:0;width:0;height:0;">\
                                <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.1);border-radius:9px;transition:0.2s;"></span>\
                                <span style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#636B76;border-radius:50%;transition:0.2s;" id="botRegimeToggleDot"></span>\
                            </label>\
                        </div>\
                    </div>\
                    \
                    <div class="bot-w-section" id="botWindowSection" style="display:none;">\
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">\
                            <span style="font-size:11px;color:#94A3B8;">Окно торговли (UTC)</span>\
                            <span id="botWindowStatusLabel" style="font-size:10px;color:#636B76;">все часы</span>\
                        </div>\
                        \
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid rgba(255,255,255,0.04);">\
                            <span style="font-size:10px;color:#9598A1;">Европа · 07:05–11:55</span>\
                            <label style="position:relative;width:26px;height:14px;cursor:pointer;flex-shrink:0;margin-left:8px;">\
                                <input type="checkbox" id="botWindowEUToggle" style="opacity:0;width:0;height:0;">\
                                <span style="position:absolute;inset:0;background:rgba(255,255,255,0.10);border-radius:7px;transition:0.2s;"></span>\
                                <span style="position:absolute;top:2px;left:2px;width:10px;height:10px;background:#636B76;border-radius:50%;transition:0.2s;" id="botWindowEUDot"></span>\
                            </label>\
                        </div>\
                        \
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid rgba(255,255,255,0.04);">\
                            <span style="font-size:10px;color:#9598A1;">US Open · 13:05–16:55</span>\
                            <label style="position:relative;width:26px;height:14px;cursor:pointer;flex-shrink:0;margin-left:8px;">\
                                <input type="checkbox" id="botWindowUSToggle" style="opacity:0;width:0;height:0;">\
                                <span style="position:absolute;inset:0;background:rgba(255,255,255,0.10);border-radius:7px;transition:0.2s;"></span>\
                                <span style="position:absolute;top:2px;left:2px;width:10px;height:10px;background:#636B76;border-radius:50%;transition:0.2s;" id="botWindowUSDot"></span>\
                            </label>\
                        </div>\
                    </div>\
                    \
                    <div class="bot-w-section" id="botClusterSection" style="display:none;">\
                        <div id="botClusterContainer"></div>\
                        <div id="botClusterToggleWrap" class="bot-w-mini-toggle-wrap" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;">\
                            <span style="font-size:10px;color:#636B76;">Учитывать при входе</span>\
                            <label style="position:relative;width:32px;height:18px;cursor:pointer;">\
                                <input type="checkbox" id="botClusterEntryToggle" style="opacity:0;width:0;height:0;">\
                                <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.1);border-radius:9px;transition:0.2s;"></span>\
                                <span style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#636B76;border-radius:50%;transition:0.2s;" id="botClusterToggleDot"></span>\
                            </label>\
                        </div>\
                    </div>\
                </div>\
                </div>\
            </div>\
            \
            <!-- Группа "ТОРГОВЛЯ": ручные кнопки + открытая позиция -->\
            <div class="bot-w-group" id="botTradingGroup" style="display:none;">\
                <div class="bot-w-group-title">Торговля</div>\
                <div class="bot-w-group-body">\
                    <div class="bot-w-section" id="botManualBtnsSection" style="display:none;">\
                        <div id="botManualBtnsContainer"></div>\
                    </div>\
                    \
                    <div class="bot-w-section" id="botWidgetPositionSection" style="display:none;">\
                        <div class="bot-w-section-title">Открытая позиция</div>\
                        <div id="botWidgetPosition" class="bot-w-position"></div>\
                    </div>\
                </div>\
            </div>\
            \
            <div class="bot-w-section">\
                <div class="bot-w-section-title" style="display:flex;justify-content:space-between;align-items:center;">\
                    <span>Сегодня</span>\
                    <span class="bot-w-today-meta" style="font-weight:400;letter-spacing:0;text-transform:none;color:#475569;font-size:9px;">\
                        WR <span class="bot-w-stats-foot-val" id="wWinrate" style="color:#94A3B8;">—</span> · <span id="wTradesInline">0</span> сд. · WS <span class="bot-w-stats-foot-val" id="wWsStatus" style="color:#94A3B8;">—</span>\
                    </span>\
                </div>\
                <div class="bot-w-stats-grid bot-w-stats-grid-2col">\
                    <div class="bot-w-stat-card">\
                        <div class="bot-w-stat-card-val" id="wBalance">$10,000</div>\
                        <div class="bot-w-stat-card-lbl">Баланс</div>\
                    </div>\
                    <div class="bot-w-stat-card">\
                        <div class="bot-w-stat-card-val" id="wPnl">—</div>\
                        <div class="bot-w-stat-card-lbl">P&L сегодня</div>\
                    </div>\
                    <div class="bot-w-stat-card" style="display:none;" id="wTradesCard">\
                        <div class="bot-w-stat-card-val" id="wTrades">0</div>\
                        <div class="bot-w-stat-card-lbl">Сделок</div>\
                    </div>\
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
        var startAllBtn = widget.querySelector('#botStartAllBtn');
        if (startAllBtn) startAllBtn.onclick = startAllPaperBots;
        var stopAllLiveBtn = widget.querySelector('#botStopAllLiveBtn');
        if (stopAllLiveBtn) stopAllLiveBtn.onclick = confirmStopAllLive;
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
        widget.querySelector('#botRegimeEntryToggle').onchange = function() {
            var on = this.checked;
            var dot = document.getElementById('botRegimeToggleDot');
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
                body: JSON.stringify({ uid: uid, botId: _state.botId, regimeFilterEnabled: on })
            }).then(function() { loadBotList(); }).catch(function() {});
        };

        // ── Окно торговли — Европа ──
        var euT = widget.querySelector('#botWindowEUToggle');
        if (euT) {
            euT.onchange = function() {
                var on = this.checked;
                var dot = document.getElementById('botWindowEUDot');
                if (dot) {
                    dot.style.left = on ? '14px' : '2px';
                    dot.style.background = on ? '#26a69a' : '#636B76';
                    dot.parentElement.querySelector('span').style.background = on ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
                }
                _state.tradingWindowEU = on;
                updateWindowStatusLabel();
                var uid = getUid();
                fetch('/api/bot/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uid, botId: _state.botId, tradingWindowEU: on })
                }).then(function() { loadBotList(); }).catch(function() {});
            };
        }
        // ── Окно торговли — US Open ──
        var usT = widget.querySelector('#botWindowUSToggle');
        if (usT) {
            usT.onchange = function() {
                var on = this.checked;
                var dot = document.getElementById('botWindowUSDot');
                if (dot) {
                    dot.style.left = on ? '14px' : '2px';
                    dot.style.background = on ? '#26a69a' : '#636B76';
                    dot.parentElement.querySelector('span').style.background = on ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
                }
                _state.tradingWindowUS = on;
                updateWindowStatusLabel();
                var uid = getUid();
                fetch('/api/bot/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uid, botId: _state.botId, tradingWindowUS: on })
                }).then(function() { loadBotList(); }).catch(function() {});
            };
        }
        // Хелпер: обновляет лейбл статуса окна
        function updateWindowStatusLabel() {
            var label = document.getElementById('botWindowStatusLabel');
            if (!label) return;
            var eu = !!_state.tradingWindowEU;
            var us = !!_state.tradingWindowUS;
            if (!eu && !us) { label.textContent = 'все часы'; label.style.color = '#636B76'; }
            else if (eu && us) { label.textContent = 'EU + US'; label.style.color = '#26a69a'; }
            else if (eu) { label.textContent = 'только EU'; label.style.color = '#26a69a'; }
            else { label.textContent = 'только US'; label.style.color = '#26a69a'; }
        }
        widget.querySelector('#botAtrEntryToggle').onchange = function() {
            var on = this.checked;
            var dot = document.getElementById('botAtrToggleDot');
            if (dot) {
                dot.style.left = on ? '16px' : '2px';
                dot.style.background = on ? '#26a69a' : '#636B76';
                dot.parentElement.querySelector('span').style.background = on ? 'rgba(38,166,154,0.3)' : 'rgba(255,255,255,0.1)';
            }
            _state.atrFilterEnabled = on;
            var uid = getUid();
            fetch('/api/bot/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: _state.botId, atrFilterEnabled: on })
            }).then(function() { loadBotList(); }).catch(function() {});
        };
        widget.querySelector('#botWidgetStart').onclick = startBot;

        // Делегированный обработчик кликов по inline-тумблерам в блоке "Рынок".
        // При клике переключает состояние оригинального скрытого чекбокса —
        // дальше срабатывает его .onchange (см. обработчики выше) и весь существующий
        // флоу: запрос /api/bot/settings + перерисовка.
        widget.addEventListener('click', function(e) {
            var label = e.target.closest('.bot-w-inline-toggle');
            if (!label) return;
            var targetId = label.getAttribute('data-target');
            var cb = document.getElementById(targetId);
            if (!cb) return;
            cb.checked = !cb.checked;
            // Моментально обновляем визуальное состояние самого inline-toggle,
            // чтобы не ждать пока вернётся ответ /api/bot/list и перерисуется виджет.
            var on = cb.checked;
            var spans = label.querySelectorAll('span');
            if (spans.length >= 2) {
                spans[0].style.background = on ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
                spans[1].style.left       = on ? '14px' : '2px';
                spans[1].style.background = on ? '#26a69a' : '#636B76';
            }
            cb.dispatchEvent(new Event('change'));
        });

        // Клики по чипам "BB / Уровни" (только для manual режима).
        widget.addEventListener('click', function(e) {
            var chip = e.target.closest('.bot-w-manual-viz-chip');
            if (!chip) return;
            var key = chip.getAttribute('data-key');
            // Маппинг лейбла на поле _state и серверное поле
            var stateKey, payloadKey;
            if (key === 'BB')          { stateKey = 'manualShowBB';     payloadKey = 'manualShowBB'; }
            else if (key === 'Уровни') { stateKey = 'manualShowLevels'; payloadKey = 'manualShowLevels'; }
            else return;

            var newVal = !_state[stateKey];
            _state[stateKey] = newVal;

            // Моментально перерисовываем чипы и связанные секции
            renderManualVizToggles();
            // Триггерим полный пересчёт видимости BB/Levels секций
            // (тот же блок что в основном render-цикле)
            var levelsSection = document.getElementById('botWidgetLevelsSection');
            var bbSection = document.getElementById('botBBSection');
            if (bbSection)     bbSection.style.display     = _state.manualShowBB ? '' : 'none';
            if (levelsSection) levelsSection.style.display = _state.manualShowLevels ? '' : 'none';
            if (_state.manualShowBB) renderBBContent();

            // Перезапускаем поллинг уровней/BB на графике под новые галочки
            if (typeof syncBotLevelsVisibility === 'function') syncBotLevelsVisibility();

            // Сохраняем на сервере и сразу после ответа дёргаем refresh —
            // чтобы изменения были видны моментально, не через 10 сек тика поллинга.
            var uid = getUid();
            var payload = { uid: uid, botId: _state.botId };
            payload[payloadKey] = newVal;
            fetch('/api/bot/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function() {
                loadBotList();
                // Принудительный refetch /api/bot/levels — иначе график обновится
                // только через 10 сек (следующий тик поллинга).
                if (typeof window._refreshBotLevels === 'function') {
                    window._refreshBotLevels();
                }
            }).catch(function() {});
        });
        widget.querySelector('#botWidgetStop').onclick  = stopBot;
        widget.querySelector('#botSaveSettings').onclick = saveSettingsHot;
        widget.querySelector('#botWidgetResume').onclick = resumeBot;
        // Кнопка Paper trading в виджете — раньше не имела обработчика и поэтому
        // не реагировала на клик. Теперь ставит mode='paper' и стартует бота напрямую,
        // используя сохранённые настройки из _state. Если у бота не было mode (свежий бот
        // после рестарта сервера) — это даёт возможность запустить его без модалки.
        var paperBtn = widget.querySelector('#botWidgetPaper');
        if (paperBtn) paperBtn.onclick = function() {
            _state.mode = 'paper';
            startBot();
        };
        widget.querySelector('#botSelectorBtn').onclick = toggleBotDropdown;
        widget.querySelector('#botSelectorAdd').onclick = function() { closeBotDropdown(); createNewBot(); };
        widget.querySelector('#botSelectorAdd').onmouseover = function() { this.style.background = 'rgba(38,166,154,0.1)'; };
        widget.querySelector('#botSelectorAdd').onmouseout = function() { this.style.background = 'transparent'; };
        var delAllBtn = widget.querySelector('#botSelectorDeleteAll');
        if (delAllBtn) {
            delAllBtn.onclick = function() { closeBotDropdown(); confirmDeleteAllBots(); };
            delAllBtn.onmouseover = function() { this.style.background = 'rgba(239,83,80,0.1)'; };
            delAllBtn.onmouseout = function() { this.style.background = 'transparent'; };
        }
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

        // BB/RSI секция — схлопывается, состояние в localStorage
        var bbToggle = widget.querySelector('#botBBToggle');
        if (bbToggle) {
            bbToggle.onclick = function() {
                var body = document.getElementById('botBBCollapsible');
                var arrow = document.getElementById('botBBArrow');
                if (!body) return;
                var isHidden = body.style.display === 'none';
                if (isHidden) {
                    body.style.display = '';
                    if (arrow) arrow.style.transform = 'rotate(0deg)';
                    try { localStorage.setItem('botBBCollapsed', '0'); } catch(e) {}
                } else {
                    body.style.display = 'none';
                    if (arrow) arrow.style.transform = 'rotate(-90deg)';
                    try { localStorage.setItem('botBBCollapsed', '1'); } catch(e) {}
                }
            };
            // Восстанавливаем состояние при загрузке
            try {
                if (localStorage.getItem('botBBCollapsed') === '1') {
                    var body = widget.querySelector('#botBBCollapsible');
                    var arrow = widget.querySelector('#botBBArrow');
                    if (body) body.style.display = 'none';
                    if (arrow) arrow.style.transform = 'rotate(-90deg)';
                }
            } catch(e) {}
        }

        // Группа "Рынок" — сворачивается, состояние в localStorage (по аналогии с BB)
        var marketToggle = widget.querySelector('#botMarketToggle');
        if (marketToggle) {
            marketToggle.onclick = function() {
                var body = document.getElementById('botMarketCollapsible');
                var arrow = document.getElementById('botMarketArrow');
                if (!body) return;
                var isHidden = body.style.display === 'none';
                if (isHidden) {
                    body.style.display = '';
                    if (arrow) arrow.style.transform = 'rotate(0deg)';
                    try { localStorage.setItem('botMarketCollapsed', '0'); } catch(e) {}
                } else {
                    body.style.display = 'none';
                    if (arrow) arrow.style.transform = 'rotate(-90deg)';
                    try { localStorage.setItem('botMarketCollapsed', '1'); } catch(e) {}
                }
            };
            // Восстанавливаем состояние при загрузке
            try {
                if (localStorage.getItem('botMarketCollapsed') === '1') {
                    var mBody = widget.querySelector('#botMarketCollapsible');
                    var mArrow = widget.querySelector('#botMarketArrow');
                    if (mBody) mBody.style.display = 'none';
                    if (mArrow) mArrow.style.transform = 'rotate(-90deg)';
                }
            } catch(e) {}
        }
        // Кнопки Paper/Live перенесены в шапку и в модалку настроек — здесь их нет.
        // Сохраняем null-safe обработку на случай если элементы где-то остались.
        var pBtn = widget.querySelector('#botModeWidgetPaper');
        var lBtn = widget.querySelector('#botModeWidgetLive');
        if (pBtn) pBtn.onclick = function() { setMode('paper'); openModal(); };
        if (lBtn) lBtn.onclick = function() { setMode('live');  openModal(); };

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
        _state.warmupUntil  = data.warmupUntil    || 0;
        _state.paused       = data.paused        || false;
        _state.bbData       = data.bbData        || null;
        _state.regime       = data.regime        || null;
        _state.atrRegime    = data.atrRegime     || null;
        _state.pendingLimit = data.pendingLimit  || null;
        _state.pendingExit  = data.pendingExit   || null;

        // Параметры которые пользователь может менять в модалке настроек —
        // НЕ перезаписываем из polling пока модалка открыта, иначе затрём его выбор.
        var modalOpen = document.querySelector('#botModal.visible');
        if (!modalOpen) {
            _state.strategy = data.strategy || 'scalper';
            if (data.trailingEnabled !== undefined) _state.trailingEnabled = !!data.trailingEnabled;
            if (data.trailingActivation !== undefined) _state.trailingActivation = data.trailingActivation;
            if (data.trailingOffset !== undefined) _state.trailingOffset = data.trailingOffset;
            if (data.stepTpEnabled !== undefined) _state.stepTpEnabled = !!data.stepTpEnabled;
            if (data.stepTpTrigger !== undefined) _state.stepTpTrigger = String(data.stepTpTrigger);
            if (data.stepTpStep !== undefined) _state.stepTpStep = String(data.stepTpStep);
            if (data.stepTpTolerance !== undefined) _state.stepTpTolerance = String(data.stepTpTolerance);
            if (data.bbExitEnabled !== undefined) _state.bbExitEnabled = !!data.bbExitEnabled;
            if (data.bbExitTolerance !== undefined) _state.bbExitTolerance = data.bbExitTolerance;
            if (data.smaReturnEnabled !== undefined) _state.smaReturnEnabled = !!data.smaReturnEnabled;
            if (data.smaReturnTolerance !== undefined) _state.smaReturnTolerance = data.smaReturnTolerance;
            // Manual-стратегия
            if (data.manualStopPct !== undefined) _state.manualStopPct = String(data.manualStopPct);
            if (data.manualSizeMode !== undefined) _state.manualSizeMode = data.manualSizeMode === 'fixed' ? 'fixed' : 'risk';
            if (data.manualFixedSizePct !== undefined) _state.manualFixedSizePct = String(data.manualFixedSizePct);
            if (data.manualTimeoutEnabled !== undefined) _state.manualTimeoutEnabled = !!data.manualTimeoutEnabled;
        } else {
            // Модалка открыта — обновляем ТОЛЬКО то, что нужно для отрисовки позиции на шкале
            // (trailingActivation читается в renderPosition для метки TR).
            // bbExitEnabled / trailingEnabled / tolerances не трогаем — они настраиваются пользователем.
            if (data.trailingActivation !== undefined && !_state.trailingEnabled) {
                // Если трейлинг выключен в клиенте — можно безопасно обновить activation
                _state.trailingActivation = data.trailingActivation;
            }
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
        // Обновляем тумблер режима рынка из данных бота
        if (data.regimeFilterEnabled !== undefined) {
            var rgToggle = document.getElementById('botRegimeEntryToggle');
            var rgDot = document.getElementById('botRegimeToggleDot');
            if (rgToggle) rgToggle.checked = !!data.regimeFilterEnabled;
            if (rgDot) {
                var onR = !!data.regimeFilterEnabled;
                rgDot.style.left = onR ? '16px' : '2px';
                rgDot.style.background = onR ? '#26a69a' : '#636B76';
                if (rgDot.parentElement) {
                    var trackR = rgDot.parentElement.querySelector('span');
                    if (trackR) trackR.style.background = onR ? 'rgba(38,166,154,0.3)' : 'rgba(255,255,255,0.1)';
                }
            }
            _state.regimeFilterEnabled = !!data.regimeFilterEnabled;
        }
        // Окно торговли — Европа
        if (data.tradingWindowEU !== undefined) {
            var euT2 = document.getElementById('botWindowEUToggle');
            var euD2 = document.getElementById('botWindowEUDot');
            if (euT2) euT2.checked = !!data.tradingWindowEU;
            if (euD2) {
                var onEU = !!data.tradingWindowEU;
                euD2.style.left = onEU ? '14px' : '2px';
                euD2.style.background = onEU ? '#26a69a' : '#636B76';
                if (euD2.parentElement) {
                    var trackEU = euD2.parentElement.querySelector('span');
                    if (trackEU) trackEU.style.background = onEU ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
                }
            }
            _state.tradingWindowEU = !!data.tradingWindowEU;
        }
        // Окно торговли — US
        if (data.tradingWindowUS !== undefined) {
            var usT2 = document.getElementById('botWindowUSToggle');
            var usD2 = document.getElementById('botWindowUSDot');
            if (usT2) usT2.checked = !!data.tradingWindowUS;
            if (usD2) {
                var onUS = !!data.tradingWindowUS;
                usD2.style.left = onUS ? '14px' : '2px';
                usD2.style.background = onUS ? '#26a69a' : '#636B76';
                if (usD2.parentElement) {
                    var trackUS = usD2.parentElement.querySelector('span');
                    if (trackUS) trackUS.style.background = onUS ? 'rgba(38,166,154,0.30)' : 'rgba(255,255,255,0.10)';
                }
            }
            _state.tradingWindowUS = !!data.tradingWindowUS;
        }
        // Показываем секцию окна торговли и обновляем лейбл статуса
        var winSec = document.getElementById('botWindowSection');
        if (winSec) winSec.style.display = '';
        var winLbl = document.getElementById('botWindowStatusLabel');
        if (winLbl) {
            var euOn = !!_state.tradingWindowEU;
            var usOn = !!_state.tradingWindowUS;
            if (!euOn && !usOn) { winLbl.textContent = 'все часы'; winLbl.style.color = '#636B76'; }
            else if (euOn && usOn) { winLbl.textContent = 'EU + US'; winLbl.style.color = '#26a69a'; }
            else if (euOn) { winLbl.textContent = 'только EU'; winLbl.style.color = '#26a69a'; }
            else { winLbl.textContent = 'только US'; winLbl.style.color = '#26a69a'; }
        }
        // Обновляем тумблер ATR-фильтра из данных бота
        if (data.atrFilterEnabled !== undefined) {
            var atrToggle = document.getElementById('botAtrEntryToggle');
            var atrDot = document.getElementById('botAtrToggleDot');
            if (atrToggle) atrToggle.checked = !!data.atrFilterEnabled;
            if (atrDot) {
                var onA = !!data.atrFilterEnabled;
                atrDot.style.left = onA ? '16px' : '2px';
                atrDot.style.background = onA ? '#26a69a' : '#636B76';
                if (atrDot.parentElement) {
                    var trackA = atrDot.parentElement.querySelector('span');
                    if (trackA) trackA.style.background = onA ? 'rgba(38,166,154,0.3)' : 'rgba(255,255,255,0.1)';
                }
            }
            _state.atrFilterEnabled = !!data.atrFilterEnabled;
        }
        if (data.atrFilterThreshold !== undefined) {
            _state.atrFilterThreshold = data.atrFilterThreshold;
        }
        // Manual: визуализация BB / уровней
        if (data.manualShowBB !== undefined) {
            _state.manualShowBB = !!data.manualShowBB;
        }
        if (data.manualShowLevels !== undefined) {
            _state.manualShowLevels = !!data.manualShowLevels;
        }
        // 3 состояния: серый (остановлен) / зелёный (ждёт сигнала) / янтарный пульс (в позиции).
        // Здесь это КРИТИЧНО: функция вызывается при каждом поллинге статуса, и раньше она
        // безусловно затирала янтарный цвет на зелёный.
        var dotState = !_state.running ? 'stopped' : (_state.position ? 'in-position' : 'idle');
        if (selectorDot) setBotDotState(selectorDot, dotState);

        // Точка в кнопке БОТ в главной шапке (тоже 3 состояния).
        var mainBtn = document.getElementById('botBtnApp');
        if (mainBtn) {
            var mainDot = mainBtn.querySelector('.bot-btn-dot');
            if (mainDot) setBotDotState(mainDot, dotState);
        }

        // ── Обновляем пару в виджете ──
        var pairLabel = document.getElementById('botWidgetPairLabel');
        if (pairLabel && _state.pair) pairLabel.textContent = _state.pair;

        // ── Переключение секций по стратегии ──
        // Scalper → показываем микроуровни S/R (они нужны как подсказка/сигнал).
        // MR      → показываем BB/RSI блок (основная аналитика для контртренда).
        // Manual  → две независимых галочки: показать BB / показать уровни.
        //           По умолчанию обе выключены — пользователь сам решает, что включить.
        // Тумблер кластеров управляется отдельно в renderClusterPanel().
        var levelsSection = document.getElementById('botWidgetLevelsSection');
        var bbSection = document.getElementById('botBBSection');
        var manualToggles = document.getElementById('botManualVizToggles');

        // Решаем что показывать
        var showBB, showLevels, showManualToggles;
        if (_state.strategy === 'mean_reversion') {
            showBB = true;  showLevels = false; showManualToggles = false;
        } else if (_state.strategy === 'manual') {
            showBB = !!_state.manualShowBB;
            showLevels = !!_state.manualShowLevels;
            showManualToggles = true;
        } else {
            // scalper
            showBB = false; showLevels = true; showManualToggles = false;
        }

        if (bbSection)     bbSection.style.display     = showBB ? '' : 'none';
        if (levelsSection) levelsSection.style.display = showLevels ? '' : 'none';
        if (manualToggles) manualToggles.style.display = showManualToggles ? '' : 'none';

        // Рендер содержимого BB-секции (когда она видима)
        if (showBB) renderBBContent();

        // Рендер чипов "BB / Уровни" для manual (когда они видимы)
        if (showManualToggles) renderManualVizToggles();

        // ── Тумблеры "Учитывать при входе" (ATR / Режим рынка / Кластеры) ──
        // В manual-стратегии эти фильтры бессмысленны: они фильтруют автосигналы,
        // а автосигналов нет. Скрываем тумблеры, оставляем сами секции-индикаторы.
        // Все три wrap-элемента имеют display:flex в инлайн-стиле — восстанавливаем именно его.
        // Старые wrap'ы "Учитывать при входе" внизу секций больше не показываем —
        // вместо них в верхнюю строку каждой метрики встроен inline-тумблер
        // (см. renderInlineToggle). Чекбоксы остаются в DOM для существующих
        // обработчиков; визуальные обёртки скрыты.
        var isManual = _state.strategy === 'manual';
        var atrToggleWrap = document.getElementById('botAtrToggleWrap');
        var regimeToggleWrap = document.getElementById('botRegimeToggleWrap');
        var clusterToggleWrap = document.getElementById('botClusterToggleWrap');
        if (atrToggleWrap) atrToggleWrap.style.display = 'none';
        if (regimeToggleWrap) regimeToggleWrap.style.display = 'none';
        if (clusterToggleWrap) clusterToggleWrap.style.display = 'none';

        // В Manual группа "Рынок" без декоративной плитки-фона — секции
        // визуально как простые полоски одна под другой. В MR/Scalper остаётся
        // плитка с фоном, чтобы тумблеры справа выглядели как часть карточки.
        var marketGroup = document.getElementById('botMarketGroup');
        if (marketGroup) marketGroup.classList.toggle('bot-w-group--plain', isManual);

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
        var trInlineEl = document.getElementById('wTradesInline');
        var wrEl = document.getElementById('wWinrate');
        if (trEl)       trEl.textContent       = _state.tradeCount;
        if (trInlineEl) trInlineEl.textContent = _state.tradeCount;
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

        // ── Панель волатильности (ATR-фильтр) ──
        renderAtrBar();

        // ── Полоска режима рынка (EMA 15m + 1h) ──
        renderRegimeBar();

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

        // ── Линии позиции на графике (entry/stop/pending) ──
        // Хук определён в app.html. Вызываем каждый раз на поллинге — библиотека
        // сама кэширует priceLine'ы, а наша clear+redraw дешевле логики diff'ов.
        if (typeof window._drawBotPosition === 'function') {
            window._drawBotPosition(_state.position, _state.pendingExit, _state.pendingLimit);
        }

        // Пересчёт видимости групп "Рынок"/"Торговля" — скрываем пустые группы.
        updateGroupVisibility();
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

        // Максимум касаний — для масштабирования длины бара (1.0 = самый авторитетный уровень).
        var maxTouches = 1;
        sorted.forEach(function(l) {
            var t = l.totalTouches || l.touches || 0;
            if (t > maxTouches) maxTouches = t;
        });

        var html = '';
        sorted.forEach(function(l) {
            var isSupport = l.type === 'support';
            var cls = isSupport ? 'support' : 'resistance';
            var dotColor = isSupport ? '#10B981' : '#EF4444';

            // Расстояние от текущей цены
            var dist = _state.currentPrice > 0
                ? ((l.price - _state.currentPrice) / _state.currentPrice * 100).toFixed(2)
                : '—';
            var distStr = dist === '—' ? '—' : (dist > 0 ? '+' + dist + '%' : dist + '%');

            // Подсветка если цена очень близко к уровню (< 0.05%)
            var absDist = Math.abs(parseFloat(dist));
            var isNear = absDist < 0.05;
            var rowExtra = isNear ? ' bot-w-level-near' : '';

            // Бар касаний: длина пропорциональна max, цвет — три ступени силы.
            var touches = l.totalTouches || l.touches || 0;
            var barPct = Math.max(8, Math.round(touches / maxTouches * 100));
            var ratio = touches / maxTouches;
            var barColor, touchClass;
            if (ratio >= 0.85)      { barColor = '#E2E8F0'; touchClass = 'strong'; }
            else if (ratio >= 0.45) { barColor = '#94A3B8'; touchClass = 'mid'; }
            else                    { barColor = '#475569'; touchClass = ''; }

            html += '<div class="bot-w-level-row ' + cls + rowExtra + '">' +
                '<span class="bot-w-level-dot" style="background:' + dotColor + ';"></span>' +
                '<span class="bot-w-level-price">' + l.price.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span>' +
                '<span class="bot-w-level-bar-zone"><span class="bot-w-level-bar" style="width:' + barPct + '%;background:' + barColor + ';"></span></span>' +
                '<span class="bot-w-level-touches ' + touchClass + '">' + touches + '</span>' +
                '<span class="bot-w-level-dist">' + distStr + '</span>' +
                '</div>';
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

        // ── Снимок пользовательского ввода перед перерисовкой ──
        // Функция зовётся на каждом поллинге (~1 сек), и innerHTML-reassign сносит
        // DOM вместе с введёнными значениями и фокусом. Сохраняем то, что юзер
        // печатает прямо сейчас, и после перерисовки возвращаем обратно.
        //
        // ВАЖНО: для <input type="number"> обращение к selectionStart/selectionEnd
        // в Chrome выбрасывает DOMException (InvalidStateError), поэтому оборачиваем
        // каждое чтение в try/catch. Без этого snapshot-объект не создавался и ввод
        // терялся при каждом тике цены.
        var inputSnapshot = {};
        ['botLimitEntryPrice', 'botLimitExitPrice'].forEach(function(id) {
            var el = container.querySelector('#' + id);
            if (!el) return;
            var snap = {
                value: el.value,
                focused: document.activeElement === el,
                selStart: null,
                selEnd: null,
            };
            try { snap.selStart = el.selectionStart; } catch (e) { /* type=number в Chrome */ }
            try { snap.selEnd   = el.selectionEnd;   } catch (e) { /* type=number в Chrome */ }
            inputSnapshot[id] = snap;
        });
        // Также запоминаем, был ли развёрнут блок "Установить лимитный выход"
        var exitFormWasOpen = false;
        var exitFormEl = container.querySelector('#botLimitExitForm');
        if (exitFormEl && exitFormEl.style.display !== 'none') {
            exitFormWasOpen = true;
        }

        section.style.display = '';
        var isSpotMode = _state.market === 'spot';
        var isManualStrategy = _state.strategy === 'manual';
        var html = '';

        // ═══════════════ СОСТОЯНИЕ 1: открытая позиция ═══════════════
        if (_state.position) {
            // Кнопка CLOSE + (только в manual) блок для лимитного выхода
            html += '<div style="display:flex;gap:6px;">' +
                '<div id="botManualClose" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(239,83,80,0.15);color:#EF5350;border:1px solid rgba(239,83,80,0.3);">' +
                '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> CLOSE ' + _state.position.side + '</div></div>';

            // Блок лимитного выхода — только для manual
            if (isManualStrategy) {
                if (_state.pendingExit) {
                    // Уже стоит лимитный выход — показываем его с кнопкой отмены.
                    // Дополнительно считаем, сколько это даст в процентах при срабатывании.
                    var exitPrice = _state.pendingExit.price;
                    var entryPriceForPct = _state.position.entryPrice;
                    var isLongPos = _state.position.side === 'LONG';
                    var pctRaw = isLongPos
                        ? (exitPrice - entryPriceForPct) / entryPriceForPct * 100
                        : (entryPriceForPct - exitPrice) / entryPriceForPct * 100;
                    var pctStr = (pctRaw >= 0 ? '+' : '') + pctRaw.toFixed(2) + '%';
                    var pctColor = pctRaw >= 0 ? '#26a69a' : '#EF5350';

                    html += '<div style="margin-top:6px;padding:6px 8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:5px;display:flex;align-items:center;justify-content:space-between;gap:6px;">' +
                        '<div style="font-size:11px;color:#FBBF24;">' +
                            '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="vertical-align:-1px;margin-right:3px;"><circle cx="5" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="5" cy="5" r="0.8"/></svg>' +
                            'Лимитный выход: <span style="color:#FCD34D;font-weight:700;">' + exitPrice.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span>' +
                            ' <span style="color:' + pctColor + ';font-weight:700;margin-left:4px;">' + pctStr + '</span>' +
                        '</div>' +
                        '<div id="botCancelExitLimit" style="padding:3px 8px;font-size:10px;font-weight:600;cursor:pointer;color:#94A3B8;border:1px solid rgba(255,255,255,0.1);border-radius:4px;">Отменить</div>' +
                    '</div>';
                } else {
                    // Нет лимитного выхода — кнопка "Установить" + коллапсируемое поле цены
                    var pos = _state.position;

                    html += '<div id="botLimitExitWrap" style="margin-top:6px;">' +
                        '<div id="botLimitExitToggle" style="padding:6px 8px;font-size:11px;text-align:center;border:1px dashed rgba(251,191,36,0.3);border-radius:5px;color:#FBBF24;cursor:pointer;">' +
                            '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;margin-right:3px;"><circle cx="5" cy="5" r="3" stroke="currentColor" stroke-width="1"/></svg>' +
                            'Установить лимитный выход' +
                        '</div>' +
                        '<div id="botLimitExitForm" style="display:none;margin-top:6px;padding:8px;background:rgba(251,191,36,0.05);border:1px solid rgba(251,191,36,0.2);border-radius:5px;">' +
                            '<div style="font-size:10px;color:#94A3B8;margin-bottom:4px;">Закрыть ' + pos.side + ' по цене (' + (pos.side === 'LONG' ? 'выше' : 'ниже') + ' текущей):</div>' +
                            '<div style="display:flex;gap:6px;">' +
                                '<input id="botLimitExitPrice" type="number" step="0.01" placeholder="Цена выхода" style="flex:1;padding:6px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#E2E8F0;font-size:12px;font-family:inherit;">' +
                                '<div id="botLimitExitSet" style="padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(251,191,36,0.2);color:#FBBF24;border:1px solid rgba(251,191,36,0.4);border-radius:4px;">OK</div>' +
                                '<div id="botLimitExitCancelForm" style="padding:6px 10px;font-size:11px;cursor:pointer;color:#94A3B8;border:1px solid rgba(255,255,255,0.1);border-radius:4px;">×</div>' +
                            '</div>' +
                            // Live P&L preview — обновляется по oninput. По умолчанию пусто.
                            '<div id="botLimitExitPreview" style="margin-top:5px;font-size:10px;color:#94A3B8;min-height:12px;"></div>' +
                        '</div>' +
                    '</div>';
                }
            }
        }
        // ═══════════════ СОСТОЯНИЕ 2: ожидающая лимитка на ВХОД ═══════════════
        else if (_state.pendingLimit && isManualStrategy) {
            var pl = _state.pendingLimit;
            var plColor = pl.side === 'LONG' ? '#26a69a' : '#EF5350';
            var plBg = pl.side === 'LONG' ? 'rgba(38,166,154,0.08)' : 'rgba(239,83,80,0.08)';
            var plBorder = pl.side === 'LONG' ? 'rgba(38,166,154,0.25)' : 'rgba(239,83,80,0.25)';
            var arrow = pl.side === 'LONG'
                ? '<polygon points="0,7 8,7 4,1"/>'
                : '<polygon points="0,1 8,1 4,7"/>';
            html += '<div style="padding:8px 10px;background:' + plBg + ';border:1px solid ' + plBorder + ';border-radius:6px;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">' +
                    '<div style="font-size:11px;color:' + plColor + ';font-weight:700;">' +
                        '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;margin-right:4px;">' + arrow + '</svg>' +
                        'Ожидание ' + pl.side + ' LIMIT' +
                    '</div>' +
                    '<div style="font-size:12px;color:#E2E8F0;font-weight:700;">' + pl.price.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</div>' +
                '</div>' +
                '<div id="botCancelPendingLimit" style="text-align:center;padding:4px;font-size:10px;cursor:pointer;color:#94A3B8;border:1px solid rgba(255,255,255,0.08);border-radius:4px;">Отменить лимитку</div>' +
            '</div>';
        }
        // ═══════════════ СОСТОЯНИЕ 3: не в позиции — Market/Limit входы ═══════════════
        else {
            // Market/Limit toggle — только для manual. Для авто-стратегий остаётся старая логика (только Market).
            if (isManualStrategy) {
                var orderType = _state.manualOrderType || 'market';
                html += '<div style="display:flex;gap:4px;margin-bottom:6px;padding:3px;background:rgba(255,255,255,0.04);border-radius:5px;">' +
                    '<div id="botOrderTypeMarket" style="flex:1;padding:4px;text-align:center;font-size:10px;font-weight:600;border-radius:3px;cursor:pointer;' +
                        (orderType === 'market' ? 'background:rgba(38,166,154,0.2);color:#26a69a;' : 'color:#94A3B8;') + '">Market</div>' +
                    '<div id="botOrderTypeLimit" style="flex:1;padding:4px;text-align:center;font-size:10px;font-weight:600;border-radius:3px;cursor:pointer;' +
                        (orderType === 'limit' ? 'background:rgba(251,191,36,0.2);color:#FBBF24;' : 'color:#94A3B8;') + '">Limit</div>' +
                '</div>';

                // Для Limit — поле цены. Placeholder статичный (без текущей цены, чтобы не обновлялся).
                if (orderType === 'limit') {
                    html += '<div style="margin-bottom:6px;">' +
                        '<input id="botLimitEntryPrice" type="number" step="0.01" placeholder="Цена лимитки" style="width:100%;padding:7px 10px;background:rgba(0,0,0,0.3);border:1px solid rgba(251,191,36,0.2);border-radius:4px;color:#E2E8F0;font-size:12px;font-family:inherit;box-sizing:border-box;">' +
                        '<div style="font-size:9px;color:#636B76;margin-top:3px;line-height:1.3;">LONG limit — ниже текущей цены (ждём отката). SHORT limit — выше (ждём отскока).</div>' +
                    '</div>';
                }
            }

            // Кнопки LONG/SHORT (общие для всех стратегий)
            html += '<div style="display:flex;gap:6px;">' +
                '<div id="botManualLong" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(38,166,154,0.15);color:#26a69a;border:1px solid rgba(38,166,154,0.3);"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,7 8,7 4,1"/></svg> LONG</div>' +
                (isSpotMode ? '' :
                '<div id="botManualShort" style="flex:1;padding:8px;text-align:center;font-size:12px;font-weight:700;border-radius:6px;cursor:pointer;' +
                'background:rgba(239,83,80,0.15);color:#EF5350;border:1px solid rgba(239,83,80,0.3);"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="vertical-align:-1px;"><polygon points="0,1 8,1 4,7"/></svg> SHORT</div>') +
                '</div>';
        }

        container.innerHTML = html;

        // ── Биндинги ──
        var longBtn = container.querySelector('#botManualLong');
        var shortBtn = container.querySelector('#botManualShort');
        var closeBtn = container.querySelector('#botManualClose');
        if (longBtn) longBtn.onclick = function() { manualTrade('LONG'); };
        if (shortBtn) shortBtn.onclick = function() { manualTrade('SHORT'); };
        if (closeBtn) closeBtn.onclick = function() { manualClose(); };

        // Market/Limit toggle (только в manual, state 3)
        var marketTog = container.querySelector('#botOrderTypeMarket');
        var limitTog  = container.querySelector('#botOrderTypeLimit');
        if (marketTog) marketTog.onclick = function() {
            _state.manualOrderType = 'market';
            renderManualButtons();
        };
        if (limitTog) limitTog.onclick = function() {
            _state.manualOrderType = 'limit';
            renderManualButtons();
        };

        // Cancel pending limit (state 2)
        var cancelPendingLimit = container.querySelector('#botCancelPendingLimit');
        if (cancelPendingLimit) cancelPendingLimit.onclick = function() { cancelPendingLimitOrder(); };

        // Limit exit toggle + форма (state 1, manual, нет pendingExit)
        var exitToggle = container.querySelector('#botLimitExitToggle');
        var exitForm = container.querySelector('#botLimitExitForm');
        if (exitToggle && exitForm) exitToggle.onclick = function() {
            exitToggle.style.display = 'none';
            exitForm.style.display = '';
            var inp = container.querySelector('#botLimitExitPrice');
            if (inp) inp.focus();
        };
        var exitCancelForm = container.querySelector('#botLimitExitCancelForm');
        if (exitCancelForm) exitCancelForm.onclick = function() {
            if (exitForm) exitForm.style.display = 'none';
            if (exitToggle) exitToggle.style.display = '';
        };
        var exitSet = container.querySelector('#botLimitExitSet');
        if (exitSet) exitSet.onclick = function() {
            var inp = container.querySelector('#botLimitExitPrice');
            var price = inp ? parseFloat(inp.value) : NaN;
            if (!Number.isFinite(price) || price <= 0) { alert('Введите корректную цену'); return; }
            setExitLimit(price);
        };

        // Live-превью P&L под полем ввода. Считаем относительно entry-цены
        // и стороны позиции: для LONG профит при exit > entry, для SHORT — при exit < entry.
        var exitInp = container.querySelector('#botLimitExitPrice');
        var exitPreview = container.querySelector('#botLimitExitPreview');
        function updateExitPreview() {
            if (!exitInp || !exitPreview) return;
            var v = parseFloat(exitInp.value);
            if (!Number.isFinite(v) || v <= 0 || !_state.position) {
                exitPreview.textContent = '';
                return;
            }
            var entry = _state.position.entryPrice;
            var isLong = _state.position.side === 'LONG';
            var pct = isLong ? (v - entry) / entry * 100 : (entry - v) / entry * 100;
            var sign = pct >= 0 ? '+' : '';
            var color = pct >= 0 ? '#26a69a' : '#EF5350';
            var label = pct >= 0 ? 'прибыль' : 'убыток';
            exitPreview.innerHTML = '<span style="color:' + color + ';font-weight:700;">' +
                sign + pct.toFixed(2) + '%</span> <span style="color:#636B76;">' + label + '</span>';
        }
        if (exitInp) {
            exitInp.addEventListener('input', updateExitPreview);
            // Если пользователь уже печатал (snapshot-восстановление сработало) — сразу рассчитываем
            updateExitPreview();
        }

        // Cancel exit limit (state 1, manual, есть pendingExit)
        var cancelExit = container.querySelector('#botCancelExitLimit');
        if (cancelExit) cancelExit.onclick = function() { cancelExitLimit(); };

        // ── Восстановление снимка пользовательского ввода ──
        // ВАЖЕН ПОРЯДОК: сначала раскрываем форму лимитного выхода (если была открыта),
        // и только ПОТОМ восстанавливаем value + focus. Иначе el.focus() на скрытом
        // элементе (display:none) молча не сработает, и фокус останется потерян.
        if (exitFormWasOpen) {
            var newForm = container.querySelector('#botLimitExitForm');
            var newToggle = container.querySelector('#botLimitExitToggle');
            if (newForm) newForm.style.display = '';
            if (newToggle) newToggle.style.display = 'none';
        }

        // Теперь inputs видимы — восстанавливаем их содержимое и фокус.
        // setSelectionRange на type=number кидает exception, поэтому обёрнуто
        // в try/catch и вызывается только если selStart/selEnd — числа.
        Object.keys(inputSnapshot).forEach(function(id) {
            var snap = inputSnapshot[id];
            var el = container.querySelector('#' + id);
            if (!el) return;
            el.value = snap.value;
            if (snap.focused) {
                el.focus();
                if (typeof snap.selStart === 'number' && typeof snap.selEnd === 'number') {
                    try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch (e) {}
                }
            }
        });
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

        var buyPct = Math.max(0, Math.min(100, ci.buyPct));
        var fadeStart = Math.max(0, buyPct - 8);
        var fadeEnd   = Math.min(100, buyPct + 8);

        var isManual = _state.strategy === 'manual';
        var toggleHtml = isManual ? '' : renderInlineToggle(!!_state.clusterEntryFilter, 'botClusterEntryToggle');

        container.innerHTML = '<div style="font-size:11px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="color:#94A3B8;">Кластеры (' + ci.lookback + ' свечей)</span>' +
            '<span style="display:flex;align-items:center;">' +
                '<span style="color:' + domColor + ';font-weight:600;font-size:10px;">' + domLabel + '</span>' +
                toggleHtml +
            '</span>' +
            '</div>' +
            '<div style="height:6px;border-radius:3px;background:linear-gradient(to right,' +
                '#26a69a 0%,' +
                '#26a69a ' + fadeStart + '%,' +
                '#EF5350 ' + fadeEnd + '%,' +
                '#EF5350 100%);"></div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px;color:#636B76;font-size:10px;">' +
            '<span>Buy ' + ci.buyPct + '%</span>' +
            '<span>Sell ' + ci.sellPct + '%</span>' +
            '</div>' +
            '</div>';
    }

    /* Рендер содержимого блока Bollinger Bands / RSI.
       Используется для MR (всегда) и для manual (когда включён manualShowBB).
       Раньше код был дважды — теперь функция одна. */
    function renderBBContent() {
        var bbContainer = document.getElementById('botBBContainer');
        if (!bbContainer) return;
        if (!_state.bbData) {
            bbContainer.innerHTML = '<span style="color:#475569;font-style:italic;">Ожидание данных...</span>';
            return;
        }
        var bb = _state.bbData;
        var price = _state.currentPrice;
        var rsiOS = parseInt(_state.rsiOversold) || 35;
        var rsiOB = parseInt(_state.rsiOverbought) || 65;
        var rsiVal = Math.max(0, Math.min(100, bb.rsi));
        var rsiColor = bb.rsi >= rsiOB ? '#EF4444' : bb.rsi <= rsiOS ? '#10B981' : '#E2E8F0';
        var posInBand = price > 0 && bb.upper > bb.lower
            ? Math.round((price - bb.lower) / (bb.upper - bb.lower) * 100) : 50;
        var posClamped = Math.max(0, Math.min(100, posInBand));

        var posBadge;
        if (posInBand >= 95)      posBadge = '<span class="bb-badge bb-badge-red">у верхней</span>';
        else if (posInBand <= 5)  posBadge = '<span class="bb-badge bb-badge-green">у нижней</span>';
        else if (posInBand >= 70) posBadge = '<span class="bb-badge bb-badge-amber">верхняя половина</span>';
        else if (posInBand <= 30) posBadge = '<span class="bb-badge bb-badge-amber">нижняя половина</span>';
        else                      posBadge = '<span class="bb-badge bb-badge-mute">в середине</span>';

        var rsiBadge;
        if (bb.rsi >= rsiOB)      rsiBadge = '<span class="bb-badge bb-badge-red">перекуплен</span>';
        else if (bb.rsi <= rsiOS) rsiBadge = '<span class="bb-badge bb-badge-green">перепродан</span>';
        else                      rsiBadge = '<span class="bb-badge bb-badge-mute">нейтрально</span>';

        var rsiBg = 'linear-gradient(90deg,' +
            '#10B981 0%,#10B981 ' + rsiOS + '%,' +
            'rgba(255,255,255,0.08) ' + rsiOS + '%,rgba(255,255,255,0.08) ' + rsiOB + '%,' +
            '#EF4444 ' + rsiOB + '%,#EF4444 100%)';

        bbContainer.innerHTML = '\
            <div class="bb-tiles">\
                <div class="bb-tile bb-tile-upper">\
                    <div class="bb-tile-head"><span class="bb-tile-label">Верх</span><span class="bb-tile-arrow">▲</span></div>\
                    <div class="bb-tile-value">' + bb.upper.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</div>\
                </div>\
                <div class="bb-tile bb-tile-middle">\
                    <div class="bb-tile-head"><span class="bb-tile-label">Средняя</span><span class="bb-tile-arrow">─</span></div>\
                    <div class="bb-tile-value">' + bb.middle.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</div>\
                </div>\
                <div class="bb-tile bb-tile-lower">\
                    <div class="bb-tile-head"><span class="bb-tile-label">Низ</span><span class="bb-tile-arrow">▼</span></div>\
                    <div class="bb-tile-value">' + bb.lower.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</div>\
                </div>\
            </div>\
            <div class="bb-divider"></div>\
            <div class="bb-metric-head"><span class="bb-metric-label">Позиция в канале</span><span class="bb-metric-right"><span class="bb-metric-value">' + posInBand + '%</span>' + posBadge + '</span></div>\
            <div class="bb-scale">\
                <div class="bb-scale-mid"></div>\
                <div class="bb-scale-dot" style="left:' + posClamped + '%;background:#3B82F6;"></div>\
            </div>\
            <div class="bb-metric-head" style="margin-top:10px;"><span class="bb-metric-label">RSI <span class="bb-sub">(' + (_state.rsiPeriod || 14) + ')</span></span><span class="bb-metric-right"><span class="bb-metric-value" style="color:' + rsiColor + ';">' + bb.rsi + '</span>' + rsiBadge + '</span></div>\
            <div class="bb-scale" style="background:' + rsiBg + ';">\
                <div class="bb-scale-dot" style="left:' + rsiVal + '%;background:#FFFFFF;border:2px solid ' + rsiColor + ';"></div>\
            </div>\
            <div class="bb-scale-ticks">\
                <span style="left:0;">0</span>\
                <span style="left:' + rsiOS + '%;color:#10B981;">' + rsiOS + '</span>\
                <span style="left:' + rsiOB + '%;color:#EF4444;">' + rsiOB + '</span>\
                <span style="left:100%;">100</span>\
            </div>';
    }

    /* Чипы "BB / Уровни" для ручного режима — показываются под лейблом-селектором
       бота, перед остальными секциями. На MR/SC скрыты (там стратегия сама
       диктует что показывать). Контейнер уже имеет padding:0 10px от обёртки. */
    function renderManualVizToggles() {
        var container = document.getElementById('botManualVizToggles');
        if (!container) return;

        function chip(label, active) {
            var bg     = active ? 'rgba(38,166,154,0.15)' : 'rgba(255,255,255,0.04)';
            var border = active ? '#26a69a' : 'rgba(255,255,255,0.08)';
            var color  = active ? '#26a69a' : '#9598A1';
            return '<span class="bot-w-manual-viz-chip" data-key="' + label + '" style="' +
                'display:inline-block;padding:4px 12px;border-radius:5px;font-size:11px;font-weight:500;' +
                'background:' + bg + ';border:1px solid ' + border + ';color:' + color + ';' +
                'cursor:pointer;white-space:nowrap;transition:all 0.15s;">' +
                label +
            '</span>';
        }

        container.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:8px 0 4px 0;">' +
                '<span style="font-size:10px;color:#636B76;letter-spacing:0.4px;text-transform:uppercase;">Показать на графике</span>' +
                '<div style="flex:1;"></div>' +
                chip('BB', !!_state.manualShowBB) +
                chip('Уровни', !!_state.manualShowLevels) +
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

        // ── Хелпер: динамическое форматирование цены по её величине ──
        // BTC (>=10000) → 2 знака; SOL (>=100) → 2; ETH с 4 знаками (>=10) → 3;
        // NEAR (>=1) → 4 знака; мелкие (<1) → 5.
        function fmtPrice(p) {
            if (p == null || !isFinite(p)) return '—';
            var n = Number(p);
            if (n >= 10000) return n.toFixed(2);
            if (n >= 100)   return n.toFixed(2);
            if (n >= 10)    return n.toFixed(3);
            if (n >= 1)     return n.toFixed(4);
            return n.toFixed(5);
        }

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

        // ── Метки Step TP (STP) ──
        // До активации: одна зелёная стрелка сверху — где STP активируется (цена, при которой прибыль = trigger$).
        // После активации: красная стрелка = текущий подтянутый стоп (= pos.stop), зелёная = следующая ступенька.
        // Показываем только если stepTpEnabled (и трейлинг неактивен — они взаимоисключают друг друга).
        var stpMarkers = '';
        if (_state.stepTpEnabled && !_state.trailingEnabled && pos.entryPrice && pos.size > 0 && totalRange > 0) {
            var trigger = parseFloat(_state.stepTpTrigger) || 5.0;
            var step = parseFloat(_state.stepTpStep) || 0.5;
            var tolerance = parseFloat(_state.stepTpTolerance) || 0.5;

            // Функция: unrealized $ → цена
            function profitToPrice(profit) {
                var delta = profit * pos.entryPrice / pos.size;
                return isLong ? pos.entryPrice + delta : pos.entryPrice - delta;
            }
            // Функция: цена → % на шкале
            function priceToBarPct(pr) {
                return isLong
                    ? ((pr - pos.stop) / totalRange) * 100
                    : ((pos.stop - pr) / totalRange) * 100;
            }
            // Стрелочка торчит СВЕРХУ над шкалой, пунктир идёт ВНУТРИ шкалы
            // (как у штриха трейлинга), чтобы зрительно не отрываться от полосы.
            function makeMarker(barPct, color) {
                if (barPct < -5 || barPct > 105) return '';
                // Стрелочка над шкалой
                var arrow = '<div style="position:absolute;left:' + barPct.toFixed(1) + '%;top:-8px;width:8px;height:6px;transform:translateX(-50%);pointer-events:none;z-index:5;">' +
                    '<svg width="8" height="6" viewBox="0 0 8 6" style="display:block;"><path d="M4 6 L0 0 L8 0 Z" fill="' + color + '"/></svg>' +
                '</div>';
                // Пунктирная линия ВНУТРИ шкалы — на всю высоту
                var dash = '<div style="position:absolute;left:' + barPct.toFixed(1) + '%;top:0;width:1px;height:100%;transform:translateX(-50%);background-image:repeating-linear-gradient(to bottom,' + color + ' 0 2px,transparent 2px 4px);pointer-events:none;z-index:4;"></div>';
                return arrow + dash;
            }

            if (!pos.stepTpActive) {
                // До активации — одна метка: где активируется STP
                var actPrice = profitToPrice(trigger);
                var actPct = priceToBarPct(actPrice);
                stpMarkers = makeMarker(actPct, '#10B981');
            } else {
                // После активации — две метки:
                // 1) красная = текущий подтянутый стоп (уже в pos.stop)
                var stopPct = priceToBarPct(pos.stop);
                stpMarkers += makeMarker(stopPct, '#EF4444');
                // 2) зелёная = следующая ступенька
                // текущий уровень stopProfit мы знаем как pos.stepTpMaxLevel. Следующая ступенька
                // подтянет стоп на (stopProfit + step). Соответствующая прибыль для активации —
                // на step выше пика. Упрощённо: next_stop_profit = pos.stepTpMaxLevel + step.
                // Для отображения маркера используем цену где будет следующий stopProfit.
                var curMaxStop = pos.stepTpMaxLevel != null ? pos.stepTpMaxLevel : (trigger - tolerance);
                var nextStopProfit = curMaxStop + step;
                var nextPrice = profitToPrice(nextStopProfit);
                var nextPct = priceToBarPct(nextPrice);
                stpMarkers += makeMarker(nextPct, '#10B981');
            }
        }

        // ── Метка активации трейлинга ──
        // ШТРИХ пунктирный — на самой шкале (top:0, height:100%, проходит от верха до низа).
        // ПОДПИСЬ — отдельным элементом над шкалой, чтобы они не толкались по Y.
        // Раньше подпись TR жила под шкалой рядом с "Тейк ..." и накладывалась на неё;
        // потом я по ошибке сделал штрих частью контейнера с подписью наверху — штрих
        // перестал быть на шкале. Теперь это два разных абсолютных элемента.
        var trailMarkerHtml = '';
        var trailLabelHtml = '';
        if (_state.trailingEnabled && pos.entryPrice && totalRange > 0) {
            var activationPct = parseFloat(_state.trailingActivation) || 70;
            var pathToTarget = pos.target - pos.entryPrice;
            var trailPrice = pos.entryPrice + pathToTarget * (activationPct / 100);
            var trailOnBar = isLong
                ? ((trailPrice - pos.stop) / totalRange) * 100
                : ((pos.stop - trailPrice) / totalRange) * 100;
            if (trailOnBar >= 0 && trailOnBar <= 100) {
                var markerOpacity = pos.trailingActive ? '0.4' : '0.9';
                var trailPriceFmt = fmtPrice(trailPrice);
                // Штрих на шкале — от верха до низа шкалы, строго по позиции.
                trailMarkerHtml =
                    '<div class="bot-w-pos-bar-trail" style="position:absolute;top:0;left:' + trailOnBar.toFixed(1) + '%;width:1px;height:100%;transform:translateX(-50%);pointer-events:none;opacity:' + markerOpacity + ';z-index:2;background-image:repeating-linear-gradient(to bottom,' + amber + ' 0 2px,transparent 2px 4px);"></div>';
                // Подпись над шкалой — опция отступа, если SMA тоже сверху.
                var trailLabelOffset = _state.smaReturnEnabled ? 16 : 2;
                trailLabelHtml =
                    '<div style="position:absolute;left:' + trailOnBar.toFixed(1) + '%;bottom:calc(100% + ' + trailLabelOffset + 'px);transform:translateX(-50%);font-size:9px;font-weight:600;line-height:1;letter-spacing:0.3px;color:' + amber + ';white-space:nowrap;pointer-events:none;z-index:4;opacity:' + markerOpacity + ';">TR ' + trailPriceFmt + '</div>';
            }
        }

        // ── Метка SMA + зона ──
        // Штрих — ВНУТРИ шкалы (top:0, height:100%), подпись — над шкалой отдельно.
        // Раньше подпись и штрих были в одном контейнере с `bottom:-2px` — из-за
        // чего штрих в реальности висел ВЫШЕ шкалы.
        // Показываем ТОЛЬКО если тумблер "Выход по возврату к SMA" включён — иначе
        // метка вводит в заблуждение (бот не реагирует на SMA если фича off).
        var smaMarkerHtml = '';
        var smaLabelHtml = '';
        var smaZoneHtml = '';
        if (_state.smaReturnEnabled && _state.strategy === 'mean_reversion' && _state.bbData && totalRange > 0) {
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
                    var smaPriceFmt = fmtPrice(smaPrice);
                    smaMarkerHtml =
                        '<div class="bot-w-pos-bar-sma" style="position:absolute;top:0;left:' + smaOnBar.toFixed(1) + '%;width:1px;height:100%;transform:translateX(-50%);background:' + amber + ';opacity:0.95;pointer-events:none;z-index:3;"></div>';
                    smaLabelHtml =
                        '<div style="position:absolute;left:' + smaOnBar.toFixed(1) + '%;bottom:calc(100% + 2px);transform:translateX(-50%);font-size:9px;font-weight:600;line-height:1;letter-spacing:0.3px;color:' + amber + ';white-space:nowrap;pointer-events:none;z-index:4;">SMA ' + smaPriceFmt + '</div>';
                }
            }
        }

        // Форматирование size покороче
        var sizeStr;
        var sizeVal = pos.size || 0;
        if (sizeVal >= 1000) sizeStr = '$' + (sizeVal / 1000).toFixed(1) + 'k';
        else sizeStr = '$' + sizeVal.toFixed(0);

        var entryPriceFmt = fmtPrice(pos.entryPrice);

        container.innerHTML = '\
            <div class="bot-w-pos-header">\
                <span class="bot-w-pos-side" style="color:' + sideColor + ';">' + pos.side + ' \u00B7 ' + entryPriceFmt + '</span>\
                <span class="bot-w-pos-pnl-big" style="color:' + pnlColor + ';">' + pnlStr + ' <span style="font-size:11px;font-weight:500;opacity:0.75;">(' + pnlPct + '%)</span></span>\
            </div>\
            \
            <div class="bot-w-pos-bar-wrap">\
                <div class="bot-w-pos-bar-track" style="position:relative;overflow:visible;">\
                    <div class="bot-w-pos-bar-fill" style="width:' + progressPct.toFixed(1) + '%;background:' + barColor + ';"></div>\
                    ' + smaZoneHtml + '\
                    ' + trailMarkerHtml + '\
                    ' + smaMarkerHtml + '\
                    ' + trailLabelHtml + '\
                    ' + smaLabelHtml + '\
                    ' + stpMarkers + '\
                </div>\
                <div class="bot-w-pos-bar-labels">\
                    <span style="color:#EF5350;">' + (pos.trailingActive ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-1px;"><polyline points="1,8 3,5 5,6 9,2" stroke="#EF5350" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="6,2 9,2 9,5" stroke="#EF5350" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Трейл ' : 'Стоп ') + fmtPrice(pos.stop) + '</span>\
                    <span style="color:#26a69a;">Тейк ' + fmtPrice(pos.target) + '</span>\
                </div>\
            </div>\
            \
            <div class="bot-w-pos-details">\
                <div class="bot-w-pos-detail">\
                    <span class="bot-w-pos-dlabel">Текущая</span>\
                    <span class="bot-w-pos-dval" style="color:' + barColor + ';">' + (_state.currentPrice ? fmtPrice(_state.currentPrice) : '—') + '</span>\
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

    function renderRegimeBar() {
        var section = document.getElementById('botRegimeSection');
        var container = document.getElementById('botRegimeContainer');
        if (!section || !container) return;

        if (!_state.running || !_state.regime) {
            section.style.display = 'none';
            return;
        }

        var r = _state.regime;

        function arrowGlyph(v){ return v==='up' ? '↑' : v==='down' ? '↓' : '↑↓'; }
        function colorFor(v){ return v==='up' ? '#26a69a' : v==='down' ? '#ef5350' : '#F59E0B'; }
        function labelFor(v){ return v==='up' ? 'Up' : v==='down' ? 'Down' : 'Flat'; }

        var allowed = r.allowed || 'BLOCK';
        var allowedColor =
            allowed === 'LONG'  ? '#26a69a' :
            allowed === 'SHORT' ? '#ef5350' :
            allowed === 'BLOCK' ? '#9ca3af' : '#F59E0B';

        // V2: tf4h / tf15m / tf5m (новый формат). Старый формат — fallback.
        var s4  = (r.tf4h  && r.tf4h.state)  || r.higher || 'flat';
        var s15 = (r.tf15m && r.tf15m.state) || r.main   || 'flat';
        var s5  = (r.tf5m  && r.tf5m.state)  || 'flat';

        var c4  = colorFor(s4);
        var c15 = colorFor(s15);
        var c5  = colorFor(s5);

        var adxText = (r.tf15m && r.tf15m.adx != null) ? ' · ADX ' + r.tf15m.adx.toFixed(0) : '';
        var moveText = (r.tf5m && r.tf5m.move != null) ? ' · ' + (r.tf5m.move >= 0 ? '+' : '') + r.tf5m.move.toFixed(2) + '%' : '';

        var isManual = _state.strategy === 'manual';
        var toggleHtml = isManual ? '' : renderInlineToggle(!!_state.regimeFilterEnabled, 'botRegimeEntryToggle');

        container.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                '<span style="font-size:11px;color:#94A3B8;">Режим рынка (4h · 15m · 5m)</span>' +
                '<span style="display:flex;align-items:center;">' +
                    '<span style="color:' + allowedColor + ';font-weight:600;letter-spacing:0.5px;font-size:10px;">→ ' + allowed + '</span>' +
                    toggleHtml +
                '</span>' +
            '</div>' +
            '<div style="height:5px;border-radius:3px;background:linear-gradient(to right,' +
                c4  + ' 0%,'  + c4  + ' 33%,' +
                c15 + ' 33%,' + c15 + ' 66%,' +
                c5  + ' 66%,' + c5  + ' 100%);"></div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:#636B76;">' +
                '<span>4h <span style="color:' + c4  + ';font-weight:700;">' + arrowGlyph(s4)  + ' ' + labelFor(s4)  + '</span></span>' +
                '<span>15m <span style="color:' + c15 + ';font-weight:700;">' + arrowGlyph(s15) + ' ' + labelFor(s15) + '</span>' +
                    '<span style="color:#4A5060;">' + adxText + '</span></span>' +
                '<span>5m <span style="color:' + c5  + ';font-weight:700;">' + arrowGlyph(s5)  + ' ' + labelFor(s5)  + '</span>' +
                    '<span style="color:#4A5060;">' + moveText + '</span></span>' +
            '</div>';

        section.style.display = '';
    }

    function renderAtrBar() {
        var section = document.getElementById('botAtrSection');
        var container = document.getElementById('botAtrContainer');
        if (!section || !container) return;

        if (!_state.running || !_state.atrRegime) {
            section.style.display = 'none';
            return;
        }

        var a = _state.atrRegime;
        var mult = typeof a.multiplier === 'number' ? a.multiplier : 1.0;
        var threshold = typeof a.threshold === 'number' ? a.threshold : (parseFloat(_state.atrFilterThreshold) || 2.0);

        // Уровень (level) приходит с сервера: calm / active / impulse
        var levelColor = a.level === 'impulse' ? '#ef5350' : a.level === 'active' ? '#F59E0B' : '#26a69a';
        var levelLabel = a.level === 'impulse' ? 'Импульс' : a.level === 'active' ? 'Активно' : 'Спокойно';

        // Заполнение шкалы: от 0 (mult=1.0) до 100% (mult=threshold*1.5)
        // — т.е. когда mult = threshold, шкала заполнена на ~66% (как раз рядом с риской)
        var maxScale = threshold * 1.5;
        var fillPct = Math.max(0, Math.min(100, ((mult - 1.0) / (maxScale - 1.0)) * 100));
        var thresholdPct = Math.max(0, Math.min(100, ((threshold - 1.0) / (maxScale - 1.0)) * 100));

        var isManual = _state.strategy === 'manual';
        var toggleHtml = isManual ? '' : renderInlineToggle(!!_state.atrFilterEnabled, 'botAtrEntryToggle');

        container.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<span style="font-size:11px;color:#94A3B8;">Волатильность <span style="font-size:9px;color:#636B76;">×' + mult.toFixed(2) + '</span></span>' +
                '<span style="display:flex;align-items:center;">' +
                    '<span style="color:' + levelColor + ';font-weight:600;letter-spacing:0.3px;font-size:10px;">' + levelLabel + '</span>' +
                    toggleHtml +
                '</span>' +
            '</div>' +
            '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;">' +
                '<div style="position:absolute;top:0;left:0;height:100%;width:' + fillPct.toFixed(1) + '%;background:' + levelColor + ';border-radius:2px;"></div>' +
                '<div style="position:absolute;top:-2px;left:' + thresholdPct.toFixed(1) + '%;width:1px;height:7px;background:#ef5350;opacity:0.5;"></div>' +
            '</div>';

        // Подпись "Вход заблокирован" — только когда a.blocked и тумблер on
        if (a.blocked && _state.atrFilterEnabled) {
            container.innerHTML += '<div style="margin-top:5px;font-size:10px;color:#636B76;line-height:1.3;">Вход заблокирован — ждём успокоения</div>';
        }

        section.style.display = '';
    }

    function renderStatusLine() {
        var line = document.getElementById('botWidgetStatusLine');
        if (!line) return;

        // Строка статуса релевантна только Scalper-стратегии (там есть S/R уровни).
        // В MR её скрываем — там вместо неё есть свой индикатор "Позиция в канале".
        if (_state.strategy !== 'scalper') {
            line.style.display = 'none';
            return;
        }

        if (!_state.running && !_state.paused) {
            line.style.display = 'none';
            return;
        }

        line.style.display = '';
        // Сброс inline-стилей, которые могут быть выставлены веткой "allReady"
        // (зелёная плашка при 4/4). Без сброса — стили "залипали" бы при
        // переходе в paused/position/fallback состояния.
        line.style.borderLeftColor = '';
        line.style.background = '';
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
            // ── Кандидаты на вход ──
            // Сервер торгует только от КРАЙНИХ уровней:
            //   SHORT — самый верхний resistance (top R)
            //   LONG  — самый нижний support     (bot S)
            // Дополнительно: если кластер УЖЕ требует конкретную сторону
            // (clusterInfo.signalSide), кандидат единственный — соответствующий
            // крайний уровень. Если кластер нейтрален (signalSide=null), берём
            // ближайший из разрешённых направлением+маркетом.
            var direction = _state.direction || 'both';
            var allowShort = !isSpot && direction !== 'long';
            var allowLong  = direction !== 'short';

            var ci = _state.clusterInfo || null;
            var signalSide = ci && ci.signalSide ? ci.signalSide : null;

            var resistances = _state.levels.filter(function(l) { return l.type === 'resistance'; });
            var supports    = _state.levels.filter(function(l) { return l.type === 'support'; });
            var topR = resistances.length > 0
                ? resistances.reduce(function(max, l) { return l.price > max.price ? l : max; }, resistances[0])
                : null;
            var botS = supports.length > 0
                ? supports.reduce(function(min, l) { return l.price < min.price ? l : min; }, supports[0])
                : null;

            var candidates = [];
            if (signalSide === 'SHORT') {
                if (allowShort && topR) candidates.push(topR);
            } else if (signalSide === 'LONG') {
                if (allowLong && botS) candidates.push(botS);
            } else {
                // Нет сигнала кластера — показываем ближайший из разрешённых направлением.
                if (allowShort && topR) candidates.push(topR);
                if (allowLong  && botS) candidates.push(botS);
            }

            var nearest = null;
            var minDist = Infinity;
            candidates.forEach(function(l) {
                var dist = Math.abs(_state.currentPrice - l.price) / l.price;
                if (dist < minDist) { minDist = dist; nearest = l; }
            });

            if (nearest) {
                var distPct = (minDist * 100).toFixed(2);
                var isSupport = nearest.type === 'support';
                var levelName = isSupport ? 'поддержки' : 'сопротивления';
                var action = isSupport ? 'LONG' : 'SHORT';

                var tolerance = (typeof _state.touchTolerance === 'number') ? _state.touchTolerance : 0.001;
                var tolPct = (tolerance * 100).toFixed(2);
                var inZone = minDist <= tolerance;

                // ══════════════════════════════════════════════════════════
                // Состояние всех гейтов входа (синхронизировано с сервером):
                //   1. Кластер триггер-свечи: ≥ threshold (default 80%)
                //   2. Кластер фона:          ≥ bgThreshold (60%)
                //   3. Объём:                 ≥ multiplier (default 1.5x)
                //   4. Толеранс касания:      ≤ touchTolerance (0.10%)
                // Каждый гейт вычисляется отдельно, без зависимости от других.
                // ══════════════════════════════════════════════════════════
                var triggerNeeded = ci ? ci.threshold : 80;
                var triggerForSide = ci
                    ? (action === 'SHORT' ? (100 - ci.lastCandleBuy) : ci.lastCandleBuy)
                    : null;
                var triggerOk = ci
                    ? (action === 'SHORT' ? ci.triggerOkShort : ci.triggerOkLong)
                    : false;

                var bgPct = ci
                    ? (action === 'SHORT' ? ci.sellPct : ci.buyPct)
                    : null;
                var bgNeeded = ci ? ci.bgThreshold : 60;
                var bgOk = ci
                    ? (action === 'SHORT' ? ci.bgOkShort : ci.bgOkLong)
                    : false;

                var vol = _state.volumeInfo;
                var volOk = vol ? vol.confirmed : false;

                var tolOk = inZone;

                // ── Подсчёт пройденных гейтов (только тех, что реально считаются) ──
                // Если нет clusterInfo — кластер/фон не учитываем в total, чтобы не
                // занижать "Готово X/N" из-за отсутствия данных.
                var gates = [];
                if (ci) gates.push({ key: 'trigger', ok: triggerOk });
                if (ci) gates.push({ key: 'bg',      ok: bgOk });
                if (vol) gates.push({ key: 'vol',    ok: volOk });
                gates.push({ key: 'tol', ok: tolOk });

                var passed = gates.filter(function(g) { return g.ok; }).length;
                var total  = gates.length;
                var failed = gates.filter(function(g) { return !g.ok; }).map(function(g) { return g.key; });
                var soleBlocker = failed.length === 1 ? failed[0] : null;
                var allReady = passed === total && total > 0;

                // Цвета пилюль:
                //   ok           → зелёная заливка + зелёный текст
                //   sole blocker → красная заливка + красный текст
                //   pending      → нейтральная заливка + серый текст
                function pillStyle(name, ok) {
                    if (ok) {
                        return {
                            bg:     'rgba(38,166,154,0.08)',
                            border: 'rgba(38,166,154,0.20)',
                            dot:    '#26a69a',
                            value:  '#26a69a',
                        };
                    }
                    if (soleBlocker === name) {
                        return {
                            bg:     'rgba(239,68,68,0.08)',
                            border: 'rgba(239,68,68,0.25)',
                            dot:    '#EF4444',
                            value:  '#EF4444',
                        };
                    }
                    return {
                        bg:     'rgba(255,255,255,0.04)',
                        border: 'rgba(255,255,255,0.08)',
                        dot:    '#888780',
                        value:  '#888780',
                    };
                }

                function buildPill(name, ok, label, valueText, neededText) {
                    var s = pillStyle(name, ok);
                    return '<span style="display:inline-flex;align-items:center;gap:6px;' +
                        'padding:4px 10px;background:' + s.bg + ';' +
                        'border:0.5px solid ' + s.border + ';border-radius:4px;font-size:12px;">' +
                        '<span style="width:6px;height:6px;border-radius:50%;background:' + s.dot + ';flex-shrink:0;"></span>' +
                        '<span style="color:#636B76;">' + label + '</span>' +
                        '<span style="color:' + s.value + ';">' + valueText + '</span>' +
                        '<span style="color:#475569;">/' + neededText + '</span>' +
                        '</span>';
                }

                // Специальная пилюля для триггер-кластера: «перетягивание каната».
                // - Бар: слева buyPct (зелёное), справа sellPct (красный фон).
                // - Две риски: 20% (порог SHORT) и 80% (порог LONG).
                // - Активная риска (та, к которой бот сейчас идёт) — яркая,
                //   неактивная — приглушена.
                // - При прохождении порога фон пилюли становится зелёным
                //   (через тот же pillStyle, что и у обычных пилюль).
                function buildClusterPill(ok, buyPct, side) {
                    var s = pillStyle('trigger', ok);
                    var sellPct = 100 - buyPct;
                    var buyW    = Math.max(0, Math.min(100, buyPct));

                    // Какая риска активна. action='SHORT' → левая риска (20%) яркая,
                    // правая (80%) приглушена. Для LONG — наоборот.
                    var leftActive  = side === 'SHORT';
                    var rightActive = side === 'LONG';
                    // Цвет активной риски: ok → зелёный (порог пробит), иначе белый.
                    var leftColor   = leftActive  ? (ok ? '#26a69a' : '#E2E8F0') : 'rgba(255,255,255,0.18)';
                    var rightColor  = rightActive ? (ok ? '#26a69a' : '#E2E8F0') : 'rgba(255,255,255,0.18)';

                    // Бар: фон = красный (продавцы), поверх зелёная заливка слева до buyPct.
                    // При прохождении порога SHORT (buyPct ≤ 20%) красный фон логично виден почти полностью.
                    // При прохождении порога LONG (buyPct ≥ 80%) зелёная заливка почти всю ширину.
                    var bar = '<span style="position:relative;display:inline-block;width:80px;height:8px;' +
                        'background:rgba(239,68,68,0.25);border-radius:2px;overflow:hidden;flex-shrink:0;">' +
                        '<span style="position:absolute;top:0;left:0;height:100%;width:' + buyW + '%;' +
                            'background:rgba(38,166,154,0.7);"></span>' +
                        '<span style="position:absolute;top:-2px;bottom:-2px;left:20%;width:1px;background:' + leftColor + ';"></span>' +
                        '<span style="position:absolute;top:-2px;bottom:-2px;left:80%;width:1px;background:' + rightColor + ';"></span>' +
                        '</span>';

                    return '<span style="display:inline-flex;align-items:center;gap:8px;' +
                        'padding:4px 10px;background:' + s.bg + ';' +
                        'border:0.5px solid ' + s.border + ';border-radius:4px;font-size:12px;">' +
                        '<span style="color:#636B76;">Кластер</span>' +
                        '<span style="display:inline-flex;align-items:center;gap:4px;">' +
                            '<span style="color:#26a69a;font-variant-numeric:tabular-nums;">' + Math.round(buyPct) + '</span>' +
                            bar +
                            '<span style="color:#EF4444;font-variant-numeric:tabular-nums;">' + Math.round(sellPct) + '</span>' +
                        '</span>' +
                        '</span>';
                }

                var pills = [];
                if (ci && triggerForSide !== null) {
                    // У ci.lastCandleBuy — настоящий buyPct триггер-свечи (0..100).
                    // action — что бот сейчас ждёт (LONG/SHORT), определяет какая риска активна.
                    pills.push(buildClusterPill(triggerOk, ci.lastCandleBuy, action));
                }
                if (ci && bgPct !== null) {
                    pills.push(buildPill('bg', bgOk, 'Фон',
                        Math.round(bgPct), bgNeeded + '%'));
                }
                if (vol) {
                    pills.push(buildPill('vol', volOk, 'Объём',
                        vol.ratio.toFixed(1), vol.needed.toFixed(1) + 'x'));
                }
                pills.push(buildPill('tol', tolOk, 'Дист',
                    distPct, tolPct + '%'));

                // ── Счётчик "Готово X/N" ──
                var counterColor = passed > 0 ? '#26a69a' : '#888780';
                var counterHtml = '<span style="flex-shrink:0;display:inline-flex;align-items:center;gap:6px;' +
                    'font-size:11px;color:#636B76;padding:3px 8px;background:rgba(255,255,255,0.04);' +
                    'border:0.5px solid rgba(255,255,255,0.08);border-radius:4px;white-space:nowrap;">' +
                    'Готово <span style="color:' + counterColor + ';font-weight:500;">' + passed + '</span>' +
                    '<span style="color:#475569;">/' + total + '</span>' +
                    '</span>';

                // ── Заголовок плашки ──
                // 4/4 → "открытие" (зелёная плашка). Иначе "ожидание" / "ближайший уровень".
                var headlineText;
                if (allReady) {
                    headlineText = 'Цена у ' + levelName + ' ' +
                        nearest.price.toLocaleString('en-US') +
                        ' — открытие ' + action;
                } else if (inZone) {
                    headlineText = 'Цена у ' + levelName + ' ' +
                        nearest.price.toLocaleString('en-US') +
                        ' — ожидание ' + action;
                } else {
                    headlineText = 'Ближайший уровень ' + levelName + ': ' +
                        nearest.price.toLocaleString('en-US') +
                        ' — ' + action;
                }

                var headerRow = '<div style="display:flex;align-items:center;justify-content:space-between;' +
                    'gap:12px;margin-bottom:10px;">' +
                    '<span style="line-height:1.4;' + (allReady ? 'color:#26a69a;' : '') + '">' +
                        headlineText +
                    '</span>' +
                    counterHtml +
                    '</div>';

                // flex-wrap: при узкой панели пилюли переносятся на 2-ю строку.
                var pillsRow = '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
                    pills.join('') +
                    '</div>';

                line.innerHTML = headerRow + pillsRow;
                line.className = 'bot-w-status-line ' + (isSupport ? 'status-long' : 'status-short');

                // При 4/4 перебиваем красную/зелёную полоску слева на зелёную (allReady),
                // чтобы плашка целиком сигнализировала готовность к входу.
                // Иначе оставляем дефолт класса (status-long/status-short).
                if (allReady) {
                    line.style.borderLeftColor = '#26a69a';
                    line.style.background = 'rgba(38,166,154,0.06)';
                } else {
                    line.style.borderLeftColor = '';
                    line.style.background = '';
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

        // Warmup countdown — показываем оставшееся время вместо обычного статуса
        if (_state.running && _state.warmupUntil && _state.warmupUntil > Date.now()) {
            var leftMs = _state.warmupUntil - Date.now();
            var leftSec = Math.ceil(leftMs / 1000);
            badge.className = 'bot-w-badge idle';
            badge.textContent = 'WARMUP ' + leftSec + 's';
            // Запускаем тикер раз в секунду, если ещё не запущен
            if (!window._warmupTicker) {
                window._warmupTicker = setInterval(function() {
                    if (!_state.warmupUntil || _state.warmupUntil <= Date.now()) {
                        clearInterval(window._warmupTicker);
                        window._warmupTicker = null;
                        _state.warmupUntil = 0;
                        updateBadge();
                        return;
                    }
                    updateBadge();
                }, 1000);
            }
            return;
        }
        // Если warmup уже не активен — вычищаем тикер если был
        if (window._warmupTicker) {
            clearInterval(window._warmupTicker);
            window._warmupTicker = null;
        }

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
       Одностраничная модалка со всеми настройками бота.
       Если выбран режим Live — появляется секция API ключей Binance Futures.
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

        var pairOptions = [
            // Топ-10 по капе
            'BTC/USDT','ETH/USDT','BNB/USDT','SOL/USDT','XRP/USDT',
            'DOGE/USDT','ADA/USDT','TRX/USDT','AVAX/USDT','LINK/USDT',
            // 11-30
            'DOT/USDT','MATIC/USDT','TON/USDT','SHIB/USDT','LTC/USDT',
            'BCH/USDT','NEAR/USDT','UNI/USDT','APT/USDT','ICP/USDT',
            'HBAR/USDT','FIL/USDT','ATOM/USDT','XLM/USDT','VET/USDT',
            'INJ/USDT','ARB/USDT','OP/USDT','SUI/USDT','IMX/USDT',
            // 31-60
            'AAVE/USDT','RUNE/USDT','STX/USDT','MKR/USDT','FTM/USDT',
            'GRT/USDT','SEI/USDT','TIA/USDT','RNDR/USDT','ALGO/USDT',
            'SAND/USDT','MANA/USDT','AXS/USDT','EGLD/USDT','FLOW/USDT',
            'THETA/USDT','XTZ/USDT','CHZ/USDT','EOS/USDT','NEO/USDT',
            'KAVA/USDT','LDO/USDT','QNT/USDT','CRV/USDT','SNX/USDT',
            'COMP/USDT','ENJ/USDT','ZEC/USDT','DASH/USDT','GMT/USDT',
            // 61-100
            'APE/USDT','LRC/USDT','GALA/USDT','ENS/USDT','1INCH/USDT',
            'DYDX/USDT','SUSHI/USDT','WLD/USDT','JTO/USDT','JUP/USDT',
            'PYTH/USDT','STRK/USDT','W/USDT','ENA/USDT','ONDO/USDT',
            'ETHFI/USDT','BOME/USDT','PEPE/USDT','WIF/USDT','FLOKI/USDT',
            'BONK/USDT','ORDI/USDT','1000SATS/USDT','FET/USDT','AGIX/USDT',
            'OCEAN/USDT','ROSE/USDT','MINA/USDT','CFX/USDT','IOTA/USDT',
            'RVN/USDT','ZIL/USDT','WAVES/USDT','IOTX/USDT','BAT/USDT',
            'ANKR/USDT','CELO/USDT','SKL/USDT','YFI/USDT','BAND/USDT'
        ];
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
                <div class="bst-row bst-row-3" id="bstStrategySeg">' +
                    togBtn('scalper', _state.strategy, 'Скальпер', 'Кластеры + объём') +
                    togBtn('mean_reversion', _state.strategy, 'Mean Reversion', 'BB + RSI') +
                    togBtn('manual', _state.strategy, 'Ручной', 'Без автосигналов') +
                '</div>\
                \
                <!-- 2. ПАРА + ТАЙМФРЕЙМ -->\
                <div class="bst-row bst-row-2">\
                    <div class="bst-col">\
                        <div class="bst-lbl">Пара</div>\
                        <div class="bst-pair-select" id="bstPairSelect">\
                            <div class="bst-pair-trigger" id="bstPairTrigger" style="min-height:36px;padding:4px 8px;align-items:center;flex-wrap:wrap;gap:4px;">\
                                <div id="bstPairChips" style="display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0;"></div>\
                                <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style="opacity:0.5;flex-shrink:0;margin-left:4px;"><polygon points="0,0 8,0 4,5"/></svg>\
                            </div>\
                            <div class="bst-pair-dropdown" id="bstPairDropdown" style="display:none;">\
                                <input type="text" class="bst-pair-search" id="bstPairSearch" placeholder="Поиск пары..." autocomplete="off">\
                                <div class="bst-pair-list" id="bstPairList"></div>\
                            </div>\
                            <input type="hidden" id="bstPair" value="' + _state.pair + '">\
                        </div>\
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
                        <div class="bst-col" id="bstRsiPeriodCol">\
                            <div class="bst-lbl">RSI период</div>\
                            <input class="bst-input" id="bstRsiPeriod" type="number" min="5" max="30" step="1" value="' + _state.rsiPeriod + '">\
                        </div>\
                    </div>\
                    \
                    <!-- RSI диапазон (один ползунок — влево строже, вправо мягче) -->\
                    <!-- Виден только в Mean Reversion (в Scalper RSI не используется в логике входа). -->\
                    <div class="bst-rsi-wrap" id="bstRsiRangeWrap">\
                        <div class="bst-rsi-header">\
                            <span class="bst-lbl">RSI диапазон</span>\
                            <span class="bst-rsi-vals"><span class="bst-rsi-os" id="bstRsiOSVal">' + rsiOS + '</span><span class="bst-rsi-dash"> — </span><span class="bst-rsi-ob" id="bstRsiOBVal">' + rsiOB + '</span></span>\
                        </div>\
                        <input type="range" class="bst-rsi-single" id="bstRsiSlider" min="55" max="90" step="1" value="' + rsiOB + '">\
                        <div class="bst-rsi-scale"><span>строже</span><span></span><span>мягче</span></div>\
                    </div>\
                </div>\
                \
                <!-- 4б. ПАРАМЕТРЫ РУЧНОЙ ТОРГОВЛИ (только для strategy=manual) -->\
                <div class="bst-section" id="bstManualSection" style="' + (_state.strategy === 'manual' ? '' : 'display:none;') + '">\
                    <div class="bst-section-title">Параметры ручной торговли</div>\
                    <div class="bst-row bst-row-2">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Стоп-лосс, %</div>\
                            <input class="bst-input" id="bstManualStopPct" type="number" min="0.05" max="10" step="0.05" value="' + _state.manualStopPct + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl">Размер позиции</div>\
                            <div class="bst-row bst-row-2" style="gap:4px;">\
                                <div class="bst-tog' + (_state.manualSizeMode === 'risk' ? ' bst-tog-on' : '') + '" data-msize="risk" style="cursor:pointer;padding:6px;font-size:11px;"><div class="bst-tog-label">По риску</div></div>\
                                <div class="bst-tog' + (_state.manualSizeMode === 'fixed' ? ' bst-tog-on' : '') + '" data-msize="fixed" style="cursor:pointer;padding:6px;font-size:11px;"><div class="bst-tog-label">Фикс %</div></div>\
                            </div>\
                        </div>\
                    </div>\
                    <div class="bst-row bst-row-2" id="bstManualFixedRow" style="' + (_state.manualSizeMode === 'fixed' ? '' : 'display:none;') + '">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Фикс. размер, % баланса</div>\
                            <input class="bst-input" id="bstManualFixedSizePct" type="number" min="1" max="100" step="1" value="' + _state.manualFixedSizePct + '">\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl" style="opacity:0.5;">&nbsp;</div>\
                            <div style="font-size:10px;color:#636B76;padding:8px 0;line-height:1.4;">При фиксе размер не зависит от стопа — риск на сделку плавает</div>\
                        </div>\
                    </div>\
                    <div class="bst-row" style="margin-top:8px;">\
                        <label class="bst-switch-row" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">\
                            <span class="bst-lbl" style="margin-bottom:0;">Автозакрытие по таймауту</span>\
                            <label class="bst-switch">\
                                <input type="checkbox" id="bstManualTimeoutToggle" ' + (_state.manualTimeoutEnabled ? 'checked' : '') + '>\
                                <span class="bst-switch-slider"></span>\
                            </label>\
                        </label>\
                    </div>\
                    <div class="bst-row bst-row-2" id="bstManualTimeoutRow" style="margin-top:8px;' + (_state.manualTimeoutEnabled ? '' : 'display:none;') + '">\
                        <div class="bst-col">\
                            <div class="bst-lbl">Таймаут (свечей)</div>\
                            <div class="bst-stepper">\
                                <div class="bst-step-btn bst-step-dec"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                <input class="bst-step-input" id="bstManualTimeoutInput" type="number" min="1" max="60" step="1" value="' + _state.positionTimeout + '">\
                                <div class="bst-step-btn bst-step-inc"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="2,0 8,4 2,8"/></svg></div>\
                            </div>\
                        </div>\
                        <div class="bst-col">\
                            <div class="bst-lbl" style="opacity:0.5;">&nbsp;</div>\
                            <div style="font-size:10px;color:#636B76;padding:8px 0;line-height:1.4;">Позиция автоматически закроется через указанное число свечей</div>\
                        </div>\
                    </div>\
                </div>\
                \
                <!-- 5. УПРАВЛЕНИЕ ПОЗИЦИЕЙ -->\
                <div class="bst-section" id="bstPosMgmtSection">\
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
                            <div class="bst-lbl">Стоп · ' + (_state.stopMode === 'fixed' ? '%' : '×ATR') + '\
                                <span class="bst-stop-mode-toggle" id="bstStopModeToggle" style="margin-left:8px;cursor:pointer;font-size:10px;color:#26a69a;text-decoration:underline;">' + (_state.stopMode === 'fixed' ? 'ATR' : 'Fixed%') + '</span>\
                            </div>\
                            <input class="bst-input" id="bstStopAtr" type="number" min="0.5" max="5" step="0.1" value="' + _state.stopAtrMultiplier + '" style="' + (_state.stopMode === 'fixed' ? 'display:none;' : '') + '">\
                            <input class="bst-input" id="bstStopFixed" type="number" min="0.1" max="3" step="0.05" value="' + _state.stopFixedPct + '" style="' + (_state.stopMode === 'fixed' ? '' : 'display:none;') + '">\
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
                <!-- 6a. ШАГОВЫЙ TP (Step TP / STP) — конкурент трейлингу -->\
                <div class="bst-section" id="bstStepTpSection">\
                    <div class="bst-trail-header">\
                        <span class="bst-section-label">Шаговый TP</span>\
                        <label class="bst-switch">\
                            <input type="checkbox" id="bstStepTpToggle" ' + (_state.stepTpEnabled ? 'checked' : '') + (_state.trailingEnabled ? ' disabled' : '') + '>\
                            <span class="bst-switch-slider"></span>\
                        </label>\
                    </div>\
                    <div class="bst-trail-body" id="bstStepTpBody" style="' + (_state.stepTpEnabled ? '' : 'opacity:0.55;pointer-events:none;') + '">\
                        <div class="bst-row bst-row-3">\
                            <div class="bst-col">\
                                <div class="bst-lbl">Активация ($)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstStepTpTrigger" data-step="0.5" data-min="0.5"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstStepTpTrigger" type="number" min="0.5" max="100" step="0.5" value="' + _state.stepTpTrigger + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstStepTpTrigger" data-step="0.5" data-max="100">▶</div>\
                                </div>\
                            </div>\
                            <div class="bst-col">\
                                <div class="bst-lbl">Шаг подтяжки ($)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstStepTpStep" data-step="0.1" data-min="0.1"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstStepTpStep" type="number" min="0.1" max="10" step="0.1" value="' + _state.stepTpStep + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstStepTpStep" data-step="0.1" data-max="10">▶</div>\
                                </div>\
                            </div>\
                            <div class="bst-col">\
                                <div class="bst-lbl">Зазор стопа ($)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstStepTpTolerance" data-step="0.1" data-min="0"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstStepTpTolerance" type="number" min="0" max="10" step="0.1" value="' + _state.stepTpTolerance + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstStepTpTolerance" data-step="0.1" data-max="10">▶</div>\
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
                        <div class="bst-row bst-row-1">\
                            <div class="bst-col">\
                                <div class="bst-lbl">Толеранс касания BB (% канала)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstBbTol" data-step="1" data-min="0"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstBbTol" type="number" min="0" max="20" step="1" value="' + (_state.bbExitTolerance != null ? _state.bbExitTolerance : 5) + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstBbTol" data-step="1" data-max="20">▶</div>\
                                </div>\
                            </div>\
                        </div>\
                        <div style="font-size:10px;color:#636B76;margin-top:6px;line-height:1.4;">При включении — цель выхода = противоположная BB, минимальный тейк-профит и трейлинг отключаются автоматически.</div>\
                    </div>\
                </div>\
                \
                <!-- 6c. ВЫХОД ПО ВОЗВРАТУ К SMA (MR) — независимая секция -->\
                <div class="bst-section" id="bstSmaReturnSection">\
                    <div class="bst-trail-header">\
                        <span class="bst-section-label">Выход по возврату к SMA</span>\
                        <label class="bst-switch">\
                            <input type="checkbox" id="bstSmaReturnToggle" ' + (_state.smaReturnEnabled ? 'checked' : '') + '>\
                            <span class="bst-switch-slider"></span>\
                        </label>\
                    </div>\
                    <div class="bst-trail-body" id="bstSmaReturnBody" style="' + (_state.smaReturnEnabled ? '' : 'opacity:0.55;pointer-events:none;') + '">\
                        <div class="bst-row bst-row-1">\
                            <div class="bst-col">\
                                <div class="bst-lbl">Толеранс захода за SMA (% канала)</div>\
                                <div class="bst-stepper">\
                                    <div class="bst-step-btn bst-step-dec" data-target="bstSmaTol2" data-step="1" data-min="0"><svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="6,0 0,4 6,8"/></svg></div>\
                                    <input class="bst-step-input" id="bstSmaTol2" type="number" min="0" max="20" step="1" value="' + (_state.smaReturnTolerance != null ? _state.smaReturnTolerance : 5) + '">\
                                    <div class="bst-step-btn bst-step-inc" data-target="bstSmaTol2" data-step="1" data-max="20">▶</div>\
                                </div>\
                            </div>\
                        </div>\
                        <div style="font-size:10px;color:#636B76;margin-top:6px;line-height:1.4;">Закрываем позицию при возврате цены к SMA после глубокого захода за неё. Работает независимо от трейлинга и выхода по BB.</div>\
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
                <!-- API КЛЮЧИ BINANCE FUTURES (видна только в Live) -->\
                <div class="bst-section" id="bstApiSection" style="' + (_state.mode === 'live' ? '' : 'display:none;') + '">\
                    <div class="bst-section-title">\
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-2px;margin-right:6px;">\
                            <rect x="2" y="5" width="8" height="6" rx="1" stroke="#fbbf24" stroke-width="1" fill="none"/>\
                            <path d="M4 5 V3.5 a2 2 0 0 1 4 0 V5" stroke="#fbbf24" stroke-width="1" fill="none"/>\
                        </svg>\
                        API ключи Binance Futures\
                    </div>\
                    <div style="font-size:11px;color:rgba(226,232,240,0.55);line-height:1.4;margin-bottom:10px;">\
                        Ключи нужны для отправки реальных ордеров. Хранятся в зашифрованном виде на сервере. Создать можно в Binance → API Management. Обязательные права: Enable Reading, Enable Futures.\
                    </div>\
                    <div id="bstApiStatus" style="display:none;margin-bottom:10px;padding:7px 10px;border-radius:5px;background:rgba(38,166,154,0.1);border:0.5px solid rgba(38,166,154,0.3);font-size:11px;color:#26a69a;line-height:1.4;"></div>\
                    <div class="bst-col" style="margin-bottom:8px;">\
                        <div class="bst-lbl">API Key</div>\
                        <input class="bst-input" id="bstApiKey" type="text" autocomplete="off" spellcheck="false" placeholder="64 символа" value="' + (_state.apiKey || '') + '">\
                    </div>\
                    <div class="bst-col" style="margin-bottom:8px;">\
                        <div class="bst-lbl">API Secret</div>\
                        <input class="bst-input" id="bstApiSecret" type="password" autocomplete="off" spellcheck="false" placeholder="64 символа" value="' + (_state.apiSecret || '') + '">\
                    </div>\
                    <div class="bst-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;">\
                        <div style="flex:1;min-width:0;">\
                            <div style="font-size:13px;color:#E2E8F0;font-weight:500;line-height:1.3;">Testnet</div>\
                            <div style="font-size:11px;color:rgba(226,232,240,0.5);line-height:1.3;margin-top:2px;">Сначала проверить на testnet.binancefuture.com</div>\
                        </div>\
                        <label class="bst-switch" style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0;">\
                            <input type="checkbox" id="bstApiTestnet"' + (_state.apiTestnet ? ' checked' : '') + ' style="opacity:0;width:0;height:0;">\
                            <span class="bst-switch-slider" style="position:absolute;cursor:pointer;inset:0;background:' + (_state.apiTestnet ? '#fbbf24' : 'rgba(255,255,255,0.12)') + ';border-radius:24px;transition:background 0.2s;"><span style="position:absolute;height:18px;width:18px;left:' + (_state.apiTestnet ? '21px' : '3px') + ';top:3px;background:#E2E8F0;border-radius:50%;transition:left 0.2s;display:block;"></span></span>\
                        </label>\
                    </div>\
                    <div style="display:flex;gap:8px;margin-top:10px;">\
                        <div id="bstApiTestBtn" style="flex:1;padding:8px 12px;border:0.5px solid rgba(251,191,36,0.3);border-radius:5px;background:rgba(251,191,36,0.05);font-size:12px;color:#fbbf24;text-align:center;cursor:pointer;user-select:none;transition:border-color 0.15s, background 0.15s;">Проверить</div>\
                        <div id="bstApiSaveBtn" style="flex:1;padding:8px 12px;border:0.5px solid rgba(38,166,154,0.4);border-radius:5px;background:rgba(38,166,154,0.1);font-size:12px;color:#26a69a;text-align:center;cursor:pointer;user-select:none;transition:border-color 0.15s, background 0.15s;">Сохранить</div>\
                    </div>\
                    <div id="bstApiTestResult" style="margin-top:8px;font-size:11px;line-height:1.4;text-align:center;min-height:14px;"></div>\
                    <div id="bstApiDeleteBtn" style="display:none;margin-top:8px;padding:6px 10px;border:0.5px solid rgba(239,83,80,0.25);border-radius:5px;background:transparent;font-size:11px;color:rgba(239,83,80,0.8);text-align:center;cursor:pointer;user-select:none;">Удалить сохранённые ключи</div>\
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

        // Скрывает секции, которые бессмысленны в manual-стратегии:
        // — Управление позицией (фильтр объёма, таймаут-инпут, TP, cooldown, стоп×ATR)
        // — Трейлинг-стоп (использует pos.target, которого в manual нет)
        // — Выход по противоположной BB (MR-механика)
        // — Выход по возврату к SMA (MR-механика)
        // Параметры стратегии (BB/RSI) оставляем — виджет их рисует как подсказки.
        function applyManualVisibility(strategyValue) {
            var hideInManual = [
                'bstPosMgmtSection',
                'bstTrailSection',
                'bstBbExitSection',
                'bstSmaReturnSection',
            ];
            var isManual = strategyValue === 'manual';
            hideInManual.forEach(function(id) {
                var el = body.querySelector('#' + id);
                if (el) el.style.display = isManual ? 'none' : '';
            });
            var manualSection = body.querySelector('#bstManualSection');
            if (manualSection) manualSection.style.display = isManual ? '' : 'none';

            // RSI-поля скрываем только в Scalper — там RSI не используется
            // в торговой логике. В Mean Reversion и Manual RSI остаётся видимым.
            // DOM-элементы всегда в форме, скрытие через display:none —
            // значения сохраняются в state как раньше.
            var isScalper = strategyValue === 'scalper';
            var rsiPeriodCol = body.querySelector('#bstRsiPeriodCol');
            var rsiRangeWrap = body.querySelector('#bstRsiRangeWrap');
            if (rsiPeriodCol) rsiPeriodCol.style.display = isScalper ? 'none' : '';
            if (rsiRangeWrap) rsiRangeWrap.style.display = isScalper ? 'none' : '';
        }

        bindToggleGroup('bstStrategySeg', 'strategy', function(v) {
            applyManualVisibility(v);
        });
        // Применяем один раз сразу — на случай, если модалка открыта с уже выбранной 'manual'
        applyManualVisibility(_state.strategy);

        bindToggleGroup('bstTfSeg', 'timeframe');
        bindToggleGroup('bstDirSeg', 'direction');
        bindToggleGroup('bstEntrySeg', 'entryMode');
        bindToggleGroup('bstModeSeg', 'mode', function(v) {
            setMode(v);
            // Показываем/скрываем секцию API ключей при переключении режима
            var apiSec = document.getElementById('bstApiSection');
            if (apiSec) apiSec.style.display = (v === 'live') ? '' : 'none';
            // При переключении в Live — обязательно перезапросить статус ключей,
            // чтобы плашка "Ключи сохранены" появилась.
            if (v === 'live' && typeof refreshApiKeysStatus === 'function') {
                refreshApiKeysStatus();
            }
        });

        // ── API ключи Binance: ввод ──
        var apiKeyInput = body.querySelector('#bstApiKey');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('input', function() {
                _state.apiKey = this.value.trim();
                _state.apiConnected = false; // изменили ключ — нужна повторная проверка
            });
        }
        var apiSecretInput = body.querySelector('#bstApiSecret');
        if (apiSecretInput) {
            apiSecretInput.addEventListener('input', function() {
                _state.apiSecret = this.value.trim();
                _state.apiConnected = false;
            });
        }

        // ── API ключи Binance: чекбокс testnet ──
        var apiTestnetInput = body.querySelector('#bstApiTestnet');
        if (apiTestnetInput) {
            apiTestnetInput.addEventListener('change', function() {
                _state.apiTestnet = this.checked;
                _state.apiConnected = false;
                // Перерисуем слайдер (цвет и позиция)
                var slider = this.parentElement.querySelector('.bst-switch-slider');
                if (slider) {
                    slider.style.background = this.checked ? '#fbbf24' : 'rgba(255,255,255,0.12)';
                    var knob = slider.querySelector('span');
                    if (knob) knob.style.left = this.checked ? '21px' : '3px';
                }
            });
        }

        // ══════════════════════════════════════════════════════════
        // API ключи Binance: проверка / сохранение / удаление
        // ══════════════════════════════════════════════════════════
        var apiTestBtn     = body.querySelector('#bstApiTestBtn');
        var apiSaveBtn     = body.querySelector('#bstApiSaveBtn');
        var apiDeleteBtn   = body.querySelector('#bstApiDeleteBtn');
        var apiStatus      = body.querySelector('#bstApiStatus');
        var apiTestResult  = body.querySelector('#bstApiTestResult');
        var apiKeyField    = body.querySelector('#bstApiKey');
        var apiSecretField = body.querySelector('#bstApiSecret');

        // Установить визуальный статус "ключи сохранены" / спрятать
        function setApiSavedUI(saved, info) {
            if (saved && apiStatus && apiKeyField && apiSecretField) {
                var net = (info && info.testnet) ? 'TESTNET' : 'MAINNET';
                var when = '';
                if (info && info.updatedAt) {
                    var d = new Date(info.updatedAt);
                    when = ' · ' + d.toLocaleString();
                }
                apiStatus.style.display = '';
                apiStatus.textContent = 'Ключи сохранены · ' + net + when;
                apiKeyField.placeholder = '••• сохранены — введите новые чтобы заменить';
                apiSecretField.placeholder = '••• сохранены — введите новые чтобы заменить';
                if (apiDeleteBtn) apiDeleteBtn.style.display = '';
            } else {
                if (apiStatus) apiStatus.style.display = 'none';
                if (apiKeyField) apiKeyField.placeholder = '64 символа';
                if (apiSecretField) apiSecretField.placeholder = '64 символа';
                if (apiDeleteBtn) apiDeleteBtn.style.display = 'none';
            }
        }

        // Запросить статус сохранённых ключей и обновить UI.
        // Вызывается: 1) при первом рендере если уже Live, 2) при переключении в Live.
        // botId по умолчанию 'default' (как в остальном коде через _state.botId || 'default').
        function refreshApiKeysStatus() {
            var statusBotId = _state.botId || 'default';
            console.log('[BOT] refreshApiKeysStatus uid=' + getUid() + ' botId=' + statusBotId);
            fetch('/api/bot/binance-keys-status?uid=' + encodeURIComponent(getUid()) +
                  '&botId=' + encodeURIComponent(statusBotId))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    console.log('[BOT] keys-status response:', data);
                    if (data && data.saved) {
                        // Подтянем testnet-флаг из сохранённого состояния
                        if (typeof data.testnet === 'boolean') {
                            _state.apiTestnet = data.testnet;
                            var tn = body.querySelector('#bstApiTestnet');
                            if (tn) {
                                tn.checked = data.testnet;
                                var slider = tn.parentElement.querySelector('.bst-switch-slider');
                                if (slider) {
                                    slider.style.background = data.testnet ? '#fbbf24' : 'rgba(255,255,255,0.12)';
                                    var knob = slider.querySelector('span');
                                    if (knob) knob.style.left = data.testnet ? '21px' : '3px';
                                }
                            }
                        }
                        setApiSavedUI(true, data);
                    } else {
                        setApiSavedUI(false);
                    }
                })
                .catch(function(err) {
                    console.error('[BOT] keys-status fetch failed:', err);
                    setApiSavedUI(false);
                });
        }

        // Первый запрос при рендере — если уже выбран Live
        if (_state.mode === 'live') {
            refreshApiKeysStatus();
        }

        // ── Кнопка "Проверить" ──
        if (apiTestBtn && apiTestResult) {
            apiTestBtn.addEventListener('click', function() {
                if (!_state.apiKey || !_state.apiSecret) {
                    apiTestResult.style.color = '#ef5350';
                    apiTestResult.textContent = 'Введите API Key и API Secret';
                    return;
                }
                if (apiTestBtn.dataset.busy === '1') return;
                apiTestBtn.dataset.busy = '1';
                apiTestBtn.style.opacity = '0.6';
                apiTestResult.style.color = 'rgba(226,232,240,0.55)';
                apiTestResult.textContent = 'Проверяю...';

                fetch('/api/bot/test-binance-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey:    _state.apiKey,
                        apiSecret: _state.apiSecret,
                        testnet:   !!_state.apiTestnet,
                    }),
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && data.ok) {
                        _state.apiConnected = true;
                        var net = data.testnet ? 'TESTNET' : 'MAINNET';
                        var bal = (data.availableBalance != null)
                            ? (Math.round(data.availableBalance * 100) / 100) + ' USDT'
                            : '—';
                        var canTrade = data.canTrade ? '' : ' Внимание: canTrade=false (нет прав на торговлю)';
                        apiTestResult.style.color = '#26a69a';
                        apiTestResult.textContent = 'OK · ' + net + ' · доступный баланс: ' + bal + canTrade;
                    } else {
                        _state.apiConnected = false;
                        apiTestResult.style.color = '#ef5350';
                        apiTestResult.textContent = (data && data.error) ? data.error : 'Ошибка проверки';
                    }
                })
                .catch(function(err) {
                    _state.apiConnected = false;
                    apiTestResult.style.color = '#ef5350';
                    apiTestResult.textContent = 'Сетевая ошибка: ' + (err && err.message ? err.message : 'неизвестно');
                })
                .finally(function() {
                    apiTestBtn.dataset.busy = '0';
                    apiTestBtn.style.opacity = '';
                });
            });
        }

        // ── Кнопка "Сохранить" ──
        // Шифрует ключи на сервере. Сначала обязательно проверяет их через Binance —
        // невалидные не сохраняются. После успеха очищает поля ввода (ключи живут
        // только в зашифрованном виде на сервере, в браузере не остаются).
        if (apiSaveBtn && apiTestResult) {
            apiSaveBtn.addEventListener('click', function() {
                if (!_state.apiKey || !_state.apiSecret) {
                    apiTestResult.style.color = '#ef5350';
                    apiTestResult.textContent = 'Введите API Key и API Secret';
                    return;
                }
                var saveBotId = _state.botId || 'default';
                if (apiSaveBtn.dataset.busy === '1') return;
                apiSaveBtn.dataset.busy = '1';
                apiSaveBtn.style.opacity = '0.6';
                apiTestResult.style.color = 'rgba(226,232,240,0.55)';
                apiTestResult.textContent = 'Сохраняю...';

                fetch('/api/bot/save-binance-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uid:       getUid(),
                        botId:     saveBotId,
                        apiKey:    _state.apiKey,
                        apiSecret: _state.apiSecret,
                        testnet:   !!_state.apiTestnet,
                    }),
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && data.ok) {
                        _state.apiConnected = true;
                        // Чистим поля ввода — ключи теперь только на сервере
                        _state.apiKey    = '';
                        _state.apiSecret = '';
                        if (apiKeyField)    apiKeyField.value    = '';
                        if (apiSecretField) apiSecretField.value = '';
                        apiTestResult.style.color = '#26a69a';
                        apiTestResult.textContent = 'Ключи сохранены — больше вводить не нужно';
                        setApiSavedUI(true, { testnet: _state.apiTestnet, updatedAt: data.savedAt || Date.now() });
                    } else {
                        apiTestResult.style.color = '#ef5350';
                        apiTestResult.textContent = (data && data.error) ? data.error : 'Не удалось сохранить';
                    }
                })
                .catch(function(err) {
                    apiTestResult.style.color = '#ef5350';
                    apiTestResult.textContent = 'Сетевая ошибка: ' + (err && err.message ? err.message : 'неизвестно');
                })
                .finally(function() {
                    apiSaveBtn.dataset.busy = '0';
                    apiSaveBtn.style.opacity = '';
                });
            });
        }

        // ── Кнопка "Удалить сохранённые ключи" ──
        if (apiDeleteBtn && apiTestResult) {
            apiDeleteBtn.addEventListener('click', function() {
                var delBotId = _state.botId || 'default';
                if (!confirm('Удалить сохранённые ключи Binance? Бот в Live-режиме без них запуститься не сможет.')) return;
                if (apiDeleteBtn.dataset.busy === '1') return;
                apiDeleteBtn.dataset.busy = '1';
                apiDeleteBtn.style.opacity = '0.6';

                fetch('/api/bot/delete-binance-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: getUid(), botId: delBotId }),
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && data.ok) {
                        _state.apiConnected = false;
                        apiTestResult.style.color = 'rgba(226,232,240,0.55)';
                        apiTestResult.textContent = 'Сохранённые ключи удалены';
                        setApiSavedUI(false);
                    } else {
                        apiTestResult.style.color = '#ef5350';
                        apiTestResult.textContent = (data && data.error) ? data.error : 'Не удалось удалить';
                    }
                })
                .catch(function(err) {
                    apiTestResult.style.color = '#ef5350';
                    apiTestResult.textContent = 'Сетевая ошибка: ' + (err && err.message ? err.message : 'неизвестно');
                })
                .finally(function() {
                    apiDeleteBtn.dataset.busy = '0';
                    apiDeleteBtn.style.opacity = '';
                });
            });
        }

        // Pair select (кастомный с поиском, МУЛЬТИ-ВЫБОР)
        (function initPairSelect() {
            var trigger = body.querySelector('#bstPairTrigger');
            var dropdown = body.querySelector('#bstPairDropdown');
            var searchInput = body.querySelector('#bstPairSearch');
            var list = body.querySelector('#bstPairList');
            var hiddenInput = body.querySelector('#bstPair');
            var chipsContainer = body.querySelector('#bstPairChips');
            if (!trigger || !dropdown || !searchInput || !list || !hiddenInput || !chipsContainer) return;

            // Инициализация: _state.pairs — массив всех выбранных пар.
            // Если пусто — заполняем из старого _state.pair (обратная совместимость).
            if (!Array.isArray(_state.pairs) || _state.pairs.length === 0) {
                _state.pairs = _state.pair ? [_state.pair] : ['BTC/USDT'];
            }
            // Синхронизируем _state.pair с первой парой — чтобы остальной код работал.
            _state.pair = _state.pairs[0];

            function renderChips() {
                if (_state.pairs.length === 0) {
                    chipsContainer.innerHTML = '<span style="font-size:13px;color:#636B76;">— пара не выбрана —</span>';
                } else {
                    var html = '';
                    for (var i = 0; i < _state.pairs.length; i++) {
                        var p = _state.pairs[i];
                        // Чип: фон рамкой teal, маленький крестик справа.
                        // Крестик прячется у единственной пары — удалять её нельзя.
                        var canRemove = _state.pairs.length > 1;
                        var removeBtn = canRemove
                            ? '<span class="bst-chip-remove" data-pair="' + p + '" style="margin-left:4px;padding:0 2px;cursor:pointer;opacity:0.6;font-size:11px;line-height:1;">×</span>'
                            : '';
                        html += '<span class="bst-pair-chip" style="display:inline-flex;align-items:center;padding:3px 6px 3px 8px;background:rgba(38,166,154,0.12);border:1px solid rgba(38,166,154,0.35);border-radius:6px;font-size:11px;color:#26a69a;font-weight:500;white-space:nowrap;">' + p + removeBtn + '</span>';
                    }
                    chipsContainer.innerHTML = html;
                }
                hiddenInput.value = _state.pairs.join(',');
                updateLaunchBtnLabel();
            }

            // Делегирование клика по крестикам чипов — удаляют пару
            chipsContainer.onclick = function(e) {
                var rm = e.target.closest('.bst-chip-remove');
                if (!rm) return;
                e.stopPropagation();   // не раскрываем dropdown при клике на крестик
                var p = rm.getAttribute('data-pair');
                var idx = _state.pairs.indexOf(p);
                if (idx !== -1 && _state.pairs.length > 1) {
                    _state.pairs.splice(idx, 1);
                    _state.pair = _state.pairs[0];
                    renderChips();
                    renderList(searchInput.value);
                    updateSummary();
                }
            };

            function updateTriggerLabel() {
                renderChips();
            }

            function renderList(filter) {
                filter = (filter || '').toUpperCase();
                var html = '';
                for (var i = 0; i < pairOptions.length; i++) {
                    var p = pairOptions[i];
                    if (filter && p.toUpperCase().indexOf(filter) === -1) continue;
                    var isSelected = _state.pairs.indexOf(p) !== -1;
                    var checkSvg = isSelected
                        ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0;"><rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="#26a69a" stroke="#26a69a"/><path d="M3 6l2 2 4-4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0;"><rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="transparent" stroke="rgba(255,255,255,0.25)"/></svg>';
                    html += '<div class="bst-pair-item' + (isSelected ? ' bst-pair-item-active' : '') + '" data-pair="' + p + '" style="display:flex;align-items:center;gap:8px;">' + checkSvg + '<span>' + p + '</span></div>';
                }
                if (!html) html = '<div class="bst-pair-empty">Ничего не найдено</div>';
                list.innerHTML = html;
            }

            function openDropdown() {
                dropdown.style.display = '';
                searchInput.value = '';
                renderList('');
                setTimeout(function() { searchInput.focus(); }, 10);
            }

            function closeDropdown() {
                dropdown.style.display = 'none';
            }

            function togglePair(p) {
                var idx = _state.pairs.indexOf(p);
                if (idx === -1) {
                    _state.pairs.push(p);
                } else {
                    // Не даём убрать последнюю пару — нужна хотя бы одна
                    if (_state.pairs.length <= 1) return;
                    _state.pairs.splice(idx, 1);
                }
                _state.pair = _state.pairs[0]; // синхронизация
                updateTriggerLabel();
                renderList(searchInput.value);  // перерендерим чтобы чекбокс обновился
                updateSummary();
            }

            trigger.onclick = function(e) {
                e.stopPropagation();
                if (dropdown.style.display === 'none') openDropdown();
                else closeDropdown();
            };

            searchInput.oninput = function() { renderList(searchInput.value); };
            searchInput.onclick = function(e) { e.stopPropagation(); };

            // Клик по пункту списка — toggle (не закрываем dropdown!)
            list.onclick = function(e) {
                var item = e.target.closest('.bst-pair-item');
                if (item) {
                    // stopPropagation КРИТИЧНО — иначе document.click считает
                    // клик "снаружи" и закрывает dropdown, потому что после
                    // togglePair() элемент уже перерендерен и e.target — это
                    // удалённая нода, которой нет в root.contains().
                    e.stopPropagation();
                    togglePair(item.getAttribute('data-pair'));
                }
            };

            // Enter в поиске — добавить/убрать первый подходящий
            searchInput.onkeydown = function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var first = list.querySelector('.bst-pair-item');
                    if (first) togglePair(first.getAttribute('data-pair'));
                } else if (e.key === 'Escape') {
                    closeDropdown();
                }
            };

            // Клик вне дропдауна — закрыть
            document.addEventListener('click', function outsideClickHandler(e) {
                var root = body.querySelector('#bstPairSelect');
                if (!root) { document.removeEventListener('click', outsideClickHandler); return; }
                if (!root.contains(e.target)) closeDropdown();
            });

            // Начальная отрисовка
            updateTriggerLabel();
        })();

        // Обновлятор текста кнопки запуска — меняется при каждом изменении _state.pairs
        function updateLaunchBtnLabel() {
            var btn = document.getElementById('bstLaunchBtn');
            if (!btn) return;
            var n = (_state.pairs && _state.pairs.length) || 1;
            var arrowSvg = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="vertical-align:-1px;"><polygon points="1,0 10,5 1,10"/></svg>';
            if (n <= 1) {
                btn.innerHTML = arrowSvg + ' Запустить бота';
            } else {
                btn.innerHTML = arrowSvg + ' Запустить ботов (' + n + ')';
            }
        }

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
        var stepTpToggle = body.querySelector('#bstStepTpToggle');
        if (trailToggle) trailToggle.onchange = function() {
            _state.trailingEnabled = trailToggle.checked;
            var tb = body.querySelector('#bstTrailBody');
            if (tb) {
                tb.style.opacity = trailToggle.checked ? '1' : '0.55';
                tb.style.pointerEvents = trailToggle.checked ? 'auto' : 'none';
            }
            // Взаимоисключение: при включении Trailing → выключаем Step TP
            if (trailToggle.checked && stepTpToggle) {
                stepTpToggle.checked = false;
                stepTpToggle.disabled = true;
                _state.stepTpEnabled = false;
                var stpBody = body.querySelector('#bstStepTpBody');
                if (stpBody) {
                    stpBody.style.opacity = '0.55';
                    stpBody.style.pointerEvents = 'none';
                }
            } else if (stepTpToggle) {
                stepTpToggle.disabled = false;
            }
            updateSummary();
        };

        // Step TP toggle
        if (stepTpToggle) stepTpToggle.onchange = function() {
            _state.stepTpEnabled = stepTpToggle.checked;
            var stpBody = body.querySelector('#bstStepTpBody');
            if (stpBody) {
                stpBody.style.opacity = stepTpToggle.checked ? '1' : '0.55';
                stpBody.style.pointerEvents = stepTpToggle.checked ? 'auto' : 'none';
            }
            // Взаимоисключение: при включении Step TP → выключаем Trailing
            if (stepTpToggle.checked && trailToggle) {
                trailToggle.checked = false;
                trailToggle.disabled = true;
                _state.trailingEnabled = false;
                var tb = body.querySelector('#bstTrailBody');
                if (tb) {
                    tb.style.opacity = '0.55';
                    tb.style.pointerEvents = 'none';
                }
            } else if (trailToggle && !_state.bbExitEnabled) {
                trailToggle.disabled = false;
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

        // SMA-Return toggle: включение активирует поле толеранса
        var smaReturnToggle = body.querySelector('#bstSmaReturnToggle');
        if (smaReturnToggle) smaReturnToggle.onchange = function() {
            var on = smaReturnToggle.checked;
            _state.smaReturnEnabled = on;

            var smaBody = body.querySelector('#bstSmaReturnBody');
            if (smaBody) {
                smaBody.style.opacity = on ? '1' : '0.55';
                smaBody.style.pointerEvents = on ? 'auto' : 'none';
            }

            updateSummary();
        };

        // ── Manual-стратегия: биндинги ──
        // Inputs: стоп % и фикс-размер %
        var manualStopInp = body.querySelector('#bstManualStopPct');
        if (manualStopInp) manualStopInp.onchange = function() {
            _state.manualStopPct = manualStopInp.value;
            updateSummary();
        };
        var manualFixedInp = body.querySelector('#bstManualFixedSizePct');
        if (manualFixedInp) manualFixedInp.onchange = function() {
            _state.manualFixedSizePct = manualFixedInp.value;
            updateSummary();
        };

        // Size mode segmented: By risk / Fixed %
        // Используем data-msize вместо data-v, чтобы не конфликтовать с bindToggleGroup.
        body.querySelectorAll('[data-msize]').forEach(function(el) {
            el.onclick = function() {
                body.querySelectorAll('[data-msize]').forEach(function(o) { o.classList.remove('bst-tog-on'); });
                el.classList.add('bst-tog-on');
                _state.manualSizeMode = el.dataset.msize;
                var fixedRow = body.querySelector('#bstManualFixedRow');
                if (fixedRow) fixedRow.style.display = (_state.manualSizeMode === 'fixed') ? '' : 'none';
                updateSummary();
            };
        });

        // Manual timeout toggle — переиспользует positionTimeout из секции "Управление позицией"
        var manualTimeoutToggle = body.querySelector('#bstManualTimeoutToggle');
        if (manualTimeoutToggle) manualTimeoutToggle.onchange = function() {
            _state.manualTimeoutEnabled = manualTimeoutToggle.checked;
            var row = body.querySelector('#bstManualTimeoutRow');
            if (row) row.style.display = manualTimeoutToggle.checked ? '' : 'none';
            updateSummary();
        };

        // Manual timeout input — пишем в то же поле positionTimeout,
        // что и в авто-стратегиях, чтобы бэкенд получил значение тем же путём.
        var manualTimeoutInput = body.querySelector('#bstManualTimeoutInput');
        if (manualTimeoutInput) manualTimeoutInput.onchange = function() {
            _state.positionTimeout = manualTimeoutInput.value;
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
            bstStopFixed: 'stopFixedPct',
            bstRiskPct: 'riskPct', bstDayLimit: 'dayLimitPct', bstMaxLosses: 'maxLosses',
            bstBalance: 'virtualBalance', bstTrailOffset: 'trailingOffset', bstTrailAct: 'trailingActivation',
            bstStepTpTrigger: 'stepTpTrigger', bstStepTpStep: 'stepTpStep', bstStepTpTolerance: 'stepTpTolerance',
            bstLeverage: 'maxLeverage',
            bstBbTol: 'bbExitTolerance', bstSmaTol2: 'smaReturnTolerance'
        };
        Object.keys(inputMap).forEach(function(id) {
            var inp = body.querySelector('#' + id);
            if (inp) {
                inp.onchange = function() { _state[inputMap[id]] = inp.value; updateSummary(); };
                inp.oninput = function() { _state[inputMap[id]] = inp.value; updateSummary(); };
            }
        });

        // ── Переключатель режима стопа: ATR ↔ Fixed% ──
        var stopModeToggle = body.querySelector('#bstStopModeToggle');
        if (stopModeToggle) {
            stopModeToggle.onclick = function() {
                _state.stopMode = (_state.stopMode === 'fixed') ? 'atr' : 'fixed';
                var atrInp   = body.querySelector('#bstStopAtr');
                var fixedInp = body.querySelector('#bstStopFixed');
                var lblParent = stopModeToggle.parentElement;
                if (_state.stopMode === 'fixed') {
                    if (atrInp)   atrInp.style.display   = 'none';
                    if (fixedInp) fixedInp.style.display = '';
                    if (lblParent) lblParent.firstChild.textContent = 'Стоп · % ';
                    stopModeToggle.textContent = 'ATR';
                } else {
                    if (atrInp)   atrInp.style.display   = '';
                    if (fixedInp) fixedInp.style.display = 'none';
                    if (lblParent) lblParent.firstChild.textContent = 'Стоп · ×ATR ';
                    stopModeToggle.textContent = 'Fixed%';
                }
                updateSummary();
            };
        }

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

            // ── Live-guard: не пускаем без сохранённых ключей ──
            // Серверный guard это перепроверит, но UX лучше — сразу понятно почему не стартует.
            if (_state.mode === 'live') {
                var apiSt = document.getElementById('bstApiStatus');
                var keysSaved = apiSt && apiSt.style.display !== 'none';
                if (!keysSaved) {
                    var apiRes = document.getElementById('bstApiTestResult');
                    if (apiRes) {
                        apiRes.style.color = '#ef5350';
                        apiRes.textContent = 'Сначала сохраните API ключи (введите → Проверить → Сохранить)';
                    }
                    var sec = document.getElementById('bstApiSection');
                    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            }

            // Защита от двойного клика
            var btn = this;
            if (btn._busy) return;
            btn._busy = true;

            var pairs = (_state.pairs && _state.pairs.length) ? _state.pairs.slice() : [_state.pair || 'BTC/USDT'];

            if (pairs.length === 1) {
                // Одна пара — обычный путь: стартуем текущую сессию
                _state.pair = pairs[0];
                startBot();
                closeModal();
                btn._busy = false;
                return;
            }

            // Несколько пар — создаём и запускаем по очереди.
            // Первая пара использует текущую сессию (это тот бот что мы настраивали).
            // Для остальных создаём НОВЫЕ сессии через /api/bot/create, потом запускаем.
            btn.innerHTML = '...';
            var uid = getUid();

            // 1) Первый бот — стартуем текущую сессию с первой парой
            _state.pair = pairs[0];
            startBotSilent(uid, pairs[0]).then(function() {
                // 2) Остальные боты — создаём новые и стартуем
                var rest = pairs.slice(1);
                function next(i) {
                    if (i >= rest.length) {
                        btn._busy = false;
                        closeModal();
                        loadBotList();
                        return;
                    }
                    var pair = rest[i];
                    fetch('/api/bot/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid: uid })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (!data.ok || !data.botId) { next(i + 1); return; }
                        return startBotSilent(uid, pair, data.botId);
                    })
                    .then(function() { next(i + 1); })
                    .catch(function() { next(i + 1); });
                }
                next(0);
            }).catch(function() {
                btn._busy = false;
                closeModal();
            });
        };

        // Внутренний помощник — старт бота без изменения UI текущего виджета.
        // Используется для batch-запуска нескольких пар.
        function startBotSilent(uid, pair, botId) {
            var targetBotId = botId || _state.botId;
            return fetch('/api/bot/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: uid,
                    botId: targetBotId,
                    pair: pair,
                    strategy: _state.strategy,
                    timeframe: _state.timeframe,
                    direction: _state.direction,
                    entryMode: _state.entryMode,
                    mode: _state.mode || 'paper',
                    virtualBalance: parseFloat(_state.virtualBalance) || 10000,
                    riskPct: parseFloat(_state.riskPct) || 2,
                    dayLimitPct: parseFloat(_state.dayLimitPct) || 50,
                    maxLosses: parseInt(_state.maxLosses) || 30,
                    maxLeverage: parseInt(_state.maxLeverage) || 3,
                    volumeMultiplier: parseFloat(_state.volumeMultiplier) || 1.0,
                    positionTimeout: parseInt(_state.positionTimeout) || 30,
                    maxProfitPct: parseFloat(_state.maxProfitPct) || 1.0,
                    cooldownCandles: parseInt(_state.cooldownCandles) || 5,
                    stopAtrMultiplier: parseFloat(_state.stopAtrMultiplier) || 1.5,
                    stopMode: _state.stopMode === 'fixed' ? 'fixed' : 'atr',
                    stopFixedPct: parseFloat(_state.stopFixedPct) || 0.5,
                    trailingEnabled: !!_state.trailingEnabled,
                    trailingOffset: _state.trailingOffset,
                    trailingActivation: _state.trailingActivation,
                    stepTpEnabled: !!_state.stepTpEnabled,
                    stepTpTrigger: _state.stepTpTrigger,
                    stepTpStep: _state.stepTpStep,
                    stepTpTolerance: _state.stepTpTolerance,
                    clusterEnabled: _state.clusterEnabled,
                    clusterThreshold: _state.clusterThreshold,
                    clusterExitConfirm: _state.clusterExitConfirm,
                    bbPeriod: _state.bbPeriod,
                    bbMultiplier: _state.bbMultiplier,
                    rsiPeriod: _state.rsiPeriod,
                    rsiOverbought: _state.rsiOverbought,
                    rsiOversold: _state.rsiOversold,
                    bbExitEnabled: !!_state.bbExitEnabled,
                    bbExitTolerance: _state.bbExitTolerance,
                    smaReturnEnabled: !!_state.smaReturnEnabled,
                    smaReturnTolerance: _state.smaReturnTolerance,
                    atrFilterEnabled: !!_state.atrFilterEnabled,
                    atrFilterThreshold: _state.atrFilterThreshold,
                    notifyEnabled: _state.notifyEnabled !== false,
                    // Manual-стратегия
                    manualStopPct: parseFloat(_state.manualStopPct) || 0.5,
                    manualSizeMode: _state.manualSizeMode === 'fixed' ? 'fixed' : 'risk',
                    manualFixedSizePct: parseFloat(_state.manualFixedSizePct) || 10,
                    manualTimeoutEnabled: !!_state.manualTimeoutEnabled,
                })
            }).then(function(r) { return r.json(); });
        }

        // Initial summary
        updateSummary();
    }


    function updateSummary() {
        var el = document.getElementById('bstSummary');
        if (!el) return;

        var stratLabel = _state.strategy === 'mean_reversion' ? 'Mean Reversion (BB+RSI)'
                      : _state.strategy === 'manual' ? 'Ручной (без автосигналов)'
                      : 'Скальпер (Кластеры)';
        var dirLabel = _state.direction === 'both' ? 'Оба' : (_state.direction === 'long' ? 'Long' : 'Short');
        var entryLabel = _state.entryMode === 'tick' ? 'По тику' : 'По свече';
        var trailLabel = _state.trailingEnabled
            ? 'Вкл (' + parseFloat(_state.trailingOffset).toFixed(2) + '%, акт. ' + _state.trailingActivation + '%)'
            : 'Выкл';
        var stepTpLabel = _state.stepTpEnabled
            ? 'Вкл ($' + parseFloat(_state.stepTpTrigger).toFixed(2) + ' / ' + parseFloat(_state.stepTpStep).toFixed(2) + ' / ' + parseFloat(_state.stepTpTolerance).toFixed(2) + ')'
            : 'Выкл';
        var modeLabel = (_state.mode === 'live' ? 'Live' : 'Paper');

        var rsiOS = 100 - (parseInt(_state.rsiOverbought) || 65);
        var rsiOB = parseInt(_state.rsiOverbought) || 65;

        var pairsLabel;
        if (_state.pairs && _state.pairs.length > 1) {
            // До 3 пар — перечисляем через запятую, больше — укорачиваем до "N пар"
            if (_state.pairs.length <= 3) {
                pairsLabel = _state.pairs.join(', ');
            } else {
                pairsLabel = _state.pairs.length + ' пар';
            }
        } else {
            pairsLabel = _state.pair;
        }

        // RSI-строку прячем только в Scalper — там RSI не используется в логике.
        // В Mean Reversion и Manual оставляем как было.
        var rsiSummaryRow = _state.strategy !== 'scalper'
            ? '<div class="bst-sum-row"><span class="bst-sum-key">RSI</span><span class="bst-sum-val"><span class="bst-rsi-os">' + rsiOS + '</span><span class="bst-rsi-dash"> / </span><span class="bst-rsi-ob">' + rsiOB + '</span></span></div>'
            : '';

        el.innerHTML = '\
            <div class="bst-sum-row"><span class="bst-sum-key">Стратегия</span><span class="bst-sum-val bst-sum-accent">' + stratLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Пара / ТФ</span><span class="bst-sum-val">' + pairsLabel + ' · ' + _state.timeframe + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Направление / Вход</span><span class="bst-sum-val">' + dirLabel + ' · ' + entryLabel + '</span></div>\
            ' + rsiSummaryRow + '\
            <div class="bst-sum-row"><span class="bst-sum-key">Стоп / Тейк</span><span class="bst-sum-val">' + (_state.stopMode === 'fixed' ? (_state.stopFixedPct + '% fixed') : (_state.stopAtrMultiplier + '× ATR')) + ' / ' + _state.maxProfitPct + '%</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Трейлинг</span><span class="bst-sum-val ' + (_state.trailingEnabled ? 'bst-sum-accent' : '') + '">' + trailLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Шаговый TP</span><span class="bst-sum-val ' + (_state.stepTpEnabled ? 'bst-sum-accent' : '') + '">' + stepTpLabel + '</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Риск / Плечо</span><span class="bst-sum-val">' + _state.riskPct + '% / ' + _state.maxLeverage + 'x</span></div>\
            <div class="bst-sum-row"><span class="bst-sum-key">Баланс</span><span class="bst-sum-val">' + (parseFloat(_state.virtualBalance) || 10000) + ' USDT · ' + modeLabel + '</span></div>';
    }


    /* ══════════════════════════════════════════
       ДЕЙСТВИЯ: СТАРТ / СТОП / РЕЗЮМЕ
    ══════════════════════════════════════════ */

    // Price number — динамическая точность форматирования цены по величине:
    // BTC (>=100) → 2 знака, ETH ≥10 → 3, NEAR ≥1 → 4, <1 → 5.
    // На уровне модуля чтобы быть доступной из showJournalModal и exportTradesToCSV.
    function pn(v) {
        if (v == null || isNaN(v)) return '';
        var x = Number(v);
        if (x >= 100)  return x.toFixed(2);
        if (x >= 10)   return x.toFixed(3);
        if (x >= 1)    return x.toFixed(4);
        return x.toFixed(5);
    }

    function getUid() {
        return (window.firebase && window.firebase.auth && window.firebase.auth().currentUser)
            ? window.firebase.auth().currentUser.uid : 'anonymous';
    }

    // Синхронизирует отрисовку BB/уровней бота на графике с текущей стратегией.
    // - MR/Scalper: всегда поллим (там стратегия сама диктует что рисовать)
    // - Manual: поллим только если включена галочка BB или Уровни — иначе нет смысла
    //   дёргать сервер. Если обе выключены — останавливаем и очищаем график.
    // Вызывается из всех точек, где раньше звались _startBotLevels/_stopBotLevels напрямую.
    function syncBotLevelsVisibility() {
        var needPolling;
        if (_state.strategy === 'manual') {
            needPolling = !!(_state.manualShowBB || _state.manualShowLevels);
        } else {
            needPolling = true;
        }
        if (needPolling) {
            if (typeof window._startBotLevels === 'function') window._startBotLevels();
        } else {
            if (typeof window._stopBotLevels === 'function') window._stopBotLevels();
        }
    }

    function startBot() {
        if (_state._starting) return; // защита от двойного клика
        _state._starting = true;

        var uid = getUid();
        var startBtn = document.getElementById('botWidgetStart');
        // Сохраняем оригинальный HTML кнопки, чтобы вернуть его в любой ветке
        // (успех / ошибка / зависание / сетевой сбой). Раньше в catch и при
        // !data.ok текст не восстанавливался — кнопка зависала на "..." до перезагрузки страницы.
        var startBtnOrigHtml = startBtn ? startBtn.innerHTML : null;
        function restoreStartBtn() {
            if (startBtn && startBtnOrigHtml !== null) {
                startBtn.disabled = false;
                startBtn.innerHTML = startBtnOrigHtml;
            }
        }
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
                stepTpEnabled: !!_state.stepTpEnabled,
                stepTpTrigger: _state.stepTpTrigger,
                stepTpStep: _state.stepTpStep,
                stepTpTolerance: _state.stepTpTolerance,
                maxProfitPct: _state.maxProfitPct,
                cooldownCandles: _state.cooldownCandles,
                stopAtrMultiplier: _state.stopAtrMultiplier,
                stopMode: _state.stopMode === 'fixed' ? 'fixed' : 'atr',
                stopFixedPct: _state.stopFixedPct,
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
                smaReturnEnabled: !!_state.smaReturnEnabled,
                smaReturnTolerance: _state.smaReturnTolerance,
                atrFilterEnabled: !!_state.atrFilterEnabled,
                atrFilterThreshold: _state.atrFilterThreshold,
                notifyEnabled: _state.notifyEnabled !== false,
                // Manual-стратегия
                manualStopPct: parseFloat(_state.manualStopPct) || 0.5,
                manualSizeMode: _state.manualSizeMode === 'fixed' ? 'fixed' : 'risk',
                manualFixedSizePct: parseFloat(_state.manualFixedSizePct) || 10,
                manualTimeoutEnabled: !!_state.manualTimeoutEnabled,
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _state._starting = false;
            restoreStartBtn();
            if (data.ok) {
                if (data.botId) _state.botId = data.botId;
                _state.running = true;
                _state.paused = false;
                updateBadge();
                updateButtons();
                startStatusPolling(uid);
                loadBotList();
                // Начинаем рисовать уровни бота на графике (только если стратегия не manual)
                window._botCurrentBotId = _state.botId;
                syncBotLevelsVisibility();
                // Автоматически переключаем график на пару и таймфрейм бота,
                // чтобы BB-полосы и маркеры рисовались на правильной шкале времени.
                if (typeof window._syncChartToBot === 'function') {
                    window._syncChartToBot(_state.pair, _state.timeframe);
                }
            } else {
                alert('Ошибка запуска: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) {
            _state._starting = false;
            restoreStartBtn();
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
            // Снимаем подсветку ТФ бота
            window._botActiveTimeframe = null;
            if (typeof window._updateBotTimeframeHighlight === 'function') {
                window._updateBotTimeframeHighlight();
            }
        })
        .catch(function(e) { console.warn('[BOT] stop error', e); });
    }

    /* ══════════════════════════════════════════
       МАССОВАЯ ОСТАНОВКА ВСЕХ АКТИВНЫХ БОТОВ
       - confirmStopAll: модалка подтверждения
       - doStopAll: последовательный стоп с индикатором прогресса
       После всех стопов шлёт ОДИН сводный push
    ══════════════════════════════════════════ */
    // Запуск всех Paper-ботов которые сейчас не работают.
    // Использует новый серверный endpoint /api/bot/start-by-id, который запускает
    // бота по уже сохранённым в сессии настройкам — НЕ перезаписывает их.
    // Live-боты не трогаем — для них нужна авторизация ключей и явное подтверждение.
    // Прогресс показывается прямо в кнопке: "0/5" → "1/5" → ... → возврат "▶ START".
    function startAllPaperBots() {
        var btn = document.getElementById('botStartAllBtn');
        if (!btn) return;
        if (btn._busy) return; // защита от двойного клика

        // Только остановленные не-Live боты.
        // Если у бота не задан mode — считаем что Paper (новые/после-рестарта).
        var stopped = (_state.bots || []).filter(function(b) {
            return !b.running && (b.mode || 'paper') !== 'live';
        });

        if (stopped.length === 0) {
            // Нечего запускать — мигаем кнопкой
            btn.style.opacity = '1';
            setTimeout(function() { btn.style.opacity = '0.75'; }, 800);
            return;
        }

        btn._busy = true;
        var total = stopped.length;
        var done = 0;
        var origHtml = btn.innerHTML;
        var uid = getUid();

        function updateBtnProgress() {
            btn.innerHTML = done + '/' + total + ' ...';
        }
        updateBtnProgress();

        // Последовательный запуск с задержкой 250мс — чтобы сервер не утонул в одновременных
        // WebSocket-подписках Binance и не словил rate-limit.
        var i = 0;
        function startNext() {
            if (i >= total) {
                btn.innerHTML = origHtml;
                btn._busy = false;
                loadBotList();
                return;
            }
            var bot = stopped[i];
            fetch('/api/bot/start-by-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: bot.botId })
            })
            .catch(function(e) { console.warn('[BOT] start-all error for', bot.botId, e); })
            .finally(function() {
                i++;
                done = i;
                updateBtnProgress();
                setTimeout(startNext, 250);
            });
        }
        startNext();
    }

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

    /* ══════════════════════════════════════════
       АВАРИЙНЫЙ СТОП ТОЛЬКО ДЛЯ LIVE-БОТОВ
       Закрывает все открытые Live-позиции через market reduceOnly,
       отменяет все алго-ордера на бирже, и останавливает Live-ботов.
       Paper-боты не трогает.
    ══════════════════════════════════════════ */
    function confirmStopAllLive() {
        var old = document.getElementById('botStopAllLiveModal');
        if (old) old.remove();

        // Только запущенные live-боты
        var liveRunning = (_state.bots || []).filter(function(b) { return b.running && b.mode === 'live'; });
        var count = liveRunning.length;
        var withPositions = liveRunning.filter(function(b) { return !!b.position; }).length;

        if (count === 0) {
            // Если live-ботов нет — мигаем кнопкой и выходим
            var btn = document.getElementById('botStopAllLiveBtn');
            if (btn) {
                btn.style.opacity = '1';
                setTimeout(function() { btn.style.opacity = '0.85'; }, 800);
            }
            return;
        }

        var dayPnlTotal = liveRunning.reduce(function(s, b) { return s + (b.dayPnl || 0); }, 0);
        var pnlSign = dayPnlTotal >= 0 ? '+' : '−';
        var pnlAbs = Math.abs(dayPnlTotal).toFixed(2);
        var word = pluralBotsRu(count);

        var modal = document.createElement('div');
        modal.id = 'botStopAllLiveModal';
        modal.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = '\
            <div style="background:#1A1D23;border-radius:12px;border:1px solid rgba(239,68,68,0.4);width:90%;max-width:400px;padding:20px;">\
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">\
                        <circle cx="11" cy="11" r="10" stroke="#EF4444" stroke-width="1.5" fill="none"/>\
                        <path d="M11 6 L11 12 M11 14.5 L11 16" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round"/>\
                    </svg>\
                    <span style="font-size:14px;font-weight:700;color:#EF4444;">Аварийный стоп Live</span>\
                </div>\
                <div style="font-size:13px;color:#94A3B8;line-height:1.5;margin-bottom:14px;">\
                    Будет аварийно закрыто <span style="color:#E2E8F0;font-weight:600;">' + count + ' Live-' + word + '</span>' + (withPositions > 0 ? ' (с позициями: <span style="color:#FBBF24;font-weight:600;">' + withPositions + '</span>)' : '') + '.<br>\
                    Открытые позиции будут <span style="color:#EF4444;font-weight:600;">закрыты по рынку</span>, все алго-ордера отменены.<br>\
                    P&L Live за сегодня: <span style="color:' + (dayPnlTotal >= 0 ? '#10B981' : '#EF4444') + ';font-weight:600;">' + pnlSign + '$' + pnlAbs + '</span>\
                </div>\
                <div style="font-size:11px;color:#FBBF24;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:4px;padding:8px 10px;margin-bottom:16px;line-height:1.4;">\
                    ⚠ Это действие нельзя отменить. Paper-боты не затрагиваются.\
                </div>\
                <div id="botStopAllLiveProgress" style="display:none;margin-bottom:14px;">\
                    <div style="font-size:12px;color:#94A3B8;margin-bottom:6px;">Закрываю: <span id="botStopAllLiveCounter">0 / ' + count + '</span></div>\
                    <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">\
                        <div id="botStopAllLiveBar" style="height:100%;width:0%;background:#EF4444;transition:width 0.2s;"></div>\
                    </div>\
                </div>\
                <div style="display:flex;gap:8px;justify-content:flex-end;" id="botStopAllLiveActions">\
                    <button id="botStopAllLiveCancel" style="padding:8px 14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94A3B8;font-size:12px;cursor:pointer;">Отмена</button>\
                    <button id="botStopAllLiveConfirm" style="padding:8px 14px;background:#EF4444;border:none;border-radius:5px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Закрыть и остановить</button>\
                </div>\
            </div>';

        var leftCol = document.querySelector('.left-col') || document.body;
        if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }

        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#botStopAllLiveCancel').onclick = function() { modal.remove(); };
        modal.querySelector('#botStopAllLiveConfirm').onclick = function() {
            doStopAllLive(liveRunning, modal);
        };
    }

    function doStopAllLive(runningBots, modal) {
        var uid = getUid();
        var total = runningBots.length;
        var dayPnlTotal = runningBots.reduce(function(s, b) { return s + (b.dayPnl || 0); }, 0);

        modal.querySelector('#botStopAllLiveProgress').style.display = 'block';
        modal.querySelector('#botStopAllLiveActions').style.display = 'none';

        var counterEl = modal.querySelector('#botStopAllLiveCounter');
        var barEl = modal.querySelector('#botStopAllLiveBar');

        var failures = [];
        var i = 0;
        function stopNext() {
            if (i >= total) {
                fetch('/api/bot/notify-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uid, count: total, dayPnlTotal: dayPnlTotal, emergency: true })
                }).catch(function() {});

                if (_state.running && _state.mode === 'live') {
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

                // Если что-то упало — оставляем модалку открытой с отчётом, иначе закрываем
                if (failures.length > 0) {
                    var actions = modal.querySelector('#botStopAllLiveActions');
                    var progress = modal.querySelector('#botStopAllLiveProgress');
                    if (progress) progress.style.display = 'none';
                    if (actions) {
                        actions.style.display = 'flex';
                        actions.innerHTML = '<div style="font-size:12px;color:#EF4444;flex:1;">⚠ ' + failures.length + ' из ' + total + ' закрылись с ошибкой. Проверь Binance вручную.</div>\
                            <button id="botStopAllLiveClose" style="padding:8px 14px;background:#EF4444;border:none;border-radius:5px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">OK</button>';
                        var closeBtn = actions.querySelector('#botStopAllLiveClose');
                        if (closeBtn) closeBtn.onclick = function() { modal.remove(); };
                    }
                } else {
                    setTimeout(function() { if (modal.parentNode) modal.remove(); }, 500);
                }
                return;
            }

            var bot = runningBots[i];
            fetch('/api/bot/emergency-close-live', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: bot.botId, silent: true })
            })
            .then(function(r) { return r.json().catch(function() { return {}; }); })
            .then(function(res) {
                if (res && res.ok === false) {
                    failures.push({ botId: bot.botId, error: res.error });
                    console.warn('[BOT] emergency-close error for', bot.botId, res.error);
                }
            })
            .catch(function(e) {
                failures.push({ botId: bot.botId, error: e.message });
                console.warn('[BOT] emergency-close fetch failed for', bot.botId, e);
            })
            .finally(function() {
                i++;
                if (counterEl) counterEl.textContent = i + ' / ' + total;
                if (barEl) barEl.style.width = (i / total * 100) + '%';
                setTimeout(stopNext, 300);
            });
        }
        stopNext();
    }
    function confirmDeleteAllBots() {
        var old = document.getElementById('botDeleteAllModal');
        if (old) old.remove();

        var bots = _state.bots || [];
        var count = bots.length;
        if (count === 0) return;

        var runningCount = bots.filter(function(b) { return b.running; }).length;
        var word = pluralBotsRu(count);

        var modal = document.createElement('div');
        modal.id = 'botDeleteAllModal';
        modal.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = '\
            <div style="background:#1A1D23;border-radius:12px;border:1px solid rgba(255,255,255,0.08);width:90%;max-width:380px;padding:20px;">\
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">\
                        <path d="M2 4h12M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M4 4v9a1 1 0 001 1h6a1 1 0 001-1V4" stroke="#EF4444" stroke-width="1.2" fill="none"/>\
                    </svg>\
                    <span style="font-size:14px;font-weight:700;color:#E2E8F0;">Удалить всех ботов?</span>\
                </div>\
                <div style="font-size:13px;color:#94A3B8;line-height:1.5;margin-bottom:18px;">\
                    Будет удалено <span style="color:#E2E8F0;font-weight:600;">' + count + ' ' + word + '</span>' + (runningCount > 0 ? ' (из них ' + runningCount + ' запущено)' : '') + '.<br>\
                    <span style="color:#EF4444;">Это действие нельзя отменить.</span>\
                </div>\
                <div id="botDeleteAllProgress" style="display:none;margin-bottom:14px;">\
                    <div style="font-size:12px;color:#94A3B8;margin-bottom:6px;">Удаляю: <span id="botDeleteAllCounter">0 / ' + count + '</span></div>\
                    <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">\
                        <div id="botDeleteAllBar" style="height:100%;width:0%;background:#EF4444;transition:width 0.2s;"></div>\
                    </div>\
                </div>\
                <div style="display:flex;gap:8px;justify-content:flex-end;" id="botDeleteAllActions">\
                    <button id="botDeleteAllCancel" style="padding:8px 14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94A3B8;font-size:12px;cursor:pointer;">Отмена</button>\
                    <button id="botDeleteAllConfirm" style="padding:8px 14px;background:#EF4444;border:none;border-radius:5px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Удалить все</button>\
                </div>\
            </div>';

        var leftCol = document.querySelector('.left-col') || document.body;
        if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }

        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#botDeleteAllCancel').onclick = function() { modal.remove(); };
        modal.querySelector('#botDeleteAllConfirm').onclick = function() {
            doDeleteAllBots(bots.slice(), modal);
        };
    }

    function doDeleteAllBots(bots, modal) {
        var uid = getUid();
        var total = bots.length;
        var done = 0;

        // Скрываем actions, показываем прогресс
        var actions = modal.querySelector('#botDeleteAllActions');
        var progress = modal.querySelector('#botDeleteAllProgress');
        if (actions) actions.style.display = 'none';
        if (progress) progress.style.display = 'block';
        var counter = modal.querySelector('#botDeleteAllCounter');
        var bar = modal.querySelector('#botDeleteAllBar');

        function deleteNext() {
            if (done >= total) {
                // Всё удалено — чистим UI, закрываем модалку
                _state.bots = [];
                _state.botId = 'default';
                resetBotLocalState();
                updateBotSelector();
                setTimeout(function() { modal.remove(); }, 400);
                return;
            }
            var b = bots[done];
            fetch('/api/bot/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, botId: b.botId })
            })
            .then(function(r) { return r.json(); })
            .catch(function() {})
            .then(function() {
                done++;
                if (counter) counter.textContent = done + ' / ' + total;
                if (bar) bar.style.width = (done / total * 100).toFixed(0) + '%';
                deleteNext();
            });
        }
        deleteNext();
    }

    // ── Очистка журнала сделок (одного бота или всех) ──
    // Открывает модалку подтверждения, после подтверждения шлёт запрос на сервер.
    // isAllBots: true — чистим у всех ботов пользователя, false — только у текущего.
    function confirmClearTrades(isAllBots) {
        var old = document.getElementById('botClearTradesModal');
        if (old) old.remove();

        var title   = isAllBots ? 'Очистить журналы всех ботов?' : 'Очистить журнал этого бота?';
        var subtext = isAllBots
            ? 'Будут удалены сделки у <span style="color:#E2E8F0;font-weight:600;">всех ботов</span>. Открытые позиции не затрагиваются.'
            : 'Будут удалены сделки у <span style="color:#E2E8F0;font-weight:600;">текущего бота</span>. Открытая позиция не затрагивается.';

        var isMobile = window.innerWidth < 768;

        var modal = document.createElement('div');
        modal.id = 'botClearTradesModal';
        modal.style.cssText = 'position:' + (isMobile ? 'fixed' : 'absolute') + ';top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = '\
            <div style="background:#1A1D23;border-radius:12px;border:1px solid rgba(255,255,255,0.08);width:90%;max-width:380px;padding:20px;">\
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">\
                        <path d="M2 4h12M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M4 4v9a1 1 0 001 1h6a1 1 0 001-1V4" stroke="#EF4444" stroke-width="1.2" fill="none"/>\
                    </svg>\
                    <span style="font-size:14px;font-weight:700;color:#E2E8F0;">' + title + '</span>\
                </div>\
                <div style="font-size:13px;color:#94A3B8;line-height:1.5;margin-bottom:18px;">' + subtext + '<br>\
                    <span style="color:#EF4444;">Это действие нельзя отменить.</span>\
                </div>\
                <div style="display:flex;gap:8px;justify-content:flex-end;">\
                    <button id="botClearTradesCancel" style="padding:8px 14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94A3B8;font-size:12px;cursor:pointer;">Отмена</button>\
                    <button id="botClearTradesConfirm" style="padding:8px 14px;background:#EF4444;border:none;border-radius:5px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Очистить</button>\
                </div>\
            </div>';

        // На мобилке вешаем на body (журнал там fullscreen), на десктопе — на .left-col
        if (isMobile) {
            document.body.appendChild(modal);
        } else {
            var leftCol = document.querySelector('.left-col') || document.body;
            if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }
        }

        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#botClearTradesCancel').onclick = function() { modal.remove(); };
        modal.querySelector('#botClearTradesConfirm').onclick = function() {
            doClearTrades(isAllBots, modal);
        };
    }

    function doClearTrades(isAllBots, modal) {
        var uid = getUid();
        var body = { uid: uid };
        if (!isAllBots) body.botId = _state.botId || 'default';

        // Показываем "Очищаю..." вместо кнопок
        var btn = modal.querySelector('#botClearTradesConfirm');
        var cancelBtn = modal.querySelector('#botClearTradesCancel');
        if (btn) { btn.textContent = 'Очищаю...'; btn.disabled = true; btn.style.opacity = '0.6'; }
        if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.style.opacity = '0.5'; }

        fetch('/api/bot/clear-trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            modal.remove();
            // Закрываем и заново открываем журнал, чтобы показать обновлённые данные
            var jModal = document.getElementById('botJournalModal');
            if (jModal) jModal.remove();
            openJournal(isAllBots);
        })
        .catch(function(err) {
            if (btn) { btn.textContent = 'Ошибка'; btn.style.background = '#6b1a1a'; }
            console.error('[clearTrades] error:', err);
            setTimeout(function() { modal.remove(); }, 1500);
        });
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
        // В manual + Limit режиме берём цену из поля ввода, шлём orderType=limit.
        // В остальных случаях — market (как было).
        var orderType = 'market';
        var limitPrice = null;
        if (_state.strategy === 'manual' && _state.manualOrderType === 'limit') {
            var inp = document.getElementById('botLimitEntryPrice');
            limitPrice = inp ? parseFloat(inp.value) : NaN;
            if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
                alert('Введите цену лимитки');
                return;
            }
            orderType = 'limit';
        }

        var payload = { uid: uid, botId: _state.botId, side: side, orderType: orderType };
        if (orderType === 'limit') payload.limitPrice = limitPrice;

        fetch('/api/bot/manual-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                // Если вернулась pendingLimit — сразу подставим в state, чтобы UI перерисовался
                if (data.pendingLimit) _state.pendingLimit = data.pendingLimit;
                renderManualButtons();
                pollStatus(uid);
            } else {
                alert('Ошибка: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) { console.warn('[BOT] manual trade error', e); });
    }

    function cancelPendingLimitOrder() {
        var uid = getUid();
        fetch('/api/bot/cancel-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.pendingLimit = null;
                renderManualButtons();
                pollStatus(uid);
            } else {
                alert('Ошибка: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) { console.warn('[BOT] cancel limit error', e); });
    }

    function setExitLimit(price) {
        var uid = getUid();
        fetch('/api/bot/set-exit-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId, price: price })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                if (data.pendingExit) _state.pendingExit = data.pendingExit;
                renderManualButtons();
                pollStatus(uid);
            } else {
                alert('Ошибка: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) { console.warn('[BOT] set exit limit error', e); });
    }

    function cancelExitLimit() {
        var uid = getUid();
        fetch('/api/bot/cancel-exit-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uid, botId: _state.botId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _state.pendingExit = null;
                renderManualButtons();
                pollStatus(uid);
            } else {
                alert('Ошибка: ' + (data.error || 'unknown'));
            }
        })
        .catch(function(e) { console.warn('[BOT] cancel exit limit error', e); });
    }

    function manualClose() {
        var uid = getUid();
        var btn = document.getElementById('botManualClose');
        // Защита от двойного клика — если уже идёт запрос, выходим тихо
        if (btn && btn.dataset.busy === '1') return;
        if (btn) {
            btn.dataset.busy = '1';
            btn.dataset.origText = btn.textContent;
            btn.textContent = 'Закрывается...';
            btn.style.opacity = '0.6';
            btn.style.pointerEvents = 'none';
        }
        function restoreBtn() {
            if (!btn) return;
            btn.dataset.busy = '0';
            if (btn.dataset.origText) btn.textContent = btn.dataset.origText;
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        }
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
                // В Live кнопка снимется когда renderPosition увидит position=null после polled ответа.
                // Для надёжности всё равно восстановим через таймер.
                setTimeout(restoreBtn, 1500);
            } else {
                // "Позиция уже закрывается" — это нормальное состояние при гонке
                // (например пользователь уже кликнул раньше). Не показываем alert,
                // только восстанавливаем кнопку.
                var msg = data.error || 'unknown';
                if (msg.indexOf('уже закрывается') !== -1) {
                    console.log('[BOT] manual-close: ' + msg);
                } else {
                    alert('Ошибка закрытия: ' + msg);
                }
                restoreBtn();
            }
        })
        .catch(function(e) {
            alert('Ошибка закрытия: ' + e.message);
            restoreBtn();
        });
    }



    /* ══════════════════════════════════════════
       ЖУРНАЛ СДЕЛОК БОТА
    ══════════════════════════════════════════ */

    function openJournal(showAll) {
        var uid = getUid();
        var url = showAll
            ? '/api/bot/trades-all?uid=' + uid + '&limit=1000'
            : '/api/bot/trades?uid=' + uid + '&botId=' + _state.botId + '&limit=1000';
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
            'manual_stop': 'Стоп бота', 'trailing_stop': 'Трейлинг', 'step_tp': 'Шаговый TP', 'cluster_exit': 'Кластер',
            'manual_close': 'Ручной', 'bb_touch': 'BB', 'sma_return': 'SMA'
        };

        // ── Хелперы для форматирования новых полей ──
        // Дельта времени от входа до события: "↑12 мин" или "↑3ч 15м"
        function deltaMin(fromTs, toTs) {
            if (!fromTs || !toTs) return null;
            var min = Math.round((toTs - fromTs) / 60000);
            if (min < 60) return min + ' мин';
            var h = Math.floor(min / 60);
            var m = min % 60;
            return h + 'ч' + (m ? ' ' + m + 'м' : '');
        }
        // Стрелка направления первого движения
        function firstMoveIcon(fm) {
            if (fm === 'favor') return '<span style="color:#10B981;">↑</span>';
            if (fm === 'adverse') return '<span style="color:#EF4444;">↓</span>';
            return '<span style="color:#636B76;">–</span>';
        }
        // Процент взятия от пика: pnl / maxFav × 100, только если пик был значимый
        function tookPctStr(t) {
            if (!t.maxUnrealized || t.maxUnrealized < 0.5) return null;
            var pct = Math.round((t.pnl / t.maxUnrealized) * 100);
            var col = pct >= 70 ? '#10B981' : pct >= 40 ? '#FBBF24' : '#EF4444';
            return '<span style="color:' + col + ';">' + pct + '%</span>';
        }

        // Определяем мобильный режим
        var isMobile = window.innerWidth < 768;

        // Колонка бота — всегда видна с полным лейблом
        var botColHeader = '<th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Бот</th>';

        // Строим содержимое — таблица для десктопа, карточки для мобилы
        var rowsHtml = '';
        var cardsHtml = '';
        var colSpan = 12;
        if (trades.length === 0) {
            rowsHtml = '<tr><td colspan="' + colSpan + '" style="text-align:center;color:#475569;padding:20px;">Сделок пока нет</td></tr>';
            cardsHtml = '<div style="text-align:center;color:#475569;padding:40px 20px;font-size:13px;">Сделок пока нет</div>';
        } else {
            trades.forEach(function(t, i) {
                var openTime = t.openedAt ? new Date(t.openedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
                var closeTime = t.closedAt ? new Date(t.closedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
                var openTimeShort = t.openedAt ? new Date(t.openedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}) : '—';
                var closeTimeShort = t.closedAt ? new Date(t.closedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}) : '—';
                var sideColor = t.side === 'SHORT' ? '#EF5350' : '#26a69a';
                var pnlColor = t.pnl >= 0 ? '#10B981' : '#EF4444';
                var reason = reasonMap[t.reason] || t.reason || '—';
                var entryP = t.entryPrice ? pn(t.entryPrice) : '—';
                var exitP = t.closePrice ? pn(t.closePrice) : '—';
                var pnlPct = t.pnlPct !== undefined ? ('(' + (t.pnlPct >= 0 ? '+' : '') + t.pnlPct + '%)') : '';
                var entryLabel = t.entryType === 'manual' ? 'Ручной' : (t.entryType === 'bot_tick' ? 'Бот (тик)' : 'Бот');
                var entryColor = t.entryType === 'manual' ? '#FBBF24' : '#3B82F6';
                var botLabel = t.botLabel || '—';
                var pnlStr = (t.pnl >= 0 ? '+' : '') + '$' + (t.pnl || 0).toFixed(2);

                // ── Время достижения пиков (относительно входа) ──
                var maxFavDelta = deltaMin(t.openedAt, t.maxUnrealizedAt);
                var maxAdvDelta = deltaMin(t.openedAt, t.maxDrawdownAt);
                var trailActDelta = deltaMin(t.openedAt, t.trailingActivatedAt);

                // ── DESKTOP: таблица (как раньше) ──
                var botCol = '<td style="padding:6px 4px;font-size:9px;color:#94A3B8;vertical-align:top;white-space:nowrap;" title="' + botLabel + '">' + botLabel + '</td>';

                // Группа 1 — "Вход": индикаторы при открытии
                var g1 = [];
                if (t.entryRsi != null) g1.push('RSI ' + t.entryRsi);
                if (t.entryClusterBuy != null) g1.push('Кл.вх B' + t.entryClusterBuy + '%');
                if (t.entryAtr != null) g1.push('ATR ' + t.entryAtr);
                if (t.strategy) g1.push(t.strategy === 'mean_reversion' ? 'MR' : 'Scalp');
                if (t.clusterEntryUsed) g1.push('Кл.фильтр');
                if (t.entryRegime && t.entryRegime.allowed) {
                    var reg = t.entryRegime;
                    function regArrow(v){ return v==='up'?'↑':v==='down'?'↓':'↑↓'; }
                    if (reg.tf4hState != null || reg.tf15mState != null || reg.tf5mState != null) {
                        // V2: 4h + 15m + 5m
                        g1.push('Режим 4h' + regArrow(reg.tf4hState) +
                                ' 15m' + regArrow(reg.tf15mState) +
                                ' 5m' + regArrow(reg.tf5mState) +
                                ' →' + reg.allowed);
                    } else {
                        // Старый формат (совместимость)
                        g1.push('Режим ' + (reg.tfHigher || '1h') + regArrow(reg.higher) + ' ' +
                               (reg.tfMain || '15m') + regArrow(reg.main) + ' →' + reg.allowed);
                    }
                }

                // Группа 2 — "Путь": как развивалась сделка
                var g2 = [];
                // Первое движение (стрелка)
                if (t.firstMoveSide) {
                    // Стрелка = физ. направление цены; текст = трактовка для позиции
                    var fmUp = (t.side === 'LONG' && t.firstMoveSide === 'favor') || (t.side === 'SHORT' && t.firstMoveSide === 'adverse');
                    var fmArrow = fmUp ? '↑' : '↓';
                    var fmWord  = t.firstMoveSide === 'favor' ? 'в нашу сторону' : 'против нас';
                    var fmCol2  = t.firstMoveSide === 'favor' ? '#10B981' : '#EF4444';
                    var fmTxt = '<span style="color:' + fmCol2 + ';">' + fmArrow + ' ' + fmWord + '</span>';
                    g2.push('Первое ' + fmTxt);
                }
                // Пик в плюс с таймингом и ценой
                if (t.maxUnrealized && t.maxUnrealized > 0.01) {
                    var mfTxt = '<span style="color:#10B981;">Макс+$' + t.maxUnrealized.toFixed(2) + '</span>';
                    if (maxFavDelta) mfTxt += ' <span style="color:#636B76;">(' + maxFavDelta;
                    if (t.maxUnrealizedPrice) mfTxt += ' @ ' + pn(t.maxUnrealizedPrice);
                    if (maxFavDelta) mfTxt += ')</span>';
                    g2.push(mfTxt);
                }
                // Пик в минус
                if (t.maxDrawdown && t.maxDrawdown < -0.01) {
                    var mdTxt = '<span style="color:#EF4444;">Макс−$' + Math.abs(t.maxDrawdown).toFixed(2) + '</span>';
                    if (maxAdvDelta) mdTxt += ' <span style="color:#636B76;">(' + maxAdvDelta;
                    if (t.maxDrawdownPrice) mdTxt += ' @ ' + pn(t.maxDrawdownPrice);
                    if (maxAdvDelta) mdTxt += ')</span>';
                    g2.push(mdTxt);
                }
                // Длительность
                if (t.durationMin != null) g2.push(t.durationMin + ' мин');
                // Взяли N% от пика
                var took = tookPctStr(t);
                if (took) g2.push('Взяли ' + took);

                // Группа 3 — "Выход": индикаторы на момент закрытия + трейлинг
                var g3 = [];
                if (t.exitClusterBuy != null) g3.push('Кл.вых B' + t.exitClusterBuy + '%');
                if (t.exitRsi != null) g3.push('RSI ' + t.exitRsi);
                if (t.exitAtr != null) g3.push('ATR ' + t.exitAtr);
                // Трейлинг: активировался и на каком уровне
                if (t.trailingActivated) {
                    var trTxt = 'TR акт.';
                    if (t.trailingActivatedPnl != null) trTxt += ' на +$' + t.trailingActivatedPnl.toFixed(2);
                    if (trailActDelta) trTxt += ' (' + trailActDelta + ')';
                    g3.push('<span style="color:#FBBF24;">' + trTxt + '</span>');
                } else if (t.reason === 'stop_loss' && t.maxUnrealized > 1) {
                    // Был пик но трейлинг не активировался — полезно знать
                    g3.push('<span style="color:#636B76;">TR не акт.</span>');
                }
                // Step TP: активировался и на каком уровне
                if (t.stepTpActivated) {
                    var stpDelta = deltaMin(t.openedAt, t.stepTpActivatedAt);
                    var stpTxt = 'STP';
                    if (t.stepTpMaxLevel != null) stpTxt += ' стоп $' + t.stepTpMaxLevel.toFixed(2);
                    if (stpDelta) stpTxt += ' (' + stpDelta + ')';
                    g3.push('<span style="color:#10B981;">' + stpTxt + '</span>');
                }

                // Собираем серую строку: три блока через " │ "
                var detailBlocks = [];
                if (g1.length) detailBlocks.push(g1.join(' · '));
                if (g2.length) detailBlocks.push(g2.join(' · '));
                if (g3.length) detailBlocks.push(g3.join(' · '));
                var detailsHtml = detailBlocks.length
                    ? '<div style="font-size:9px;color:#94A3B8;margin-top:3px;line-height:1.5;">' + detailBlocks.join(' <span style="color:#475569;">│</span> ') + '</div>'
                    : '';

                rowsHtml += '<tr data-trade-idx="' + i + '" style="border-bottom:1px solid rgba(255,255,255,0.04);">' +
                    '<td style="padding:6px 4px;color:#636B76;font-size:10px;vertical-align:top;">' + (i + 1) + '</td>' +
                    botCol +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + (t.pair || '—') + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + openTime + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + closeTime + '</td>' +
                    '<td style="padding:6px 4px;vertical-align:top;"><span style="color:' + sideColor + ';font-weight:600;font-size:10px;">' + (t.side || '—') + '</span></td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:' + entryColor + ';vertical-align:top;">' + entryLabel + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;">' + entryP + ' → ' + exitP + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;white-space:nowrap;">$' + (t.size != null ? t.size.toFixed(0) : '—') + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:' + pnlColor + ';font-weight:600;vertical-align:top;">' + pnlStr + ' <span style="font-weight:400;font-size:9px;">' + pnlPct + '</span></td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#636B76;vertical-align:top;">$' + (t.fee || 0).toFixed(2) + '</td>' +
                    '<td style="padding:6px 4px;font-size:10px;color:#94A3B8;vertical-align:top;max-width:260px;white-space:normal;word-break:break-word;">' + reason + detailsHtml + '</td>' +
                    '</tr>';

                // ── MOBILE: карточка, раскрывается по тапу ──
                // Скрытая часть — все технические детали
                var expandedRows = '';
                if (t.fee != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Комиссия</span><span style="color:#CBD5E1;">$' + t.fee.toFixed(2) + '</span></div>';
                // ── Блок "Вход" ──
                if (t.strategy) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Стратегия</span><span style="color:#CBD5E1;">' + (t.strategy === 'mean_reversion' ? 'Mean Reversion' : t.strategy === 'scalper' ? 'Scalper' : t.strategy) + '</span></div>';
                if (t.entryRsi != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">RSI на входе</span><span style="color:#CBD5E1;">' + t.entryRsi + '</span></div>';
                if (t.entryClusterBuy != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Кластер вход</span><span style="color:#CBD5E1;">B' + t.entryClusterBuy + '%</span></div>';
                if (t.entryAtr != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">ATR вход</span><span style="color:#CBD5E1;">' + t.entryAtr + '</span></div>';

                // ── Блок "Путь": пики с таймингом и первое движение ──
                if (t.firstMoveSide) {
                    var fmCol = t.firstMoveSide === 'favor' ? '#10B981' : '#EF4444';
                    var fmUp3 = (t.side === 'LONG' && t.firstMoveSide === 'favor') || (t.side === 'SHORT' && t.firstMoveSide === 'adverse');
                    var fmArr = fmUp3 ? '↑' : '↓';
                    var fmWrd = t.firstMoveSide === 'favor' ? 'в нашу сторону' : 'против нас';
                    var fmLbl = fmArr + ' ' + fmWrd;
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Первое движение</span><span style="color:' + fmCol + ';">' + fmLbl + '</span></div>';
                }
                if (t.maxUnrealized) {
                    var mfVal = '+$' + t.maxUnrealized.toFixed(2);
                    if (maxFavDelta) mfVal += ' <span style="color:#64748B;font-size:10px;">· ' + maxFavDelta + '</span>';
                    if (t.maxUnrealizedPrice) mfVal += ' <span style="color:#64748B;font-size:10px;">@ ' + pn(t.maxUnrealizedPrice) + '</span>';
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Макс +</span><span style="color:#10B981;">' + mfVal + '</span></div>';
                }
                if (t.maxDrawdown) {
                    var mdVal = '−$' + Math.abs(t.maxDrawdown).toFixed(2);
                    if (maxAdvDelta) mdVal += ' <span style="color:#64748B;font-size:10px;">· ' + maxAdvDelta + '</span>';
                    if (t.maxDrawdownPrice) mdVal += ' <span style="color:#64748B;font-size:10px;">@ ' + pn(t.maxDrawdownPrice) + '</span>';
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Макс −</span><span style="color:#EF4444;">' + mdVal + '</span></div>';
                }
                // Взяли N% от пика — отдельной строкой
                var tookM = tookPctStr(t);
                if (tookM) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Взяли от пика</span><span>' + tookM + '</span></div>';

                // ── Блок "Выход" ──
                if (t.exitClusterBuy != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Кластер выход</span><span style="color:#CBD5E1;">B' + t.exitClusterBuy + '%</span></div>';
                if (t.exitRsi != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">RSI выход</span><span style="color:#CBD5E1;">' + t.exitRsi + '</span></div>';
                if (t.exitAtr != null) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">ATR выход</span><span style="color:#CBD5E1;">' + t.exitAtr + '</span></div>';

                // ── Трейлинг: активировался или нет ──
                if (t.trailingActivated) {
                    var trVal = 'активирован';
                    if (t.trailingActivatedPnl != null) trVal += ' на +$' + t.trailingActivatedPnl.toFixed(2);
                    if (trailActDelta) trVal += ' <span style="color:#64748B;font-size:10px;">· ' + trailActDelta + '</span>';
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Трейлинг</span><span style="color:#FBBF24;">' + trVal + '</span></div>';
                } else if (t.reason === 'stop_loss' && t.maxUnrealized > 1) {
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Трейлинг</span><span style="color:#636B76;">не активировался</span></div>';
                }
                // ── Step TP: активировался или нет ──
                if (t.stepTpActivated) {
                    var stpDeltaExp = deltaMin(t.openedAt, t.stepTpActivatedAt);
                    var stpVal = 'активирован';
                    if (t.stepTpActivatedPnl != null) stpVal += ' на +$' + t.stepTpActivatedPnl.toFixed(2);
                    if (t.stepTpMaxLevel != null) stpVal += ', стоп → $' + t.stepTpMaxLevel.toFixed(2);
                    if (stpDeltaExp) stpVal += ' <span style="color:#64748B;font-size:10px;">· ' + stpDeltaExp + '</span>';
                    expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Шаговый TP</span><span style="color:#10B981;">' + stpVal + '</span></div>';
                }

                expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Тип входа</span><span style="color:' + entryColor + ';">' + entryLabel + '</span></div>';
                if (t.clusterEntryUsed) expandedRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Кластер-фильтр</span><span style="color:#FBBF24;">вкл</span></div>';
                if (t.entryRegime && t.entryRegime.allowed) {
                    var regM = t.entryRegime;
                    function regArrowM(v){ return v==='up'?'↑':v==='down'?'↓':'↑↓'; }
                    function regColorM(v){ return v==='up'?'#26a69a':v==='down'?'#ef5350':'#F59E0B'; }
                    var allowedColorM =
                        regM.allowed==='LONG'  ? '#26a69a' :
                        regM.allowed==='SHORT' ? '#ef5350' :
                        regM.allowed==='BLOCK' ? '#9ca3af' : '#F59E0B';
                    var regimeInner;
                    if (regM.tf4hState != null || regM.tf15mState != null || regM.tf5mState != null) {
                        // V2: 4h + 15m + 5m
                        regimeInner =
                            '<span style="color:#94A3B8;">4h </span>' +
                            '<span style="color:' + regColorM(regM.tf4hState) + ';font-weight:600;">' + regArrowM(regM.tf4hState) + '</span>' +
                            '<span style="color:#636B76;"> · </span>' +
                            '<span style="color:#94A3B8;">15m </span>' +
                            '<span style="color:' + regColorM(regM.tf15mState) + ';font-weight:600;">' + regArrowM(regM.tf15mState) + '</span>' +
                            '<span style="color:#636B76;"> · </span>' +
                            '<span style="color:#94A3B8;">5m </span>' +
                            '<span style="color:' + regColorM(regM.tf5mState) + ';font-weight:600;">' + regArrowM(regM.tf5mState) + '</span>' +
                            '<span style="color:#636B76;"> → </span>' +
                            '<span style="color:' + allowedColorM + ';font-weight:600;">' + regM.allowed + '</span>';
                    } else {
                        // Старый формат
                        regimeInner =
                            '<span style="color:#94A3B8;">' + (regM.tfHigher || '1h') + ' </span>' +
                            '<span style="color:' + regColorM(regM.higher) + ';font-weight:600;">' + regArrowM(regM.higher) + '</span>' +
                            '<span style="color:#636B76;"> · </span>' +
                            '<span style="color:#94A3B8;">' + (regM.tfMain || '15m') + ' </span>' +
                            '<span style="color:' + regColorM(regM.main) + ';font-weight:600;">' + regArrowM(regM.main) + '</span>' +
                            '<span style="color:#636B76;"> → </span>' +
                            '<span style="color:' + allowedColorM + ';font-weight:600;">' + regM.allowed + '</span>';
                    }
                    expandedRows +=
                        '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#64748B;">Режим рынка</span>' +
                        '<span>' + regimeInner + '</span></div>';
                }

                cardsHtml += '<div class="bjm-card" data-trade-idx="' + i + '" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:background 0.15s;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;">' +
                        '<span style="font-size:12px;font-weight:600;color:' + sideColor + ';letter-spacing:0.3px;">' + (t.side || '—') + ' · ' + pnlStr + ' <span style="font-weight:400;font-size:10px;opacity:0.8;">' + pnlPct + '</span></span>' +
                        '<span style="font-size:10px;color:#94A3B8;white-space:nowrap;">' + reason + '</span>' +
                    '</div>' +
                    '<div style="font-size:10px;color:#64748B;margin-bottom:8px;word-break:break-word;line-height:1.4;">' + botLabel + '</div>' +
                    '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94A3B8;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04);">' +
                        '<span>' + openTimeShort + ' → ' + closeTimeShort + (t.durationMin != null ? ' · ' + t.durationMin + ' мин' : '') + '</span>' +
                        '<span style="color:#CBD5E1;">' + entryP + ' → ' + exitP + '</span>' +
                    '</div>' +
                    (expandedRows ? '<div class="bjm-expanded" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.04);font-size:11px;">' + expandedRows + '</div>' : '') +
                    (expandedRows ? '<div class="bjm-expand-arrow" style="text-align:center;margin-top:6px;color:#475569;font-size:10px;">▼</div>' : '') +
                    '</div>';
            });
        }

        // Кнопка переключения
        var toggleBtnLabel = isAllBots ? 'Этот бот' : 'Все боты';
        var toggleBtnColor = isAllBots ? '#26a69a' : '#94A3B8';

        var modal = document.createElement('div');
        modal.id = 'botJournalModal';

        // Мобильный fullscreen vs десктопная центральная модалка
        var modalOuterStyle, modalInnerStyle, headerPadding, statsPadding, contentPadding, closeSize;
        if (isMobile) {
            modalOuterStyle = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0B0E16;z-index:9999;display:flex;flex-direction:column;';
            modalInnerStyle = 'background:#0B0E16;width:100%;height:100%;max-width:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;border-radius:0;border:none;';
            headerPadding = 'padding:16px 16px 14px;';
            statsPadding = 'padding:14px 16px;';
            contentPadding = 'padding:14px 14px 24px;';
            closeSize = 'width:40px;height:40px;';
        } else {
            modalOuterStyle = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
            modalInnerStyle = 'background:#1A1D23;border-radius:12px;border:1px solid rgba(255,255,255,0.08);width:95%;max-width:1400px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';
            headerPadding = 'padding:14px 18px;';
            statsPadding = 'padding:12px 18px;';
            contentPadding = 'padding:0 18px;';
            closeSize = 'width:24px;height:24px;';
        }
        modal.style.cssText = modalOuterStyle;

        // Содержимое — разное на мобиле и десктопе
        var contentHtml = isMobile
            ? '<div style="flex:1;overflow-y:auto;' + contentPadding + '-webkit-overflow-scrolling:touch;">' + cardsHtml + '</div>'
            : '<div style="flex:1;overflow-y:auto;' + contentPadding + '">\
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
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Размер</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">P&L</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Ком.</th>\
                            <th style="padding:8px 4px;font-size:9px;color:#475569;text-align:left;font-weight:600;">Выход по</th>\
                        </tr></thead>\
                        <tbody>' + rowsHtml + '</tbody>\
                    </table>\
                </div>';

        // Крестик крупнее на мобиле (40×40) и обычный на десктопе (24×24)
        var closeIconSize = isMobile ? 20 : 12;

        modal.innerHTML = '\
            <div style="' + modalInnerStyle + '">\
                <div style="' + headerPadding + 'display:flex;align-items:center;gap:' + (isMobile ? '5px' : '8px') + ';border-bottom:1px solid rgba(255,255,255,0.06);">\
                    <svg width="' + (isMobile ? 18 : 16) + '" height="' + (isMobile ? 18 : 16) + '" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#26a69a" stroke-width="1.2" fill="none"/><line x1="5" y1="4.5" x2="11" y2="4.5" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/><line x1="5" y1="7" x2="11" y2="7" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/><line x1="5" y1="9.5" x2="9" y2="9.5" stroke="#26a69a" stroke-width="1" stroke-linecap="round"/></svg>\
                    <span style="font-size:' + (isMobile ? '13px' : '13px') + ';font-weight:700;color:#E2E8F0;' + (isMobile ? '' : 'flex:1;') + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (isMobile ? 'min-width:0;flex-shrink:1;' : '') + '">Журнал' + (isMobile ? '' : ' сделок') + '</span>\
                    ' + (isMobile ? '<div style="flex:1;min-width:4px;"></div>' : '') + '\
                    <div id="botJournalCsv" style="cursor:pointer;font-size:' + (isMobile ? '0' : '10px') + ';padding:' + (isMobile ? '8px' : '3px 8px') + ';border-radius:5px;border:1px solid rgba(255,255,255,0.1);color:#94A3B8;transition:all 0.2s;display:flex;align-items:center;gap:4px;justify-content:center;' + (isMobile ? 'width:32px;height:32px;' : '') + '" title="Скачать CSV"><svg width="' + (isMobile ? 14 : 10) + '" height="' + (isMobile ? 14 : 10) + '" viewBox="0 0 10 10" fill="none"><path d="M5 1v6M2.5 4.5L5 7l2.5-2.5M1 8.5h8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (isMobile ? '' : 'CSV') + '</div>\
                    <div id="botJournalAnalytics" style="cursor:pointer;font-size:' + (isMobile ? '0' : '10px') + ';padding:' + (isMobile ? '8px' : '3px 8px') + ';border-radius:5px;border:1px solid rgba(38,166,154,0.30);color:#26a69a;transition:all 0.2s;display:flex;align-items:center;gap:4px;justify-content:center;' + (isMobile ? 'width:32px;height:32px;' : '') + '" title="Анализ сделок"><svg width="' + (isMobile ? 14 : 10) + '" height="' + (isMobile ? 14 : 10) + '" viewBox="0 0 10 10" fill="none"><path d="M1 9h8M2 9V6M4.5 9V4M7 9V2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (isMobile ? '' : 'Анализ') + '</div>\
                    <div id="botJournalClear" style="cursor:pointer;font-size:' + (isMobile ? '0' : '10px') + ';padding:' + (isMobile ? '8px' : '3px 8px') + ';border-radius:5px;border:1px solid rgba(239,68,68,0.25);color:#EF4444;transition:all 0.2s;display:flex;align-items:center;gap:4px;justify-content:center;' + (isMobile ? 'width:32px;height:32px;' : '') + '" title="Очистить журнал"><svg width="' + (isMobile ? 14 : 10) + '" height="' + (isMobile ? 14 : 10) + '" viewBox="0 0 10 10" fill="none"><path d="M2 3h6M3.5 3V2a0.5 0.5 0 0 1 0.5 -0.5h2a0.5 0.5 0 0 1 0.5 0.5v1M2.5 3l0.5 5.5a0.5 0.5 0 0 0 0.5 0.5h3a0.5 0.5 0 0 0 0.5 -0.5L7.5 3" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (isMobile ? '' : 'Очистить') + '</div>\
                    <div id="botJournalToggle" style="cursor:pointer;font-size:' + (isMobile ? '11px' : '10px') + ';padding:' + (isMobile ? '6px 10px' : '3px 8px') + ';border-radius:5px;border:1px solid rgba(255,255,255,0.1);color:' + toggleBtnColor + ';transition:all 0.2s;white-space:nowrap;">' + toggleBtnLabel + '</div>\
                    <div id="botJournalClose" style="cursor:pointer;color:#94A3B8;' + closeSize + 'display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background 0.15s;"><svg width="' + closeIconSize + '" height="' + closeIconSize + '" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>\
                </div>\
                <div id="botJournalFilters" style="' + statsPadding + 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid rgba(255,255,255,0.04);"></div>\
                <div id="botJournalStats" style="' + statsPadding + 'display:flex;gap:' + (isMobile ? '10px' : '16px') + ';flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.04);">\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Сделок <span style="color:#E2E8F0;font-weight:700;">' + totalTrades + '</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Win rate <span style="color:' + (winRate >= 50 ? '#10B981' : '#EF4444') + ';font-weight:700;">' + winRate + '%</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">P&L <span style="color:' + (totalPnl >= 0 ? '#10B981' : '#EF4444') + ';font-weight:700;">' + (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2) + '</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Комиссии <span style="color:#FBBF24;font-weight:700;">$' + totalFees.toFixed(2) + '</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Сред. <span style="color:#94A3B8;font-weight:700;">' + (avgPnl >= 0 ? '+' : '') + '$' + avgPnl.toFixed(2) + '</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Лучшая <span style="color:#10B981;font-weight:700;">+$' + best.toFixed(2) + '</span></div>\
                    <div style="font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;">Худшая <span style="color:#EF4444;font-weight:700;">$' + worst.toFixed(2) + '</span></div>\
                </div>\
                ' + contentHtml + '\
            </div>';

        // Привязываем к правильному контейнеру: на мобилке — к body (fullscreen), на десктопе — к графику
        if (isMobile) {
            document.body.appendChild(modal);
        } else {
            var leftCol = document.querySelector('.left-col') || document.body;
            if (leftCol) { leftCol.style.position = 'relative'; leftCol.appendChild(modal); }
        }

        modal.querySelector('#botJournalClose').onclick = function() { modal.remove(); };
        modal.querySelector('#botJournalToggle').onclick = function() { openJournal(!isAllBots); };
        modal.querySelector('#botJournalCsv').onclick = function() { exportTradesToCSV(trades, isAllBots); };
        modal.querySelector('#botJournalClear').onclick = function() { confirmClearTrades(isAllBots); };
        modal.querySelector('#botJournalAnalytics').onclick = function() {
            // isAllBots определяет скоуп: true → анализ всех ботов, false → конкретного бота
            openAnalytics(isAllBots ? null : (_state.botId || null));
        };

        // ════════════════════════════════════════════════════════════════
        //  ФИЛЬТРЫ ЖУРНАЛА — Вариант A (чипы в строку)
        //  7 фильтров + кнопка сброса. Активные подсвечены зелёным.
        //  При изменении: пересчитываем массив filtered и перерисовываем
        //  блок #botJournalContent (статистика + строки таблицы / карточки).
        // ════════════════════════════════════════════════════════════════
        var _journalFilters = {
            firstMove: 'all',  // 'all' | 'favor' | 'adverse'
            exitReason: 'all', // 'all' | 'step_tp' | 'stop_loss' | 'trailing_stop' | 'cluster_exit' | 'manual_close' | 'timeout' | 'take_profit'
            side:      'all',  // 'all' | 'LONG' | 'SHORT'
            result:    'all',  // 'all' | 'win' | 'loss'
            pair:      'all',  // 'all' | 'BTC/USDT' | ...
            strategy:  'all',  // 'all' | 'mean_reversion' | 'scalper' | 'manual'
            regime:    'all',  // 'all' | 'LONG' | 'SHORT' | 'BLOCK'
        };

        // Все уникальные пары из текущего набора сделок — для дропдауна "Пара"
        var _journalPairs = [];
        (function() {
            var seen = {};
            trades.forEach(function(t) {
                if (t.pair && !seen[t.pair]) { seen[t.pair] = 1; _journalPairs.push(t.pair); }
            });
            _journalPairs.sort();
        })();

        // Конфигурация чипов: label, key в _journalFilters, options [{val, label}]
        var _journalChipConfigs = [
            {
                key: 'firstMove', label: 'Движение',
                options: [{val:'all',label:'все'}, {val:'favor',label:'в нашу сторону'}, {val:'adverse',label:'против нас'}]
            },
            {
                key: 'exitReason', label: 'Выход',
                options: [
                    {val:'all',label:'все'},
                    {val:'step_tp',label:'Шаговый TP'},
                    {val:'take_profit',label:'Тейк'},
                    {val:'stop_loss',label:'Стоп'},
                    {val:'trailing_stop',label:'Трейлинг'},
                    {val:'cluster_exit',label:'Кластер'},
                    {val:'manual_close',label:'Ручной'},
                    {val:'timeout',label:'Таймаут'},
                ]
            },
            {
                key: 'side', label: 'Сторона',
                options: [{val:'all',label:'все'}, {val:'LONG',label:'LONG'}, {val:'SHORT',label:'SHORT'}]
            },
            {
                key: 'result', label: 'Результат',
                options: [{val:'all',label:'все'}, {val:'win',label:'победа'}, {val:'loss',label:'поражение'}]
            },
            {
                key: 'pair', label: 'Пара',
                options: [{val:'all',label:'все'}].concat(_journalPairs.map(function(p){ return {val:p, label:p}; }))
            },
            {
                key: 'strategy', label: 'Стратегия',
                options: [
                    {val:'all',label:'все'},
                    {val:'mean_reversion',label:'Mean Reversion'},
                    {val:'scalper',label:'Скальпер'},
                    {val:'manual',label:'Ручной'},
                ]
            },
            {
                key: 'regime', label: 'Режим',
                options: [
                    {val:'all',label:'все'},
                    {val:'LONG',label:'→LONG'},
                    {val:'SHORT',label:'→SHORT'},
                    {val:'BLOCK',label:'→BLOCK'},
                ]
            },
        ];

        // Применяет _journalFilters к массиву trades, возвращает отфильтрованный набор
        function _filterTrades(allTrades) {
            return allTrades.filter(function(t) {
                if (_journalFilters.firstMove !== 'all' && t.firstMoveSide !== _journalFilters.firstMove) return false;
                if (_journalFilters.exitReason !== 'all' && t.reason !== _journalFilters.exitReason) return false;
                if (_journalFilters.side !== 'all' && t.side !== _journalFilters.side) return false;
                if (_journalFilters.result !== 'all') {
                    var pnlPositive = (t.pnl || 0) > 0;
                    if (_journalFilters.result === 'win' && !pnlPositive) return false;
                    if (_journalFilters.result === 'loss' && pnlPositive) return false;
                }
                if (_journalFilters.pair !== 'all' && t.pair !== _journalFilters.pair) return false;
                if (_journalFilters.strategy !== 'all' && t.strategy !== _journalFilters.strategy) return false;
                if (_journalFilters.regime !== 'all') {
                    var rg = t.entryRegime && t.entryRegime.allowed;
                    if (rg !== _journalFilters.regime) return false;
                }
                return true;
            });
        }

        // Считаем сколько фильтров активно (не 'all')
        function _activeFilterCount() {
            var n = 0;
            for (var k in _journalFilters) if (_journalFilters[k] !== 'all') n++;
            return n;
        }

        // Рендер строки фильтр-чипов в #botJournalFilters
        function _renderFilterChips() {
            var container = modal.querySelector('#botJournalFilters');
            if (!container) return;
            var html = '';
            _journalChipConfigs.forEach(function(cfg) {
                var current = _journalFilters[cfg.key];
                var active = current !== 'all';
                var currentLabel = cfg.label;
                if (active) {
                    var opt = cfg.options.find(function(o){ return o.val === current; });
                    if (opt) currentLabel = cfg.label + ': ' + opt.label;
                }
                var chipStyle = active
                    ? 'background:rgba(38,166,154,0.15);border:1px solid #26a69a;color:#26a69a;'
                    : 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#C8CACE;';
                html += '<span class="bjm-chip" data-key="' + cfg.key + '" style="position:relative;cursor:pointer;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:500;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;' + chipStyle + '">'
                     + currentLabel
                     + '<svg width="8" height="8" viewBox="0 0 12 12" fill="none" style="margin-left:2px;opacity:0.7;"><polyline points="3,4.5 6,8 9,4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>'
                     + '</span>';
            });
            // Кнопка "Сбросить" видна только если есть активные фильтры
            if (_activeFilterCount() > 0) {
                html += '<span id="bjmResetFilters" style="cursor:pointer;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:500;white-space:nowrap;background:rgba(226,75,74,0.08);border:1px solid rgba(226,75,74,0.25);color:#E24B4A;">✕ Сбросить</span>';
            }
            // Счётчик
            var filtered = _filterTrades(trades);
            var fTotal = filtered.length;
            var fWins = filtered.filter(function(t){ return (t.pnl||0) > 0; }).length;
            var fWR = fTotal > 0 ? Math.round(fWins / fTotal * 100) : 0;
            var fNet = filtered.reduce(function(s, t){ return s + (t.pnl || 0); }, 0);
            var counterColor = fNet >= 0 ? '#10B981' : '#EF4444';
            html += '<span style="margin-left:auto;font-size:11px;color:#888780;">'
                 +  'Показано <b style="color:#C8CACE;font-weight:500;">' + fTotal + '</b> из ' + trades.length
                 +  ' · WR <b style="color:' + (fWR >= 50 ? '#10B981' : '#EF4444') + ';font-weight:500;">' + fWR + '%</b>'
                 +  ' · <b style="color:' + counterColor + ';font-weight:500;">' + (fNet >= 0 ? '+' : '') + '$' + fNet.toFixed(2) + '</b>'
                 +  '</span>';
            container.innerHTML = html;

            // Обработчики чипов
            container.querySelectorAll('.bjm-chip').forEach(function(chip) {
                chip.onclick = function(e) {
                    e.stopPropagation();
                    _showChipDropdown(chip);
                };
            });
            var resetBtn = container.querySelector('#bjmResetFilters');
            if (resetBtn) resetBtn.onclick = function() {
                for (var k in _journalFilters) _journalFilters[k] = 'all';
                _renderFilterChips();
                _renderJournalContent();
            };
        }

        // Открывает мини-дропдаун рядом с чипом со списком опций
        function _showChipDropdown(chipEl) {
            // Закрываем существующий дропдаун если есть
            var existing = document.getElementById('bjmDropdown');
            if (existing) existing.remove();

            var key = chipEl.getAttribute('data-key');
            var cfg = _journalChipConfigs.find(function(c){ return c.key === key; });
            if (!cfg) return;
            var current = _journalFilters[key];

            var dd = document.createElement('div');
            dd.id = 'bjmDropdown';
            dd.style.cssText = 'position:absolute;top:100%;left:0;margin-top:4px;background:#1A1D23;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px;min-width:140px;max-height:280px;overflow-y:auto;z-index:10000;box-shadow:0 6px 18px rgba(0,0,0,0.4);';
            cfg.options.forEach(function(opt) {
                var isCurrent = opt.val === current;
                var optStyle = isCurrent
                    ? 'background:rgba(38,166,154,0.15);color:#26a69a;'
                    : 'color:#C8CACE;';
                var item = document.createElement('div');
                item.style.cssText = 'padding:6px 10px;font-size:11px;border-radius:4px;cursor:pointer;white-space:nowrap;' + optStyle;
                item.textContent = opt.label;
                item.onmouseover = function() { if (!isCurrent) this.style.background = 'rgba(255,255,255,0.05)'; };
                item.onmouseout  = function() { if (!isCurrent) this.style.background = ''; };
                item.onclick = function(e) {
                    e.stopPropagation();
                    _journalFilters[key] = opt.val;
                    dd.remove();
                    _renderFilterChips();
                    _renderJournalContent();
                };
                dd.appendChild(item);
            });
            chipEl.appendChild(dd);

            // Закрытие по клику вне дропдауна
            setTimeout(function() {
                document.addEventListener('click', function closeDd(e) {
                    if (!dd.contains(e.target)) {
                        dd.remove();
                        document.removeEventListener('click', closeDd);
                    }
                });
            }, 0);
        }

        // Перерисовка содержимого журнала под текущие фильтры.
        // Подход: НЕ пересобираем HTML таблицы (это терялись бы все колонки/комментарии).
        // Вместо этого:
        //   1. Помечаем каждую строку (или карточку) индексом сделки через data-trade-idx
        //   2. Проходим по trades, для каждого индекса решаем show/hide через style.display
        //   3. Пересчитываем статистику и обновляем только её (#botJournalStats)
        function _renderJournalContent() {
            // Готовим Set отфильтрованных индексов
            var filteredIndices = {};
            var filteredTrades = [];
            trades.forEach(function(t, i) {
                if (_filterTrades([t]).length > 0) {
                    filteredIndices[i] = true;
                    filteredTrades.push(t);
                }
            });

            // Скрываем/показываем строки таблицы (desktop)
            modal.querySelectorAll('tr[data-trade-idx]').forEach(function(tr) {
                var idx = parseInt(tr.getAttribute('data-trade-idx'), 10);
                tr.style.display = filteredIndices[idx] ? '' : 'none';
            });

            // Скрываем/показываем карточки (mobile)
            modal.querySelectorAll('.bjm-card[data-trade-idx]').forEach(function(card) {
                var idx = parseInt(card.getAttribute('data-trade-idx'), 10);
                card.style.display = filteredIndices[idx] ? '' : 'none';
            });

            // Пересчитываем статистику под filteredTrades и обновляем только #botJournalStats
            var stats = modal.querySelector('#botJournalStats');
            if (!stats) return;

            var fTotal = filteredTrades.length;
            var fWins = filteredTrades.filter(function(t){ return (t.pnl||0) > 0; });
            var fNet = filteredTrades.reduce(function(s,t){ return s + (t.pnl||0); }, 0);
            var fFees = filteredTrades.reduce(function(s,t){ return s + (t.fee||0); }, 0);
            var fWR = fTotal > 0 ? Math.round(fWins.length / fTotal * 100) : 0;
            var fAvg = fTotal > 0 ? (fNet / fTotal) : 0;
            var fBest = filteredTrades.length ? Math.max.apply(null, filteredTrades.map(function(t){ return t.pnl||0; })) : 0;
            var fWorst = filteredTrades.length ? Math.min.apply(null, filteredTrades.map(function(t){ return t.pnl||0; })) : 0;

            stats.innerHTML =
                  '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Сделок <span style="color:#E2E8F0;font-weight:700;">' + fTotal + '</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Win rate <span style="color:' + (fWR>=50?'#10B981':'#EF4444') + ';font-weight:700;">' + fWR + '%</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">P&L <span style="color:' + (fNet>=0?'#10B981':'#EF4444') + ';font-weight:700;">' + (fNet>=0?'+':'') + '$' + fNet.toFixed(2) + '</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Комиссии <span style="color:#FBBF24;font-weight:700;">$' + fFees.toFixed(2) + '</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Сред. <span style="color:#94A3B8;font-weight:700;">' + (fAvg>=0?'+':'') + '$' + fAvg.toFixed(2) + '</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Лучшая <span style="color:#10B981;font-weight:700;">+$' + fBest.toFixed(2) + '</span></div>'
                + '<div style="font-size:' + (isMobile?'11px':'10px') + ';color:#636B76;">Худшая <span style="color:#EF4444;font-weight:700;">$' + fWorst.toFixed(2) + '</span></div>';
        }

        // Первичный рендер фильтров.
        _renderFilterChips();
        // Закрытие по клику в тёмный фон — только на десктопе (на мобиле фона нет, это fullscreen)
        if (!isMobile) {
            modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        }

        // На мобилке — раскрытие карточек по тапу + блокировка свайпа страниц внутри модалки
        if (isMobile) {
            modal.querySelectorAll('.bjm-card').forEach(function(card) {
                card.addEventListener('click', function() {
                    var expanded = card.querySelector('.bjm-expanded');
                    var arrow = card.querySelector('.bjm-expand-arrow');
                    if (!expanded) return;
                    var isOpen = expanded.style.display !== 'none' && expanded.style.display !== '';
                    if (isOpen) {
                        expanded.style.display = 'none';
                        if (arrow) arrow.textContent = '▼';
                    } else {
                        expanded.style.display = 'block';
                        if (arrow) arrow.textContent = '▲';
                    }
                });
            });
            // Блокировка свайпа страниц — ставим data-атрибут, который глобальный touch-handler проверит
            modal.setAttribute('data-blocks-swipe', '1');
        }
    }

    // ════════════════════════════════════════════════════════════
    //  АНАЛИТИКА — модалка с агрегированной статистикой по сделкам.
    //  Открывается из шапки журнала кнопкой "Анализ".
    //  scope: null = все боты юзера, иначе botId конкретного бота.
    // ════════════════════════════════════════════════════════════

    // hours удалён — теперь всегда показываем "Всё".
    // tab: 'general' (общий по всем стратегиям) или 'scalper' (только скальпер с разрезами по уровням).
    // scalperData кэшируется отдельно — у двух вкладок разные эндпоинты.
    var _analyticsState = { tab: 'general', scope: null, data: null, scalperData: null, loading: false };

    function openAnalytics(botId) {
        _analyticsState.scope = botId || null;
        _analyticsState.tab = 'general';
        _analyticsState.data = null;
        _analyticsState.scalperData = null;
        renderAnalyticsModal();
        loadAnalyticsData();
    }

    function loadAnalyticsData() {
        _analyticsState.loading = true;
        renderAnalyticsModal();
        var uid = getUid();
        // hours=0 → бэк отдаст всю историю
        var params = ['uid=' + encodeURIComponent(uid), 'hours=0'];
        if (_analyticsState.scope) params.push('botId=' + encodeURIComponent(_analyticsState.scope));

        var url = _analyticsState.tab === 'scalper'
            ? '/api/bot/analytics/scalper?' + params.filter(function(p){ return p.indexOf('hours=') !== 0; }).join('&')
            : '/api/bot/analytics?' + params.join('&');

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _analyticsState.loading = false;
                if (_analyticsState.tab === 'scalper') {
                    _analyticsState.scalperData = data;
                } else {
                    _analyticsState.data = data;
                }
                renderAnalyticsModal();
            })
            .catch(function(e) {
                _analyticsState.loading = false;
                if (_analyticsState.tab === 'scalper') {
                    _analyticsState.scalperData = { error: e.message };
                } else {
                    _analyticsState.data = { error: e.message };
                }
                renderAnalyticsModal();
            });
    }

    function renderAnalyticsModal() {
        var isMobile = window.innerWidth < 768;
        var old = document.getElementById('botAnalyticsModal');
        if (old) old.remove();

        var modal = document.createElement('div');
        modal.id = 'botAnalyticsModal';

        // Стили модалки — на мобиле fullscreen, на десктопе поверх журнала
        if (isMobile) {
            modal.style.cssText = 'position:fixed;inset:0;background:#0a0e1a;z-index:10000;display:flex;flex-direction:column;overflow:hidden;';
        } else {
            modal.style.cssText = 'position:absolute;inset:0;background:rgba(10,14,26,0.97);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 24px;overflow-y:auto;';
        }

        var innerStyle = isMobile
            ? 'width:100%;height:100%;display:flex;flex-direction:column;background:#0a0e1a;'
            : 'width:100%;max-width:780px;background:#0F1419;border:1px solid rgba(255,255,255,0.08);border-radius:10px;display:flex;flex-direction:column;max-height:calc(100vh - 80px);overflow:hidden;';

        var headerPad = isMobile ? 'padding:14px 16px;' : 'padding:12px 16px;';
        var bodyPad   = isMobile ? 'padding:14px 16px;' : 'padding:14px 18px;';
        var closeIconSize = isMobile ? 20 : 14;

        // Заголовок скоупа
        var scopeLabel = 'Все боты';
        var anyData = _analyticsState.data || _analyticsState.scalperData;
        if (_analyticsState.scope && anyData && anyData.scope && anyData.scope.label) {
            scopeLabel = anyData.scope.label;
        } else if (_analyticsState.scope) {
            scopeLabel = 'Этот бот';
        }

        var headerHtml =
            '<div style="' + headerPad + 'display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">' +
                '<svg width="' + (isMobile ? 20 : 16) + '" height="' + (isMobile ? 20 : 16) + '" viewBox="0 0 16 16" fill="none">' +
                    '<path d="M2 14h12M3 14V8M7 14V4M11 14V10" stroke="#26a69a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>' +
                '<span style="font-size:' + (isMobile ? '15px' : '13px') + ';font-weight:700;color:#E2E8F0;">Анализ</span>' +
                '<div style="flex:1;"></div>' +
                '<div id="botAnalyticsClose" style="cursor:pointer;color:#94A3B8;width:' + (isMobile ? 36 : 24) + 'px;height:' + (isMobile ? 36 : 24) + 'px;display:flex;align-items:center;justify-content:center;border-radius:6px;margin-left:6px;">' +
                    '<svg width="' + closeIconSize + '" height="' + closeIconSize + '" viewBox="0 0 12 12" fill="none">' +
                        '<line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                        '<line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                    '</svg>' +
                '</div>' +
            '</div>';

        // Вкладки: Общий / Скальпер
        function tabBtn(label, tabKey, count) {
            var active = _analyticsState.tab === tabKey;
            var color = active ? '#26a69a' : '#64748B';
            var border = active ? '2px solid #26a69a' : '2px solid transparent';
            var fontWeight = active ? '600' : '400';
            var countSpan = count != null
                ? '<span style="color:#475569;font-weight:400;margin-left:4px;">' + count + '</span>'
                : '';
            return '<span data-tab="' + tabKey + '" class="bam-tab-btn" style="padding:' + (isMobile ? '12px 16px' : '10px 14px') + ';font-size:' + (isMobile ? '13px' : '12px') + ';color:' + color + ';border-bottom:' + border + ';cursor:pointer;font-weight:' + fontWeight + ';">' + label + countSpan + '</span>';
        }
        var scalperCount = (_analyticsState.scalperData && _analyticsState.scalperData.totalTrades != null)
            ? _analyticsState.scalperData.totalTrades : null;
        var tabsRow =
            '<div style="' + (isMobile ? 'padding:0 16px;' : 'padding:0 16px;') + 'display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.04);flex-shrink:0;">' +
                tabBtn('Общий', 'general', null) +
                tabBtn('Скальпер', 'scalper', scalperCount) +
            '</div>';

        // Скоуп-строка
        var scopeRow =
            '<div style="' + (isMobile ? 'padding:8px 16px;' : 'padding:6px 16px;') + 'border-bottom:1px solid rgba(255,255,255,0.04);font-size:' + (isMobile ? '11px' : '10px') + ';color:#636B76;flex-shrink:0;">' +
                'Скоуп: <span style="color:#94A3B8;">' + escapeHtml(scopeLabel) + '</span>' +
            '</div>';

        var bodyHtml = '';
        var currentData = _analyticsState.tab === 'scalper'
            ? _analyticsState.scalperData
            : _analyticsState.data;

        if (_analyticsState.loading) {
            bodyHtml = '<div style="' + bodyPad + 'flex:1;display:flex;align-items:center;justify-content:center;color:#636B76;font-size:12px;">Загрузка...</div>';
        } else if (!currentData) {
            bodyHtml = '<div style="' + bodyPad + 'flex:1;color:#636B76;font-size:12px;">Нет данных</div>';
        } else if (currentData.error) {
            bodyHtml = '<div style="' + bodyPad + 'flex:1;color:#EF4444;font-size:12px;">Ошибка: ' + escapeHtml(currentData.error) + '</div>';
        } else if (currentData.empty || currentData.totalTrades === 0) {
            var emptyMsg = _analyticsState.tab === 'scalper'
                ? 'Нет скальпер-сделок со снэпшотом уровней.<br>Подожди пока бот совершит несколько сделок после включения этой функции.'
                : 'Нет сделок.';
            bodyHtml = '<div style="' + bodyPad + 'flex:1;display:flex;align-items:center;justify-content:center;color:#636B76;font-size:12px;text-align:center;">' + emptyMsg + '</div>';
        } else if (_analyticsState.tab === 'scalper') {
            bodyHtml = renderScalperAnalyticsBody(currentData, isMobile);
        } else {
            bodyHtml = renderAnalyticsBody(currentData, isMobile);
        }

        var bodyWrap = '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;">' + bodyHtml + '</div>';

        modal.innerHTML = '<div style="' + innerStyle + '">' + headerHtml + tabsRow + scopeRow + bodyWrap + '</div>';

        if (isMobile) {
            document.body.appendChild(modal);
        } else {
            // На десктопе модалка анализа открывается ПОВЕРХ журнала, не заменяя его.
            document.body.appendChild(modal);
        }

        modal.querySelector('#botAnalyticsClose').onclick = function() { modal.remove(); };

        // Клики по вкладкам
        var tabBtns = modal.querySelectorAll('.bam-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.onclick = function() {
                var t = btn.getAttribute('data-tab');
                if (t === _analyticsState.tab) return;
                _analyticsState.tab = t;
                // Если данных по этой вкладке ещё нет — грузим. Иначе просто перерисовываем.
                var alreadyHave = (t === 'scalper' && _analyticsState.scalperData)
                               || (t === 'general' && _analyticsState.data);
                if (alreadyHave) {
                    renderAnalyticsModal();
                } else {
                    loadAnalyticsData();
                }
            };
        });

        // Закрытие по клику в фон (только десктоп)
        if (!isMobile) {
            modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        }
    }

    // Хелпер: экранирование HTML для безопасной вставки текста из API
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // SVG-иконки для типов инсайтов (good/warn/bad) — без эмодзи
    function insightIconSvg(type) {
        if (type === 'good') {
            return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#10B981" stroke-width="1.2" fill="none"/><path d="M4.5 7.2L6.2 8.9L9.5 5.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
        if (type === 'bad') {
            return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#EF4444" stroke-width="1.2" fill="none"/><line x1="5" y1="5" x2="9" y2="9" stroke="#EF4444" stroke-width="1.4" stroke-linecap="round"/><line x1="9" y1="5" x2="5" y2="9" stroke="#EF4444" stroke-width="1.4" stroke-linecap="round"/></svg>';
        }
        // warn
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5z" stroke="#FBBF24" stroke-width="1.2" stroke-linejoin="round" fill="none"/><line x1="7" y1="6" x2="7" y2="9" stroke="#FBBF24" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="10.5" r="0.7" fill="#FBBF24"/></svg>';
    }

    // ── Хелперы для часов: UTC → МСК (UTC+3) и определение сессии ──
    // МСК всегда UTC+3 (без перехода на летнее).
    function utcToMsk(hourUtc) {
        return (hourUtc + 3) % 24;
    }
    // Сессия по часу UTC: Азия 00–06, Европа 07–12, США 13–20, "ночь" 21–23
    function sessionFromUtc(hourUtc) {
        if (hourUtc >= 0 && hourUtc <= 6)  return { name: 'Азия',   color: '#FB923C' };
        if (hourUtc >= 7 && hourUtc <= 12) return { name: 'Европа', color: '#60A5FA' };
        if (hourUtc >= 13 && hourUtc <= 20) return { name: 'США',    color: '#A78BFA' };
        return { name: 'Ночь', color: '#64748B' };
    }
    // Парсит ключ вида "07:00 UTC" → 7
    function parseHourKey(k) {
        var m = String(k).match(/^(\d{1,2}):/);
        return m ? parseInt(m[1], 10) : null;
    }

    // Рендер тела отчёта (без шапки и скоупа — это снаружи)
    function renderAnalyticsBody(d, isMobile) {
        var pad = isMobile ? 'padding:14px 16px;' : 'padding:16px 18px;';

        function fmtMoney(v) {
            if (v == null || isNaN(v)) return '$0.00';
            var sign = v >= 0 ? '+' : '';
            return sign + '$' + Number(v).toFixed(2);
        }
        function colorFor(v) { return v >= 0 ? '#10B981' : '#EF4444'; }
        function wrColor(wr) { return wr >= 60 ? '#10B981' : wr >= 45 ? '#FBBF24' : '#EF4444'; }

        // Универсальный рендер таблицы-разбивки: ключ -> bucket
        function renderBreakdown(title, obj, options) {
            options = options || {};
            var keys = Object.keys(obj);
            if (keys.length === 0) return '';
            keys.sort(function(a, b) {
                if (options.sortBy === 'pnl') return (obj[b].pnl || 0) - (obj[a].pnl || 0);
                return (obj[b].n || 0) - (obj[a].n || 0);
            });
            var keyMap = options.keyMap || {};
            var rows = keys.map(function(k) {
                var b = obj[k];
                var name = keyMap[k] || k;
                return '<div style="display:grid;grid-template-columns:1fr 36px 50px 64px;gap:8px;padding:6px 0;font-size:' + (isMobile ? '11px' : '12px') + ';border-bottom:1px solid rgba(255,255,255,0.04);align-items:center;">' +
                    '<span style="color:#CBD5E1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
                    '<span style="color:#636B76;font-variant-numeric:tabular-nums;text-align:right;">n=' + b.n + '</span>' +
                    '<span style="color:' + wrColor(b.winRate) + ';font-weight:600;font-variant-numeric:tabular-nums;text-align:right;">' + b.winRate + '%</span>' +
                    '<span style="color:' + colorFor(b.pnl) + ';font-weight:600;font-variant-numeric:tabular-nums;text-align:right;">' + fmtMoney(b.pnl) + '</span>' +
                '</div>';
            }).join('');
            // Карточный обёртка для каждой группировки
            return '<div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:12px 14px;margin-bottom:10px;">' +
                '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">' + title + '</div>' +
                rows +
            '</div>';
        }

        // ── Общая картина: 4 крупные карточки ──
        var beBelow = (d.breakEvenWR != null) && (d.overall.winRate < d.breakEvenWR);
        var beSubtext = '';
        if (d.breakEvenWR != null) {
            beSubtext = '<div style="font-size:10px;color:#636B76;margin-top:3px;font-variant-numeric:tabular-nums;">break-even ' + d.breakEvenWR + '%</div>';
        }
        var feesSubtext = '';
        if (d.feesAsPercentOfGross != null && Math.abs(d.grossPnl) > 0.01) {
            var feesEat = d.feesAsPercentOfGross >= 80;
            feesSubtext = '<div style="font-size:10px;color:' + (feesEat ? '#EF4444' : '#636B76') + ';margin-top:3px;font-variant-numeric:tabular-nums;">съели ' + d.feesAsPercentOfGross + '% валового</div>';
        }

        function metricCard(label, value, valueColor, subtext) {
            return '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px 14px;">' +
                '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">' + label + '</div>' +
                '<div style="font-size:' + (isMobile ? '18px' : '20px') + ';color:' + valueColor + ';font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1;">' + value + '</div>' +
                (subtext || '') +
            '</div>';
        }

        var overallBlock =
            '<div style="display:grid;grid-template-columns:repeat(' + (isMobile ? 2 : 4) + ',1fr);gap:8px;margin-bottom:14px;">' +
                metricCard('Сделок', d.overall.n, '#E2E8F0', '') +
                metricCard('Win rate', d.overall.winRate + '%', wrColor(d.overall.winRate), beSubtext) +
                metricCard('P&L net', fmtMoney(d.overall.pnl), colorFor(d.overall.pnl), '') +
                metricCard('Комиссии', '$' + d.overall.fees.toFixed(2), '#FBBF24', feesSubtext) +
            '</div>';

        // Главное предупреждение про break-even — отдельно, ярко
        var beAlert = '';
        if (beBelow) {
            beAlert = '<div style="background:rgba(239,68,68,0.08);border-left:3px solid #EF4444;border-radius:4px;padding:10px 12px;margin-bottom:14px;font-size:' + (isMobile ? '12px' : '12px') + ';color:#FCA5A5;">' +
                'WR ' + d.overall.winRate + '% ниже break-even ' + d.breakEvenWR + '% — текущий R:R математически проигрышный' +
            '</div>';
        }

        // ── Инсайты — без дублирования break-even ──
        var insightsBlock = '';
        if (d.insights && d.insights.length > 0) {
            // фильтруем инсайт про break-even, он уже наверху
            var filtered = d.insights.filter(function(ins) {
                return !/break-even|R:R математически/i.test(ins.text || '');
            });
            if (filtered.length > 0) {
                var insightsRows = filtered.map(function(ins) {
                    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:rgba(251,191,36,0.05);border-radius:6px;margin-bottom:5px;">' +
                        '<div style="flex-shrink:0;margin-top:1px;">' + insightIconSvg(ins.type) + '</div>' +
                        '<div style="font-size:' + (isMobile ? '12px' : '12px') + ';color:#FDE68A;line-height:1.45;">' + escapeHtml(ins.text) + '</div>' +
                    '</div>';
                }).join('');
                insightsBlock = '<div style="margin-bottom:14px;">' +
                    '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">Инсайты</div>' +
                    insightsRows +
                '</div>';
            }
        }

        // ── Разбивки ──
        var strategyMap = { 'mean_reversion': 'Mean Reversion', 'scalper': 'Скальпер' };
        var sideMap = { 'LONG': 'LONG', 'SHORT': 'SHORT' };
        var windowMap = { 'EU': 'EU (07:05–11:55)', 'US': 'US (13:05–16:55)', 'EU+US': 'EU + US', 'all': 'Без фильтра окон' };
        var regimeMap = {
            'all_up': 'Все 3 ТФ согласны вверх',
            'all_down': 'Все 3 ТФ согласны вниз',
            'two_agree': 'Согласны 2 из 3',
            'disagree': 'Расхождение или флэт',
            'no_regime': 'Без фильтра режима',
            'legacy': 'Старый формат',
        };
        var exitMap = {
            'stop_loss': 'Стоп', 'take_profit': 'Тейк', 'timeout': 'Таймаут',
            'manual_stop': 'Стоп бота', 'trailing_stop': 'Трейлинг', 'step_tp': 'Шаговый TP',
            'cluster_exit': 'Кластер', 'bb_exit': 'Bollinger', 'manual': 'Ручной', 'external_close': 'Внешнее',
        };

        // На десктопе — двухколоночная сетка для группировок
        var leftCol =
            renderBreakdown('По стратегии', d.byStrategy, { keyMap: strategyMap }) +
            renderBreakdown('По парам', d.byPair, { sortBy: 'pnl' }) +
            renderBreakdown('По режиму при входе', d.byRegimeAgreement, { keyMap: regimeMap });

        var rightCol =
            renderBreakdown('По направлению', d.bySide, { keyMap: sideMap }) +
            renderBreakdown('По окну торговли', d.byWindow, { keyMap: windowMap }) +
            renderBreakdown('По выходу', d.byExit, { keyMap: exitMap });

        var breakdownsGrid = isMobile
            ? '<div>' + leftCol + rightCol + '</div>'
            : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;"><div>' + leftCol + '</div><div>' + rightCol + '</div></div>';

        // ── По часам — отдельный блок с тремя сессиями ──
        var hoursBlock = renderHoursBySession(d.byHour, isMobile, fmtMoney, colorFor, wrColor);

        // По ботам — только если "Все боты"
        var byBotBlock = '';
        if (!_analyticsState.scope && d.byBot) {
            byBotBlock = renderBreakdown('По ботам', d.byBot, { sortBy: 'pnl' });
        }

        return '<div style="' + pad + '">' + overallBlock + beAlert + insightsBlock + breakdownsGrid + hoursBlock + byBotBlock + '</div>';
    }

    // ── Рендер блока "По часам" с группировкой по сессиям и временем в МСК ──
    function renderHoursBySession(byHour, isMobile, fmtMoney, colorFor, wrColor) {
        if (!byHour || Object.keys(byHour).length === 0) return '';

        // Группируем часы по сессиям
        var sessions = {
            'Азия':   { color: '#FB923C', range: '03–09 МСК', items: [] },
            'Европа': { color: '#60A5FA', range: '10–15 МСК', items: [] },
            'США':    { color: '#A78BFA', range: '16–23 МСК', items: [] },
            'Ночь':   { color: '#64748B', range: '00–02 МСК', items: [] },
        };

        Object.keys(byHour).forEach(function(k) {
            var hourUtc = parseHourKey(k);
            if (hourUtc == null) return;
            var sess = sessionFromUtc(hourUtc);
            var hourMsk = utcToMsk(hourUtc);
            var b = byHour[k];
            sessions[sess.name].items.push({
                hourMsk: hourMsk,
                hourUtc: hourUtc,
                bucket: b,
            });
        });

        // Сортируем по часу МСК внутри каждой сессии
        Object.keys(sessions).forEach(function(name) {
            sessions[name].items.sort(function(a, b) { return a.hourMsk - b.hourMsk; });
        });

        // Видимые сессии (с данными)
        var visibleSessions = ['Азия', 'Европа', 'США', 'Ночь'].filter(function(name) {
            return sessions[name].items.length > 0;
        });
        if (visibleSessions.length === 0) return '';

        function fmtHour(h) { return String(h).padStart(2, '0') + ':00'; }

        function renderSessionColumn(name) {
            var sess = sessions[name];
            var rowsHtml = sess.items.map(function(item) {
                var b = item.bucket;
                return '<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:5px 0;font-size:' + (isMobile ? '11px' : '12px') + ';align-items:center;border-bottom:1px solid rgba(255,255,255,0.03);">' +
                    '<span style="color:#CBD5E1;font-variant-numeric:tabular-nums;">' + fmtHour(item.hourMsk) + ' МСК <span style="color:#636B76;font-size:10px;">(' + fmtHour(item.hourUtc) + ' UTC)</span></span>' +
                    '<span style="color:' + wrColor(b.winRate) + ';font-weight:600;font-variant-numeric:tabular-nums;font-size:' + (isMobile ? '10px' : '11px') + ';">' + b.winRate + '%</span>' +
                    '<span style="color:' + colorFor(b.pnl) + ';font-weight:600;font-variant-numeric:tabular-nums;min-width:54px;text-align:right;">' + fmtMoney(b.pnl) + '</span>' +
                '</div>';
            }).join('');
            return '<div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:12px 14px;">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
                    '<div style="width:6px;height:6px;background:' + sess.color + ';border-radius:50%;"></div>' +
                    '<span style="font-size:10px;color:' + sess.color + ';font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">' + name + ' · ' + sess.range + '</span>' +
                '</div>' +
                rowsHtml +
            '</div>';
        }

        var columns = visibleSessions.map(renderSessionColumn).join('');
        var cols = isMobile ? 1 : Math.min(visibleSessions.length, 3);
        return '<div style="margin-bottom:10px;">' +
            '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;padding-left:2px;">По часам торговли · время МСК</div>' +
            '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:8px;">' + columns + '</div>' +
        '</div>';
    }


    /* ── Рендер вкладки "Скальпер" в модалке Анализ ──
       Группировки специфичные для скальпера: позиция в коридоре, ранг ближайшего уровня,
       ширина коридора, дошла ли цена до уровня к выходу. Помогает проверить гипотезу
       что вход от внешних границ работает лучше внутренних. */
    function renderScalperAnalyticsBody(d, isMobile) {
        var pad = isMobile ? 'padding:14px 16px;' : 'padding:16px 18px;';

        function fmtMoney(v) {
            if (v == null || isNaN(v)) return '$0.00';
            var sign = v >= 0 ? '+' : '';
            return sign + '$' + Number(v).toFixed(2);
        }
        function colorFor(v) { return v >= 0 ? '#10B981' : '#EF4444'; }
        function wrColor(wr) { return wr >= 60 ? '#10B981' : wr >= 45 ? '#FBBF24' : '#EF4444'; }

        // Мини-индикатор позиции цены в коридоре для строк "SHORT · Верх 0–10%" и т.п.
        // Возвращает SVG 44x22: верхняя/нижняя серые границы коридора + цветная полоска
        // (красная для SHORT, зелёная для LONG) на нужной высоте.
        function channelMiniIndicator(key, side) {
            // Парсим зону. Внутренняя область коридора по Y: от 3 до 19 (16px высоты).
            // Полоска шириной 3px. Чем ближе зона к границе — тем ближе полоска.
            var stripeY = null;
            if (/Верх 0[–-]10/.test(key))       stripeY = 2;   // у самого потолка
            else if (/Верх 10[–-]30/.test(key))  stripeY = 6;
            else if (/Середина/.test(key))       stripeY = 10;
            else if (/Низ 10[–-]30/.test(key))   stripeY = 14;
            else if (/Низ 0[–-]10/.test(key))    stripeY = 17;  // у самого пола
            if (stripeY == null) return '';
            var color = (side === 'SHORT') ? '#EF4444' : '#22C55E';
            return '<svg width="44" height="22" style="flex-shrink:0;" viewBox="0 0 44 22">' +
                // Верхняя и нижняя границы коридора (потолок и пол)
                '<line x1="2" y1="3" x2="42" y2="3" stroke="#94A3B8" stroke-width="1" opacity="0.7"/>' +
                '<line x1="2" y1="19" x2="42" y2="19" stroke="#94A3B8" stroke-width="1" opacity="0.7"/>' +
                // Боковые рамки — обозначают что это коридор
                '<rect x="0" y="3" width="2" height="16" fill="rgba(255,255,255,0.15)"/>' +
                '<rect x="42" y="3" width="2" height="16" fill="rgba(255,255,255,0.15)"/>' +
                // Цветная полоска — позиция цены
                '<rect x="4" y="' + stripeY + '" width="36" height="3" rx="1" fill="' + color + '"/>' +
            '</svg>';
        }

        // Цвет лейбла для позиции/выхода
        function labelColor(key) {
            if (/^SHORT/.test(key) || /−PnL$/.test(key)) return '#F87171';
            if (/^LONG/.test(key) || /\+PnL$/.test(key)) return '#4ADE80';
            return '#CBD5E1';
        }

        // Общий рендер строки бакета
        function renderRow(b, opts) {
            opts = opts || {};
            var labelHtml = escapeHtml(b.key);
            var labelExtra = opts.labelExtra ? '<span style="color:#64748B;font-size:10px;"> ' + opts.labelExtra(b.key) + '</span>' : '';
            var indicator = '';
            if (opts.showChannelIndicator) {
                var side = /^SHORT/.test(b.key) ? 'SHORT' : 'LONG';
                indicator = channelMiniIndicator(b.key, side);
            }
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:' + (isMobile ? '11px' : '12px') + ';border-bottom:1px solid rgba(255,255,255,0.04);">' +
                (indicator ? indicator : '') +
                '<span style="color:' + labelColor(b.key) + ';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(b.key) + '">' + labelHtml + labelExtra + '</span>' +
                '<span style="color:#64748B;font-size:10px;font-variant-numeric:tabular-nums;">n=' + b.n + '</span>' +
                '<span style="color:' + wrColor(b.winRate) + ';font-weight:600;font-variant-numeric:tabular-nums;min-width:38px;text-align:right;">' + b.winRate + '%</span>' +
                '<span style="color:' + colorFor(b.netPnl) + ';font-weight:600;font-variant-numeric:tabular-nums;min-width:56px;text-align:right;">' + fmtMoney(b.netPnl) + '</span>' +
            '</div>';
        }

        // Карточка-секция группировки
        function renderSection(title, subtitle, buckets, opts) {
            if (!buckets || buckets.length === 0) return '';
            var rows = buckets.map(function(b){ return renderRow(b, opts || {}); }).join('');
            return '<div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:14px;">' +
                '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600;">' + title + '</div>' +
                (subtitle ? '<div style="font-size:11px;color:#64748B;font-style:italic;margin-bottom:10px;line-height:1.4;">' + subtitle + '</div>' : '<div style="margin-bottom:6px;"></div>') +
                rows +
            '</div>';
        }

        // ── Метрики наверху — 4 карточки в один ряд (как на вкладке Общий) ──
        var ov = d.overall || {};
        function metricCard(label, value, valueColor) {
            return '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px 14px;">' +
                '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">' + label + '</div>' +
                '<div style="font-size:' + (isMobile ? '18px' : '20px') + ';color:' + valueColor + ';font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1;">' + value + '</div>' +
            '</div>';
        }
        var overallBlock =
            '<div style="display:grid;grid-template-columns:repeat(' + (isMobile ? 2 : 4) + ',1fr);gap:8px;margin-bottom:14px;">' +
                metricCard('Сделок', ov.n || 0, '#F1F5F9') +
                metricCard('Win rate', (ov.winRate || 0) + '%', wrColor(ov.winRate || 0)) +
                metricCard('P&L net', fmtMoney(ov.netPnl || 0), colorFor(ov.netPnl || 0)) +
                metricCard('Средняя', fmtMoney(ov.avgPnl || 0), colorFor(ov.avgPnl || 0)) +
            '</div>';

        // ── Предупреждение про размер выборки ──
        var sampleAlert = '';
        var totalN = ov.n || 0;
        if (totalN > 0 && totalN < 30) {
            sampleAlert = '<div style="background:rgba(251,191,36,0.06);border-left:3px solid #FBBF24;border-radius:4px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#FDE68A;">' +
                'Выборка маленькая — ' + totalN + ' сделок. Для надёжных выводов нужно ≥ 30. Пока смотрим как тенденцию, не как факт.' +
            '</div>';
        }

        // ── Инсайты от сервера (если есть) ──
        var insightsBlock = '';
        if (d.insights && d.insights.length > 0) {
            // Отфильтровываем "info" про маленькую выборку, мы уже показали свой alert
            var filtered = d.insights.filter(function(ins) {
                return !/Нет скальпер|подожди пока бот/i.test(ins.text || '');
            });
            if (filtered.length > 0) {
                var insightsHtml = filtered.map(function(ins) {
                    var bg, border, color;
                    if (ins.type === 'good')      { bg = 'rgba(16,185,129,0.06)';  border = '#10B981'; color = '#A7F3D0'; }
                    else if (ins.type === 'warn') { bg = 'rgba(239,68,68,0.06)';   border = '#EF4444'; color = '#FCA5A5'; }
                    else                          { bg = 'rgba(251,191,36,0.06)'; border = '#FBBF24'; color = '#FDE68A'; }
                    return '<div style="background:' + bg + ';border-left:3px solid ' + border + ';padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:5px;font-size:12px;color:' + color + ';line-height:1.45;">' +
                        escapeHtml(ins.text) +
                    '</div>';
                }).join('');
                insightsBlock = '<div style="margin-bottom:14px;">' +
                    '<div style="font-size:10px;color:#636B76;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">Инсайты</div>' +
                    insightsHtml +
                '</div>';
            }
        }

        // ── 4 группировки в 2 колонки на десктопе ──
        var s1 = renderSection(
            'Позиция в коридоре',
            '0% = низ, 100% = верх. Где была цена в момент входа.',
            d.byPosInChannel,
            { showChannelIndicator: true }
        );
        var s2 = renderSection(
            'Ранг ближайшего уровня',
            'rank=1 — внешняя граница. rank≥3 — внутренний уровень.',
            d.byNearestRank,
            {
                labelExtra: function(key) {
                    if (/rank = 1/.test(key)) return '(граница)';
                    if (/rank ≥ 3/.test(key)) return '(внутри)';
                    return '';
                }
            }
        );
        var s3 = renderSection(
            'Ширина коридора',
            'Расстояние от низа до верха, % от цены.',
            d.byChannelWidth
        );
        var s4 = renderSection(
            'Дошла ли цена до цели',
            'SHORT → поддержка снизу, LONG → сопротивление сверху.',
            d.byPriceReached
        );

        var grid = isMobile
            ? s1 + '<div style="height:8px;"></div>' + s2 + '<div style="height:8px;"></div>' + s3 + '<div style="height:8px;"></div>' + s4
            : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' + s1 + s2 + s3 + s4 + '</div>';

        return '<div style="' + pad + '">' + overallBlock + sampleAlert + insightsBlock + grid + '</div>';
    }

    // ── CSV-экспорт журнала сделок ──
    // Выгружает список сделок в .csv-файл с UTF-8 BOM (для корректного открытия в Excel).
    // Полный набор колонок — все поля trade, включая тайминги пиков и индикаторы выхода.
    function exportTradesToCSV(trades, isAllBots) {
        if (!trades || !trades.length) return;

        var reasonMap = {
            'stop_loss': 'Стоп', 'take_profit': 'Тейк', 'timeout': 'Таймаут',
            'manual_stop': 'Стоп бота', 'trailing_stop': 'Трейлинг', 'step_tp': 'Шаговый TP', 'cluster_exit': 'Кластер',
            'manual_close': 'Ручной', 'bb_touch': 'BB', 'sma_return': 'SMA',
            'manual_limit_exit': 'Лимит'
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

        function fmtDate(ts) {
            if (!ts) return '';
            // ISO до секунд, с "T" заменённой на пробел — лучше читается в Excel/Numbers
            return new Date(ts).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
        }
        function n(v, d) {
            if (d == null) d = 2;
            if (v == null || isNaN(v)) return '';
            return Number(v).toFixed(d);
        }
        // pn() поднята на уровень модуля (см. ниже над getUid),
        // чтобы её мог использовать и showJournalModal, и этот экспорт.
        function regimeStr(r) {
            if (!r) return '';
            function arr(v) { return v==='up'?'↑':v==='down'?'↓':'↑↓'; }
            // V2: 4h + 15m + 5m
            if (r.tf4hState != null || r.tf15mState != null || r.tf5mState != null) {
                return '4h' + arr(r.tf4hState) + ' 15m' + arr(r.tf15mState) + ' 5m' + arr(r.tf5mState) + ' →' + (r.allowed || 'BLOCK');
            }
            // Старый формат
            return (r.tfHigher || '1h') + arr(r.higher) + ' ' + (r.tfMain || '15m') + arr(r.main) + ' →' + (r.allowed || 'BOTH');
        }
        function regimeAdx(r) {
            if (!r || r.tf15mAdx == null) return '';
            return Number(r.tf15mAdx).toFixed(1);
        }
        function regime5mMove(r) {
            if (!r || r.tf5mMove == null) return '';
            return Number(r.tf5mMove).toFixed(2);
        }
        // Дельта в минутах от входа до события
        function deltaMinN(fromTs, toTs) {
            if (!fromTs || !toTs) return '';
            return Math.round((toTs - fromTs) / 60000);
        }

        var headers = [
            '#','Бот','Пара','Стратегия','Режим входа','Фильтр направления',
            'Тип входа','Сторона',
            'Вход время','Выход время','Длительность (мин)','Свечей удержано',
            'Цена входа','Цена выхода','Стоп','Таргет','Размер ($)',
            'R:R','P&L Gross','P&L Net','P&L %','Комиссия',
            'Макс.+','Макс.+ через (мин)','Макс.+ цена',
            'Макс.−','Макс.− через (мин)','Макс.− цена',
            'Первое движение','Взяли от пика (%)',
            'RSI вход','BB upper вх','BB middle вх','BB lower вх','ATR вход',
            'RSI выход','BB upper вых','BB middle вых','BB lower вых','ATR выход',
            'Кластер вход %','Кластер выход %','Δ Кластер','Кластерный фильтр',
            'Трейлинг активирован','Трейлинг активирован через (мин)','Трейлинг активирован на ($)','Трейлинг активирован @ цене',
            'Step TP активирован','Step TP активирован через (мин)','Step TP активирован на ($)','Step TP финальный стоп ($)',
            'Режим рынка','ADX 15m','5m move %','Касаний уровня','Выход по',
            'Окно при входе','Час UTC','Минута UTC'
        ];
        var lines = [headers.map(csvCell).join(',')];

        trades.forEach(function(t, i) {
            var pnlStr = (t.pnl >= 0 ? '+' : '') + (t.pnl != null ? t.pnl.toFixed(2) : '0.00');
            if (t.pnlPct != null) pnlStr += ' (' + (t.pnlPct >= 0 ? '+' : '') + t.pnlPct + '%)';
            var entryLabel = t.entryType === 'manual' ? 'Ручной' : (t.entryType === 'bot_tick' ? 'Бот (тик)' : 'Бот');
            var reason = reasonMap[t.reason] || t.reason || '';

            // Первое движение: стрелка = физ. направление, текст = трактовка
            var firstMove = '';
            if (t.firstMoveSide) {
                var fmUpCsv = (t.side === 'LONG' && t.firstMoveSide === 'favor') || (t.side === 'SHORT' && t.firstMoveSide === 'adverse');
                firstMove = (fmUpCsv ? '↑' : '↓') + ' ' + (t.firstMoveSide === 'favor' ? 'в нашу сторону' : 'против нас');
            }

            // Взяли от пика %
            var tookPct = '';
            if (t.maxUnrealized && t.maxUnrealized > 0.01 && t.pnl != null) {
                tookPct = Math.round((t.pnl / t.maxUnrealized) * 100);
            }

            // Δ кластер
            var deltaCl = '';
            if (t.entryClusterBuy != null && t.exitClusterBuy != null) {
                deltaCl = t.exitClusterBuy - t.entryClusterBuy;
            }

            var row = [
                i + 1,
                t.botLabel || '',
                t.pair || '',
                t.strategy || '',
                t.entryMode || '',
                t.direction || '',
                entryLabel,
                t.side || '',
                fmtDate(t.openedAt),
                fmtDate(t.closedAt),
                t.durationMin != null ? t.durationMin : '',
                t.candlesHeld != null ? t.candlesHeld : '',
                pn(t.entryPrice),
                pn(t.closePrice),
                pn(t.stop),
                pn(t.target),
                n(t.size),
                t.riskReward != null ? t.riskReward : '',
                n(t.grossPnl),
                n(t.pnl),
                t.pnlPct != null ? t.pnlPct : '',
                n(t.fee),
                n(t.maxUnrealized),
                deltaMinN(t.openedAt, t.maxUnrealizedAt),
                pn(t.maxUnrealizedPrice),
                n(t.maxDrawdown),
                deltaMinN(t.openedAt, t.maxDrawdownAt),
                pn(t.maxDrawdownPrice),
                firstMove,
                tookPct,
                t.entryRsi != null ? t.entryRsi : '',
                pn(t.entryBbUpper),
                pn(t.entryBbMiddle),
                pn(t.entryBbLower),
                n(t.entryAtr),
                t.exitRsi != null ? t.exitRsi : '',
                pn(t.exitBbUpper),
                pn(t.exitBbMiddle),
                pn(t.exitBbLower),
                n(t.exitAtr),
                t.entryClusterBuy != null ? t.entryClusterBuy : '',
                t.exitClusterBuy != null ? t.exitClusterBuy : '',
                deltaCl,
                t.clusterEntryUsed ? 'да' : 'нет',
                t.trailingActivated ? 'да' : 'нет',
                deltaMinN(t.openedAt, t.trailingActivatedAt),
                n(t.trailingActivatedPnl),
                pn(t.trailingActivatedPrice),
                t.stepTpActivated ? 'да' : 'нет',
                deltaMinN(t.openedAt, t.stepTpActivatedAt),
                n(t.stepTpActivatedPnl),
                n(t.stepTpMaxLevel),
                regimeStr(t.entryRegime),
                regimeAdx(t.entryRegime),
                regime5mMove(t.entryRegime),
                t.levelTouches != null ? t.levelTouches : '',
                reason,
                t.tradingWindowAtEntry || '',
                t.entryHourUTC != null ? t.entryHourUTC : '',
                t.entryMinuteUTC != null ? t.entryMinuteUTC : ''
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
       POLLING — опрос статуса каждые 5 секунд.
       Раньше было 10 сек, но этого мало для индикатора позиции —
       после закрытия сделки точка оставалась янтарной до 10 сек.
    ══════════════════════════════════════════ */

    var _pollInterval = null;

    function startStatusPolling(uid) {
        if (_pollInterval) clearInterval(_pollInterval);
        _pollInterval = setInterval(function() { pollStatus(uid); }, 5000);
        pollStatus(uid);
    }

    function stopStatusPolling() {
        if (_pollInterval) {
            clearInterval(_pollInterval);
            _pollInterval = null;
        }
    }

    function pollStatus(uid) {
        // Запоминаем "до" — было ли у нас открытая позиция и был ли бот запущен.
        // Если эти поля меняются в результате поллинга — нужно синхронизировать
        // список ботов (где каждому элементу приписано свое bot.position / bot.running).
        var prevHasPos = !!_state.position;
        var prevRunning = !!_state.running;

        fetch('/api/bot/status?uid=' + uid + '&botId=' + _state.botId)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                updateWidgetFromStatus(data);
                // Всегда вызываем fetchTrades — даже если tradeCount === 0.
                // Внутри он поставит placeholder "Сделок пока нет", если сделок нет.
                // Это важно после переключения/удаления бота, чтобы не висел лог предыдущего.
                fetchTrades(uid);

                var nowHasPos = !!_state.position;
                var nowRunning = !!_state.running;

                // Синхронизируем запись текущего бота в _state.bots — иначе bot.position
                // там будет устаревшим, и точка в раскрытом dropdown останется пульсировать
                // ещё долго после того, как бот реально закрыл сделку.
                if (_state.bots && _state.bots.length) {
                    for (var i = 0; i < _state.bots.length; i++) {
                        if (_state.bots[i].botId === _state.botId) {
                            _state.bots[i].position = _state.position || null;
                            _state.bots[i].running = nowRunning;
                            _state.bots[i].dayPnl = _state.dayPnl;
                            _state.bots[i].totalPnl = _state.totalPnl;
                            break;
                        }
                    }
                }

                // Если состояние изменилось — перерисуем dropdown (если он сейчас открыт)
                // и подтянем свежий список ботов с сервера, чтобы обновить и ДРУГИХ ботов тоже.
                if (prevHasPos !== nowHasPos || prevRunning !== nowRunning) {
                    var dd = document.getElementById('botSelectorDropdown');
                    if (dd && dd.style.display !== 'none') renderBotDropdown();
                    // Подтянем свежий общий список (положения других ботов тоже могли измениться).
                    loadBotList();
                }
            })
            .catch(function(e) { console.warn('[BOT] poll error', e); });
    }

    function fetchTrades(uid) {
        // Запоминаем, для какого бота был запрос — пока ответ идёт, пользователь
        // мог переключиться на другого бота, и тогда чужой ответ не должен
        // перезаписать лог нового бота.
        var requestedBotId = _state.botId;
        fetch('/api/bot/trades?uid=' + uid + '&botId=' + requestedBotId + '&limit=10')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (requestedBotId !== _state.botId) return; // бота уже переключили

                // Рисуем маркеры истории сделок на графике только при изменениях,
                // чтобы не дёргать setMarkers() каждую секунду поллинга.
                var newCount = (data.trades || []).length;
                var lastClosedAt = newCount > 0 ? (data.trades[0].closedAt || 0) : 0;
                var prevKey = _state._lastTradeMarkersKey || '';
                var nextKey = requestedBotId + '|' + newCount + '|' + lastClosedAt;
                if (nextKey !== prevKey) {
                    _state._lastTradeMarkersKey = nextKey;
                    if (typeof window._drawBotTrades === 'function') {
                        window._drawBotTrades(data.trades || []);
                    }
                }

                var log = document.getElementById('botWidgetLog');
                if (!log) return;
                if (!data.trades || !data.trades.length) {
                    log.innerHTML = '<div class="bot-w-log-empty">Сделок пока нет</div>';
                    return;
                }
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
        var strat = bot.strategy === 'mean_reversion' ? 'MR'
                  : bot.strategy === 'manual' ? 'MN'
                  : 'SC';
        var mode = (bot.entryMode === 'tick') ? 'T' : 'C';
        var dir = bot.direction === 'long' ? 'L' : bot.direction === 'short' ? 'S' : 'L+S';
        var trail = bot.trailingEnabled ? ' ' + s + ' TR' : '';
        var stepTp = bot.stepTpEnabled ? ' ' + s + ' STP' : '';
        var bbExit = bot.bbExitEnabled ? ' ' + s + ' BB' : '';
        var cluster = bot.clusterEntryFilter ? ' ' + s + ' Cl' : '';
        var regime = bot.regimeFilterEnabled ? ' ' + s + ' R' : '';
        var atr = bot.atrFilterEnabled ? ' ' + s + ' A' : '';
        var windowTag = '';
        if (bot.tradingWindowEU || bot.tradingWindowUS) {
            var wT = 'W';
            if (bot.tradingWindowEU && bot.tradingWindowUS) wT = 'W12-17';
            else if (bot.tradingWindowEU) wT = 'W12';
            else if (bot.tradingWindowUS) wT = 'W17';
            windowTag = ' ' + s + ' ' + wT;
        }
        var rsiStr = '';
        // RSI используется только в Mean Reversion. В Scalper RSI игнорируется
        // в торговой логике, поэтому в ярлыке его не показываем (раньше вводил
        // в заблуждение «STP · 35/65»).
        if ((bot.rsiOversold || bot.rsiOverbought) && bot.strategy !== 'scalper') {
            rsiStr = ' ' + s + ' ' + (bot.rsiOversold || 35) + '/' + (bot.rsiOverbought || 65);
        }
        return (bot.pair || 'BTC/USDT') + ' ' + s + ' ' + strat + ' ' + s + ' ' + (bot.timeframe || '5m') + ' ' + s + ' ' + mode + ' ' + s + ' ' + dir + trail + stepTp + bbExit + cluster + regime + atr + windowTag + rsiStr;
    }

    function updateBotSelector() {
        var dot = document.getElementById('botSelectorDot');
        var label = document.getElementById('botSelectorLabel');
        if (!label) return;

        var current = _state.bots.find(function(b) { return b.botId === _state.botId; });
        if (current) {
            label.textContent = getBotLabel(current);
            // Для текущего бота предпочитаем _state.position — он всегда свежий (из /api/bot/status),
            // а bot.position из /api/bot/list может отсутствовать или запаздывать.
            var hasPos = _state.position || current.position;
            var state = !current.running ? 'stopped' : (hasPos ? 'in-position' : 'idle');
            setBotDotState(dot, state);
        } else {
            var fallback = {
                pair: _state.pair, strategy: _state.strategy, timeframe: _state.timeframe,
                entryMode: _state.entryMode, direction: _state.direction,
                trailingEnabled: _state.trailingEnabled,
                stepTpEnabled: _state.stepTpEnabled,
                rsiOversold: _state.rsiOversold, rsiOverbought: _state.rsiOverbought
            };
            label.textContent = getBotLabel(fallback);
            var fbState = !_state.running ? 'stopped' : (_state.position ? 'in-position' : 'idle');
            setBotDotState(dot, fbState);
        }
    }

    /* Таймер опроса списка ботов — запускается только когда dropdown открыт.
       Без него точки других ботов в раскрытом списке никогда не обновляются
       (poll статуса ходит только за ТЕКУЩИМ ботом). */
    var _dropdownPollTimer = null;

    function toggleBotDropdown() {
        var dd = document.getElementById('botSelectorDropdown');
        if (!dd) return;
        if (dd.style.display === 'none') {
            renderBotDropdown();
            dd.style.display = 'block';
            // Обновляем список каждые 4 сек, пока dropdown открыт — чтобы индикаторы
            // (running / in-position / P&L) у ВСЕХ ботов оставались актуальными.
            if (_dropdownPollTimer) clearInterval(_dropdownPollTimer);
            _dropdownPollTimer = setInterval(function() {
                var stillOpen = document.getElementById('botSelectorDropdown');
                if (!stillOpen || stillOpen.style.display === 'none') {
                    clearInterval(_dropdownPollTimer);
                    _dropdownPollTimer = null;
                    return;
                }
                // loadBotList() обновит _state.bots и вызовет updateBotSelector(),
                // но перерисовкой dropdown в этом месте управляем сами — после приезда данных.
                var uid = getUid();
                fetch('/api/bot/list?uid=' + uid)
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        _state.bots = data.bots || [];
                        updateBotSelector();
                        var ddNow = document.getElementById('botSelectorDropdown');
                        if (ddNow && ddNow.style.display !== 'none') renderBotDropdown();
                    })
                    .catch(function() {});
            }, 4000);
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
        if (_dropdownPollTimer) {
            clearInterval(_dropdownPollTimer);
            _dropdownPollTimer = null;
        }
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
            // 3 состояния: серый = остановлен, зелёный = ждёт сигнала, янтарный пульс = в позиции.
            // Для активного бота предпочитаем свежее состояние позиции из _state
            // (bot.position из /api/bot/list может отсутствовать или запаздывать).
            var hasPos = isActive ? (_state.position || bot.position) : bot.position;
            var dotClass;
            if (!bot.running) dotClass = 'bot-dot-stopped';
            else if (hasPos)  dotClass = 'bot-dot-in-position';
            else              dotClass = 'bot-dot-idle';

            // Общий P&L бота за всё время (сумма всех закрытых сделок).
            // Сервер должен возвращать bot.totalPnl из /api/bot/list.
            var totalPnl = (typeof bot.totalPnl === 'number' && !isNaN(bot.totalPnl)) ? bot.totalPnl : 0;
            var pnlStr = totalPnl >= 0 ? '+$' + totalPnl.toFixed(2) : '-$' + Math.abs(totalPnl).toFixed(2);
            var pnlColor = totalPnl >= 0 ? '#26a69a' : '#EF5350';

            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;transition:background 0.15s;' +
                (isActive ? 'background:rgba(38,166,154,0.08);' : '');

            row.innerHTML = '<span class="' + dotClass + '" style="width:6px;height:6px;border-radius:50%;flex-shrink:0;"></span>' +
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
        // Наследуем настройки от текущего бота — пользователь обычно создаёт боты одной серии.
        // В запрос на сервер передаём только пару (BTC как дефолт); остальные настройки он подхватит
        // при старте из _state через endpoint /api/bot/start.
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
                // НЕ сбрасываем настройки — они наследуются от предыдущего бота.
                // Только меняем пару на BTC/USDT (дефолт нового бота), пользователь сменит в модалке.
                _state.pair = 'BTC/USDT';
                _state.pairs = ['BTC/USDT'];
                updateBotSelector();
                openModal(0);
            }
        })
        .catch(function(e) { console.warn('[BOT] create error', e); });
    }

    /* Сбрасывает локальное состояние, привязанное к конкретному боту,
       и чистит DOM-лог сделок. Нужно при переключении/удалении бота,
       чтобы в UI не оставались сделки и индикаторы предыдущего бота. */
    function resetBotLocalState() {
        _state.trades = [];
        _state.position = null;
        _state.levels = [];
        _state.currentPrice = 0;
        _state.dayPnl = 0;
        _state.totalPnl = 0;
        _state.tradeCount = 0;
        _state.winRate = null;
        _state.bbData = null;
        _state.volumeInfo = null;
        _state.clusterInfo = null;
        _state._lastTradeMarkersKey = '';  // сброс ключа — маркеры перерисуются

        // Очищаем маркеры сделок на графике
        if (typeof window._clearBotTrades === 'function') {
            window._clearBotTrades();
        }

        var log = document.getElementById('botWidgetLog');
        if (log) log.innerHTML = '<div class="bot-w-log-empty">Сделок пока нет</div>';

        // Позиция скрывается (renderPosition прячет секцию при _state.position === null).
        if (typeof renderPosition === 'function') renderPosition();
    }

    function deleteBot(botId) {
        var uid = getUid();
        // Если удаляем текущего бота — сразу чистим UI, не дожидаясь ответа сервера.
        // Иначе старый лог сделок остаётся висеть, пока придут данные нового бота
        // (а если у нового 0 сделок — остаётся висеть вообще всегда).
        var deletingActive = (_state.botId === botId);
        if (deletingActive) resetBotLocalState();

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
                    // Мы переключились на другого бота — чистим UI ещё раз
                    // (resetBotLocalState выше был для удаляемого, теперь для нового).
                    resetBotLocalState();
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

        // Чистим UI от данных старого бота (лог сделок, позиция, PnL, уровни),
        // чтобы они не «всплывали» на долю секунды и не оставались висеть,
        // если у нового бота 0 сделок.
        resetBotLocalState();

        var bot = _state.bots.find(function(b) { return b.botId === botId; });
        if (bot) {
            _state.pair = bot.pair;
            _state.pairs = [bot.pair];  // у существующего бота всегда одна пара
            _state.running = bot.running;
            _state.strategy = bot.strategy || 'scalper';
            var pairLabel = document.getElementById('botWidgetPairLabel');
            if (pairLabel) pairLabel.textContent = bot.pair;

            // Переключаем график на пару и таймфрейм бота
            if (typeof window._syncChartToBot === 'function') {
                window._syncChartToBot(bot.pair, bot.timeframe);
            } else {
                // Fallback на старый _switchChartCoin если _syncChartToBot не определён
                var symbol = bot.pair ? bot.pair.replace('/USDT', '').replace('USDT', '') : null;
                if (symbol && typeof window._switchChartCoin === 'function') {
                    window._switchChartCoin(symbol);
                }
            }

            // Обновляем botId для отрисовки уровней
            if (typeof window._botCurrentBotId !== 'undefined') {
                window._botCurrentBotId = botId;
            }

            // Перерисовываем уровни для нового бота (с учётом стратегии — manual не рисует)
            if (bot.running) {
                syncBotLevelsVisibility();
            }
        }

        updateBotSelector();
        var uid = getUid();
        pollStatus(uid);
        // Гарантируем что интервал поллинга запущен. Если пользователь переключился
        // на running-бота, а polling раньше не стартовал (например default-бот не был
        // запущен в момент загрузки страницы) — без этой строки карточка позиции
        // обновлялась бы только при ручном переключении ботов, а не в реальном времени.
        // startStatusPolling сам делает clearInterval перед setInterval, так что
        // повторные вызовы безопасны.
        if (bot && (bot.running || bot.paused)) {
            startStatusPolling(uid);
        }
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
                stopMode: _state.stopMode === 'fixed' ? 'fixed' : 'atr',
                stopFixedPct: _state.stopFixedPct,
                trailingEnabled: _state.trailingEnabled,
                trailingOffset: _state.trailingOffset,
                trailingActivation: _state.trailingActivation,
                smaReturnEnabled: !!_state.smaReturnEnabled,
                smaReturnTolerance: _state.smaReturnTolerance,
                atrFilterEnabled: !!_state.atrFilterEnabled,
                atrFilterThreshold: _state.atrFilterThreshold,
                clusterEnabled: _state.clusterEnabled,
                clusterThreshold: _state.clusterThreshold,
                clusterExitConfirm: _state.clusterExitConfirm,
                bbPeriod: _state.bbPeriod,
                bbMultiplier: _state.bbMultiplier,
                rsiPeriod: _state.rsiPeriod,
                rsiOverbought: _state.rsiOverbought,
                rsiOversold: _state.rsiOversold,
                // Manual-стратегия
                manualStopPct: _state.manualStopPct,
                manualSizeMode: _state.manualSizeMode,
                manualFixedSizePct: _state.manualFixedSizePct,
                manualTimeoutEnabled: !!_state.manualTimeoutEnabled,
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

        // Глобальный хук — возвращает таймфрейм текущего бота ('1m', '5m', '15m', '1h', ...)
        window._getBotTimeframe = function() {
            return _state.timeframe || null;
        };

        // Глобальный хук — возвращает стратегию текущего бота ('manual', 'mean_reversion', 'scalper').
        // Используется в app.html для решения: рисовать ли линии позиции на графике.
        // Линии входа/стопа/таргета показываются ТОЛЬКО для manual — в авто-режимах
        // они визуальный шум, бот сам управляет позицией.
        window._getBotStrategy = function() {
            return _state.strategy || null;
        };

        // При загрузке страницы проверяем — может бот уже запущен на сервере.
        // ВАЖНО: запрашиваем СПИСОК всех ботов пользователя (а не только 'default'),
        // потому что у пользователя может быть много ботов и активным может быть
        // не default, а bot_1777xxx. Раньше fetch шёл на /api/bot/status без botId →
        // сервер всегда возвращал default-сессию → если default не running, polling
        // не запускался, и карточка позиции активного бота "замерзала" (была
        // отрендерена один раз и больше не обновлялась, т.к. setInterval нигде
        // не запускался).
        setTimeout(function() {
            var uid = getUid();
            fetch('/api/bot/list?uid=' + uid)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var bots = (data && data.bots) || [];
                    _state.bots = bots;

                    // Ищем первого running/paused бота — он и будет активным.
                    // Если несколько running — берём первого; пользователь сам переключится
                    // на нужного через выпадающий список (уже привычный UX).
                    var activeBot = bots.find(function(b) { return b.running || b.paused; });
                    if (!activeBot) {
                        // Нет ни одного активного — просто обновим селектор и выйдем.
                        // polling не нужен: незачем долбить сервер каждые 5 сек если ничего не торгуется.
                        updateBotSelector();
                        return;
                    }

                    // Переключаем _state на активного бота
                    _state.botId    = activeBot.botId;
                    _state.pair     = activeBot.pair || 'BTC/USDT';
                    _state.pairs    = [_state.pair];
                    _state.timeframe = activeBot.timeframe || _state.timeframe;
                    _state.strategy = activeBot.strategy || _state.strategy;
                    _state.running  = !!activeBot.running;
                    _state.paused   = !!activeBot.paused;

                    // Тянем полный статус именно для активного бота
                    fetch('/api/bot/status?uid=' + uid + '&botId=' + activeBot.botId)
                        .then(function(r) { return r.json(); })
                        .then(function(status) {
                            _state.mode   = status.mode   || 'paper';
                            _state.market = status.market || 'futures';
                            updateWidgetFromStatus(status);
                            updateWidgetMode();
                            updateBotSelector();

                            // Запускаем поллинг — это и есть то чего раньше не происходило
                            startStatusPolling(uid);

                            window._botCurrentBotId = _state.botId;
                            syncBotLevelsVisibility();

                            if (_state.timeframe) {
                                window._botActiveTimeframe = _state.timeframe;
                                if (typeof window._updateBotTimeframeHighlight === 'function') {
                                    window._updateBotTimeframeHighlight();
                                }
                            }

                            if (status.tradeCount > 0) fetchTrades(uid);
                        })
                        .catch(function() {});
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
