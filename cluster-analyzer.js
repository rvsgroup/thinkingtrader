// ══════════════════════════════════════════════════════════════
// CLUSTER ANALYZER — кластерный анализ объёмов возле уровней
// Серверный модуль. Подключается через require() в server.js
// ══════════════════════════════════════════════════════════════

/**
 * Маппинг: для какого таймфрейма анализа какие свечи загружать
 *
 * analysisTimeframe → { interval: младший ТФ, limit: сколько свечей }
 *
 * 1D анализ → 4H свечи, 42 шт (~7 дней)
 * 4H анализ → 1H свечи, 84 шт (~3.5 дня)
 * 1H анализ → 15m свечи, 48 шт (~12 часов)
 */
const TF_MAP = {
    '1D': { interval: '4h', limit: 42 },
    '4H': { interval: '1h', limit: 84 },
    '1H': { interval: '15m', limit: 48 },
};

/**
 * Зоны внутри свечи (% от диапазона low→high):
 * Нижняя 30% — зона покупателей
 * Средняя 40% — нейтральная зона
 * Верхняя 30% — зона продавцов
 */
const ZONE_BOTTOM = 0.30;
const ZONE_MIDDLE = 0.40;
// ZONE_TOP = 1 - ZONE_BOTTOM - ZONE_MIDDLE = 0.30

/**
 * Радиус зоны уровня зависит от таймфрейма анализа:
 * 1D (кластеры по 4H): ±1.5% — широкая зона, дневные движения крупные
 * 4H (кластеры по 1H): ±1.0% — средняя зона
 * 1H (кластеры по 15m): ±0.5% — узкая зона, только свечи вплотную к уровню
 */
const LEVEL_ZONE_PCT_MAP = {
    '1D': 1.5,
    '4H': 1.0,
    '1H': 0.5,
};

/**
 * Минимум свечей в зоне для надёжного анализа.
 * Если меньше — расширяем зону на 0.5% и пробуем снова.
 */
const MIN_CANDLES_IN_ZONE = 3;

/**
 * Основная функция анализа кластеров
 *
 * @param {Object} params
 * @param {string} params.symbol — символ Binance (BTCUSDT)
 * @param {string} params.timeframe — таймфрейм анализа (1D, 4H, 1H)
 * @param {number} params.support — уровень поддержки
 * @param {number} params.resistance — уровень сопротивления
 * @param {number} params.currentPrice — текущая цена
 * @param {Function} params.fetchCandles — функция загрузки свечей: (symbol, interval, limit) => Promise<Array>
 *
 * @returns {Object|null} — результат кластерного анализа или null
 */
