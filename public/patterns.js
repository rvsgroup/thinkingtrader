// ============================================================
// patterns.js — данные и SVG всех торговых паттернов
// Подключается в index.html: <script src="patterns.js"></script>
// ============================================================

const PATTERNS = [

  // ─────────────────────────────────────────
  // 1. ГОЛОВА И ПЛЕЧИ
  // ─────────────────────────────────────────
  {
    id: 'head-and-shoulders',
    name: 'Head & Shoulders', nameRu: 'Голова и плечи',
    type: 'bearish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '20–50',
    reliability: 'Very High', reliabilityRu: 'Очень высокая',
    desc: 'Three peaks — the center one (head) is higher than the two sides (shoulders). A break below the neckline signals a strong drop. Target equals the distance from head to neckline.', descRu: 'Три пика — центральный (голова) выше двух боковых (плечи). Пробой линии шеи вниз даёт сигнал к сильному падению. Цель равна высоте от головы до шеи.',
    svg: `<svg width="100%" viewBox="0 0 448 210" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="35" x2="448" y2="35" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="70" x2="448" y2="70" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="105" x2="448" y2="105" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="140" x2="448" y2="140" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="175" x2="448" y2="175" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="8" y1="118" x2="360" y2="118" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.85"/>
      <text x="364" y="122" font-size="9" fill="#EF4444" opacity="0.9" font-family="'SF Pro Display', sans-serif">Neckline</text>
      <line x1="14" y1="132" x2="14" y2="136" stroke="#10B981" stroke-width="1.5"/><rect x="11" y="122" width="6" height="10" fill="#10B981" rx="1"/><line x1="14" y1="122" x2="14" y2="125" stroke="#10B981" stroke-width="1.5"/>
      <line x1="22" y1="126" x2="22" y2="129" stroke="#10B981" stroke-width="1.5"/><rect x="19" y="116" width="6" height="10" fill="#10B981" rx="1"/><line x1="22" y1="116" x2="22" y2="119" stroke="#10B981" stroke-width="1.5"/>
      <line x1="30" y1="114" x2="30" y2="118" stroke="#10B981" stroke-width="1.5"/><rect x="27" y="104" width="6" height="10" fill="#10B981" rx="1"/><line x1="30" y1="104" x2="30" y2="107" stroke="#10B981" stroke-width="1.5"/>
      <line x1="38" y1="102" x2="38" y2="106" stroke="#10B981" stroke-width="1.5"/><rect x="35" y="92" width="6" height="10" fill="#10B981" rx="1"/><line x1="38" y1="92" x2="38" y2="95" stroke="#10B981" stroke-width="1.5"/>
      <line x1="46" y1="90" x2="46" y2="93" stroke="#10B981" stroke-width="1.5"/><rect x="43" y="83" width="6" height="7" fill="#10B981" rx="1"/><line x1="46" y1="83" x2="46" y2="86" stroke="#10B981" stroke-width="1.5"/>
      <text x="34" y="72" font-size="8.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">L.S.</text>
      <line x1="46" y1="75" x2="46" y2="83" stroke="#475569" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="54" y1="91" x2="54" y2="95" stroke="#EF4444" stroke-width="1.5"/><rect x="51" y="95" width="6" height="10" fill="#EF4444" rx="1"/><line x1="54" y1="105" x2="54" y2="108" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="62" y1="108" x2="62" y2="112" stroke="#EF4444" stroke-width="1.5"/><rect x="59" y="112" width="6" height="8" fill="#EF4444" rx="1"/><line x1="62" y1="120" x2="62" y2="123" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="70" y1="116" x2="70" y2="120" stroke="#10B981" stroke-width="1.5"/><rect x="67" y="106" width="6" height="10" fill="#10B981" rx="1"/><line x1="70" y1="106" x2="70" y2="109" stroke="#10B981" stroke-width="1.5"/>
      <line x1="78" y1="102" x2="78" y2="106" stroke="#10B981" stroke-width="1.5"/><rect x="75" y="90" width="6" height="12" fill="#10B981" rx="1"/><line x1="78" y1="90" x2="78" y2="93" stroke="#10B981" stroke-width="1.5"/>
      <line x1="86" y1="78" x2="86" y2="82" stroke="#10B981" stroke-width="1.5"/><rect x="83" y="66" width="6" height="12" fill="#10B981" rx="1"/><line x1="86" y1="66" x2="86" y2="69" stroke="#10B981" stroke-width="1.5"/>
      <line x1="94" y1="50" x2="94" y2="54" stroke="#10B981" stroke-width="1.5"/><rect x="91" y="40" width="6" height="10" fill="#10B981" rx="1"/><line x1="94" y1="40" x2="94" y2="43" stroke="#10B981" stroke-width="1.5"/>
      <ellipse cx="94" cy="42" rx="14" ry="10" fill="rgba(239,68,68,0.07)"/>
      <text x="74" y="27" font-size="8.5" fill="#EF4444" font-family="'SF Pro Display', sans-serif">Head</text>
      <line x1="94" y1="29" x2="94" y2="40" stroke="#475569" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="112" y1="40" x2="112" y2="118" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,2" opacity="0.55"/>
      <line x1="108" y1="40" x2="116" y2="40" stroke="#EF4444" stroke-width="1" opacity="0.55"/>
      <line x1="108" y1="118" x2="116" y2="118" stroke="#EF4444" stroke-width="1" opacity="0.55"/>
      <text x="115" y="83" font-size="10" fill="#EF4444" opacity="0.75" font-family="monospace" font-weight="600">H</text>
      <line x1="102" y1="52" x2="102" y2="56" stroke="#EF4444" stroke-width="1.5"/><rect x="99" y="56" width="6" height="14" fill="#EF4444" rx="1"/><line x1="102" y1="70" x2="102" y2="74" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="110" y1="74" x2="110" y2="78" stroke="#EF4444" stroke-width="1.5"/><rect x="107" y="78" width="6" height="14" fill="#EF4444" rx="1"/><line x1="110" y1="92" x2="110" y2="96" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="118" y1="96" x2="118" y2="100" stroke="#EF4444" stroke-width="1.5"/><rect x="115" y="100" width="6" height="10" fill="#EF4444" rx="1"/><line x1="118" y1="110" x2="118" y2="114" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="126" y1="112" x2="126" y2="116" stroke="#10B981" stroke-width="1.5"/><rect x="123" y="102" width="6" height="10" fill="#10B981" rx="1"/><line x1="126" y1="102" x2="126" y2="105" stroke="#10B981" stroke-width="1.5"/>
      <line x1="134" y1="100" x2="134" y2="104" stroke="#10B981" stroke-width="1.5"/><rect x="131" y="90" width="6" height="10" fill="#10B981" rx="1"/><line x1="134" y1="90" x2="134" y2="93" stroke="#10B981" stroke-width="1.5"/>
      <line x1="142" y1="88" x2="142" y2="92" stroke="#10B981" stroke-width="1.5"/><rect x="139" y="80" width="6" height="8" fill="#10B981" rx="1"/><line x1="142" y1="80" x2="142" y2="83" stroke="#10B981" stroke-width="1.5"/>
      <text x="130" y="69" font-size="8.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">R.S.</text>
      <line x1="142" y1="72" x2="142" y2="80" stroke="#475569" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="150" y1="90" x2="150" y2="94" stroke="#EF4444" stroke-width="1.5"/><rect x="147" y="94" width="6" height="10" fill="#EF4444" rx="1"/><line x1="150" y1="104" x2="150" y2="108" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="158" y1="108" x2="158" y2="112" stroke="#EF4444" stroke-width="1.5"/><rect x="155" y="112" width="6" height="8" fill="#EF4444" rx="1"/><line x1="158" y1="120" x2="158" y2="123" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="166" y1="108" x2="166" y2="112" stroke="#EF4444" stroke-width="1.5"/><rect x="163" y="112" width="6" height="24" fill="#EF4444" rx="1"/><line x1="166" y1="136" x2="166" y2="141" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="174" y1="120" x2="174" y2="124" stroke="#10B981" stroke-width="1.5"/><rect x="171" y="114" width="6" height="6" fill="#10B981" rx="1"/><line x1="174" y1="114" x2="174" y2="117" stroke="#10B981" stroke-width="1.5"/>
      <line x1="182" y1="118" x2="182" y2="122" stroke="#EF4444" stroke-width="1.5"/><rect x="179" y="122" width="6" height="20" fill="#EF4444" rx="1"/><line x1="182" y1="142" x2="182" y2="148" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="190" y1="136" x2="190" y2="140" stroke="#EF4444" stroke-width="1.5"/><rect x="187" y="140" width="6" height="22" fill="#EF4444" rx="1"/><line x1="190" y1="162" x2="190" y2="168" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="198" y1="155" x2="198" y2="159" stroke="#EF4444" stroke-width="1.5"/><rect x="195" y="159" width="6" height="20" fill="#EF4444" rx="1"/><line x1="198" y1="179" x2="198" y2="185" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="206" y1="168" x2="206" y2="172" stroke="#EF4444" stroke-width="1.5"/><rect x="203" y="172" width="6" height="18" fill="#EF4444" rx="1"/><line x1="206" y1="190" x2="206" y2="195" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="162" y1="196" x2="340" y2="196" stroke="#10B981" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.8"/>
      <text x="282" y="191" font-size="8.5" fill="#10B981" opacity="0.9" font-family="'SF Pro Display', sans-serif">Take Profit</text>
      <line x1="330" y1="118" x2="330" y2="196" stroke="#10B981" stroke-width="1" stroke-dasharray="2,2" opacity="0.5"/>
      <line x1="326" y1="118" x2="334" y2="118" stroke="#10B981" stroke-width="1" opacity="0.5"/>
      <line x1="326" y1="196" x2="334" y2="196" stroke="#10B981" stroke-width="1" opacity="0.5"/>
      <text x="336" y="161" font-size="10" fill="#10B981" opacity="0.7" font-family="monospace" font-weight="600">H</text>
    </svg>`
  },

  // ─────────────────────────────────────────
  // 2. ПЕРЕВЁРНУТАЯ ГОЛОВА И ПЛЕЧИ
  // ─────────────────────────────────────────
  {
    id: 'inverse-head-and-shoulders',
    name: 'Inv. Head & Shoulders', nameRu: 'Перевёрнутая Г&П',
    type: 'bullish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '20–50',
    reliability: 'Very High', reliabilityRu: 'Очень высокая',
    desc: 'Three troughs — the center one (head) is deeper than the two sides (shoulders). A break above the neckline signals a strong rally. Target equals the distance from head to neckline.', descRu: 'Три впадины — центральная (голова) ниже двух боковых (плечи). Пробой линии шеи вверх даёт сигнал к сильному росту. Цель равна высоте от головы до шеи.',
    svg: `<svg width="100%" viewBox="0 0 448 200" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="40" x2="448" y2="40" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="80" x2="448" y2="80" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="120" x2="448" y2="120" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="160" x2="448" y2="160" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="10" y1="82" x2="340" y2="82" stroke="#10B981" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.8"/>
      <text x="344" y="86" font-size="9" fill="#10B981" opacity="0.9">Neckline</text>
      <line x1="14" y1="52" x2="14" y2="56" stroke="#EF4444" stroke-width="1.5"/><rect x="11" y="56" width="6" height="10" fill="#EF4444" rx="1"/><line x1="14" y1="66" x2="14" y2="70" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="22" y1="60" x2="22" y2="64" stroke="#EF4444" stroke-width="1.5"/><rect x="19" y="64" width="6" height="10" fill="#EF4444" rx="1"/><line x1="22" y1="74" x2="22" y2="78" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="30" y1="72" x2="30" y2="76" stroke="#EF4444" stroke-width="1.5"/><rect x="27" y="76" width="6" height="10" fill="#EF4444" rx="1"/><line x1="30" y1="86" x2="30" y2="90" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="38" y1="84" x2="38" y2="88" stroke="#EF4444" stroke-width="1.5"/><rect x="35" y="88" width="6" height="10" fill="#EF4444" rx="1"/><line x1="38" y1="98" x2="38" y2="102" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="46" y1="100" x2="46" y2="104" stroke="#EF4444" stroke-width="1.5"/><rect x="43" y="104" width="6" height="8" fill="#EF4444" rx="1"/><line x1="46" y1="112" x2="46" y2="116" stroke="#EF4444" stroke-width="1.5"/>
      <text x="34" y="128" font-size="8.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">L.S.</text>
      <line x1="46" y1="120" x2="46" y2="126" stroke="#475569" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="54" y1="100" x2="54" y2="104" stroke="#10B981" stroke-width="1.5"/><rect x="51" y="90" width="6" height="10" fill="#10B981" rx="1"/><line x1="54" y1="90" x2="54" y2="94" stroke="#10B981" stroke-width="1.5"/>
      <line x1="62" y1="84" x2="62" y2="88" stroke="#10B981" stroke-width="1.5"/><rect x="59" y="76" width="6" height="8" fill="#10B981" rx="1"/><line x1="62" y1="76" x2="62" y2="80" stroke="#10B981" stroke-width="1.5"/>
      <line x1="70" y1="80" x2="70" y2="84" stroke="#EF4444" stroke-width="1.5"/><rect x="67" y="84" width="6" height="12" fill="#EF4444" rx="1"/><line x1="70" y1="96" x2="70" y2="100" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="78" y1="96" x2="78" y2="100" stroke="#EF4444" stroke-width="1.5"/><rect x="75" y="100" width="6" height="14" fill="#EF4444" rx="1"/><line x1="78" y1="114" x2="78" y2="118" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="86" y1="112" x2="86" y2="116" stroke="#EF4444" stroke-width="1.5"/><rect x="83" y="116" width="6" height="14" fill="#EF4444" rx="1"/><line x1="86" y1="130" x2="86" y2="136" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="94" y1="148" x2="94" y2="152" stroke="#EF4444" stroke-width="1.5"/><rect x="91" y="152" width="6" height="10" fill="#EF4444" rx="1"/><line x1="94" y1="162" x2="94" y2="166" stroke="#EF4444" stroke-width="1.5"/>
      <ellipse cx="94" cy="162" rx="14" ry="10" fill="rgba(16,185,129,0.07)"/>
      <text x="94" y="180" font-size="8.5" fill="#10B981" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Head</text>
      <line x1="94" y1="170" x2="94" y2="176" stroke="#10B981" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>
      <line x1="112" y1="82" x2="112" y2="162" stroke="#10B981" stroke-width="1" stroke-dasharray="2,2" opacity="0.45"/>
      <line x1="108" y1="82" x2="116" y2="82" stroke="#10B981" stroke-width="1" opacity="0.45"/>
      <line x1="108" y1="162" x2="116" y2="162" stroke="#10B981" stroke-width="1" opacity="0.45"/>
      <text x="118" y="126" font-size="10" fill="#10B981" opacity="0.65" font-weight="600">H</text>
      <line x1="102" y1="148" x2="102" y2="152" stroke="#10B981" stroke-width="1.5"/><rect x="99" y="136" width="6" height="12" fill="#10B981" rx="1"/><line x1="102" y1="136" x2="102" y2="140" stroke="#10B981" stroke-width="1.5"/>
      <line x1="110" y1="120" x2="110" y2="124" stroke="#10B981" stroke-width="1.5"/><rect x="107" y="108" width="6" height="12" fill="#10B981" rx="1"/><line x1="110" y1="108" x2="110" y2="112" stroke="#10B981" stroke-width="1.5"/>
      <line x1="118" y1="100" x2="118" y2="104" stroke="#10B981" stroke-width="1.5"/><rect x="115" y="90" width="6" height="10" fill="#10B981" rx="1"/><line x1="118" y1="90" x2="118" y2="94" stroke="#10B981" stroke-width="1.5"/>
      <line x1="126" y1="84" x2="126" y2="88" stroke="#EF4444" stroke-width="1.5"/><rect x="123" y="88" width="6" height="10" fill="#EF4444" rx="1"/><line x1="126" y1="98" x2="126" y2="102" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="134" y1="98" x2="134" y2="102" stroke="#EF4444" stroke-width="1.5"/><rect x="131" y="102" width="6" height="8" fill="#EF4444" rx="1"/><line x1="134" y1="110" x2="134" y2="114" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="142" y1="108" x2="142" y2="112" stroke="#EF4444" stroke-width="1.5"/><rect x="139" y="112" width="6" height="8" fill="#EF4444" rx="1"/><line x1="142" y1="120" x2="142" y2="124" stroke="#EF4444" stroke-width="1.5"/>
      <text x="130" y="136" font-size="8.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">R.S.</text>
      <line x1="142" y1="126" x2="142" y2="132" stroke="#475569" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="150" y1="106" x2="150" y2="110" stroke="#10B981" stroke-width="1.5"/><rect x="147" y="96" width="6" height="10" fill="#10B981" rx="1"/><line x1="150" y1="96" x2="150" y2="100" stroke="#10B981" stroke-width="1.5"/>
      <line x1="158" y1="88" x2="158" y2="92" stroke="#10B981" stroke-width="1.5"/><rect x="155" y="80" width="6" height="8" fill="#10B981" rx="1"/><line x1="158" y1="80" x2="158" y2="84" stroke="#10B981" stroke-width="1.5"/>
      <line x1="166" y1="84" x2="166" y2="88" stroke="#10B981" stroke-width="1.5"/><rect x="163" y="60" width="6" height="24" fill="#10B981" rx="1"/><line x1="166" y1="60" x2="166" y2="64" stroke="#10B981" stroke-width="1.5"/>
      <line x1="174" y1="76" x2="174" y2="80" stroke="#EF4444" stroke-width="1.5"/><rect x="171" y="80" width="6" height="6" fill="#EF4444" rx="1"/><line x1="174" y1="86" x2="174" y2="90" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="182" y1="74" x2="182" y2="78" stroke="#10B981" stroke-width="1.5"/><rect x="179" y="54" width="6" height="20" fill="#10B981" rx="1"/><line x1="182" y1="54" x2="182" y2="58" stroke="#10B981" stroke-width="1.5"/>
      <line x1="190" y1="52" x2="190" y2="56" stroke="#10B981" stroke-width="1.5"/><rect x="187" y="32" width="6" height="20" fill="#10B981" rx="1"/><line x1="190" y1="32" x2="190" y2="36" stroke="#10B981" stroke-width="1.5"/>
      <line x1="198" y1="30" x2="198" y2="34" stroke="#10B981" stroke-width="1.5"/><rect x="195" y="14" width="6" height="16" fill="#10B981" rx="1"/><line x1="198" y1="14" x2="198" y2="18" stroke="#10B981" stroke-width="1.5"/>
      <line x1="206" y1="14" x2="206" y2="18" stroke="#10B981" stroke-width="1.5"/><rect x="203" y="6" width="6" height="8" fill="#10B981" rx="1"/><line x1="206" y1="6" x2="206" y2="10" stroke="#10B981" stroke-width="1.5"/>
      <line x1="162" y1="2" x2="340" y2="2" stroke="#10B981" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.8"/>
      <text x="252" y="14" font-size="8.5" fill="#10B981" opacity="0.9" font-family="'SF Pro Display', sans-serif">Take Profit</text>
      <line x1="330" y1="2" x2="330" y2="82" stroke="#10B981" stroke-width="1" stroke-dasharray="2,2" opacity="0.45"/>
      <line x1="326" y1="2" x2="334" y2="2" stroke="#10B981" stroke-width="1" opacity="0.45"/>
      <line x1="326" y1="82" x2="334" y2="82" stroke="#10B981" stroke-width="1" opacity="0.45"/>
      <text x="336" y="46" font-size="10" fill="#10B981" opacity="0.65" font-weight="600">H</text>
      <text x="158" y="55" font-size="8" fill="#10B981">Breakout</text>
      <text x="166" y="95" font-size="8" fill="#EF4444">ретест</text>
    </svg>`
  },

  // ─────────────────────────────────────────
  // 3. МОЛОТ
  // ─────────────────────────────────────────
  {
    id: 'hammer',
    name: 'Hammer', nameRu: 'Молот',
    type: 'bullish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '1',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'Small body with a long lower shadow (at least twice the body length) at the bottom of a downtrend. Bullish reversal signal.', descRu: 'Короткое тело с длинной нижней тенью (минимум вдвое длиннее тела) на дне нисходящего тренда. Сигнал разворота вверх.',
    svg: `<svg width="100%" viewBox="0 0 280 160" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="30"  x2="280" y2="30"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="70"  x2="280" y2="70"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="110" x2="280" y2="110" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="280" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="24" y1="14" x2="24" y2="19" stroke="#EF4444" stroke-width="1.5"/><rect x="20" y="19" width="9" height="46" fill="#EF4444" rx="1"/><line x1="24" y1="65" x2="24" y2="72" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="44" y1="48" x2="44" y2="53" stroke="#EF4444" stroke-width="1.5"/><rect x="40" y="53" width="9" height="32" fill="#EF4444" rx="1"/><line x1="44" y1="85" x2="44" y2="92" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="64" y1="66" x2="64" y2="71" stroke="#EF4444" stroke-width="1.5"/><rect x="60" y="71" width="9" height="30" fill="#EF4444" rx="1"/><line x1="64" y1="101" x2="64" y2="110" stroke="#EF4444" stroke-width="1.5"/>
      <ellipse cx="88" cy="120" rx="16" ry="16" fill="rgba(16,185,129,0.06)"/>
      <line x1="88" y1="96" x2="88" y2="102" stroke="#10B981" stroke-width="1.5"/>
      <rect x="84" y="102" width="9" height="13" fill="#10B981" rx="1"/>
      <line x1="88" y1="115" x2="88" y2="150" stroke="#10B981" stroke-width="1.5"/>
      <text x="88" y="158" font-size="8" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Hammer</text>
      <line x1="108" y1="68" x2="108" y2="74" stroke="#10B981" stroke-width="1.5"/><rect x="104" y="74" width="9" height="28" fill="#10B981" rx="1"/><line x1="108" y1="102" x2="108" y2="108" stroke="#10B981" stroke-width="1.5"/>
      <line x1="128" y1="38" x2="128" y2="44" stroke="#10B981" stroke-width="1.5"/><rect x="124" y="44" width="9" height="48" fill="#10B981" rx="1"/><line x1="128" y1="92" x2="128" y2="100" stroke="#10B981" stroke-width="1.5"/>
    </svg>`
  },

  // ─────────────────────────────────────────
  // 4. ПОВЕШЕННЫЙ
  // ─────────────────────────────────────────
  {
    id: 'hanging-man',
    name: 'Hanging Man', nameRu: 'Повешенный',
    type: 'bearish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '1',
    reliability: 'Medium', reliabilityRu: 'Средняя',
    desc: 'Same shape as the Hammer but appears at the top of an uptrend. Bearish reversal signal.', descRu: 'Та же форма что и молот, но появляется на вершине восходящего тренда. Медвежий сигнал разворота вниз.',
    svg: `<svg width="100%" viewBox="0 0 280 160" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="30"  x2="280" y2="30"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="70"  x2="280" y2="70"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="110" x2="280" y2="110" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="280" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="24" y1="88" x2="24" y2="94" stroke="#10B981" stroke-width="1.5"/><rect x="20" y="56" width="9" height="38" fill="#10B981" rx="1"/><line x1="24" y1="56" x2="24" y2="50" stroke="#10B981" stroke-width="1.5"/>
      <line x1="44" y1="70" x2="44" y2="75" stroke="#10B981" stroke-width="1.5"/><rect x="40" y="42" width="9" height="33" fill="#10B981" rx="1"/><line x1="44" y1="42" x2="44" y2="36" stroke="#10B981" stroke-width="1.5"/>
      <ellipse cx="68" cy="52" rx="16" ry="16" fill="rgba(239,68,68,0.06)"/>
      <line x1="68" y1="28" x2="68" y2="34" stroke="#EF4444" stroke-width="1.5"/>
      <rect x="64" y="34" width="9" height="13" fill="#EF4444" rx="1"/>
      <line x1="68" y1="47" x2="68" y2="83" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="68" y1="20" x2="68" y2="28" stroke="#94A3B8" stroke-width="1"/>
      <text x="68" y="17" font-size="8" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Hanging Man</text>
      <line x1="88" y1="38" x2="88" y2="43" stroke="#EF4444" stroke-width="1.5"/><rect x="84" y="43" width="9" height="30" fill="#EF4444" rx="1"/><line x1="88" y1="73" x2="88" y2="80" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="108" y1="56" x2="108" y2="62" stroke="#EF4444" stroke-width="1.5"/><rect x="104" y="62" width="9" height="46" fill="#EF4444" rx="1"/><line x1="108" y1="108" x2="108" y2="116" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="128" y1="88" x2="128" y2="93" stroke="#EF4444" stroke-width="1.5"/><rect x="124" y="93" width="9" height="28" fill="#EF4444" rx="1"/><line x1="128" y1="121" x2="128" y2="128" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="148" y1="106" x2="148" y2="111" stroke="#EF4444" stroke-width="1.5"/><rect x="144" y="111" width="9" height="26" fill="#EF4444" rx="1"/><line x1="148" y1="137" x2="148" y2="144" stroke="#EF4444" stroke-width="1.5"/>
    </svg>`
  },

  // ─────────────────────────────────────────
  // 5. БЫЧИЙ ФЛАГ
  // ─────────────────────────────────────────
  {
    id: 'bull-flag',
    name: 'Bull Flag', nameRu: 'Бычий флаг',
    type: 'bullish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Continuation ↑', signalRu: 'Продолжение ↑',
    candles: '20–50',
    reliability: 'Very High', reliabilityRu: 'Очень высокая',
    desc: 'A brief consolidation after a sharp rally. A breakout above the flag upper boundary signals trend continuation. Target equals the flagpole height.', descRu: 'Короткий период консолидации после резкого роста. Пробой верхней границы флага даёт сигнал к продолжению роста. Цель равна высоте флагштока.',
    svg: `<svg width="100%" viewBox="0 0 448 220" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="44"  x2="448" y2="44"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="88"  x2="448" y2="88"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="132" x2="448" y2="132" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="176" x2="448" y2="176" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="82" y1="198" x2="158" y2="52" stroke="#10B981" stroke-width="1.5" opacity="0.6"/>
      <line x1="90"  y1="202" x2="90"  y2="206" stroke="#10B981" stroke-width="1.5"/><rect x="87"  y="190" width="7" height="12" fill="#10B981" rx="1"/><line x1="90"  y1="190" x2="90"  y2="186" stroke="#10B981" stroke-width="1.5"/>
      <line x1="103" y1="184" x2="103" y2="188" stroke="#10B981" stroke-width="1.5"/><rect x="100" y="168" width="7" height="16" fill="#10B981" rx="1"/><line x1="103" y1="168" x2="103" y2="163" stroke="#10B981" stroke-width="1.5"/>
      <line x1="116" y1="160" x2="116" y2="165" stroke="#10B981" stroke-width="1.5"/><rect x="113" y="128" width="8" height="32" fill="#10B981" rx="1"/><line x1="116" y1="128" x2="116" y2="122" stroke="#10B981" stroke-width="1.5"/>
      <line x1="129" y1="118" x2="129" y2="123" stroke="#10B981" stroke-width="1.5"/><rect x="126" y="102" width="7" height="16" fill="#10B981" rx="1"/><line x1="129" y1="102" x2="129" y2="97"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="142" y1="96"  x2="142" y2="102" stroke="#10B981" stroke-width="1.5"/><rect x="139" y="62"  width="8" height="34" fill="#10B981" rx="1"/><line x1="142" y1="62"  x2="142" y2="56"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="18" y1="170" x2="86" y2="170" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="16" y="166" font-size="7.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">Strong Uptrend</text>
      <line x1="150" y1="52"  x2="280" y2="98"  stroke="#10B981" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="150" y1="90"  x2="280" y2="130" stroke="#10B981" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="158" y1="60"  x2="158" y2="65"  stroke="#EF4444" stroke-width="1.5"/><rect x="155" y="65"  width="7" height="22" fill="#EF4444" rx="1"/><line x1="158" y1="87"  x2="158" y2="92"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="170" y1="66"  x2="170" y2="71"  stroke="#10B981" stroke-width="1.5"/><rect x="167" y="58"  width="7" height="13" fill="#10B981" rx="1"/><line x1="170" y1="58"  x2="170" y2="53"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="182" y1="76"  x2="182" y2="81"  stroke="#EF4444" stroke-width="1.5"/><rect x="179" y="81"  width="7" height="24" fill="#EF4444" rx="1"/><line x1="182" y1="105" x2="182" y2="110" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="194" y1="80"  x2="194" y2="85"  stroke="#10B981" stroke-width="1.5"/><rect x="191" y="72"  width="6" height="13" fill="#10B981" rx="1"/><line x1="194" y1="72"  x2="194" y2="67"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="206" y1="87"  x2="206" y2="92"  stroke="#EF4444" stroke-width="1.5"/><rect x="203" y="92"  width="7" height="20" fill="#EF4444" rx="1"/><line x1="206" y1="112" x2="206" y2="117" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="218" y1="90"  x2="218" y2="95"  stroke="#10B981" stroke-width="1.5"/><rect x="215" y="82"  width="6" height="13" fill="#10B981" rx="1"/><line x1="218" y1="82"  x2="218" y2="77"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="230" y1="96"  x2="230" y2="101" stroke="#EF4444" stroke-width="1.5"/><rect x="227" y="101" width="7" height="22" fill="#EF4444" rx="1"/><line x1="230" y1="123" x2="230" y2="128" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="244" y1="100" x2="244" y2="105" stroke="#10B981" stroke-width="1.5"/><rect x="241" y="92"  width="6" height="13" fill="#10B981" rx="1"/><line x1="244" y1="92"  x2="244" y2="87"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="256" y1="104" x2="256" y2="109" stroke="#10B981" stroke-width="1.5"/><rect x="253" y="96"  width="6" height="13" fill="#10B981" rx="1"/><line x1="256" y1="96"  x2="256" y2="91"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="214" y1="40" x2="214" y2="52" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="214" y="36" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Consolidation (sideway)</text>
      <line x1="264" y1="132" x2="360" y2="22" stroke="#10B981" stroke-width="1.5" opacity="0.6"/>
      <line x1="268" y1="118" x2="268" y2="123" stroke="#10B981" stroke-width="1.5"/><rect x="265" y="106" width="6" height="12" fill="#10B981" rx="1"/><line x1="268" y1="106" x2="268" y2="101" stroke="#10B981" stroke-width="1.5"/>
      <line x1="280" y1="100" x2="280" y2="105" stroke="#10B981" stroke-width="1.5"/><rect x="277" y="84"  width="7" height="16" fill="#10B981" rx="1"/><line x1="280" y1="84"  x2="280" y2="78"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="292" y1="76"  x2="292" y2="82"  stroke="#10B981" stroke-width="1.5"/><rect x="289" y="48"  width="8" height="28" fill="#10B981" rx="1"/><line x1="292" y1="48"  x2="292" y2="42"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="305" y1="42"  x2="305" y2="47"  stroke="#10B981" stroke-width="1.5"/><rect x="302" y="26"  width="7" height="16" fill="#10B981" rx="1"/><line x1="305" y1="26"  x2="305" y2="20"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="318" y1="20"  x2="318" y2="26"  stroke="#10B981" stroke-width="1.5"/><rect x="315" y="6"   width="8" height="28" fill="#10B981" rx="1"/><line x1="318" y1="6"   x2="318" y2="2"   stroke="#10B981" stroke-width="1.5"/>
      <line x1="325" y1="96" x2="390" y2="96" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="327" y="92" font-size="7.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">Strong Uptrend</text>
    </svg>`
  },

  // ─────────────────────────────────────────
  // 6. МЕДВЕЖИЙ ФЛАГ
  // ─────────────────────────────────────────
  {
    id: 'bear-flag',
    name: 'Bear Flag', nameRu: 'Медвежий флаг',
    type: 'bearish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Continuation ↓', signalRu: 'Продолжение ↓',
    candles: '20–50',
    reliability: 'Very High', reliabilityRu: 'Очень высокая',
    desc: 'A brief consolidation after a sharp drop. A breakout below the flag lower boundary signals trend continuation. Target equals the flagpole height.', descRu: 'Короткий период консолидации после резкого падения. Пробой нижней границы флага даёт сигнал к продолжению падения. Цель равна высоте флагштока.',
    svg: `<svg width="100%" viewBox="0 0 448 220" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="44"  x2="448" y2="44"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="88"  x2="448" y2="88"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="132" x2="448" y2="132" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="176" x2="448" y2="176" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="82" y1="22" x2="158" y2="168" stroke="#EF4444" stroke-width="1.5" opacity="0.6"/>
      <line x1="90"  y1="14"  x2="90"  y2="18"  stroke="#EF4444" stroke-width="1.5"/><rect x="87"  y="18"  width="7" height="12" fill="#EF4444" rx="1"/><line x1="90"  y1="30"  x2="90"  y2="34"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="103" y1="28"  x2="103" y2="32"  stroke="#EF4444" stroke-width="1.5"/><rect x="100" y="32"  width="7" height="16" fill="#EF4444" rx="1"/><line x1="103" y1="48"  x2="103" y2="53"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="116" y1="48"  x2="116" y2="53"  stroke="#EF4444" stroke-width="1.5"/><rect x="113" y="60"  width="8" height="32" fill="#EF4444" rx="1"/><line x1="116" y1="92"  x2="116" y2="98"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="129" y1="97"  x2="129" y2="102" stroke="#EF4444" stroke-width="1.5"/><rect x="126" y="102" width="7" height="16" fill="#EF4444" rx="1"/><line x1="129" y1="118" x2="129" y2="123" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="142" y1="118" x2="142" y2="124" stroke="#EF4444" stroke-width="1.5"/><rect x="139" y="124" width="8" height="34" fill="#EF4444" rx="1"/><line x1="142" y1="158" x2="142" y2="164" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="18" y1="50" x2="86" y2="50" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="16" y="46" font-size="7.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">Strong Downtrend</text>
      <line x1="150" y1="128" x2="280" y2="88"  stroke="#EF4444" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="150" y1="166" x2="280" y2="110" stroke="#EF4444" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="158" y1="128" x2="158" y2="133" stroke="#10B981" stroke-width="1.5"/><rect x="155" y="111" width="7" height="22" fill="#10B981" rx="1"/><line x1="158" y1="111" x2="158" y2="106" stroke="#10B981" stroke-width="1.5"/>
      <line x1="170" y1="147" x2="170" y2="152" stroke="#EF4444" stroke-width="1.5"/><rect x="167" y="134" width="7" height="13" fill="#EF4444" rx="1"/><line x1="170" y1="134" x2="170" y2="129" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="182" y1="133" x2="182" y2="138" stroke="#10B981" stroke-width="1.5"/><rect x="179" y="109" width="7" height="24" fill="#10B981" rx="1"/><line x1="182" y1="109" x2="182" y2="104" stroke="#10B981" stroke-width="1.5"/>
      <line x1="194" y1="133" x2="194" y2="138" stroke="#EF4444" stroke-width="1.5"/><rect x="191" y="120" width="6" height="13" fill="#EF4444" rx="1"/><line x1="194" y1="120" x2="194" y2="115" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="206" y1="128" x2="206" y2="133" stroke="#10B981" stroke-width="1.5"/><rect x="203" y="108" width="7" height="20" fill="#10B981" rx="1"/><line x1="206" y1="108" x2="206" y2="103" stroke="#10B981" stroke-width="1.5"/>
      <line x1="218" y1="125" x2="218" y2="130" stroke="#EF4444" stroke-width="1.5"/><rect x="215" y="112" width="6" height="13" fill="#EF4444" rx="1"/><line x1="218" y1="112" x2="218" y2="107" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="230" y1="120" x2="230" y2="125" stroke="#10B981" stroke-width="1.5"/><rect x="227" y="98"  width="7" height="22" fill="#10B981" rx="1"/><line x1="230" y1="98"  x2="230" y2="93"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="244" y1="115" x2="244" y2="120" stroke="#EF4444" stroke-width="1.5"/><rect x="241" y="102" width="6" height="13" fill="#EF4444" rx="1"/><line x1="244" y1="102" x2="244" y2="97"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="256" y1="111" x2="256" y2="116" stroke="#EF4444" stroke-width="1.5"/><rect x="253" y="98"  width="6" height="13" fill="#EF4444" rx="1"/><line x1="256" y1="98"  x2="256" y2="93"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="214" y1="168" x2="214" y2="180" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="214" y="190" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Consolidation (sideway)</text>
      <line x1="264" y1="88" x2="360" y2="198" stroke="#EF4444" stroke-width="1.5" opacity="0.6"/>
      <line x1="268" y1="88"  x2="268" y2="93"  stroke="#EF4444" stroke-width="1.5"/><rect x="265" y="93"  width="6" height="12" fill="#EF4444" rx="1"/><line x1="268" y1="105" x2="268" y2="110" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="280" y1="100" x2="280" y2="105" stroke="#EF4444" stroke-width="1.5"/><rect x="277" y="105" width="7" height="16" fill="#EF4444" rx="1"/><line x1="280" y1="121" x2="280" y2="127" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="292" y1="118" x2="292" y2="124" stroke="#EF4444" stroke-width="1.5"/><rect x="289" y="124" width="8" height="28" fill="#EF4444" rx="1"/><line x1="292" y1="152" x2="292" y2="158" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="305" y1="148" x2="305" y2="154" stroke="#EF4444" stroke-width="1.5"/><rect x="302" y="154" width="7" height="16" fill="#EF4444" rx="1"/><line x1="305" y1="170" x2="305" y2="176" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="318" y1="168" x2="318" y2="174" stroke="#EF4444" stroke-width="1.5"/><rect x="315" y="174" width="8" height="28" fill="#EF4444" rx="1"/><line x1="318" y1="202" x2="318" y2="208" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="325" y1="124" x2="390" y2="124" stroke="#94A3B8" stroke-width="0.8" opacity="0.5"/>
      <text x="327" y="120" font-size="7.5" fill="#94A3B8" font-family="'SF Pro Display', sans-serif">Strong Downtrend</text>
    </svg>`
  }
  ,{
    id: 'inverted-hammer',
    name: 'Inverted Hammer', nameRu: 'Перевёрнутый молот',
    type: 'bullish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '1',
    reliability: 'Medium', reliabilityRu: 'Средняя',
    desc: 'Small body at the bottom with a long upper shadow (at least twice the body) at the bottom of a downtrend. Little or no lower shadow. Bullish reversal signal.', descRu: 'Маленькое тело внизу и длинная верхняя тень на дне нисходящего тренда. Нижней тени нет или почти нет. Сигнал разворота вверх.',
    svg: `<svg width="100%" viewBox="0 0 280 160" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="30"  x2="280" y2="30"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="70"  x2="280" y2="70"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="110" x2="280" y2="110" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="280" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="24" y1="12" x2="24" y2="18" stroke="#EF4444" stroke-width="1.5"/><rect x="20" y="18" width="9" height="48" fill="#EF4444" rx="1"/><line x1="24" y1="66" x2="24" y2="74" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="44" y1="50" x2="44" y2="56" stroke="#EF4444" stroke-width="1.5"/><rect x="40" y="56" width="9" height="30" fill="#EF4444" rx="1"/><line x1="44" y1="86" x2="44" y2="94" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="64" y1="70" x2="64" y2="76" stroke="#EF4444" stroke-width="1.5"/><rect x="60" y="76" width="9" height="28" fill="#EF4444" rx="1"/><line x1="64" y1="104" x2="64" y2="112" stroke="#EF4444" stroke-width="1.5"/>
      <ellipse cx="88" cy="118" rx="16" ry="18" fill="rgba(16,185,129,0.06)"/>
      <line x1="88" y1="90" x2="88" y2="130" stroke="#10B981" stroke-width="1.5"/>
      <rect x="84" y="130" width="9" height="13" fill="#10B981" rx="1"/>
      <text x="88" y="158" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Inverted Hammer</text>
      <line x1="108" y1="100" x2="108" y2="106" stroke="#10B981" stroke-width="1.5"/><rect x="104" y="106" width="9" height="24" fill="#10B981" rx="1"/><line x1="108" y1="130" x2="108" y2="136" stroke="#10B981" stroke-width="1.5"/>
      <line x1="128" y1="36" x2="128" y2="42" stroke="#10B981" stroke-width="1.5"/><rect x="124" y="42" width="9" height="50" fill="#10B981" rx="1"/><line x1="128" y1="92" x2="128" y2="100" stroke="#10B981" stroke-width="1.5"/>
    </svg>`
  }
  ,{
    id: 'shooting-star',
    name: 'Shooting Star', nameRu: 'Падающая звезда',
    type: 'bearish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '1',
    reliability: 'Medium', reliabilityRu: 'Средняя',
    desc: 'Small body at the top with a long upper shadow at the peak of an uptrend. Little or no lower shadow. Bearish reversal signal.', descRu: 'Маленькое тело вверху и длинная верхняя тень на вершине восходящего тренда. Нижней тени нет или почти нет. Медвежий сигнал разворота вниз.',
    svg: `<svg width="100%" viewBox="0 0 280 160" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="30"  x2="280" y2="30"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="70"  x2="280" y2="70"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="110" x2="280" y2="110" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="280" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <!-- Восходящий тренд -->
      <line x1="24" y1="88" x2="24" y2="94" stroke="#10B981" stroke-width="1.5"/><rect x="20" y="60" width="9" height="34" fill="#10B981" rx="1"/><line x1="24" y1="60" x2="24" y2="54" stroke="#10B981" stroke-width="1.5"/>
      <line x1="44" y1="72" x2="44" y2="78" stroke="#10B981" stroke-width="1.5"/><rect x="40" y="46" width="9" height="32" fill="#10B981" rx="1"/><line x1="44" y1="46" x2="44" y2="40" stroke="#10B981" stroke-width="1.5"/>
      <!-- ПАДАЮЩАЯ ЗВЕЗДА: тело вверху, длинная верхняя тень, нижней нет -->
      <ellipse cx="68" cy="42" rx="16" ry="18" fill="rgba(239,68,68,0.06)"/>
      <!-- верхняя тень длинная -->
      <line x1="68" y1="8" x2="68" y2="30" stroke="#EF4444" stroke-width="1.5"/>
      <!-- тело маленькое вверху -->
      <rect x="64" y="30" width="9" height="13" fill="#EF4444" rx="1"/>
      <!-- нижней тени нет -->
      <text x="68" y="58" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Shooting Star</text>
      <!-- Нисходящий тренд после -->
      <line x1="88" y1="46" x2="88" y2="52" stroke="#EF4444" stroke-width="1.5"/><rect x="84" y="52" width="9" height="28" fill="#EF4444" rx="1"/><line x1="88" y1="80" x2="88" y2="88" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="108" y1="66" x2="108" y2="72" stroke="#EF4444" stroke-width="1.5"/><rect x="104" y="72" width="9" height="46" fill="#EF4444" rx="1"/><line x1="108" y1="118" x2="108" y2="126" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="128" y1="96" x2="128" y2="102" stroke="#EF4444" stroke-width="1.5"/><rect x="124" y="102" width="9" height="32" fill="#EF4444" rx="1"/><line x1="128" y1="134" x2="128" y2="142" stroke="#EF4444" stroke-width="1.5"/>
    </svg>`
  }
  ,{
    id: 'bullish-engulfing',
    name: 'Bullish Engulfing', nameRu: 'Бычье поглощение',
    type: 'bullish',
    label: 'Double Candle', labelRu: 'Двойная свеча',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '2',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'A bullish candle fully engulfs the previous bearish one — opens below its close and closes above its open. Appears after a downtrend and signals a reversal to the upside.', descRu: 'Бычья свеча полностью поглощает предыдущую медвежью. Появляется после нисходящего тренда и сигнализирует о развороте вверх.',
    svg: `<svg width="100%" viewBox="0 0 280 170" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="34"  x2="280" y2="34"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="78"  x2="280" y2="78"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="122" x2="280" y2="122" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="160" x2="280" y2="160" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="30" y1="24" x2="30" y2="30" stroke="#EF4444" stroke-width="1.5"/><rect x="26" y="30" width="9" height="44" fill="#EF4444" rx="1"/><line x1="30" y1="74" x2="30" y2="82" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="52" y1="52" x2="52" y2="58" stroke="#EF4444" stroke-width="1.5"/><rect x="48" y="58" width="8" height="28" fill="#EF4444" rx="1"/><line x1="52" y1="86" x2="52" y2="94" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="72" y1="76" x2="72" y2="82" stroke="#EF4444" stroke-width="1.5"/><rect x="68" y="82" width="7" height="18" fill="#EF4444" rx="1"/><line x1="72" y1="100" x2="72" y2="108" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="110" y1="90" x2="110" y2="96" stroke="#EF4444" stroke-width="1.5"/><rect x="106" y="96" width="9" height="30" fill="#EF4444" rx="1"/><line x1="110" y1="126" x2="110" y2="132" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="132" y1="76" x2="132" y2="82" stroke="#10B981" stroke-width="1.5"/><rect x="128" y="82" width="11" height="58" fill="#10B981" rx="1"/><line x1="132" y1="140" x2="132" y2="146" stroke="#10B981" stroke-width="1.5"/>
      <ellipse cx="121" cy="114" rx="32" ry="38" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>
      <text x="121" y="167" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Bullish Engulfing</text>
      <line x1="162" y1="60" x2="162" y2="66" stroke="#10B981" stroke-width="1.5"/><rect x="158" y="66" width="9" height="42" fill="#10B981" rx="1"/><line x1="162" y1="108" x2="162" y2="116" stroke="#10B981" stroke-width="1.5"/>
      <line x1="184" y1="30" x2="184" y2="36" stroke="#10B981" stroke-width="1.5"/><rect x="180" y="36" width="10" height="56" fill="#10B981" rx="1"/><line x1="184" y1="92" x2="184" y2="100" stroke="#10B981" stroke-width="1.5"/>
    </svg>`
  }
  ,{
    id: 'bearish-engulfing',
    name: 'Bearish Engulfing', nameRu: 'Медвежье поглощение',
    type: 'bearish',
    label: 'Double Candle', labelRu: 'Двойная свеча',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '2',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'A bearish candle fully engulfs the previous bullish one. Appears after an uptrend and signals a reversal to the downside with continued bearish momentum.', descRu: 'Медвежья свеча полностью поглощает предыдущую бычью. Появляется после восходящего тренда и сигнализирует о развороте вниз.',
    svg: `<svg width="100%" viewBox="0 0 280 170" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="34"  x2="280" y2="34"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="78"  x2="280" y2="78"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="122" x2="280" y2="122" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="160" x2="280" y2="160" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="30" y1="118" x2="30" y2="124" stroke="#10B981" stroke-width="1.5"/><rect x="26" y="96" width="7" height="22" fill="#10B981" rx="1"/><line x1="30" y1="96" x2="30" y2="90" stroke="#10B981" stroke-width="1.5"/>
      <line x1="52" y1="100" x2="52" y2="106" stroke="#10B981" stroke-width="1.5"/><rect x="48" y="72" width="8" height="28" fill="#10B981" rx="1"/><line x1="52" y1="72" x2="52" y2="66" stroke="#10B981" stroke-width="1.5"/>
      <line x1="72" y1="86" x2="72" y2="92" stroke="#10B981" stroke-width="1.5"/><rect x="68" y="52" width="9" height="34" fill="#10B981" rx="1"/><line x1="72" y1="52" x2="72" y2="44" stroke="#10B981" stroke-width="1.5"/>
      <line x1="110" y1="36" x2="110" y2="42" stroke="#10B981" stroke-width="1.5"/><rect x="106" y="42" width="9" height="30" fill="#10B981" rx="1"/><line x1="110" y1="72" x2="110" y2="78" stroke="#10B981" stroke-width="1.5"/>
      <line x1="132" y1="22" x2="132" y2="28" stroke="#EF4444" stroke-width="1.5"/><rect x="128" y="28" width="11" height="58" fill="#EF4444" rx="1"/><line x1="132" y1="86" x2="132" y2="92" stroke="#EF4444" stroke-width="1.5"/>
      <ellipse cx="121" cy="57" rx="32" ry="38" fill="none" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>
      <text x="121" y="108" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Bearish Engulfing</text>
      <line x1="162" y1="68" x2="162" y2="74" stroke="#EF4444" stroke-width="1.5"/><rect x="158" y="74" width="9" height="38" fill="#EF4444" rx="1"/><line x1="162" y1="112" x2="162" y2="120" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="184" y1="96" x2="184" y2="102" stroke="#EF4444" stroke-width="1.5"/><rect x="180" y="102" width="10" height="48" fill="#EF4444" rx="1"/><line x1="184" y1="150" x2="184" y2="158" stroke="#EF4444" stroke-width="1.5"/>
    </svg>`
  }
  ,{
    id: 'double-top',
    name: 'Double Top', nameRu: 'Двойная вершина',
    type: 'bearish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '30–50',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'Two peaks at the same level after an uptrend. Price fails to break resistance twice, then breaks the neckline downward. Target equals the distance from the peak to the neckline.', descRu: 'Два пика на одном уровне после восходящего тренда. Цена дважды не может пробить сопротивление и пробивает линию шеи вниз. Цель — расстояние от вершины до шеи.',
    svg: `<svg width="100%" viewBox="0 0 448 220" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="44"  x2="448" y2="44"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="88"  x2="448" y2="88"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="132" x2="448" y2="132" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="176" x2="448" y2="176" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="10" y1="190" x2="100" y2="68" stroke="#10B981" stroke-width="1.2" opacity="0.6"/>
      <text x="8" y="210" font-size="7" fill="#10B981" opacity="0.7" font-family="'SF Pro Display', sans-serif">Uptrend</text>
      <line x1="14" y1="184" x2="14" y2="189" stroke="#10B981" stroke-width="1.5"/><rect x="11" y="172" width="7" height="12" fill="#10B981" rx="1"/><line x1="14" y1="172" x2="14" y2="167" stroke="#10B981" stroke-width="1.5"/>
      <line x1="26" y1="168" x2="26" y2="173" stroke="#EF4444" stroke-width="1.5"/><rect x="23" y="160" width="7" height="8"  fill="#EF4444" rx="1"/><line x1="26" y1="160" x2="26" y2="156" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="38" y1="158" x2="38" y2="163" stroke="#10B981" stroke-width="1.5"/><rect x="35" y="144" width="7" height="14" fill="#10B981" rx="1"/><line x1="38" y1="144" x2="38" y2="139" stroke="#10B981" stroke-width="1.5"/>
      <line x1="50" y1="140" x2="50" y2="145" stroke="#EF4444" stroke-width="1.5"/><rect x="47" y="132" width="7" height="8"  fill="#EF4444" rx="1"/><line x1="50" y1="132" x2="50" y2="127" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="62" y1="124" x2="62" y2="129" stroke="#10B981" stroke-width="1.5"/><rect x="59" y="108" width="7" height="16" fill="#10B981" rx="1"/><line x1="62" y1="108" x2="62" y2="102" stroke="#10B981" stroke-width="1.5"/>
      <line x1="74" y1="103" x2="74" y2="108" stroke="#EF4444" stroke-width="1.5"/><rect x="71" y="96"  width="7" height="7"  fill="#EF4444" rx="1"/><line x1="74" y1="96"  x2="74" y2="90"  stroke="#EF4444" stroke-width="1.5"/>
      <circle cx="98" cy="52" r="13" fill="none" stroke="#EF4444" stroke-width="1.3" stroke-dasharray="4,2" opacity="0.85"/>
      <line x1="86" y1="88" x2="86" y2="93"  stroke="#10B981" stroke-width="1.5"/><rect x="83" y="72"  width="7" height="16" fill="#10B981" rx="1"/><line x1="86" y1="72"  x2="86" y2="66"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="98" y1="60" x2="98" y2="65"  stroke="#EF4444" stroke-width="1.5"/><rect x="95" y="44"  width="7" height="16" fill="#EF4444" rx="1"/><line x1="98" y1="44"  x2="98" y2="38"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="110" y1="65" x2="110" y2="70" stroke="#EF4444" stroke-width="1.5"/><rect x="107" y="56" width="7" height="9"  fill="#EF4444" rx="1"/><line x1="110" y1="56" x2="110" y2="50" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="122" y1="90"  x2="122" y2="96"  stroke="#10B981" stroke-width="1.5"/><rect x="119" y="78"  width="7" height="12" fill="#10B981" rx="1"/><line x1="122" y1="78"  x2="122" y2="72"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="134" y1="100" x2="134" y2="106" stroke="#EF4444" stroke-width="1.5"/><rect x="131" y="94"  width="7" height="6"  fill="#EF4444" rx="1"/><line x1="134" y1="94"  x2="134" y2="88"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="146" y1="104" x2="146" y2="110" stroke="#10B981" stroke-width="1.5"/><rect x="143" y="96"  width="7" height="8"  fill="#10B981" rx="1"/><line x1="146" y1="96"  x2="146" y2="90"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="158" y1="108" x2="158" y2="114" stroke="#EF4444" stroke-width="1.5"/><rect x="155" y="102" width="7" height="6"  fill="#EF4444" rx="1"/><line x1="158" y1="102" x2="158" y2="96"  stroke="#EF4444" stroke-width="1.5"/>
      <circle cx="194" cy="52" r="13" fill="none" stroke="#EF4444" stroke-width="1.3" stroke-dasharray="4,2" opacity="0.85"/>
      <line x1="170" y1="92" x2="170" y2="98" stroke="#10B981" stroke-width="1.5"/><rect x="167" y="76"  width="7" height="16" fill="#10B981" rx="1"/><line x1="170" y1="76"  x2="170" y2="70"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="182" y1="68" x2="182" y2="74" stroke="#10B981" stroke-width="1.5"/><rect x="179" y="54"  width="7" height="14" fill="#10B981" rx="1"/><line x1="182" y1="54"  x2="182" y2="48"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="194" y1="58" x2="194" y2="64" stroke="#EF4444" stroke-width="1.5"/><rect x="191" y="44"  width="7" height="14" fill="#EF4444" rx="1"/><line x1="194" y1="44"  x2="194" y2="38"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="206" y1="64" x2="206" y2="70" stroke="#EF4444" stroke-width="1.5"/><rect x="203" y="56"  width="7" height="8"  fill="#EF4444" rx="1"/><line x1="206" y1="56"  x2="206" y2="50"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="218" y1="72"  x2="218" y2="78"  stroke="#EF4444" stroke-width="1.5"/><rect x="215" y="78"  width="7" height="14" fill="#EF4444" rx="1"/><line x1="218" y1="92"  x2="218" y2="98"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="230" y1="86"  x2="230" y2="92"  stroke="#EF4444" stroke-width="1.5"/><rect x="227" y="92"  width="7" height="18" fill="#EF4444" rx="1"/><line x1="230" y1="110" x2="230" y2="116" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="70" y1="112" x2="340" y2="112" stroke="#EF4444" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.75"/>
      <text x="110" y="124" font-size="7.5" fill="#EF4444" opacity="0.8" font-family="'SF Pro Display', sans-serif">Neckline</text>
      <line x1="242" y1="96"  x2="242" y2="102" stroke="#EF4444" stroke-width="1.5"/><rect x="239" y="102" width="7" height="26" fill="#EF4444" rx="1"/><line x1="242" y1="128" x2="242" y2="135" stroke="#EF4444" stroke-width="1.5"/>
      <circle cx="242" cy="112" r="4" fill="#EF4444" opacity="0.9"/>
      <text x="238" y="144" font-size="7" fill="#EF4444" opacity="0.85" font-family="'SF Pro Display', sans-serif">Breakout</text>
      <line x1="254" y1="110" x2="254" y2="116" stroke="#10B981" stroke-width="1.5"/><rect x="251" y="116" width="7" height="10" fill="#10B981" rx="1"/><line x1="254" y1="126" x2="254" y2="133" stroke="#10B981" stroke-width="1.5"/>
      <line x1="266" y1="124" x2="266" y2="130" stroke="#EF4444" stroke-width="1.5"/><rect x="263" y="130" width="7" height="20" fill="#EF4444" rx="1"/><line x1="266" y1="150" x2="266" y2="157" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="278" y1="142" x2="278" y2="148" stroke="#EF4444" stroke-width="1.5"/><rect x="275" y="148" width="7" height="22" fill="#EF4444" rx="1"/><line x1="278" y1="170" x2="278" y2="177" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="290" y1="162" x2="290" y2="168" stroke="#10B981" stroke-width="1.5"/><rect x="287" y="168" width="7" height="10" fill="#10B981" rx="1"/><line x1="290" y1="178" x2="290" y2="185" stroke="#10B981" stroke-width="1.5"/>
      <line x1="302" y1="174" x2="302" y2="180" stroke="#EF4444" stroke-width="1.5"/><rect x="299" y="180" width="7" height="26" fill="#EF4444" rx="1"/><line x1="302" y1="206" x2="302" y2="213" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="320" y1="38"  x2="320" y2="112" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="320" y1="112" x2="320" y2="186" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="315" y1="38"  x2="325" y2="38"  stroke="#EF4444" stroke-width="1" opacity="0.6"/>
      <line x1="315" y1="112" x2="325" y2="112" stroke="#EF4444" stroke-width="1" opacity="0.6"/>
      <line x1="315" y1="186" x2="325" y2="186" stroke="#EF4444" stroke-width="1" opacity="0.6"/>
      <text x="330" y="78"  font-size="9" fill="#EF4444" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <text x="330" y="153" font-size="9" fill="#EF4444" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <line x1="240" y1="186" x2="430" y2="186" stroke="#EF4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>
      <text x="338" y="183" font-size="7.5" fill="#EF4444" opacity="0.75" font-family="'SF Pro Display', sans-serif">Take Profit</text>
    </svg>`
  }
  ,{
    id: 'double-bottom',
    name: 'Double Bottom', nameRu: 'Двойное дно',
    type: 'bullish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '30–50',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'Two troughs at the same level after a downtrend. Price fails to break support twice, then breaks the neckline upward. Target equals the distance from the trough to the neckline.', descRu: 'Два минимума на одном уровне после нисходящего тренда. Цена дважды не может пробить поддержку и пробивает линию шеи вверх. Цель — расстояние от дна до шеи.',
    svg: `<svg width="100%" viewBox="0 0 448 220" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="44"  x2="448" y2="44"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="88"  x2="448" y2="88"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="132" x2="448" y2="132" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="176" x2="448" y2="176" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="10" y1="30" x2="100" y2="152" stroke="#EF4444" stroke-width="1.2" opacity="0.6"/>
      <text x="8" y="20" font-size="7" fill="#EF4444" opacity="0.7" font-family="'SF Pro Display', sans-serif">Downtrend</text>
      <line x1="14" y1="32" x2="14" y2="37"  stroke="#EF4444" stroke-width="1.5"/><rect x="11" y="37"  width="7" height="12" fill="#EF4444" rx="1"/><line x1="14" y1="49"  x2="14" y2="54"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="26" y1="48" x2="26" y2="53"  stroke="#10B981" stroke-width="1.5"/><rect x="23" y="53"  width="7" height="8"  fill="#10B981" rx="1"/><line x1="26" y1="61"  x2="26" y2="66"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="38" y1="58" x2="38" y2="63"  stroke="#EF4444" stroke-width="1.5"/><rect x="35" y="63"  width="7" height="14" fill="#EF4444" rx="1"/><line x1="38" y1="77"  x2="38" y2="82"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="50" y1="76" x2="50" y2="81"  stroke="#10B981" stroke-width="1.5"/><rect x="47" y="81"  width="7" height="8"  fill="#10B981" rx="1"/><line x1="50" y1="89"  x2="50" y2="94"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="62" y1="90" x2="62" y2="95"  stroke="#EF4444" stroke-width="1.5"/><rect x="59" y="95"  width="7" height="16" fill="#EF4444" rx="1"/><line x1="62" y1="111" x2="62" y2="117" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="74" y1="108" x2="74" y2="113" stroke="#10B981" stroke-width="1.5"/><rect x="71" y="113" width="7" height="7"  fill="#10B981" rx="1"/><line x1="74" y1="120" x2="74" y2="125" stroke="#10B981" stroke-width="1.5"/>
      <circle cx="98" cy="168" r="13" fill="none" stroke="#10B981" stroke-width="1.3" stroke-dasharray="4,2" opacity="0.85"/>
      <line x1="86" y1="120" x2="86" y2="126" stroke="#EF4444" stroke-width="1.5"/><rect x="83" y="126" width="7" height="16" fill="#EF4444" rx="1"/><line x1="86" y1="142" x2="86" y2="148" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="98"  y1="148" x2="98"  y2="154" stroke="#10B981" stroke-width="1.5"/><rect x="95"  y="154" width="7" height="16" fill="#10B981" rx="1"/><line x1="98"  y1="170" x2="98"  y2="176" stroke="#10B981" stroke-width="1.5"/>
      <line x1="110" y1="148" x2="110" y2="154" stroke="#10B981" stroke-width="1.5"/><rect x="107" y="154" width="7" height="9"  fill="#10B981" rx="1"/><line x1="110" y1="163" x2="110" y2="169" stroke="#10B981" stroke-width="1.5"/>
      <line x1="122" y1="118" x2="122" y2="124" stroke="#EF4444" stroke-width="1.5"/><rect x="119" y="124" width="7" height="12" fill="#EF4444" rx="1"/><line x1="122" y1="136" x2="122" y2="142" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="134" y1="108" x2="134" y2="114" stroke="#10B981" stroke-width="1.5"/><rect x="131" y="114" width="7" height="6"  fill="#10B981" rx="1"/><line x1="134" y1="120" x2="134" y2="126" stroke="#10B981" stroke-width="1.5"/>
      <line x1="146" y1="104" x2="146" y2="110" stroke="#EF4444" stroke-width="1.5"/><rect x="143" y="110" width="7" height="8"  fill="#EF4444" rx="1"/><line x1="146" y1="118" x2="146" y2="124" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="158" y1="100" x2="158" y2="106" stroke="#10B981" stroke-width="1.5"/><rect x="155" y="106" width="7" height="6"  fill="#10B981" rx="1"/><line x1="158" y1="112" x2="158" y2="118" stroke="#10B981" stroke-width="1.5"/>
      <circle cx="194" cy="168" r="13" fill="none" stroke="#10B981" stroke-width="1.3" stroke-dasharray="4,2" opacity="0.85"/>
      <line x1="170" y1="120" x2="170" y2="126" stroke="#EF4444" stroke-width="1.5"/><rect x="167" y="126" width="7" height="16" fill="#EF4444" rx="1"/><line x1="170" y1="142" x2="170" y2="148" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="182" y1="140" x2="182" y2="146" stroke="#EF4444" stroke-width="1.5"/><rect x="179" y="146" width="7" height="14" fill="#EF4444" rx="1"/><line x1="182" y1="160" x2="182" y2="166" stroke="#EF4444" stroke-width="1.5"/>
      <line x1="194" y1="148" x2="194" y2="154" stroke="#10B981" stroke-width="1.5"/><rect x="191" y="154" width="7" height="14" fill="#10B981" rx="1"/><line x1="194" y1="168" x2="194" y2="174" stroke="#10B981" stroke-width="1.5"/>
      <line x1="206" y1="148" x2="206" y2="154" stroke="#10B981" stroke-width="1.5"/><rect x="203" y="154" width="7" height="8"  fill="#10B981" rx="1"/><line x1="206" y1="162" x2="206" y2="168" stroke="#10B981" stroke-width="1.5"/>
      <line x1="218" y1="132" x2="218" y2="138" stroke="#10B981" stroke-width="1.5"/><rect x="215" y="122" width="7" height="10" fill="#10B981" rx="1"/><line x1="218" y1="122" x2="218" y2="116" stroke="#10B981" stroke-width="1.5"/>
      <line x1="230" y1="120" x2="230" y2="126" stroke="#10B981" stroke-width="1.5"/><rect x="227" y="108" width="7" height="12" fill="#10B981" rx="1"/><line x1="230" y1="108" x2="230" y2="102" stroke="#10B981" stroke-width="1.5"/>
      <line x1="70" y1="108" x2="340" y2="108" stroke="#10B981" stroke-width="1.2" stroke-dasharray="5,3" opacity="0.75"/>
      <text x="110" y="102" font-size="7.5" fill="#10B981" opacity="0.8" font-family="'SF Pro Display', sans-serif">Neckline</text>
      <line x1="242" y1="82"  x2="242" y2="88"  stroke="#10B981" stroke-width="1.5"/><rect x="239" y="82"  width="7" height="26" fill="#10B981" rx="1"/><line x1="242" y1="108" x2="242" y2="114" stroke="#10B981" stroke-width="1.5"/>
      <circle cx="242" cy="108" r="4" fill="#10B981" opacity="0.9"/>
      <text x="238" y="76" font-size="7" fill="#10B981" opacity="0.85" font-family="'SF Pro Display', sans-serif">Breakout</text>
      <line x1="254" y1="88"  x2="254" y2="94"  stroke="#10B981" stroke-width="1.5"/><rect x="251" y="78"  width="7" height="10" fill="#10B981" rx="1"/><line x1="254" y1="78"  x2="254" y2="71"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="266" y1="72"  x2="266" y2="78"  stroke="#10B981" stroke-width="1.5"/><rect x="263" y="58"  width="7" height="14" fill="#10B981" rx="1"/><line x1="266" y1="58"  x2="266" y2="51"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="278" y1="52"  x2="278" y2="58"  stroke="#EF4444" stroke-width="1.5"/><rect x="275" y="38"  width="7" height="14" fill="#EF4444" rx="1"/><line x1="278" y1="38"  x2="278" y2="31"  stroke="#EF4444" stroke-width="1.5"/>
      <line x1="290" y1="36"  x2="290" y2="42"  stroke="#10B981" stroke-width="1.5"/><rect x="287" y="22"  width="7" height="14" fill="#10B981" rx="1"/><line x1="290" y1="22"  x2="290" y2="15"  stroke="#10B981" stroke-width="1.5"/>
      <line x1="302" y1="18"  x2="302" y2="24"  stroke="#10B981" stroke-width="1.5"/><rect x="299" y="8"   width="7" height="10" fill="#10B981" rx="1"/><line x1="302" y1="8"   x2="302" y2="3"   stroke="#10B981" stroke-width="1.5"/>
      <line x1="320" y1="108" x2="320" y2="34"  stroke="#10B981" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="320" y1="108" x2="320" y2="182" stroke="#10B981" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="315" y1="34"  x2="325" y2="34"  stroke="#10B981" stroke-width="1" opacity="0.6"/>
      <line x1="315" y1="108" x2="325" y2="108" stroke="#10B981" stroke-width="1" opacity="0.6"/>
      <line x1="315" y1="182" x2="325" y2="182" stroke="#10B981" stroke-width="1" opacity="0.6"/>
      <text x="330" y="75"  font-size="9" fill="#10B981" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <text x="330" y="150" font-size="9" fill="#10B981" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <line x1="240" y1="34" x2="430" y2="34" stroke="#10B981" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>
      <text x="338" y="30" font-size="7.5" fill="#10B981" opacity="0.75" font-family="'SF Pro Display', sans-serif">Take Profit</text>
    </svg>`
  }
  ,{
    id: 'ascending-triangle',
    name: 'Ascending Triangle', nameRu: 'Восходящий треугольник',
    type: 'bullish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Continuation ↑', signalRu: 'Продолжение ↑',
    candles: '10–50',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'Horizontal resistance and a rising support line — each low is higher than the previous. Price compresses and breaks resistance to the upside. Target equals the height of the triangle at its base.', descRu: 'Горизонтальное сопротивление и восходящая поддержка — каждый минимум выше предыдущего. Цена сжимается и пробивает сопротивление вверх. Цель — высота треугольника у основания.',
    svg: `<svg width="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="35"  x2="300" y2="35"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="85"  x2="300" y2="85"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="135" x2="300" y2="135" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="180" x2="300" y2="180" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="15" y1="50" x2="218" y2="50" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="15" y1="160" x2="218" y2="60" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="15"  y1="160" x2="50"  y2="50"  stroke="#10B981" stroke-width="2"/>
      <line x1="50"  y1="50"  x2="85"  y2="133" stroke="#EF4444" stroke-width="2"/>
      <line x1="85"  y1="133" x2="118" y2="50"  stroke="#10B981" stroke-width="2"/>
      <line x1="118" y1="50"  x2="150" y2="108" stroke="#EF4444" stroke-width="2"/>
      <line x1="150" y1="108" x2="180" y2="50"  stroke="#10B981" stroke-width="2"/>
      <line x1="180" y1="50"  x2="205" y2="86"  stroke="#EF4444" stroke-width="2"/>
      <line x1="205" y1="86"  x2="218" y2="50"  stroke="#10B981" stroke-width="2"/>
      <line x1="218" y1="50" x2="255" y2="8" stroke="#10B981" stroke-width="2"/>
      <text x="222" y="64" font-size="7.5" fill="#10B981" opacity="0.85" font-family="'SF Pro Display', sans-serif">Breakout</text>
      <line x1="272" y1="50"  x2="272" y2="160" stroke="#10B981" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="267" y1="50"  x2="277" y2="50"  stroke="#10B981" stroke-width="1" opacity="0.6"/>
      <line x1="267" y1="160" x2="277" y2="160" stroke="#10B981" stroke-width="1" opacity="0.6"/>
      <text x="281" y="110" font-size="9" fill="#10B981" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <line x1="218" y1="160" x2="300" y2="160" stroke="#10B981" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>
      <text x="222" y="172" font-size="7.5" fill="#10B981" opacity="0.75" font-family="'SF Pro Display', sans-serif">Take Profit</text>
    </svg>`
  }
  ,{
    id: 'descending-triangle',
    name: 'Descending Triangle', nameRu: 'Нисходящий треугольник',
    type: 'bearish',
    label: 'Chart Pattern', labelRu: 'Графический',
    signal: 'Continuation ↓', signalRu: 'Продолжение ↓',
    candles: '10–50',
    reliability: 'High', reliabilityRu: 'Высокая',
    desc: 'Horizontal support and a descending resistance line — each high is lower than the previous. Price compresses and breaks support to the downside. Target equals the height of the triangle at its base.', descRu: 'Горизонтальная поддержка и нисходящее сопротивление — каждый максимум ниже предыдущего. Цена сжимается и пробивает поддержку вниз. Цель — высота треугольника у основания.',
    svg: `<svg width="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="35"  x2="300" y2="35"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="85"  x2="300" y2="85"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="135" x2="300" y2="135" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="180" x2="300" y2="180" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="15" y1="35" x2="218" y2="135" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="15" y1="145" x2="218" y2="145" stroke="#3B82F6" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.85"/>
      <line x1="15"  y1="35"  x2="50"  y2="145" stroke="#EF4444" stroke-width="2"/>
      <line x1="50"  y1="145" x2="85"  y2="55"  stroke="#10B981" stroke-width="2"/>
      <line x1="85"  y1="55"  x2="118" y2="145" stroke="#EF4444" stroke-width="2"/>
      <line x1="118" y1="145" x2="150" y2="75"  stroke="#10B981" stroke-width="2"/>
      <line x1="150" y1="75"  x2="180" y2="145" stroke="#EF4444" stroke-width="2"/>
      <line x1="180" y1="145" x2="205" y2="96"  stroke="#10B981" stroke-width="2"/>
      <line x1="205" y1="96"  x2="218" y2="145" stroke="#EF4444" stroke-width="2"/>
      <line x1="218" y1="145" x2="255" y2="190" stroke="#EF4444" stroke-width="2"/>
      <text x="222" y="140" font-size="7.5" fill="#EF4444" opacity="0.85" font-family="'SF Pro Display', sans-serif">Breakout</text>
      <line x1="272" y1="35"  x2="272" y2="145" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <line x1="267" y1="35"  x2="277" y2="35"  stroke="#EF4444" stroke-width="1" opacity="0.6"/>
      <line x1="267" y1="145" x2="277" y2="145" stroke="#EF4444" stroke-width="1" opacity="0.6"/>
      <text x="281" y="94"  font-size="9" fill="#EF4444" opacity="0.7" font-family="monospace" font-weight="600">H</text>
      <line x1="218" y1="185" x2="300" y2="185" stroke="#EF4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>
      <text x="222" y="197" font-size="7.5" fill="#EF4444" opacity="0.75" font-family="'SF Pro Display', sans-serif">Take Profit</text>
    </svg>`
  }
  ,{
    id: 'doji-dragonfly',
    name: 'Dragonfly Doji', nameRu: 'Доджи стрекоза',
    type: 'bullish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↑', signalRu: 'Разворот ↑',
    candles: '1',
    reliability: 'Medium', reliabilityRu: 'Средняя',
    desc: 'Open and close at the same level, long lower shadow. Appears after a downtrend — buyers absorbed the selling pressure. Bullish reversal signal.', descRu: 'Открытие и закрытие на одном уровне, длинная нижняя тень. Появляется после нисходящего тренда — покупатели выкупили падение. Сигнал разворота вверх.',
    svg: `<svg width="100%" viewBox="0 0 260 165" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="35"  x2="260" y2="35"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="75"  x2="260" y2="75"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="115" x2="260" y2="115" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="260" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <rect x="28" y="20" width="16" height="30" fill="#EF4444" rx="1"/>
      <rect x="54" y="50" width="16" height="30" fill="#EF4444" rx="1"/>
      <rect x="80" y="80" width="16" height="30" fill="#EF4444" rx="1"/>
      <ellipse cx="108" cy="118" rx="20" ry="20" fill="rgba(16,185,129,0.06)"/>
      <line x1="108" y1="110" x2="108" y2="148" stroke="#94A3B8" stroke-width="2"/>
      <line x1="100" y1="110" x2="116" y2="110" stroke="#94A3B8" stroke-width="2.5"/>
      <text x="108" y="160" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Dragonfly</text>
      <rect x="130" y="80" width="16" height="30" fill="#10B981" rx="1"/>
      <rect x="156" y="50" width="16" height="30" fill="#10B981" rx="1"/>
      <rect x="182" y="20" width="16" height="30" fill="#10B981" rx="1"/>
    </svg>`
  }
  ,{
    id: 'doji-gravestone',
    name: 'Gravestone Doji', nameRu: 'Доджи надгробие',
    type: 'bearish',
    label: 'Single Candle', labelRu: 'Одиночная свеча',
    signal: 'Reversal ↓', signalRu: 'Разворот ↓',
    candles: '1',
    reliability: 'Medium', reliabilityRu: 'Средняя',
    desc: 'Open and close at the same level, long upper shadow. Appears after an uptrend — sellers pushed price back down from the highs. Bearish reversal signal.', descRu: 'Открытие и закрытие на одном уровне, длинная верхняя тень. Появляется после восходящего тренда — продавцы откинули цену вниз. Сигнал разворота вниз.',
    svg: `<svg width="100%" viewBox="0 0 260 165" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="35"  x2="260" y2="35"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="75"  x2="260" y2="75"  stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="115" x2="260" y2="115" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <line x1="0" y1="150" x2="260" y2="150" stroke="#1E2D45" stroke-width="1" stroke-dasharray="3,5"/>
      <rect x="28" y="110" width="16" height="30" fill="#10B981" rx="1"/>
      <rect x="54" y="80"  width="16" height="30" fill="#10B981" rx="1"/>
      <rect x="80" y="50"  width="16" height="30" fill="#10B981" rx="1"/>
      <line x1="108" y1="8"  x2="108" y2="50" stroke="#94A3B8" stroke-width="2"/>
      <line x1="100" y1="50" x2="116" y2="50" stroke="#94A3B8" stroke-width="2.5"/>
      <text x="108" y="5" font-size="7.5" fill="#94A3B8" text-anchor="middle" font-family="'SF Pro Display', sans-serif">Gravestone</text>
      <rect x="126" y="50"  width="16" height="30" fill="#EF4444" rx="1"/>
      <rect x="150" y="80"  width="16" height="30" fill="#EF4444" rx="1"/>
      <rect x="174" y="110" width="16" height="30" fill="#EF4444" rx="1"/>
    </svg>`
  }

];

