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

    // Binance klines → объекты
    const candles = rawCandles.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +(k[5] || 0),
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
    const details = [];
    let totalBottomPct = 0;
    let totalTopPct = 0;
    let totalMiddlePct = 0;

    for (const c of candlesInZone) {
        const range = c.high - c.low;
        if (range <= 0 || c.volume <= 0) continue;

        // Границы зон
        const bottomCutoff = c.low + range * ZONE_BOTTOM;       // верх нижней зоны
        const topCutoff = c.high - range * (1 - ZONE_BOTTOM - ZONE_MIDDLE); // низ верхней зоны

        // Оценка распределения объёма через форму свечи + volume
        // Используем weighted подход: где close относительно open показывает давление
        const bodyTop = Math.max(c.open, c.close);
        const bodyBottom = Math.min(c.open, c.close);
        const bodySize = bodyTop - bodyBottom;
        const isBullish = c.close >= c.open;

        // Какая доля тела попадает в каждую зону
        const bodyInBottom = Math.max(0, Math.min(bodyTop, bottomCutoff) - Math.max(bodyBottom, c.low));
        const bodyInTop = Math.max(0, Math.min(bodyTop, c.high) - Math.max(bodyBottom, topCutoff));
        const bodyInMiddle = Math.max(0, Math.min(bodyTop, topCutoff) - Math.max(bodyBottom, bottomCutoff));

        const bodyTotal = bodyInBottom + bodyInTop + bodyInMiddle || 1;

        // Базовое распределение по телу свечи
        let bottomPct = bodyInBottom / bodyTotal * 100;
        let topPct = bodyInTop / bodyTotal * 100;
        let middlePct = bodyInMiddle / bodyTotal * 100;

        // Корректировка по теням (тени показывают отвержение цены)
        const lowerShadow = bodyBottom - c.low;
        const upperShadow = c.high - bodyTop;
        const totalShadow = lowerShadow + upperShadow || 1;

        // Длинная нижняя тень = покупатели оттолкнули цену снизу → объём внизу
        // Длинная верхняя тень = продавцы оттолкнули цену сверху → объём вверху
        const shadowBottomWeight = lowerShadow / totalShadow;
        const shadowTopWeight = upperShadow / totalShadow;

        // Финальная корректировка: тени перераспределяют 30% оценки
        const shadowInfluence = 30;
        bottomPct = bottomPct * 0.7 + shadowBottomWeight * shadowInfluence;
        topPct = topPct * 0.7 + shadowTopWeight * shadowInfluence;
        middlePct = 100 - bottomPct - topPct;
        if (middlePct < 0) {
            // Нормализуем
            const total = bottomPct + topPct;
            bottomPct = bottomPct / total * 100;
            topPct = topPct / total * 100;
            middlePct = 0;
        }

        // Дополнительная корректировка: бычья свеча усиливает "bottom", медвежья — "top"
        if (isBullish) {
            bottomPct += 5;
            topPct -= 5;
        } else {
            topPct += 5;
            bottomPct -= 5;
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
    let concentration;
    const diff = bottomVolumeAvg - topVolumeAvg;
    if (diff >= 10) concentration = 'bottom';
    else if (diff <= -10) concentration = 'top';
    else concentration = 'mixed';

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
    if (details.length >= 6) {
        const firstHalf = details.slice(0, Math.floor(details.length / 2));
        const secondHalf = details.slice(Math.floor(details.length / 2));
        const avgFirst = firstHalf.reduce((s, d) => s + d.bottomPct, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, d) => s + d.bottomPct, 0) / secondHalf.length;
        if (avgSecond - avgFirst > 8) volumeTrend = 'buyers_increasing';
        else if (avgFirst - avgSecond > 8) volumeTrend = 'buyers_decreasing';
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
        volumeTrend,
        interpretation,
        consecutiveNearLevel,
        details: details.slice(-10), // Последние 10 для промпта (не перегружаем)
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