async function analyze(params) {
    const { symbol, timeframe, support, resistance, currentPrice, fetchCandles } = params;

    // Проверки
    if (!symbol || !timeframe || !support || !resistance || !currentPrice) {
        return null;
    }

    const tfConfig = TF_MAP[timeframe];
    if (!tfConfig) {
        return null; // Неподдерживаемый таймфрейм
    }

    if (support >= resistance) {
        return null; // Невалидные уровни
    }

    // ── Определяем ближайший уровень ──
    const distToSupport = Math.abs(currentPrice - support) / support * 100;
    const distToResistance = Math.abs(currentPrice - resistance) / resistance * 100;

    // Если цена далеко от обоих уровней (>5%), кластерный анализ малополезен
    const nearestDist = Math.min(distToSupport, distToResistance);
    if (nearestDist > 5) {
        return {
            nearLevel: null,
            scenario: 'no_level_nearby',
            candlesInZone: 0,
            concentration: null,
            interpretation: 'price_far_from_levels',
            bottomVolumeAvg: 0,
            topVolumeAvg: 0,
            middleVolumeAvg: 0,
            consecutiveNearLevel: 0,
            details: [],
        };
    }

    // Какой уровень ближе
    let nearLevel, levelPrice;
    if (distToResistance <= distToSupport) {
        nearLevel = 'resistance';
        levelPrice = resistance;
    } else {
        nearLevel = 'support';
        levelPrice = support;
    }

    // ── Загружаем свечи младшего ТФ ──
    let rawCandles;
    try {
        rawCandles = await fetchCandles(symbol, tfConfig.interval, tfConfig.limit);
    } catch (e) {
        console.error('[ClusterAnalyzer] Fetch error:', e.message);
        return null;
    }

    if (!rawCandles || !Array.isArray(rawCandles) || rawCandles.length < 10) {
        return null;
    }

    // Binance klines → объекты (поле [9] = taker buy base asset volume — реальные данные покупателей)
    const candles = rawCandles.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +(k[5] || 0),
        buyVolume: +(k[9] || 0), // taker buy volume — реальный объём покупателей
    }));

    // ── Фильтруем свечи в зоне уровня (адаптивный радиус) ──
    const baseZonePct = LEVEL_ZONE_PCT_MAP[timeframe] || 1.5;
    let zonePct = baseZonePct;
    let zoneRadius, zoneTop, zoneBottom, candlesInZone;

    // Пробуем с базовым радиусом, если мало свечей — расширяем
    for (let attempt = 0; attempt < 3; attempt++) {
        zoneRadius = levelPrice * zonePct / 100;
        zoneTop = levelPrice + zoneRadius;
        zoneBottom = levelPrice - zoneRadius;

        candlesInZone = candles.filter(c => {
            return c.high >= zoneBottom && c.low <= zoneTop;
        });

        if (candlesInZone.length >= MIN_CANDLES_IN_ZONE) break;

        // Мало свечей — расширяем зону на 0.5%
        zonePct += 0.5;
    }

    if (candlesInZone.length < 2) {
        return {
            nearLevel,
            levelPrice: _round(levelPrice),
            zoneRadiusPct: zonePct,
            scenario: 'insufficient_data',
            candlesInZone: candlesInZone.length,
            concentration: null,
            interpretation: 'too_few_candles_near_level',
            bottomVolumeAvg: 0,
            topVolumeAvg: 0,
            middleVolumeAvg: 0,
            consecutiveNearLevel: 0,
            details: [],
        };
    }

    // ── Считаем объём в 3 зонах для каждой свечи ──
    // Приоритет: реальная дельта из Binance (buyVolume, поле [9]), body heuristic как fallback
    const details = [];
    let totalBottomPct = 0;
    let totalTopPct = 0;
    let totalMiddlePct = 0;
    let totalDelta = 0;
    let deltaCount = 0;
    let hasDeltaData = false;

    for (const c of candlesInZone) {
        const range = c.high - c.low;
        if (range <= 0 || c.volume <= 0) continue;

        const isBullish = c.close >= c.open;
        let bottomPct, topPct, middlePct;

        // ── PRIMARY: реальная дельта из Binance (buyVolume / sellVolume) ──
        if (c.buyVolume > 0 && c.volume > 0 && c.buyVolume <= c.volume) {
            hasDeltaData = true;
            const buyPct = c.buyVolume / c.volume * 100;   // % покупателей
            const sellPct = 100 - buyPct;                   // % продавцов
            const delta = c.buyVolume - (c.volume - c.buyVolume); // абсолютная дельта

            totalDelta += delta;
            deltaCount++;

            // Распределяем по зонам через реальное соотношение buy/sell
            // buyPct > 50 → покупатели доминируют → объём "внизу" (они поддерживают)
            // sellPct > 50 → продавцы доминируют → объём "вверху" (они давят)
            bottomPct = buyPct;
            topPct = sellPct;
            middlePct = 0;

            // Корректировка: если разница buy/sell маленькая (<10%) — часть уходит в middle
            const imbalance = Math.abs(buyPct - sellPct);
            if (imbalance < 10) {
                const toMiddle = (10 - imbalance) * 2; // до 20% в middle при полном балансе
                bottomPct = Math.max(0, bottomPct - toMiddle / 2);
                topPct = Math.max(0, topPct - toMiddle / 2);
                middlePct = 100 - bottomPct - topPct;
            }
        } else {
            // ── FALLBACK: body + shadow heuristic (когда buyVolume недоступен) ──
            const bottomCutoff = c.low + range * ZONE_BOTTOM;
            const topCutoff = c.high - range * (1 - ZONE_BOTTOM - ZONE_MIDDLE);

            const bodyTop = Math.max(c.open, c.close);
            const bodyBottom = Math.min(c.open, c.close);

            const bodyInBottom = Math.max(0, Math.min(bodyTop, bottomCutoff) - Math.max(bodyBottom, c.low));
            const bodyInTop = Math.max(0, Math.min(bodyTop, c.high) - Math.max(bodyBottom, topCutoff));
            const bodyInMiddle = Math.max(0, Math.min(bodyTop, topCutoff) - Math.max(bodyBottom, bottomCutoff));
            const bodyTotal = bodyInBottom + bodyInTop + bodyInMiddle || 1;

            bottomPct = bodyInBottom / bodyTotal * 100;
            topPct = bodyInTop / bodyTotal * 100;
            middlePct = bodyInMiddle / bodyTotal * 100;

            const lowerShadow = bodyBottom - c.low;
            const upperShadow = c.high - bodyTop;
            const totalShadow = lowerShadow + upperShadow || 1;
            const shadowBottomWeight = lowerShadow / totalShadow;
            const shadowTopWeight = upperShadow / totalShadow;

            const shadowInfluence = 30;
            bottomPct = bottomPct * 0.7 + shadowBottomWeight * shadowInfluence;
            topPct = topPct * 0.7 + shadowTopWeight * shadowInfluence;
            middlePct = 100 - bottomPct - topPct;
            if (middlePct < 0) {
                const total = bottomPct + topPct;
                bottomPct = bottomPct / total * 100;
                topPct = topPct / total * 100;
                middlePct = 0;
            }

            if (isBullish) { bottomPct += 5; topPct -= 5; }
            else { topPct += 5; bottomPct -= 5; }
        }

        // Clamp
        bottomPct = Math.max(0, Math.min(100, bottomPct));
        topPct = Math.max(0, Math.min(100, topPct));
        middlePct = Math.max(0, 100 - bottomPct - topPct);

        // Округляем
        bottomPct = Math.round(bottomPct);
        topPct = Math.round(topPct);
        middlePct = 100 - bottomPct - topPct;

        totalBottomPct += bottomPct;
        totalTopPct += topPct;
        totalMiddlePct += middlePct;

        details.push({
            time: new Date(c.time * 1000).toISOString().slice(0, 16).replace('T', ' '),
            close: _round(c.close),
            volume: Math.round(c.volume),
            buyVolume: c.buyVolume > 0 ? Math.round(c.buyVolume) : undefined,
            delta: (c.buyVolume > 0 && c.volume > 0) ? Math.round(c.buyVolume - (c.volume - c.buyVolume)) : undefined,
            bottomPct,
            topPct,
            midPct: middlePct,
            dir: isBullish ? 'green' : 'red',
        });
    }

    if (details.length === 0) {
        return {
            nearLevel,
            levelPrice: _round(levelPrice),
            scenario: 'insufficient_data',
            candlesInZone: 0,
            concentration: null,
            interpretation: 'no_volume_data',
            bottomVolumeAvg: 0,
            topVolumeAvg: 0,
            middleVolumeAvg: 0,
            consecutiveNearLevel: 0,
            details: [],
        };
    }

    // ── Средние значения ──
    const count = details.length;
    const bottomVolumeAvg = Math.round(totalBottomPct / count);
    const topVolumeAvg = Math.round(totalTopPct / count);
    const middleVolumeAvg = Math.round(totalMiddlePct / count);

    // ── Концентрация ──
    // Для реальной дельты нужен ДВОЙНОЙ фильтр:
    // 1) buyDominance — в скольких свечах покупатели сильнее (частота)
    // 2) avgBuyPct — насколько сильнее (амплитуда)
    // Оба условия должны выполниться, иначе — mixed
    let concentration;
    let _avgBuyPctForConc = 50; // сохраняем для использования ниже

    if (hasDeltaData && deltaCount > 0) {
        const buyDomCandles = details.filter(d => d.delta !== undefined && d.delta > 0).length;
        const buyDom = Math.round(buyDomCandles / deltaCount * 100);

        // Считаем avgBuyPct прямо здесь (до deltaData)
        let _tbp = 0, _tbc = 0;
        for (const d of candlesInZone) {
            if (d.buyVolume > 0 && d.volume > 0 && d.buyVolume <= d.volume) {
                _tbp += d.buyVolume / d.volume * 100;
                _tbc++;
            }
        }
        _avgBuyPctForConc = _tbc > 0 ? Math.round(_tbp / _tbc) : 50;
        const spread = Math.abs(_avgBuyPctForConc - 50); // отклонение от 50/50

        // spread < 7 (buyPct < 57%) → mixed, даже если buyDominance высокий
        // spread >= 7 → смотрим buyDominance для подтверждения
        if (spread >= 7 && buyDom >= 60) concentration = 'bottom';        // покупатели реально давят
        else if (spread >= 7 && buyDom <= 40) concentration = 'top';      // продавцы реально давят
        else concentration = 'mixed';                                      // баланс сил
    } else {
        // Fallback: по bottomPct/topPct (body heuristic)
        const diff = bottomVolumeAvg - topVolumeAvg;
        if (diff >= 10) concentration = 'bottom';
        else if (diff <= -10) concentration = 'top';
        else concentration = 'mixed';
    }

    // ── Последовательные свечи у уровня (от последней назад) ──
    let consecutiveNearLevel = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
        const c = candles[i];
        if (c.high >= zoneBottom && c.low <= zoneTop) {
            consecutiveNearLevel++;
        } else {
            break;
        }
    }

    // ── Сценарий ──
    const scenario = _detectScenario(candles, nearLevel, levelPrice, currentPrice, zoneRadius);

    // ── Интерпретация ──
    const interpretation = _interpret(nearLevel, concentration, scenario);

    // ── Тренд объёма (последние 5 свечей vs первые 5) ──
    let volumeTrend = 'stable';
    if (hasDeltaData && details.length >= 6) {
        // С реальной дельтой — сравниваем delta первой и второй половины
        const withDelta = details.filter(d => d.delta !== undefined);
        if (withDelta.length >= 6) {
            const firstHalf = withDelta.slice(0, Math.floor(withDelta.length / 2));
            const secondHalf = withDelta.slice(Math.floor(withDelta.length / 2));
            const avgDeltaFirst = firstHalf.reduce((s, d) => s + d.delta, 0) / firstHalf.length;
            const avgDeltaSecond = secondHalf.reduce((s, d) => s + d.delta, 0) / secondHalf.length;
            // Нормализуем через средний объём
            const avgVol = details.reduce((s, d) => s + d.volume, 0) / details.length || 1;
            const deltaDiff = (avgDeltaSecond - avgDeltaFirst) / avgVol * 100;
            if (deltaDiff > 5) volumeTrend = 'buyers_increasing';
            else if (deltaDiff < -5) volumeTrend = 'buyers_decreasing';
        }
    } else if (details.length >= 6) {
        // Fallback: по bottomPct (как было раньше)
        const firstHalf = details.slice(0, Math.floor(details.length / 2));
        const secondHalf = details.slice(Math.floor(details.length / 2));
        const avgFirst = firstHalf.reduce((s, d) => s + d.bottomPct, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, d) => s + d.bottomPct, 0) / secondHalf.length;
        if (avgSecond - avgFirst > 8) volumeTrend = 'buyers_increasing';
        else if (avgFirst - avgSecond > 8) volumeTrend = 'buyers_decreasing';
    }

    // ── Агрегированная дельта для AI ──
    let deltaData = null;
    if (hasDeltaData && deltaCount > 0) {
        const avgDelta = totalDelta / deltaCount;
        const avgVolume = details.reduce((s, d) => s + d.volume, 0) / details.length || 1;
        const deltaPct = Math.round(avgDelta / avgVolume * 1000) / 10; // % от среднего объёма
        const buyDominance = Math.round(
            details.filter(d => d.delta !== undefined && d.delta > 0).length / deltaCount * 100
        );

        // Средний buy/sell% по свечам в зоне — для UI (чистые числа без эвристик)
        let totalBuyPct = 0;
        let deltaDetails = 0;
        for (const d of candlesInZone) {
            if (d.buyVolume > 0 && d.volume > 0 && d.buyVolume <= d.volume) {
                totalBuyPct += d.buyVolume / d.volume * 100;
                deltaDetails++;
            }
        }
        const avgBuyPct = deltaDetails > 0 ? Math.round(totalBuyPct / deltaDetails) : 50;
        const avgSellPct = 100 - avgBuyPct;

        deltaData = {
            avgDelta: Math.round(avgDelta),
            deltaPct: deltaPct,           // дельта как % от объёма (+3.5% = покупатели доминируют)
            buyDominance: buyDominance,   // % свечей где покупатели сильнее (70 = 70% свечей buy-dominated)
            avgBuyPct: avgBuyPct,         // средний % покупателей (для UI)
            avgSellPct: avgSellPct,       // средний % продавцов (для UI)
            dataSource: 'binance_taker',  // чтобы AI знал что это реальные данные
        };
    }

    // ── Сила кластерного сигнала (для калибровки target в AI) ──
    // Основан на реальном спреде buy/sell: чем больше перевес, тем сильнее сигнал
    let clusterStrength = 'none'; // none / weak / medium / strong
    if (hasDeltaData) {
        const spread = Math.abs(_avgBuyPctForConc - 50);
        if (spread < 7) clusterStrength = 'none';           // < 57/43 — баланс, нет сигнала
        else if (spread < 13) clusterStrength = 'weak';     // 57-62 / 43-38 — слабый перевес
        else if (spread < 20) clusterStrength = 'medium';   // 63-69 / 37-31 — средний перевес
        else clusterStrength = 'strong';                     // 70+ / 30- — явное доминирование
    }

    return {
        nearLevel,
        levelPrice: _round(levelPrice),
        scenario,
        candlesInZone: details.length,
        totalCandlesLoaded: candles.length,
        zoneRadiusPct: zonePct,
        clusterTimeframe: tfConfig.interval,
        bottomVolumeAvg,
        topVolumeAvg,
        middleVolumeAvg,
        concentration,
        clusterStrength,                         // none / weak / medium / strong
        volumeTrend,
        interpretation,
        consecutiveNearLevel,
        delta: deltaData,
        dataQuality: hasDeltaData ? 'real_delta' : 'estimated_heuristic',
        details: details.slice(-10),
    };
}