// ─────────────────────────────────────────
// Рендер карточек в грид
// ─────────────────────────────────────────
function renderPatterns(filter = 'all', query = '') {
  const t = (key) => (window._t && window._t(key)) || key;
  const isRu = (window.currentLang || localStorage.getItem('cryptopro_lang') || 'en') === 'ru';
  const grid = document.getElementById('patternsGrid');
  if (!grid) return;

  grid.innerHTML = PATTERNS
    .filter(p => {
      const typeOk = filter === 'all' || p.type === filter;
      const q = query.toLowerCase();
      const nameOk = !q || p.name.toLowerCase().includes(q) || p.id.includes(q);
      return typeOk && nameOk;
    })
    .map(p => `
      <div class="pattern-card" data-type="${p.type}" data-id="${p.id}">
        <div class="pattern-card-header">
          <span class="pattern-type-label">${p.label}</span>
          <span class="pattern-badge ${p.type === 'bullish' ? 'bullish' : p.type === 'bearish' ? 'bearish' : 'neutral'}">${p.type === 'bullish' ? 'Bullish' : p.type === 'bearish' ? 'Bearish' : 'Neutral'}</span>
        </div>
        <div class="pattern-visual">${p.svg}</div>
        <div class="pattern-name">${p.name}</div>
        <div class="pattern-meta"><span>${isRu ? (p.signalRu||p.signal) : p.signal}</span><span>${p.candles} candles</span></div>
      </div>
    `).join('');
}

