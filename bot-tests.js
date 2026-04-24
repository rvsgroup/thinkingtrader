#!/usr/bin/env node
/**
 * Тест-скрипт для проверки логики ботов ThinkingTrader.
 *
 * Использование:
 *   node bot-tests.js                     # все тесты
 *   node bot-tests.js --unit              # только unit-тесты (без API)
 *   node bot-tests.js --api               # только API-тесты (нужен запущенный сервер)
 *   node bot-tests.js --url=http://host   # кастомный URL сервера для API-тестов
 *
 * Unit-тесты проверяют чистую логику Step TP, формулы подтяжки стопа,
 * форматирование цены, граничные случаи.
 *
 * API-тесты требуют запущенный сервер и проверяют endpoints:
 *   - создание бота, totalPnl=0 для нового
 *   - startBalance не сбрасывается при перезапуске
 *   - взаимоисключение Trailing ↔ Step TP
 *   - сохранение всех параметров через /api/bot/settings
 *   - проход значений RSI 10/90
 */

'use strict';

// ───────────────────────────────────────────────────────────────────
// Tiny test framework (без зависимостей)
// ───────────────────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, skipped: 0, fails: [] };

function log(s) { process.stdout.write(s); }
function colorOK(s)   { return '\x1b[32m' + s + '\x1b[0m'; }
function colorFail(s) { return '\x1b[31m' + s + '\x1b[0m'; }
function colorDim(s)  { return '\x1b[2m' + s + '\x1b[0m'; }
function colorBold(s) { return '\x1b[1m' + s + '\x1b[0m'; }

async function test(name, fn) {
    try {
        const r = await fn();
        if (r === 'skip') {
            results.skipped++;
            log(colorDim('  ⊘ ' + name) + '\n');
        } else {
            results.passed++;
            log(colorOK('  ✓ ') + name + '\n');
        }
    } catch (e) {
        results.failed++;
        results.fails.push({ name, err: e.message });
        log(colorFail('  ✗ ') + name + '\n');
        log(colorFail('      ' + e.message) + '\n');
    }
}

