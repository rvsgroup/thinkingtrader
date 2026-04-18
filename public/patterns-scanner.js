// ============================================================
// patterns-scanner.js — движок сканера свечных паттернов
// Подключается в app.html: <script src="patterns-scanner.js"></script>
// ============================================================

const PatternScanner = (function() {

    // ═══════════════════════════════════════════
    // FILTER STATE
    // ═══════════════════════════════════════════
    const ALL_PATTERN_TYPES = [
        'doji', 'hammer', 'shooting_star', 'harami', 'engulfing', 'marubozu', 'tweezer', 'morning_star', 'evening_star'
    ];

    let enabledTypes = new Set(ALL_PATTERN_TYPES);

    // ═══════════════════════════════════════════
    // PATTERN DETECTION ENGINE
    // ═══════════════════════════════════════════

    function detectPatterns(candles) {
        const patterns = [];
        if (candles.length < 5) return patterns;

        function getTrend(idx, lookback) {
            if (idx < lookback) return 'none';
            let up = 0, down = 0;
            for (let j = idx - lookback; j < idx; j++) {
                if (candles[j].close > candles[j].open) up++;
                else if (candles[j].close < candles[j].open) down++;
            }
            if (up >= lookback * 0.6) return 'up';
            if (down >= lookback * 0.6) return 'down';
            return 'none';
        }

        function isDoji(c) {
            const range = c.high - c.low;
            if (range === 0) return true;
            return Math.abs(c.close - c.open) / range < 0.1;
        }

        function hasBody(c) {
            const range = c.high - c.low;
            if (range === 0) return false;
            return Math.abs(c.close - c.open) / range >= 0.15;
        }

        for (let i = 2; i < candles.length - 1; i++) {
            const prev = candles[i - 1];
            const curr = candles[i];

            // ══ 8. MORNING STAR (бычий разворот, 3 свечи) ══
            // Проверяем ДО односвечных паттернов, чтобы continue от doji/marubozu не заблокировал
            if (enabledTypes.has('morning_star') && i >= 3) {
                const ms1 = candles[i - 2]; // первая — красная
                const ms2 = candles[i - 1]; // средняя — пауза
                const ms3 = candles[i];     // третья — зелёная

                const msBody1 = Math.abs(ms1.close - ms1.open);
                const msBody2 = Math.abs(ms2.close - ms2.open);
                const msBody3 = Math.abs(ms3.close - ms3.open);

                const ms1Bearish = ms1.close < ms1.open;
                const ms3Bullish = ms3.close > ms3.open;

                if (ms1Bearish && ms3Bullish && msBody1 > 0 && msBody1 / ms1.open >= 0.01 && msBody3 >= msBody1 * 0.9 && msBody3 <= msBody1 * 2.2 && msBody2 < msBody1 / 3) {
                    // Шаг 2: проверяем направление движения перед паттерном
                    // Считаем шаги вверх/вниз по close за 5 свечей перед красной
                    const ms1Idx = i - 2;
                    let stepsUp = 0, stepsDown = 0;
                    for (let k = 1; k < 5; k++) {
                        const curr2 = ms1Idx - k;
                        const prev2 = ms1Idx - k - 1;
                        if (prev2 < 0) break;
                        if (candles[curr2].close > candles[prev2].close) stepsUp++;
                        else if (candles[curr2].close < candles[prev2].close) stepsDown++;
                    }
                    const cameFromAbove = stepsDown > stepsUp;

                    if (cameFromAbove) {
                        const strength = ms3.close >= ms1.open ? 'strong' : 'medium';
                        const level = Math.max(ms1.high, ms2.high, ms3.high);

                        patterns.push({
                            type: 'Утренняя звезда',
                            typeEn: 'Morning Star',
                            group: 'morning_star',
                            index: i - 1,
                            time: ms2.time,
                            time1: ms1.time,
                            time3: ms3.time,
                            level: level,
                            position: 'aboveBar',
                            direction: 'bullish',
                            color: '#10B981',
                            strength: strength,
                            description: strength === 'strong'
                                ? 'Сильный бычий разворот — покупатели полностью перекрыли падение'
                                : 'Бычий разворот — покупатели отыграли больше половины падения',
                            descriptionEn: strength === 'strong'
                                ? 'Strong bullish reversal — buyers fully recovered the drop'
                                : 'Bullish reversal — buyers recovered more than half the drop'
                        });
                    }
                }
            }

            // ══ 9. EVENING STAR (медвежий разворот, 3 свечи) ══
            if (enabledTypes.has('evening_star') && i >= 3) {
                const es1 = candles[i - 2]; // первая — зелёная
                const es2 = candles[i - 1]; // средняя — пауза
                const es3 = candles[i];     // третья — красная

                const esBody1 = Math.abs(es1.close - es1.open);
                const esBody2 = Math.abs(es2.close - es2.open);
                const esBody3 = Math.abs(es3.close - es3.open);

                const es1Bullish = es1.close > es1.open;
                const es3Bearish = es3.close < es3.open;

                if (es1Bullish && es3Bearish && esBody1 > 0 && esBody1 / es1.open >= 0.01 && esBody3 >= esBody1 * 0.9 && esBody3 <= esBody1 * 2.2 && esBody2 < esBody1 / 3) {
                    // Шаг 2: проверяем направление движения перед паттерном
                    // Считаем шаги вверх/вниз по close за 5 свечей перед зелёной
                    const es1Idx = i - 2;
                    let stepsUp = 0, stepsDown = 0;
                    for (let k = 1; k < 5; k++) {
                        const curr2 = es1Idx - k;
                        const prev2 = es1Idx - k - 1;
                        if (prev2 < 0) break;
                        if (candles[curr2].close > candles[prev2].close) stepsUp++;
                        else if (candles[curr2].close < candles[prev2].close) stepsDown++;
                    }
                    const cameFromBelow = stepsUp > stepsDown;

                    if (cameFromBelow) {
                        const strength = es3.close <= es1.open ? 'strong' : 'medium';
                        const level = Math.max(es1.high, es2.high, es3.high);

                        patterns.push({
                            type: 'Вечерняя звезда',
                            typeEn: 'Evening Star',
                            group: 'evening_star',
                            index: i - 1,
                            time: es2.time,
                            time1: es1.time,
                            time3: es3.time,
                            level: level,
                            position: 'aboveBar',
                            direction: 'bearish',
                            color: '#EF4444',
                            strength: strength,
                            description: strength === 'strong'
                                ? 'Сильный медвежий разворот — продавцы полностью перекрыли рост'
                                : 'Медвежий разворот — продавцы отыграли больше половины роста',
                            descriptionEn: strength === 'strong'
                                ? 'Strong bearish reversal — sellers fully reversed the rally'
                                : 'Bearish reversal — sellers reversed more than half the rally'
                        });
                    }
                }
            }
            const body = Math.abs(curr.close - curr.open);
            const range = curr.high - curr.low;
            if (range === 0) continue;

            const upperWick = curr.high - Math.max(curr.open, curr.close);
            const lowerWick = Math.min(curr.open, curr.close) - curr.low;

            const prevBody = Math.abs(prev.close - prev.open);
            const prevRange = prev.high - prev.low;

            // ══ 1. DOJI (subtypes) ══
            if (enabledTypes.has('doji') && body / range < 0.05) {
                const upperRatio = upperWick / range;
                const lowerRatio = lowerWick / range;

                if (lowerRatio > 0.55 && upperRatio < 0.15) {
                    patterns.push({
                        type: 'Доджи-стрекоза', typeEn: 'Dragonfly Doji', group: 'doji',
                        index: i, time: curr.time,
                        position: 'belowBar', direction: 'bullish',
                        color: '#FBBF24',
                        description: 'Бычий сигнал — покупатели оттолкнули цену от минимума',
                        descriptionEn: 'Bullish signal — buyers pushed price back from the low'
                    });
                } else if (upperRatio > 0.55 && lowerRatio < 0.15) {
                    patterns.push({
                        type: 'Доджи-надгробие', typeEn: 'Gravestone Doji', group: 'doji',
                        index: i, time: curr.time,
                        position: 'aboveBar', direction: 'bearish',
                        color: '#FBBF24',
                        description: 'Медвежий сигнал — продавцы оттолкнули цену от максимума',
                        descriptionEn: 'Bearish signal — sellers pushed price back from the high'
                    });
                } else if (upperRatio > 0.3 && lowerRatio > 0.3) {
                    patterns.push({
                        type: 'Длинноногий доджи', typeEn: 'Long-Legged Doji', group: 'doji',
                        index: i, time: curr.time,
                        position: 'belowBar', direction: 'neutral',
                        color: '#FBBF24',
                        description: 'Сильная неопределённость — борьба покупателей и продавцов',
                        descriptionEn: 'High indecision — buyers and sellers in balance'
                    });
                } else {
                    patterns.push({
                        type: 'Доджи', typeEn: 'Doji', group: 'doji',
                        index: i, time: curr.time,
                        position: 'belowBar', direction: 'neutral',
                        color: '#FBBF24',
                        description: 'Рыночная неопределённость — возможный разворот',
                        descriptionEn: 'Market indecision — possible reversal'
                    });
                }
                continue;
            }

            // ══ 2. MARUBOZU ══
            if (enabledTypes.has('marubozu') && body / range >= 0.85) {
                const isBullish = curr.close > curr.open;
                patterns.push({
                    type: isBullish ? 'Бычий марибозу' : 'Медвежий марибозу',
                    typeEn: isBullish ? 'Bullish Marubozu' : 'Bearish Marubozu',
                    group: 'marubozu',
                    index: i, time: curr.time,
                    position: isBullish ? 'belowBar' : 'aboveBar',
                    direction: isBullish ? 'bullish' : 'bearish',
                    color: isBullish ? '#10B981' : '#EF4444',
                    description: isBullish
                        ? 'Сильное давление покупателей — цена закрылась у максимума'
                        : 'Сильное давление продавцов — цена закрылась у минимума',
                    descriptionEn: isBullish
                        ? 'Strong buying pressure — price closed at the high'
                        : 'Strong selling pressure — price closed at the low'
                });
                continue;
            }

            // ══ 3. HAMMER / HANGING MAN ══
            if (enabledTypes.has('hammer') && body / range >= 0.1 && body / range <= 0.35 &&
                lowerWick >= body * 2 && upperWick <= body * 0.3) {
                const trend = getTrend(i, 3);
                if (trend === 'down') {
                    patterns.push({
                        type: 'Молот', typeEn: 'Hammer', group: 'hammer',
                        index: i, time: curr.time,
                        position: 'belowBar', direction: 'bullish',
                        color: '#10B981',
                        description: 'Бычий разворот — покупатели вступили в игру после падения',
                        descriptionEn: 'Bullish reversal — buyers stepped in after a decline'
                    });
                    continue;
                }
                if (trend === 'up') {
                    patterns.push({
                        type: 'Повешенный', typeEn: 'Hanging Man', group: 'hammer',
                        index: i, time: curr.time,
                        position: 'aboveBar', direction: 'bearish',
                        color: '#EF4444',
                        description: 'Медвежий сигнал — форма молота на вершине тренда',
                        descriptionEn: 'Bearish signal — hammer shape at the top of an uptrend'
                    });
                    continue;
                }
            }

            // ══ 4. SHOOTING STAR / INVERTED HAMMER ══
            if (enabledTypes.has('shooting_star') && body / range >= 0.1 && body / range <= 0.35 &&
                upperWick >= body * 2 && lowerWick <= body * 0.3) {
                const trend = getTrend(i, 3);
                if (trend === 'up') {
                    patterns.push({
                        type: 'Падающая звезда', typeEn: 'Shooting Star', group: 'shooting_star',
                        index: i, time: curr.time,
                        position: 'aboveBar', direction: 'bearish',
                        color: '#EF4444',
                        description: 'Медвежий разворот — продавцы отбили рост',
                        descriptionEn: 'Bearish reversal — sellers rejected the rally'
                    });
                    continue;
                }
                if (trend === 'down') {
                    patterns.push({
                        type: 'Перевёрнутый молот', typeEn: 'Inverted Hammer', group: 'shooting_star',
                        index: i, time: curr.time,
                        position: 'belowBar', direction: 'bullish',
                        color: '#10B981',
                        description: 'Бычий сигнал — попытка разворота после падения',
                        descriptionEn: 'Bullish signal — potential reversal attempt after a drop'
                    });
                    continue;
                }
            }

            // ══ 5. TWEEZER TOP / BOTTOM ══
            if (enabledTypes.has('tweezer') && i >= 2) {
                const tolerance = range * 0.005;
                // Tweezer Top — две свечи с одинаковым максимумом после роста
                if (Math.abs(curr.high - prev.high) <= tolerance && getTrend(i, 3) === 'up') {
                    const prevIsBull = prev.close > prev.open;
                    const currIsBear = curr.close < curr.open;
                    if (prevIsBull && currIsBear) {
                        patterns.push({
                            type: 'Пинцет (вершина)', typeEn: 'Tweezer Top', group: 'tweezer',
                            index: i, time: curr.time,
                            position: 'aboveBar', direction: 'bearish',
                            color: '#F59E0B',
                            description: 'Медвежий разворот — двойной тест максимума',
                            descriptionEn: 'Bearish reversal — double rejection at the high'
                        });
                    }
                }
                // Tweezer Bottom — две свечи с одинаковым минимумом после падения
                if (Math.abs(curr.low - prev.low) <= tolerance && getTrend(i, 3) === 'down') {
                    const prevIsBear = prev.close < prev.open;
                    const currIsBull = curr.close > curr.open;
                    if (prevIsBear && currIsBull) {
                        patterns.push({
                            type: 'Пинцет (дно)', typeEn: 'Tweezer Bottom', group: 'tweezer',
                            index: i, time: curr.time,
                            position: 'belowBar', direction: 'bullish',
                            color: '#F59E0B',
                            description: 'Бычий разворот — двойной тест минимума',
                            descriptionEn: 'Bullish reversal — double support at the low'
                        });
                    }
                }
            }

            // ══ 6. HARAMI (bullish / bearish) ══
            if (enabledTypes.has('harami') && hasBody(prev) && prevBody > 0 && body < prevBody * 0.4 && body > 0) {
                const prevTop = Math.max(prev.open, prev.close);
                const prevBot = Math.min(prev.open, prev.close);
                const currTop = Math.max(curr.open, curr.close);
                const currBot = Math.min(curr.open, curr.close);
                const margin = prevBody * 0.1;

                if (currTop <= prevTop - margin && currBot >= prevBot + margin) {
                    const prevIsBearish2 = prev.close < prev.open;
                    const prevIsBullish2 = prev.close > prev.open;
                    const currIsBullish2 = curr.close > curr.open;
                    const currIsBearish2 = curr.close < curr.open;

                    if (prevIsBearish2 && currIsBullish2 && getTrend(i, 3) === 'down') {
                        patterns.push({
                            type: 'Бычий харами', typeEn: 'Bullish Harami', group: 'harami',
                            index: i, time: curr.time,
                            position: 'belowBar', direction: 'bullish',
                            color: '#10B981',
                            description: 'Бычий разворот — маленькая свеча внутри большой медвежьей',
                            descriptionEn: 'Bullish reversal — small candle inside a large bearish one'
                        });
                    }
                    if (prevIsBullish2 && currIsBearish2 && getTrend(i, 3) === 'up') {
                        patterns.push({
                            type: 'Медвежий харами', typeEn: 'Bearish Harami', group: 'harami',
                            index: i, time: curr.time,
                            position: 'aboveBar', direction: 'bearish',
                            color: '#EF4444',
                            description: 'Медвежий разворот — маленькая свеча внутри большой бычьей',
                            descriptionEn: 'Bearish reversal — small candle inside a large bullish one'
                        });
                    }
                }
            }


            // ══ 7. ENGULFING ══
            if (enabledTypes.has('engulfing') && hasBody(prev)) {
                const prevIsBullish = prev.close > prev.open;
                const prevIsBearish = prev.close < prev.open;
                const currIsBullish = curr.close > curr.open;
                const currIsBearish = curr.close < curr.open;
                const bodyTol = prevBody * 0.05;

                // BEARISH ENGULFING: prev green, curr red, и последние 2 свечи (до предыдущей) были бычьими
                if (prevIsBullish && currIsBearish &&
                    curr.open >= prev.close - bodyTol &&
                    curr.close <= prev.open + bodyTol &&
                    body >= prevBody * 1.2) {

                    // Проверяем, что перед предыдущей свечой были две бычьи подряд
                    let twoPrevBullish = true;
                    for (let j = i - 2; j < i; j++) {
                        if (j >= 0 && candles[j].close <= candles[j].open) { // не бычья
                            twoPrevBullish = false;
                            break;
                        }
                    }
                    if (twoPrevBullish) {
                        patterns.push({
                            type: 'Медвежье поглощение', typeEn: 'Bearish Engulfing', group: 'engulfing',
                            index: i, time: curr.time,
                            position: 'aboveBar', direction: 'bearish',
                            color: '#EF4444',
                            description: 'Медвежий разворот — продавцы полностью поглотили покупателей',
                            descriptionEn: 'Bearish reversal — sellers fully engulfed the buyers'
                        });
                    }
                }

                // BULLISH ENGULFING: prev red, curr green, и последние 2 свечи (до предыдущей) были медвежьими
                if (prevIsBearish && currIsBullish &&
                    curr.open <= prev.close + bodyTol &&
                    curr.close >= prev.open - bodyTol &&
                    body >= prevBody * 1.2) {

                    let twoPrevBearish = true;
                    for (let j = i - 2; j < i; j++) {
                        if (j >= 0 && candles[j].close >= candles[j].open) { // не медвежья
                            twoPrevBearish = false;
                            break;
                        }
                    }
                    if (twoPrevBearish) {
                        patterns.push({
                            type: 'Бычье поглощение', typeEn: 'Bullish Engulfing', group: 'engulfing',
                            index: i, time: curr.time,
                            position: 'belowBar', direction: 'bullish',
                            color: '#10B981',
                            description: 'Бычий разворот — покупатели полностью поглотили продавцов',
                            descriptionEn: 'Bullish reversal — buyers fully engulfed the sellers'
                        });
                    }
                }
            }
        }

        return patterns;
    }

    // ═══════════════════════════════════════════
    // DOUBLE TOP / DOUBLE BOTTOM DETECTION
    // ═══════════════════════════════════════════

    function getIntervalFromDays(days) {
        if (days <= 0.04) return '1h';
        if (days <= 0.17) return '4h';
        if (days <= 1)    return '1d';
        if (days <= 7)    return '1w';
        return '1M';
    }

    function getDoubleParams(interval) {
        if (interval === '1h') return { minGap: 25, maxGap: 60,  minRetrace: 0.04, maxRetrace: 0.12, radius: 5 };
        if (interval === '4h') return { minGap: 20, maxGap: 110, minRetrace: 0.10, maxRetrace: 0.30, radius: 6 };
        if (interval === '1d') return { minGap: 20, maxGap: 60,  minRetrace: 0.10, maxRetrace: 0.35, radius: 10 };
        if (interval === '1w') return { minGap: 35, maxGap: 50,  minRetrace: 0.15, maxRetrace: 0.60, radius: 12  };
        return { minGap: 25, maxGap: 60, minRetrace: 0.15, maxRetrace: 0.25, radius: 10 };
    }

    function findLocalExtremes(candles, radius) {
        const tops = [], bottoms = [];
        const len = candles.length;

        // Исключаем последнюю свечу (незакрытую)
        for (let i = 0; i < len - 1; i++) {
            const c = candles[i];
            const fullRange = c.high - c.low;
            let isTop = true, isBottom = true;

            // Проверка слева
            for (let j = 1; j <= radius; j++) {
                if (i - j < 0) break;
                if (c.high <= candles[i - j].high) isTop = false;
                if (c.low >= candles[i - j].low) isBottom = false;
            }

            // Проверка справа (только по закрытым свечам, до len-1)
            for (let j = 1; j <= radius; j++) {
                if (i + j >= len - 1) break; // не заходим на последнюю
                if (c.high <= candles[i + j].high) isTop = false;
                if (c.low >= candles[i + j].low) isBottom = false;
            }

            // Фильтр длинных теней (порог 0.95)
            if (isTop && fullRange > 0) {
                const upperWick = c.high - Math.max(c.open, c.close);
                if (upperWick / fullRange > 0.95) isTop = false;
            }
            if (isBottom && fullRange > 0) {
                const lowerWick = Math.min(c.open, c.close) - c.low;
                if (lowerWick / fullRange > 0.95) isBottom = false;
            }

            if (isTop) tops.push(i);
            if (isBottom) bottoms.push(i);
        }
        return { tops, bottoms };
    }

    function detectDoublePatterns(candles, days) {
        // Двойное дно/вершина — только для 1D и выше (на 1H и 4H слишком много ложных сигналов)
        const interval   = getIntervalFromDays(days);
        if (interval === '1h' || interval === '4h') return [];
        const params     = getDoubleParams(interval);
        const tolerance  = 0.020;
        const minRetrace = 0.03;
        const radius     = params.radius;
        const { tops, bottoms } = findLocalExtremes(candles, radius);
        const patterns = [];

        // Double Top — цепочка: вторая вершина паттерна становится первой для следующего
        // Ищем ближайшую подходящую пару в пределах maxGap, пропуская промежуточные мелкие
        for (let a = 0; a < tops.length - 1; a++) {
            for (let b = a + 1; b < tops.length; b++) {
                const i1 = tops[a], i2 = tops[b];
                const gap = i2 - i1;
                if (gap < params.minGap) continue;
                if (gap > params.maxGap) break;
                const h1 = candles[i1].high, h2 = candles[i2].high;
                const tolDiff = Math.abs(h1 - h2) / Math.max(h1, h2);
                if (tolDiff > tolerance) continue;
                const level   = Math.max(h1, h2);
                let minBetween = Infinity;
                let breached = false;
                for (let k = i1 + 1; k < i2; k++) {
                    if (candles[k].low < minBetween) minBetween = candles[k].low;
                    if (candles[k].high > level * (1 + tolerance)) { breached = true; break; }
                }
                if (breached) continue;
                const retrace = (level - minBetween) / level;
                if (retrace < minRetrace) continue;
                patterns.push({
                    type: 'double_top', typeEn: 'Double Top',
                    group: 'double', direction: 'bearish',
                    time1: candles[i1].time, time2: candles[i2].time,
                    level, price1: h1, price2: h2,
                    retrace: (retrace * 100).toFixed(1)
                });
                a = b - 1;  // следующая итерация: a станет b → вершина b = новый time1
                break;
            }
        }

        // Double Bottom — цепочка: второе дно паттерна становится первым для следующего
        for (let a = 0; a < bottoms.length - 1; a++) {
            for (let b = a + 1; b < bottoms.length; b++) {
                const i1 = bottoms[a], i2 = bottoms[b];
                const gap = i2 - i1;
                if (gap < params.minGap) continue;
                if (gap > params.maxGap) break;
                const l1 = candles[i1].low, l2 = candles[i2].low;
                if (Math.abs(l1 - l2) / Math.min(l1, l2) > tolerance) continue;
                const level   = Math.min(l1, l2);
                let maxBetween = 0;
                let breached = false;
                for (let k = i1 + 1; k < i2; k++) {
                    if (candles[k].high > maxBetween) maxBetween = candles[k].high;
                    if (candles[k].low < level * (1 - tolerance)) { breached = true; break; }
                }
                if (breached) continue;
                const retrace = (maxBetween - level) / level;
                if (retrace < minRetrace) continue;
                patterns.push({
                    type: 'double_bottom', typeEn: 'Double Bottom',
                    group: 'double', direction: 'bullish',
                    time1: candles[i1].time, time2: candles[i2].time,
                    level, price1: l1, price2: l2,
                    retrace: (retrace * 100).toFixed(1)
                });
                a = b - 1;
                break;
            }
        }

        return patterns;
    }

    // ═══════════════════════════════════════════
    // FORMING (REAL-TIME) DOUBLE PATTERNS
    // ═══════════════════════════════════════════

    function detectFormingPatterns(candles, days, confirmedPatterns) {
        if (candles.length < 5) return [];
        const interval   = getIntervalFromDays(days);
        if (interval === '1h' || interval === '4h') return [];
        const params     = getDoubleParams(interval);
        const tolerance  = 0.020;
        const minRetrace = 0.03;
        const radius     = params.radius;
        const { tops, bottoms } = findLocalExtremes(candles, radius);
        let forming = [];

        const last = candles[candles.length - 1];
        const lastIdx = candles.length - 1;

        // ── Forming Double Top ──
        for (let a = tops.length - 1; a >= 0; a--) {
            const i1 = tops[a];
            const h1 = candles[i1].high;
            const gap = lastIdx - i1;

            if (gap < params.minGap) continue;
            if (gap > params.maxGap) break;

            let minBetween = Infinity;
            let breached = false;
            for (let k = i1 + 1; k < lastIdx; k++) {
                if (candles[k].low < minBetween) minBetween = candles[k].low;
                if (candles[k].high > h1 * (1 + tolerance)) { breached = true; break; }
            }
            if (breached) continue;

            const retrace = (h1 - minBetween) / h1;
            if (retrace < minRetrace) continue;

            if (last.high >= h1 * (1 - tolerance)) {
                if (last.high > h1 * (1 + tolerance)) continue;
                forming.push({
                    type: 'forming_double_top',
                    typeEn: 'Forming Double Top',
                    typeRu: 'Формируется дв. вершина',
                    group: 'double', direction: 'bearish',
                    time1: candles[i1].time,
                    time2: last.time,
                    level: h1,
                    price1: h1,
                    price2: last.high,
                    retrace: (retrace * 100).toFixed(1)
                });
                break;
            }
        }

        // ── Forming Double Bottom ──
        for (let a = bottoms.length - 1; a >= 0; a--) {
            const i1 = bottoms[a];
            const l1 = candles[i1].low;
            const gap = lastIdx - i1;

            if (gap < params.minGap) continue;
            if (gap > params.maxGap) break;

            let maxBetween = 0;
            let breached = false;
            for (let k = i1 + 1; k < lastIdx; k++) {
                if (candles[k].high > maxBetween) maxBetween = candles[k].high;
                if (candles[k].low < l1 * (1 - tolerance)) { breached = true; break; }
            }
            if (breached) continue;

            const retrace = (maxBetween - l1) / l1;
            if (retrace < minRetrace) continue;

            if (last.low <= l1 * (1 + tolerance)) {
                if (last.low < l1 * (1 - tolerance)) continue;
                forming.push({
                    type: 'forming_double_bottom',
                    typeEn: 'Forming Double Bottom',
                    typeRu: 'Формируется дв. дно',
                    group: 'double', direction: 'bullish',
                    time1: candles[i1].time,
                    time2: last.time,
                    level: l1,
                    price1: l1,
                    price2: last.low,
                    retrace: (retrace * 100).toFixed(1)
                });
                break;
            }
        }

        // ===== ФИЛЬТРАЦИЯ: убираем forming, которые уже есть в confirmedPatterns =====
        if (confirmedPatterns && confirmedPatterns.length) {
            forming = forming.filter(f => {
                return !confirmedPatterns.some(c => {
                    // Для двойной вершины
                    if (f.type === 'forming_double_top' && c.type === 'double_top' && c.direction === 'bearish') {
                        return c.time1 === f.time1 && Math.abs(c.level - f.level) / c.level <= tolerance;
                    }
                    // Для двойного дна
                    if (f.type === 'forming_double_bottom' && c.type === 'double_bottom' && c.direction === 'bullish') {
                        return c.time1 === f.time1 && Math.abs(c.level - f.level) / c.level <= tolerance;
                    }
                    return false;
                });
            });
        }

        return forming;
    }

    // ═══════════════════════════════════════════
    // SUPPORT / RESISTANCE LEVELS DETECTION
    // ═══════════════════════════════════════════

    function detectLevels(candles, days) {
        if (candles.length < 40) return null;

        // Не определяем боковик для таймфреймов 1М и выше
        if (days >= 30) return null;

        // ── Количество свечей для анализа (увеличено для точности) ──
        // Минутные/5-минутные: до 200, часовые: 150, дневные: 100
        let barsCount;
        if (days <= 0.01)       barsCount = 200;   // 1м, 5м, 15м
        else if (days <= 0.04)  barsCount = 150;   // 1ч
        else if (days <= 0.17)  barsCount = 120;   // 4ч
        else                    barsCount = 100;    // 1д

        if (candles.length < barsCount) barsCount = candles.length;
        if (barsCount < 30) return null;

        const window = candles.slice(-barsCount);
        const rangeStart = candles.length - barsCount;

        // ── ATR по последним 14 свечам ──
        const atrLen = Math.min(14, candles.length);
        let atrSum = 0;
        for (let i = candles.length - atrLen; i < candles.length; i++) {
            atrSum += candles[i].high - candles[i].low;
        }
        const atr = atrSum / atrLen;

        // ── Tolerance для кластеризации: адаптивная к таймфрейму ──
        // Младшие ТФ (1м–15м): 0.05%, Старшие (1ч+): 0.08%, Дневные: 0.12%
        let tolerance;
        if (days <= 0.01)       tolerance = 0.0005;   // 0.05%
        else if (days <= 0.04)  tolerance = 0.0008;   // 0.08%
        else if (days <= 0.17)  tolerance = 0.001;    // 0.1%
        else                    tolerance = 0.0012;   // 0.12%

        // ── Шаг 1: Pivot Points (локальные экстремумы) ──
        // Проверяем 2 свечи в каждую сторону (radius = 2)
        const pivots = [];
        for (let i = 2; i < window.length - 2; i++) {
            const c = window[i];

            const isHigh = c.high > window[i-1].high && c.high > window[i+1].high
                        && c.high >= window[i-2].high && c.high >= window[i+2].high;

            const isLow = c.low < window[i-1].low && c.low < window[i+1].low
                       && c.low <= window[i-2].low && c.low <= window[i+2].low;

            if (isHigh) pivots.push({ price: c.high, index: rangeStart + i, type: 'high' });
            if (isLow)  pivots.push({ price: c.low,  index: rangeStart + i, type: 'low' });
        }

        if (pivots.length < 2) return null;

        // ── Шаг 2: Кластеризация близких pivot-ов ──
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

        // ── Шаг 3: Фильтр — минимум 2 касания ──
        const allLevels = [];
        for (const cluster of clusters) {
            if (cluster.length < 2) continue;

            const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
            const highs = cluster.filter(p => p.type === 'high').length;
            const lows  = cluster.filter(p => p.type === 'low').length;
            const type  = highs > lows ? 'resistance' : 'support';

            allLevels.push({
                price:   Math.round(avgPrice * 100) / 100,
                touches: cluster.length,
                type:    type,
            });
        }

        // ── Шаг 4: Убираем дубликаты (уровни ближе 0.1%) ──
        const merged = [];
        const sortedAll = allLevels.sort((a, b) => a.price - b.price);

        for (const level of sortedAll) {
            const existing = merged.find(m =>
                Math.abs(m.price - level.price) / m.price < 0.001
            );
            if (existing) {
                if (level.touches > existing.touches) {
                    Object.assign(existing, level);
                }
            } else {
                merged.push({ ...level });
            }
        }

        if (merged.length === 0) return null;

        // ── Шаг 5: Выбираем основные support и resistance ──
        const lastPrice = candles[candles.length - 1].close;

        // Поддержка: самый сильный уровень НИЖЕ текущей цены
        const supLevels = merged.filter(l => l.price < lastPrice).sort((a, b) => b.touches - a.touches);
        const support = supLevels.length > 0 ? supLevels[0].price : merged[0].price;
        const supportTouches = supLevels.length > 0 ? supLevels[0].touches : merged[0].touches;

        // Сопротивление: самый сильный уровень ВЫШЕ текущей цены
        const resLevels = merged.filter(l => l.price > lastPrice).sort((a, b) => b.touches - a.touches);
        const resistance = resLevels.length > 0 ? resLevels[0].price : merged[merged.length - 1].price;
        const resistanceTouches = resLevels.length > 0 ? resLevels[0].touches : merged[merged.length - 1].touches;

        // Если support >= resistance (цена за пределами всех уровней), корректируем
        if (support >= resistance) {
            // Берём самый нижний и самый верхний
            const fallbackSup = merged[0].price;
            const fallbackRes = merged[merged.length - 1].price;
            if (fallbackSup < fallbackRes) {
                return buildResult(fallbackSup, merged[0].touches, fallbackRes, merged[merged.length-1].touches,
                                   rangeStart, candles, barsCount, lastPrice, atr);
            }
            return null;
        }

        return buildResult(support, supportTouches, resistance, resistanceTouches,
                           rangeStart, candles, barsCount, lastPrice, atr);
    }

    // Формируем результат в том же формате что и раньше (совместимость с app.html)
    function buildResult(support, supportTouches, resistance, resistanceTouches,
                         rangeStart, candles, barsCount, lastPrice, atr) {
        const rangeSize   = resistance - support;
        const positionPct = rangeSize > 0 ? ((lastPrice - support) / rangeSize) * 100 : 50;

        let signal = 'neutral', signalText = '', signalTextEn = '';

        if (positionPct <= 0) {
            signal = 'bear'; signalText = 'Пробой поддержки';       signalTextEn = 'Support breakout';
        } else if (positionPct >= 100) {
            signal = 'bull'; signalText = 'Пробой сопротивления';   signalTextEn = 'Resistance breakout';
        } else if (positionPct <= 20) {
            signal = 'bull'; signalText = 'Цена у поддержки';       signalTextEn = 'Price at support';
        } else if (positionPct >= 80) {
            signal = 'bear'; signalText = 'Цена у сопротивления';   signalTextEn = 'Price at resistance';
        } else if (positionPct <= 40) {
            signal = 'bull'; signalText = 'Цена ближе к поддержке'; signalTextEn = 'Price near support';
        } else if (positionPct >= 60) {
            signal = 'bear'; signalText = 'Цена ближе к сопротивлению'; signalTextEn = 'Price near resistance';
        } else {
            signal = 'neutral'; signalText = 'Цена в середине диапазона'; signalTextEn = 'Price in mid-range';
        }

        return {
            support:          Math.round(support    * 100) / 100,
            resistance:       Math.round(resistance * 100) / 100,
            supportTouches,
            resistanceTouches,
            rangeStartIdx:    rangeStart,
            rangeStartTime:   candles[rangeStart].time,
            candlesInRange:   barsCount,
            positionPct:      Math.round(positionPct),
            signal,
            signalText,
            signalTextEn,
            lastPrice,
            atr: Math.round(atr * 100) / 100,
        };
    }

    // ═══════════════════════════════════════════
    // WIN RATE CALCULATION
    // ═══════════════════════════════════════════

    function calcWinRate(candles, days) {
        if (candles.length < 10) return {};

        const patterns = detectPatterns(candles);
        const results = {};

        // ── Адаптивные параметры под таймфрейм ──
        // UI передаёт days: 0.0007=1m, 0.003=5m, 0.04=1h, 0.17=4h, 1=1d, 7=1w
        let lookforward, minMovePct;
        if (days <= 0.001) {
            // 1-минутный таймфрейм: 10 свечей, цена должна пройти 0.15%
            lookforward = 10;
            minMovePct = 0.0015;
        } else if (days <= 0.005) {
            // 5-минутный таймфрейм: 6 свечей, цена должна пройти 0.20%
            lookforward = 6;
            minMovePct = 0.0020;
        } else if (days <= 0.04) {
            // 1-часовой таймфрейм: 6 свечей, цена должна пройти 0.20%
            lookforward = 6;
            minMovePct = 0.0020;
        } else {
            // 4h, 1d, 1w — оставляем старую логику (body-based targets)
            lookforward = 0; // 0 = использовать старую логику
            minMovePct = 0;
        }

        // Бычье поглощение
        const bullEngulf = patterns.filter(p => p.type === 'Бычье поглощение');
        if (bullEngulf.length > 0) {
            let win = 0, total = 0;
            bullEngulf.forEach(p => {
                const idx = p.index;
                const lf = lookforward || 2;
                if (idx + lf >= candles.length) return;
                const body = Math.abs(candles[idx].close - candles[idx].open);
                const target = minMovePct > 0
                    ? candles[idx].close * (1 + minMovePct)
                    : candles[idx].close + 0.5 * body;
                let maxClose = 0;
                for (let n = 1; n <= lf; n++) {
                    if (idx + n < candles.length && candles[idx + n].close > maxClose) maxClose = candles[idx + n].close;
                }
                total++;
                if (maxClose >= target) win++;
            });
            if (total >= 2) {
                results['Бычье поглощение'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Медвежье поглощение
        const bearEngulf = patterns.filter(p => p.type === 'Медвежье поглощение');
        if (bearEngulf.length > 0) {
            let win = 0, total = 0;
            bearEngulf.forEach(p => {
                const idx = p.index;
                const lf = lookforward || 2;
                if (idx + lf >= candles.length) return;
                const body = Math.abs(candles[idx].close - candles[idx].open);
                const target = minMovePct > 0
                    ? candles[idx].close * (1 - minMovePct)
                    : candles[idx].close - 0.5 * body;
                let minClose = Infinity;
                for (let n = 1; n <= lf; n++) {
                    if (idx + n < candles.length && candles[idx + n].close < minClose) minClose = candles[idx + n].close;
                }
                total++;
                if (minClose <= target) win++;
            });
            if (total >= 2) {
                results['Медвежье поглощение'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Бычий марибозу — цена должна вырасти на minMovePct (или не пробить low для больших TF)
        const bullMar = patterns.filter(p => p.type === 'Бычий марибозу');
        if (bullMar.length > 0) {
            let win = 0, total = 0;
            bullMar.forEach(p => {
                const idx = p.index;
                const lf = lookforward || 3;
                if (idx + lf >= candles.length) return;
                total++;
                if (minMovePct > 0) {
                    // Короткие TF: цена должна вырасти на minMovePct
                    const target = candles[idx].close * (1 + minMovePct);
                    let maxClose = 0;
                    for (let n = 1; n <= lf; n++) {
                        if (idx + n < candles.length && candles[idx + n].close > maxClose) maxClose = candles[idx + n].close;
                    }
                    if (maxClose >= target) win++;
                } else {
                    // Большие TF: старая логика — не пробил low
                    const broken = [1,2,3].some(n => candles[idx + n].close < candles[idx].low);
                    if (!broken) win++;
                }
            });
            if (total >= 2) {
                results['Бычий марибозу'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Медвежий марибозу — цена должна упасть на minMovePct (или не пробить high для больших TF)
        const bearMar = patterns.filter(p => p.type === 'Медвежий марибозу');
        if (bearMar.length > 0) {
            let win = 0, total = 0;
            bearMar.forEach(p => {
                const idx = p.index;
                const lf = lookforward || 3;
                if (idx + lf >= candles.length) return;
                total++;
                if (minMovePct > 0) {
                    // Короткие TF: цена должна упасть на minMovePct
                    const target = candles[idx].close * (1 - minMovePct);
                    let minClose = Infinity;
                    for (let n = 1; n <= lf; n++) {
                        if (idx + n < candles.length && candles[idx + n].close < minClose) minClose = candles[idx + n].close;
                    }
                    if (minClose <= target) win++;
                } else {
                    // Большие TF: старая логика — не пробил high
                    const broken = [1,2,3].some(n => candles[idx + n].close > candles[idx].high);
                    if (!broken) win++;
                }
            });
            if (total >= 2) {
                results['Медвежий марибозу'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Утренняя звезда — цена должна вырасти на minMovePct (или на тело 3-й свечи для больших TF)
        const mornStars = patterns.filter(p => p.type === 'Утренняя звезда');
        if (mornStars.length > 0) {
            let win = 0, total = 0;
            mornStars.forEach(p => {
                const midIdx = p.index; // средняя свеча
                const thirdIdx = midIdx + 1; // третья — зелёная подтверждающая
                if (thirdIdx >= candles.length) return;
                const c3 = candles[thirdIdx];
                const body3 = Math.abs(c3.close - c3.open);
                if (body3 <= 0) return;
                const target = minMovePct > 0
                    ? c3.close * (1 + minMovePct)
                    : c3.close + body3;
                const startN = minMovePct > 0 ? 1 : 3;
                const endN = lookforward || 8;
                let maxClose = -Infinity;
                let checked = 0;
                for (let n = startN; n <= endN; n++) {
                    if (thirdIdx + n < candles.length) {
                        if (candles[thirdIdx + n].close > maxClose) maxClose = candles[thirdIdx + n].close;
                        checked++;
                    }
                }
                if (checked === 0) return;
                total++;
                if (maxClose >= target) win++;
            });
            if (total >= 2) {
                results['Утренняя звезда'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Вечерняя звезда — цена должна упасть на minMovePct (или на тело 3-й свечи для больших TF)
        const eveStars = patterns.filter(p => p.type === 'Вечерняя звезда');
        if (eveStars.length > 0) {
            let win = 0, total = 0;
            eveStars.forEach(p => {
                const midIdx = p.index; // средняя свеча
                const thirdIdx = midIdx + 1; // третья — красная подтверждающая
                if (thirdIdx >= candles.length) return;
                const c3 = candles[thirdIdx];
                const body3 = Math.abs(c3.close - c3.open);
                if (body3 <= 0) return;
                const target = minMovePct > 0
                    ? c3.close * (1 - minMovePct)
                    : c3.close - body3;
                const startN = minMovePct > 0 ? 1 : 3;
                const endN = lookforward || 8;
                let minClose = Infinity;
                let checked = 0;
                for (let n = startN; n <= endN; n++) {
                    if (thirdIdx + n < candles.length) {
                        if (candles[thirdIdx + n].close < minClose) minClose = candles[thirdIdx + n].close;
                        checked++;
                    }
                }
                if (checked === 0) return;
                total++;
                if (minClose <= target) win++;
            });
            if (total >= 2) {
                results['Вечерняя звезда'] = { win, total, pct: Math.round((win / total) * 100) };
            }
        }

        // Бычьи: Молот, Перевёрнутый молот
        ['Молот', 'Перевёрнутый молот'].forEach(type => {
            const pts = patterns.filter(p => p.type === type);
            if (pts.length > 0) {
                let win = 0, total = 0;
                const lf = lookforward || 5;
                pts.forEach(p => {
                    const idx = p.index;
                    if (idx < 3 || idx + lf >= candles.length) return;

                    let worked = false;

                    if (minMovePct > 0) {
                        // Короткие TF: цена должна вырасти на minMovePct
                        const target = candles[idx].close * (1 + minMovePct);
                        let maxClose = 0;
                        for (let n = 1; n <= lf; n++) {
                            if (idx + n < candles.length && candles[idx + n].close > maxClose) maxClose = candles[idx + n].close;
                        }
                        if (maxClose >= target) worked = true;
                    } else {
                        // Большие TF: старая логика — 30% от глубины или направление
                        let preHigh = 0;
                        for (let n = 3; n <= Math.min(6, idx); n++) {
                            if (candles[idx - n].high > preHigh) preHigh = candles[idx - n].high;
                        }
                        const depth = preHigh - candles[idx].low;

                        if (depth > 0) {
                            const target = candles[idx].low + depth * 0.3;
                            let maxClose = 0;
                            for (let n = 1; n <= 5; n++) {
                                if (idx + n < candles.length && candles[idx + n].close > maxClose) maxClose = candles[idx + n].close;
                            }
                            if (maxClose >= target) worked = true;
                        }

                        if (!worked) {
                            let aboveCount = 0;
                            for (let n = 1; n <= 5; n++) {
                                if (idx + n < candles.length && candles[idx + n].close > candles[idx].close) aboveCount++;
                            }
                            if (aboveCount >= 3) worked = true;
                        }
                    }

                    total++;
                    if (worked) win++;
                });
                if (total >= 2) {
                    results[type] = { win, total, pct: Math.round((win / total) * 100) };
                }
            }
        });

        // Медвежьи: Повешенный, Падающая звезда
        ['Повешенный', 'Падающая звезда'].forEach(type => {
            const pts = patterns.filter(p => p.type === type);
            if (pts.length > 0) {
                let win = 0, total = 0;
                const lf = lookforward || 5;
                pts.forEach(p => {
                    const idx = p.index;
                    if (idx < 3 || idx + lf >= candles.length) return;

                    let worked = false;

                    if (minMovePct > 0) {
                        // Короткие TF: цена должна упасть на minMovePct
                        const target = candles[idx].close * (1 - minMovePct);
                        let minClose = Infinity;
                        for (let n = 1; n <= lf; n++) {
                            if (idx + n < candles.length && candles[idx + n].close < minClose) minClose = candles[idx + n].close;
                        }
                        if (minClose <= target) worked = true;
                    } else {
                        // Большие TF: старая логика — 30% от глубины или направление
                        let preLow = Infinity;
                        for (let n = 3; n <= Math.min(6, idx); n++) {
                            if (candles[idx - n].low < preLow) preLow = candles[idx - n].low;
                        }
                        const rise = candles[idx].high - preLow;

                        if (rise > 0) {
                            const target = candles[idx].high - rise * 0.3;
                            let minClose = Infinity;
                            for (let n = 1; n <= 5; n++) {
                                if (idx + n < candles.length && candles[idx + n].close < minClose) minClose = candles[idx + n].close;
                            }
                            if (minClose <= target) worked = true;
                        }

                        if (!worked) {
                            let belowCount = 0;
                            for (let n = 1; n <= 5; n++) {
                                if (idx + n < candles.length && candles[idx + n].close < candles[idx].close) belowCount++;
                            }
                            if (belowCount >= 3) worked = true;
                        }
                    }

                    total++;
                    if (worked) win++;
                });
                if (total >= 2) {
                    results[type] = { win, total, pct: Math.round((win / total) * 100) };
                }
            }
        });

        // Двойная вершина / Двойное дно — 35% от глубины ямки/пика за 7-14 свечей
        if (days) {
            const doubles = detectDoublePatterns(candles, days);

            function findIdx(time) {
                for (let i = 0; i < candles.length; i++) {
                    if (candles[i].time === time) return i;
                }
                return -1;
            }

            // Двойная вершина
            const dTops = doubles.filter(p => p.type === 'double_top');
            if (dTops.length > 0) {
                let win = 0, total = 0;
                dTops.forEach(p => {
                    const idx2 = findIdx(p.time2);
                    const idx1 = findIdx(p.time1);
                    if (idx2 < 0 || idx1 < 0 || idx2 + 14 >= candles.length) return;
                    let valleyLow = Infinity;
                    for (let i = idx1; i <= idx2; i++) {
                        if (candles[i].low < valleyLow) valleyLow = candles[i].low;
                    }
                    const depth = p.level - valleyLow;
                    if (depth <= 0) return;
                    const target = p.level - depth * 0.35;
                    let minClose = Infinity;
                    for (let n = 7; n <= 14; n++) {
                        if (idx2 + n < candles.length && candles[idx2 + n].close < minClose) minClose = candles[idx2 + n].close;
                    }
                    total++;
                    if (minClose <= target) win++;
                });
                if (total >= 2) {
                    results['Двойная вершина'] = { win, total, pct: Math.round((win / total) * 100) };
                }
            }

            // Двойное дно
            const dBots = doubles.filter(p => p.type === 'double_bottom');
            if (dBots.length > 0) {
                let win = 0, total = 0;
                dBots.forEach(p => {
                    const idx2 = findIdx(p.time2);
                    const idx1 = findIdx(p.time1);
                    if (idx2 < 0 || idx1 < 0 || idx2 + 14 >= candles.length) return;
                    let peakHigh = 0;
                    for (let i = idx1; i <= idx2; i++) {
                        if (candles[i].high > peakHigh) peakHigh = candles[i].high;
                    }
                    const depth = peakHigh - p.level;
                    if (depth <= 0) return;
                    const target = p.level + depth * 0.35;
                    let maxClose = 0;
                    for (let n = 7; n <= 14; n++) {
                        if (idx2 + n < candles.length && candles[idx2 + n].close > maxClose) maxClose = candles[idx2 + n].close;
                    }
                    total++;
                    if (maxClose >= target) win++;
                });
                if (total >= 2) {
                    results['Двойное дно'] = { win, total, pct: Math.round((win / total) * 100) };
                }
            }
        }

        return results;
    }

    // ═══════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════

    return {
        ALL_TYPES: ALL_PATTERN_TYPES,

        /** Set which pattern types are enabled */
        setFilter(types) {
            enabledTypes = new Set(types);
        },

        /** Get current filter */
        getFilter() {
            return [...enabledTypes];
        },

        /** Toggle a single type */
        toggleType(type) {
            if (enabledTypes.has(type)) enabledTypes.delete(type);
            else enabledTypes.add(type);
            return enabledTypes.has(type);
        },

        /** Enable all types */
        enableAll() {
            enabledTypes = new Set(ALL_PATTERN_TYPES);
        },

        /** Scan candles and return detected patterns */
        scan(candles) {
            return detectPatterns(candles);
        },

        /** Scan for double top / double bottom patterns */
        scanDouble(candles, days) {
            return detectDoublePatterns(candles, days);
        },

        /** Scan for forming (real-time) double patterns */
        scanForming(candles, days, confirmedPatterns) {
            return detectFormingPatterns(candles, days, confirmedPatterns || []);
        },

        /** Scan for support/resistance levels in the current sideways range */
        scanLevels(candles, days) {
            return detectLevels(candles, days);
        },

        /** Calculate win rate for patterns on historical data */
        calcWinRate(candles, days) {
            return calcWinRate(candles, days);
        },

        /** Get human-readable group names */
        getGroupName(group, lang) {
            const names = {
                doji:         { ru: 'Доджи',                      en: 'Doji' },
                hammer:       { ru: 'Молот / Повешенный',          en: 'Hammer / Hanging Man' },
                shooting_star:{ ru: 'Звезда / Перевёрн. молот',   en: 'Shooting Star / Inv. Hammer' },
                harami:       { ru: 'Харами',                      en: 'Harami' },
                engulfing:    { ru: 'Поглощение',                  en: 'Engulfing' },
                marubozu:     { ru: 'Марибозу',                    en: 'Marubozu' },
                tweezer:      { ru: 'Пинцет',                      en: 'Tweezer' },
                morning_star: { ru: 'Утренняя звезда',              en: 'Morning Star' },
                evening_star: { ru: 'Вечерняя звезда',              en: 'Evening Star' },
            };
            const entry = names[group];
            if (!entry) return group;
            return entry[lang] || entry.ru;
        }
    };
})();