// ─────────────────────────────────────────
// Модальное окно
// ─────────────────────────────────────────
function openPatternModal(id) {
  const t = (key) => (window._t && window._t(key)) || key;
  const p = PATTERNS.find(x => x.id === id);
  if (!p) return;
  const badgeClass = p.type === 'bullish' ? 'bullish' : p.type === 'bearish' ? 'bearish' : 'neutral';
  const badgeText = p.type === 'bullish' ? t('patternLabelBullish') : p.type === 'bearish' ? t('patternLabelBearish') : t('patternLabelNeutral');
  const isRu = (window.currentLang || localStorage.getItem('cryptopro_lang') || 'en') === 'ru';
  document.getElementById('modalTypeLabel').textContent = isRu ? (p.labelRu||p.label) : p.label;
  document.getElementById('modalBadge').className = 'pattern-badge ' + badgeClass;
  document.getElementById('modalBadge').textContent = badgeText;
  document.getElementById('modalVisual').innerHTML = p.svg;
  document.getElementById('modalTitle').textContent = isRu ? (p.nameRu||p.name) : p.name;
  document.getElementById('modalDesc').textContent = isRu ? (p.descRu||p.desc) : p.desc;
  document.getElementById('modalStats').innerHTML = `
    <div class="pattern-modal-stat">
      <div class="pattern-modal-stat-label">${t('patternReliability')}</div>
      <div class="pattern-modal-stat-value green">${isRu ? (p.reliabilityRu||p.reliability) : p.reliability}</div>
    </div>
    <div class="pattern-modal-stat">
      <div class="pattern-modal-stat-label">${t('patternCandlesLabel')}</div>
      <div class="pattern-modal-stat-value">${p.candles}</div>
    </div>
    <div class="pattern-modal-stat">
      <div class="pattern-modal-stat-label">${t('patternSignal')}</div>
      <div class="pattern-modal-stat-value ${p.type === 'bullish' ? 'green' : 'red'}">${isRu ? (p.signalRu||p.signal) : p.signal}</div>
    </div>
  `;
  document.getElementById('patternModalOverlay').classList.add('open');
}

function closePatternModal(e) {
  if (!e || e.target === document.getElementById('patternModalOverlay') || e.currentTarget?.classList.contains('pattern-modal-close')) {
    document.getElementById('patternModalOverlay').classList.remove('open');
  }
}

// Авто-инициализация когда DOM готов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { renderPatterns(); _initPatternClicks(); });
} else {
  renderPatterns();
  _initPatternClicks();
}

function _initPatternClicks() {
  document.addEventListener('click', e => {
    const card = e.target.closest('.pattern-card');
    if (card && card.dataset.id) openPatternModal(card.dataset.id);
  });
}
