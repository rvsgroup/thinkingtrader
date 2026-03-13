// ============================================================
// patterns-scanner.js — движок сканера свечных паттернов
// Подключается в app.html: <script src="patterns-scanner.js"></script>
// ============================================================

const PatternScanner = (function() {

    // ═══════════════════════════════════════════
    // FILTER STATE
    // ═══════════════════════════════════════════
    const ALL_PATTERN_TYPES = [
        'doji', 'hammer', 'shooting_star', 'harami', 'engulfing', 'marubozu', 'tweezer'
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
            if (!enabledTypes.has('engulfing') || !hasBody(prev)) continue;

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
        if (interval === '1h') return { minGap: 25, maxGap: 60,  minRetrace: 0.04, maxRetrace: 0.12, radius: 20 };
        if (interval === '4h') return { minGap: 20, maxGap: 110, minRetrace: 0.12, maxRetrace: 0.30, radius: 5 };
        if (interval === '1d') return { minGap: 20, maxGap: 60,  minRetrace: 0.10, maxRetrace: 0.35, radius: 10 };
        if (interval === '1w') return { minGap: 35, maxGap: 50,  minRetrace: 0.15, maxRetrace: 0.60, radius: 7  };
        return { minGap: 25, maxGap: 60, minRetrace: 0.15, maxRetrace: 0.25, radius: 10 };
    }

    function findLocalExtremes(candles, radius) {
        const tops = [], bottoms = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const c = candles[i];
            const fullRange = c.high - c.low;
            let isTop = true, isBottom = true;
            for (let j = 1; j <= radius; j++) {
                if (c.high <= candles[i-j].high || c.high <= candles[i+j].high) isTop = false;
                if (c.low  >= candles[i-j].low  || c.low  >= candles[i+j].low)  isBottom = false;
            }
            if (isTop && fullRange > 0) {
                const upperWick = c.high - Math.max(c.open, c.close);
                if (upperWick / fullRange > 0.80) isTop = false;
            }
            if (isBottom && fullRange > 0) {
                const lowerWick = Math.min(c.open, c.close) - c.low;
                if (lowerWick / fullRange > 0.90) isBottom = false;
            }
            if (isTop)    tops.push(i);
            if (isBottom) bottoms.push(i);
        }
        return { tops, bottoms };
    }

    function detectDoublePatterns(candles, days) {
        const interval   = getIntervalFromDays(days);
        const params     = getDoubleParams(interval);
        const tolerance  = 0.020;
        const minRetrace = 0.03;
        const radius     = params.radius;
        const { tops, bottoms } = findLocalExtremes(candles, radius);
        const patterns = [];

        console.log(`[Scanner] interval=${interval} radius=${radius} minGap=${params.minGap} maxGap=${params.maxGap} tolerance=${tolerance} tops=${tops.length} bottoms=${bottoms.length}`);

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
        const params     = getDoubleParams(interval);
        const tolerance  = 0.020;
        const minRetrace = 0.03;
        const radius     = params.radius;
        const { tops, bottoms } = findLocalExtremes(candles, radius);
        const forming = [];

        const last = candles[candles.length - 1];
        const lastIdx = candles.length - 1;

        // ── Forming Double Top ──
        // Ищем подтверждённую вершину, от которой был откат,
        // и текущая цена подходит к её уровню
        for (let a = tops.length - 1; a >= 0; a--) {
            const i1 = tops[a];
            const h1 = candles[i1].high;
            const gap = lastIdx - i1;

            if (gap < params.minGap) continue;
            if (gap > params.maxGap) break;

            // Откат между вершиной и текущей позицией
            let minBetween = Infinity;
            let breached = false;
            for (let k = i1 + 1; k < lastIdx; k++) {
                if (candles[k].low < minBetween) minBetween = candles[k].low;
                if (candles[k].high > h1 * (1 + tolerance)) { breached = true; break; }
            }
            if (breached) continue;

            const retrace = (h1 - minBetween) / h1;
            if (retrace < minRetrace) continue;

            // Текущая цена входит в зону tolerance от вершины
            if (last.high >= h1 * (1 - tolerance)) {
                // Пробила вверх — паттерн исчезает
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
                // Пробила вниз — паттерн исчезает
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

        return forming;
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
            };
            const entry = names[group];
            if (!entry) return group;
            return entry[lang] || entry.ru;
        }
    };
})();