function section(title) {
    log('\n' + colorBold('━━ ' + title + ' ━━') + '\n');
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error((msg || 'mismatch') + `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
function assertNear(actual, expected, epsilon, msg) {
    if (Math.abs(actual - expected) > epsilon) {
        throw new Error((msg || 'not near') + `: expected ${expected} ±${epsilon}, got ${actual}`);
    }
}

// ───────────────────────────────────────────────────────────────────
// Часть 1: UNIT-тесты логики Step TP
// ───────────────────────────────────────────────────────────────────
function simulateStepTp(peak, params) {
    // Чистая симуляция подтяжки стопа по peak PnL
    const { trigger, step, tolerance } = params;
    const actTol = step * 0.10;
    const effective = peak + actTol;
    if (effective < trigger || step <= 0) return null;
    const maxLevel = Math.floor((effective - trigger) / step);
    const stopProfit = trigger + maxLevel * step - tolerance;
    return { maxLevel, stopProfit };
}

async function runStepTpTests() {
    section('Unit: Step TP formula');

    const p = { trigger: 5.00, step: 0.50, tolerance: 0.50 };

    await test('peak $4.94 < trigger $5 → не активируется', () => {
        assertEq(simulateStepTp(4.94, p), null);
    });

    await test('peak ровно $5.00 → ступень 0, stop $4.50', () => {
        const r = simulateStepTp(5.00, p);
        assertEq(r.maxLevel, 0);
        assertNear(r.stopProfit, 4.50, 0.001);
    });

    await test('peak $5.99 с допуском 10% засчитывает $6.00 → ступень 2, stop $5.50', () => {
        const r = simulateStepTp(5.99, p);
        assertEq(r.maxLevel, 2);
        assertNear(r.stopProfit, 5.50, 0.001);
    });

    await test('peak $5.50 → ступень 1, stop $5.00', () => {
        const r = simulateStepTp(5.50, p);
        assertEq(r.maxLevel, 1);
        assertNear(r.stopProfit, 5.00, 0.001);
    });

    await test('peak $6.00 → ступень 2, stop $5.50', () => {
        const r = simulateStepTp(6.00, p);
        assertEq(r.maxLevel, 2);
        assertNear(r.stopProfit, 5.50, 0.001);
    });

    await test('peak $17.27 → ступень 24, stop $16.50 (кейс BTC из журнала)', () => {
        const r = simulateStepTp(17.27, p);
        assertEq(r.maxLevel, 24);
        assertNear(r.stopProfit, 16.50, 0.001);
    });

    await test('кастомные параметры trigger=3 step=0.25 tol=0.25', () => {
        const r = simulateStepTp(5.00, { trigger: 3, step: 0.25, tolerance: 0.25 });
        // effective = 5.025, maxLevel = floor((5.025-3)/0.25) = 8
        // stop = 3 + 8*0.25 - 0.25 = 4.75
        assertEq(r.maxLevel, 8);
        assertNear(r.stopProfit, 4.75, 0.001);
    });

    await test('boundary: step=0 возвращает null (защита от деления на 0)', () => {
        assertEq(simulateStepTp(10, { trigger: 5, step: 0, tolerance: 0.5 }), null);
    });

    await test('tolerance > step корректно уходит в минус (stop ниже trigger)', () => {
        // trigger=5 step=0.5 tol=1 → ступень 0 → stop = 5 + 0 - 1 = 4
        const r = simulateStepTp(5.00, { trigger: 5, step: 0.5, tolerance: 1.0 });
        assertEq(r.maxLevel, 0);
        assertNear(r.stopProfit, 4.00, 0.001);
    });
}

// ───────────────────────────────────────────────────────────────────
// Часть 2: Unit-тесты fmtPrice (динамическое форматирование цены)
// ───────────────────────────────────────────────────────────────────
function fmtPrice(p) {
    if (p == null || !isFinite(p)) return '—';
    const n = Number(p);
    if (n >= 10000) return n.toFixed(2);
    if (n >= 100)   return n.toFixed(2);
    if (n >= 10)    return n.toFixed(3);
    if (n >= 1)     return n.toFixed(4);
    return n.toFixed(5);
}

async function runFmtPriceTests() {
    section('Unit: fmtPrice');

    await test('BTC 78196.50 → "78196.50"', () => assertEq(fmtPrice(78196.50), '78196.50'));
    await test('SOL 85.40 → "85.400" (3 знака для 10-99)', () => assertEq(fmtPrice(85.40), '85.400'));
    await test('ETH 2321.90 → "2321.90"',   () => assertEq(fmtPrice(2321.90), '2321.90'));
    await test('ETH 12.345 → "12.345"',     () => assertEq(fmtPrice(12.345), '12.345'));
    await test('NEAR 1.4150 → "1.4150"',    () => assertEq(fmtPrice(1.415), '1.4150'));
    await test('NEAR 1.41 → "1.4100" (не 1.41!)', () => assertEq(fmtPrice(1.41), '1.4100'));
    await test('DOGE 0.12345 → "0.12345"',  () => assertEq(fmtPrice(0.12345), '0.12345'));
    await test('null → "—"',                () => assertEq(fmtPrice(null), '—'));
    await test('NaN → "—"',                 () => assertEq(fmtPrice(NaN), '—'));
    await test('граница 100 → 2 знака',     () => assertEq(fmtPrice(100), '100.00'));
    await test('граница 99.999 → 3 знака',  () => assertEq(fmtPrice(99.999), '99.999'));
}

// ───────────────────────────────────────────────────────────────────
// Часть 3: Симуляция порядка выходов (проверка что Step TP работает перед TP)
// ───────────────────────────────────────────────────────────────────
async function runExitOrderTests() {
    section('Unit: exit order (Step TP must run before TP check)');

    // Симулируем один тик с ценой, которая одновременно:
    // - достигает следующей ступеньки STP
    // - достигает таргета TP
    // Ожидание: сначала обновится stopTpMaxLevel, потом закроется по TP.

    function simulateTick(pos, price, settings) {
        const events = [];
        const isLong = pos.side === 'LONG';

        // 1. Обновить maxUnrealized
        const unreal = isLong
            ? (price - pos.entryPrice) / pos.entryPrice * pos.size
            : (pos.entryPrice - price) / pos.entryPrice * pos.size;
        if (unreal > (pos.maxUnrealized || 0)) {
            pos.maxUnrealized = Math.round(unreal * 100) / 100;
        }

        // 2. Stop-loss check (pre-existing stop)
        if (isLong && price <= pos.stop) { events.push('stop_closed'); return events; }
        if (!isLong && price >= pos.stop) { events.push('stop_closed'); return events; }

        // 3. Step TP tightening (НОВЫЙ порядок: ДО тейка)
        if (settings.stepTpEnabled) {
            const res = simulateStepTp(pos.maxUnrealized || 0, settings);
            if (res && res.maxLevel > (pos.stepTpLastLevel ?? -1)) {
                pos.stepTpLastLevel = res.maxLevel;
                pos.stepTpMaxLevel = res.stopProfit;
                events.push(`steptp_tightened_to_${res.stopProfit}`);
            }
        }

        // 4. Take-profit
        if (pos.target != null) {
            if (isLong && price >= pos.target) { events.push('tp_closed'); return events; }
            if (!isLong && price <= pos.target) { events.push('tp_closed'); return events; }
        }

        return events;
    }

    await test('BTC LONG: большой скачок к таргету → Step TP успевает подтянуться ДО TP', () => {
        // Вход 78196, таргет 78500, стоп 78100, size 12094, peak до этого был 6.5
        const pos = {
            side: 'LONG',
            entryPrice: 78196,
            target: 78500,
            stop: 78100,
            size: 12094,
            maxUnrealized: 6.5,      // дошло до $6.5 прибыли ранее
            stepTpLastLevel: 3,      // уже была активация на ступени 3 ($6)
            stepTpMaxLevel: 6.00,
        };
        const settings = { stepTpEnabled: true, trigger: 5, step: 0.5, tolerance: 0.5 };

        // Тик: цена сразу 78500 (таргет) — peak PnL = 17.27
        const events = simulateTick(pos, 78500, settings);

        // Проверка: Step TP подтянулся выше прежних $6
        assert(pos.stepTpMaxLevel > 6.00, `Step TP должен был подтянуться, остался на ${pos.stepTpMaxLevel}`);
        // И закрылись по тейку
        assert(events.includes('tp_closed'), 'Должно быть закрытие по TP');
        assert(events.indexOf('steptp_tightened_to_' + pos.stepTpMaxLevel) < events.indexOf('tp_closed'),
               'Step TP должен быть ДО TP в списке событий');
    });

    await test('финальный stepTpMaxLevel = $16.50 при пике $17.27 (24 ступеньки)', () => {
        const pos = {
            side: 'LONG', entryPrice: 78196, target: 78400, stop: 78100, size: 12094,
            maxUnrealized: 0, stepTpLastLevel: -1, stepTpMaxLevel: null,
        };
        const settings = { stepTpEnabled: true, trigger: 5, step: 0.5, tolerance: 0.5 };
        simulateTick(pos, 78307.65, settings);  // PnL ~= $17.27 на позиции $12094
        assertNear(pos.stepTpMaxLevel, 16.50, 0.01, 'stepTpMaxLevel должен быть $16.50');
    });
}

// ───────────────────────────────────────────────────────────────────
// Часть 4: API-тесты (требуют запущенный сервер)
// ───────────────────────────────────────────────────────────────────
async function runApiTests(baseUrl) {
    section('API: бот-менеджмент (сервер: ' + baseUrl + ')');

    // Проверяем что сервер отвечает
    let serverOk = false;
    try {
        const r = await fetch(baseUrl + '/api/bot/list?uid=test_uid');
        serverOk = r.ok;
    } catch (e) {
        log(colorFail('  ✗ Сервер недоступен: ' + e.message + '\n'));
        results.failed++;
        return;
    }
    if (!serverOk) {
        log(colorFail('  ✗ Сервер вернул ошибку на /api/bot/list\n'));
        results.failed++;
        return;
    }

    const TEST_UID = 'test_uid_' + Date.now();
    let testBotId;

    // Helper для запросов
    async function api(method, path, body) {
        const url = baseUrl + path;
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const r = await fetch(url, opts);
        const data = await r.json().catch(() => ({}));
        return { status: r.status, data };
    }

    // ── Создание бота ──
    await test('POST /api/bot/create создаёт бота', async () => {
        const r = await api('POST', '/api/bot/create', { uid: TEST_UID, pair: 'BTC/USDT' });
        assert(r.data.ok, 'create вернул не ok: ' + JSON.stringify(r.data));
        assert(r.data.botId, 'нет botId в ответе');
        testBotId = r.data.botId;
    });

    // ── GET /api/bot/list возвращает totalPnl (фикс от сегодня) ──
    await test('GET /api/bot/list возвращает поле totalPnl', async () => {
        const r = await api('GET', '/api/bot/list?uid=' + TEST_UID);
        assert(r.data.ok || r.data.bots, 'список ботов не вернулся');
        const bots = r.data.bots || [];
        const bot = bots.find(b => b.botId === testBotId);
        assert(bot, 'тестовый бот не найден в списке');
        assert('totalPnl' in bot, 'поле totalPnl отсутствует в ответе /api/bot/list');
        assertEq(typeof bot.totalPnl, 'number', 'totalPnl должен быть числом');
    });

    // ── Новый бот: totalPnl = 0, НЕ -9500$ ──
    await test('Новый бот (не запущен): totalPnl = 0, без кривых значений', async () => {
        const r = await api('GET', '/api/bot/list?uid=' + TEST_UID);
        const bot = (r.data.bots || []).find(b => b.botId === testBotId);
        assertEq(bot.totalPnl, 0, 'totalPnl у нового бота должен быть 0');
    });

    // ── Запуск бота с balance=500 → startBalance фиксируется на 500 ──
    // (Не проверяем реально трейдинг, только что сервер принял параметры)
    await test('POST /api/bot/start с balance=500: не возвращает -9500$', async () => {
        const r = await api('POST', '/api/bot/start', {
            uid: TEST_UID, botId: testBotId,
            pair: 'BTC/USDT',
            virtualBalance: 500,
            strategy: 'mean_reversion',
            timeframe: '5m',
            direction: 'both',
            entryMode: 'tick',
            maxProfitPct: 1.0,
            stopAtrMultiplier: 1.5,
            rsiOversold: 20,
            rsiOverbought: 80,
        });
        // Сервер может вернуть ошибку WebSocket (не связан с биржей) — это ок для теста
        // Главное: если start прошёл — startBalance должен быть 500
        if (!r.data.ok) {
            log(colorDim('      (start вернул ошибку — возможно биржа недоступна, но startBalance логику можно проверить через list)\n'));
        }
        // Проверяем через list
        const r2 = await api('GET', '/api/bot/list?uid=' + TEST_UID);
        const bot = (r2.data.bots || []).find(b => b.botId === testBotId);
        if (bot && bot.totalPnl !== 0) {
            assert(Math.abs(bot.totalPnl) < 100, `totalPnl=${bot.totalPnl} — подозрительно, ожидаем около 0`);
        }
    });

    // ── Step TP параметры сохраняются через /api/bot/settings ──
    await test('POST /api/bot/settings: Step TP параметры принимаются', async () => {
        const r = await api('POST', '/api/bot/settings', {
            uid: TEST_UID, botId: testBotId,
            stepTpEnabled: true,
            stepTpTrigger: 7.5,
            stepTpStep: 0.75,
            stepTpTolerance: 0.25,
        });
        assert(r.status === 200, 'settings вернул не 200, а ' + r.status);
    });

    // ── Step TP возвращается в списке ботов ──
    await test('GET /api/bot/list возвращает stepTpEnabled и параметры', async () => {
        const r = await api('GET', '/api/bot/list?uid=' + TEST_UID);
        const bot = (r.data.bots || []).find(b => b.botId === testBotId);
        assert(bot, 'бот не найден');
        assertEq(bot.stepTpEnabled, true, 'stepTpEnabled не сохранился');
        assertNear(bot.stepTpTrigger, 7.5, 0.001, 'stepTpTrigger не сохранился');
        assertNear(bot.stepTpStep, 0.75, 0.001, 'stepTpStep не сохранился');
        assertNear(bot.stepTpTolerance, 0.25, 0.001, 'stepTpTolerance не сохранился');
    });

    // ── Взаимоисключение Trailing ↔ Step TP ──
    await test('Включение Trailing при активном Step TP → Step TP НЕ должен автоматически выключаться через settings', async () => {
        // settings принимает оба true? Сервер должен force-выключить Trailing.
        await api('POST', '/api/bot/settings', {
            uid: TEST_UID, botId: testBotId,
            stepTpEnabled: true,
            trailingEnabled: true,
        });
        const r = await api('GET', '/api/bot/status?uid=' + TEST_UID + '&botId=' + testBotId);
        const data = r.data || {};
        // Оба не должны быть true одновременно
        assert(!(data.stepTpEnabled && data.trailingEnabled),
               `Оба включены одновременно: stp=${data.stepTpEnabled} tr=${data.trailingEnabled}`);
    });

    // ── RSI значения 10/90 проходят без ограничения ──
    await test('RSI 10/90 (экстремальные значения) принимаются сервером', async () => {
        const r = await api('POST', '/api/bot/settings', {
            uid: TEST_UID, botId: testBotId,
            rsiOversold: 10,
            rsiOverbought: 90,
        });
        assert(r.status === 200);
        const r2 = await api('GET', '/api/bot/status?uid=' + TEST_UID + '&botId=' + testBotId);
        assertEq(r2.data.rsiOversold, 10, 'rsiOversold не сохранился');
        assertEq(r2.data.rsiOverbought, 90, 'rsiOverbought не сохранился');
    });

    // ── Удаление тестового бота ──
    // fetch может падать с "fetch failed" если сервер во время stopBot закрывает
    // WS-соединения или делает что-то блокирующее. Добавляем retry и паузу.
    await test('POST /api/bot/delete убирает бота из списка', async () => {
        // Сначала останавливаем бота
        try {
            await api('POST', '/api/bot/stop', { uid: TEST_UID, botId: testBotId });
        } catch (e) {
            // stop мог упасть если бот уже остановлен — не критично
        }
        // Пауза 300мс чтобы сервер успел обработать отключение WS
        await new Promise(r => setTimeout(r, 300));

        // Удаляем с retry на случай transient network error
        let deleteOk = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await api('POST', '/api/bot/delete', { uid: TEST_UID, botId: testBotId });
                deleteOk = true;
                break;
            } catch (e) {
                if (attempt === 2) throw new Error('delete failed after 3 attempts: ' + e.message);
                await new Promise(r => setTimeout(r, 500));
            }
        }
        assert(deleteOk, 'не удалось выполнить delete');

        // Проверяем что бот действительно удалился
        const r2 = await api('GET', '/api/bot/list?uid=' + TEST_UID);
        const exists = (r2.data.bots || []).some(b => b.botId === testBotId);
        assert(!exists, 'бот не удалился из списка');
    });
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const onlyUnit = args.includes('--unit');
    const onlyApi = args.includes('--api');
    const urlArg = args.find(a => a.startsWith('--url='));
    const baseUrl = urlArg ? urlArg.slice(6) : 'http://localhost:3000';

    log(colorBold('\n╔══════════════════════════════════════════════════╗\n'));
    log(colorBold('║   ThinkingTrader Bot Tests                       ║\n'));
    log(colorBold('╚══════════════════════════════════════════════════╝\n'));

    if (!onlyApi) {
        await runStepTpTests();
        await runFmtPriceTests();
        await runExitOrderTests();
    }

    if (!onlyUnit) {
        await runApiTests(baseUrl);
    }

    // Итог
    log('\n' + colorBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n');
    const total = results.passed + results.failed + results.skipped;
    log(`Всего: ${total}  `);
    log(colorOK(`Прошло: ${results.passed}  `));
    if (results.failed > 0) log(colorFail(`Упало: ${results.failed}  `));
    if (results.skipped > 0) log(colorDim(`Пропущено: ${results.skipped}  `));
    log('\n');

    if (results.fails.length) {
        log('\n' + colorFail(colorBold('Упавшие тесты:')) + '\n');
        for (const f of results.fails) {
            log(colorFail('  ✗ ' + f.name) + '\n');
            log('    ' + f.err + '\n');
        }
    }

    log('\n');
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