/**
 * Определяем сценарий поведения цены относительно уровня
 */
function _detectScenario(candles, nearLevel, levelPrice, currentPrice, zoneRadius) {
    const last5 = candles.slice(-5);
    const closesAbove = last5.filter(c => c.close > levelPrice).length;
    const closesBelow = last5.filter(c => c.close < levelPrice).length;

    if (nearLevel === 'resistance') {
        if (currentPrice > levelPrice) {
            // Цена выше сопротивления
            // Проверяем: далеко ушла или рядом держится
            const distAbove = (currentPrice - levelPrice) / levelPrice * 100;
            if (closesAbove >= 3 && distAbove > 2) {
                return 'breakout_confirmed';   // Пробой подтверждён — ушла далеко
            }
            return 'breakout_not_confirmed';    // Пробила, но держится рядом
        }
        // Цена ниже сопротивления — тестирует снизу
        return 'testing_from_below';
    }

    if (nearLevel === 'support') {
        if (currentPrice < levelPrice) {
            const distBelow = (levelPrice - currentPrice) / levelPrice * 100;
            if (closesBelow >= 3 && distBelow > 2) {
                return 'breakout_confirmed';
            }
            return 'breakout_not_confirmed';
        }
        return 'testing_from_above';
    }

    return 'unknown';
}

/**
 * Готовая интерпретация для AI
 */
function _interpret(nearLevel, concentration, scenario) {
    if (scenario === 'no_level_nearby' || scenario === 'insufficient_data') {
        return 'no_data';
    }

    if (nearLevel === 'resistance') {
        if (scenario === 'testing_from_below') {
            if (concentration === 'bottom') return 'buyers_pushing_breakout_likely';
            if (concentration === 'top') return 'sellers_holding_rejection_likely';
            return 'indecisive_at_resistance';
        }
        if (scenario === 'breakout_not_confirmed') {
            if (concentration === 'bottom') return 'breakout_supported_by_buyers';
            if (concentration === 'top') return 'false_breakout_likely';
            return 'breakout_uncertain';
        }
        if (scenario === 'breakout_confirmed') {
            if (concentration === 'bottom') return 'strong_breakout_continuation';
            return 'breakout_weakening';
        }
    }

    if (nearLevel === 'support') {
        if (scenario === 'testing_from_above') {
            if (concentration === 'bottom') return 'buyers_holding_support_bounce_likely';
            if (concentration === 'top') return 'sellers_pushing_breakdown_likely';
            return 'indecisive_at_support';
        }
        if (scenario === 'breakout_not_confirmed') {
            if (concentration === 'top') return 'breakdown_supported_by_sellers';
            if (concentration === 'bottom') return 'false_breakdown_likely';
            return 'breakdown_uncertain';
        }
        if (scenario === 'breakout_confirmed') {
            if (concentration === 'top') return 'strong_breakdown_continuation';
            return 'breakdown_weakening';
        }
    }

    return 'unclear';
}

function _round(v) {
    return Math.round(v * 100) / 100;
}

module.exports = { analyze, TF_MAP };
