/* ══════════════════════════════════════════════════════════════
   CREDENTIALS STORE — Thinking Trader
   
   Зашифрованное хранилище API ключей Binance Futures.
   
   ── Безопасность ──
   - Ключи (apiKey, apiSecret) шифруются AES-256-GCM перед записью.
   - Master-ключ берётся из переменной окружения BOT_CREDS_KEY.
     Если её нет — генерируется случайный 32-байтный ключ и
     сохраняется в файл .bot-creds-master (рядом с этим модулем).
     В продакшне ОБЯЗАТЕЛЬНО задать BOT_CREDS_KEY через окружение
     и не коммитить .bot-creds-master.
   - На диск пишется только cipherText + IV + authTag. Без знания
     master-ключа расшифровать невозможно.
   - Файл хранилища (bot-credentials.json) сам по себе бесполезен
     без master-ключа.
   
   ── Структура файла ──
       {
         "uid:botId": {
           apiKey:    "<base64 ciphertext>",
           apiSecret: "<base64 ciphertext>",
           iv:        "<base64 iv>",
           authTag:   "<base64 auth tag>",
           testnet:   true|false,
           updatedAt: <timestamp>
         },
         ...
       }
   ══════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const STORE_FILE       = path.join(__dirname, 'bot-credentials.json');
const MASTER_KEY_FILE  = path.join(__dirname, '.bot-creds-master');
const ALGO             = 'aes-256-gcm';
const KEY_LENGTH       = 32; // 256 бит
const IV_LENGTH        = 12; // 96 бит — стандарт для GCM

/* ══════════════════════════════════════════
   Загрузка / создание master-ключа
   Вызывается один раз при инициализации.
══════════════════════════════════════════ */
function getMasterKey() {
    // 1. Из переменной окружения (приоритет, продакшн)
    const fromEnv = process.env.BOT_CREDS_KEY;
    if (fromEnv) {
        try {
            const buf = Buffer.from(fromEnv, 'hex');
            if (buf.length !== KEY_LENGTH) {
                throw new Error('BOT_CREDS_KEY должен быть 64 hex-символа (32 байта)');
            }
            return buf;
        } catch (e) {
            console.error('[CREDS] Invalid BOT_CREDS_KEY:', e.message);
            throw e;
        }
    }
    // 2. Из локального файла (dev fallback)
    if (fs.existsSync(MASTER_KEY_FILE)) {
        const buf = fs.readFileSync(MASTER_KEY_FILE);
        if (buf.length === KEY_LENGTH) return buf;
        console.warn('[CREDS] .bot-creds-master corrupt — regenerating');
    }
    // 3. Сгенерировать новый и сохранить
    const newKey = crypto.randomBytes(KEY_LENGTH);
    fs.writeFileSync(MASTER_KEY_FILE, newKey, { mode: 0o600 });
    console.warn('[CREDS] Generated new master key in ' + MASTER_KEY_FILE +
                 '. For production set BOT_CREDS_KEY env var instead.');
    return newKey;
}

let MASTER_KEY = null;
function ensureMasterKey() {
    if (!MASTER_KEY) MASTER_KEY = getMasterKey();
    return MASTER_KEY;
}

/* ══════════════════════════════════════════
   Шифрование / расшифровка
   AES-256-GCM. IV генерируется случайно
   на каждое шифрование (никогда не реюзается).
══════════════════════════════════════════ */
function encryptPair(apiKey, apiSecret) {
    const key = ensureMasterKey();
    const iv  = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, key, iv);

    // Шифруем apiKey и apiSecret в ОДНОМ контексте, чтобы один authTag
    // защищал оба значения. Разделитель \0 не может встретиться в base64-ключах.
    const plaintext = apiKey + '\0' + apiSecret;
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        cipher:  enc.toString('base64'),
        iv:      iv.toString('base64'),
        authTag: authTag.toString('base64'),
    };
}

function decryptPair(cipherB64, ivB64, authTagB64) {
    const key = ensureMasterKey();
    const iv      = Buffer.from(ivB64,      'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const enc     = Buffer.from(cipherB64,  'base64');

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');

    const sep = plain.indexOf('\0');
    if (sep === -1) throw new Error('Decrypted format invalid');
    return {
        apiKey:    plain.slice(0, sep),
        apiSecret: plain.slice(sep + 1),
    };
}

/* ══════════════════════════════════════════
   Чтение / запись файла хранилища
══════════════════════════════════════════ */
function readStore() {
    if (!fs.existsSync(STORE_FILE)) return {};
    try {
        const raw = fs.readFileSync(STORE_FILE, 'utf8');
        return JSON.parse(raw) || {};
    } catch (e) {
        console.error('[CREDS] Failed to read store:', e.message);
        return {};
    }
}

function writeStore(store) {
    // Атомарная запись через temp + rename — как в bot-sessions.json
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STORE_FILE);
}

function userKey(uid) {
    return String(uid);
}

/**
 * Поиск любой записи в старом формате "uid:botId" для миграции.
 * Возвращает {recordKey, record} или null.
 */
function findLegacyRecord(store, uid) {
    const prefix = String(uid) + ':';
    for (const k of Object.keys(store)) {
        if (k.indexOf(prefix) === 0 && k !== userKey(uid)) {
            return { recordKey: k, record: store[k] };
        }
    }
    return null;
}

/**
 * Прочитать запись пользователя. Если есть только старый формат —
 * мигрировать в новый (взять любую существующую запись пользователя).
 */
function readUserRecord(store, uid) {
    const k = userKey(uid);
    if (store[k]) return store[k];
    // Миграция со старого формата "uid:botId"
    const legacy = findLegacyRecord(store, uid);
    if (legacy) {
        console.log(`[CREDS] Migrating legacy record ${legacy.recordKey} → ${k}`);
        store[k] = legacy.record;
        delete store[legacy.recordKey];
        // Дополнительно подчистим все остальные старые записи этого uid
        // (чтобы не накапливался мусор от удалённых ботов)
        const prefix = String(uid) + ':';
        for (const otherK of Object.keys(store)) {
            if (otherK.indexOf(prefix) === 0 && otherK !== k) {
                console.log(`[CREDS] Cleaning legacy record ${otherK}`);
                delete store[otherK];
            }
        }
        writeStore(store);
        return store[k];
    }
    return null;
}

/* ══════════════════════════════════════════
   PUBLIC API
   
   Ключи хранятся на уровне пользователя (uid), а не отдельного бота.
   Один пользователь = один Binance-аккаунт = один набор ключей,
   которые автоматически работают для всех его ботов.
══════════════════════════════════════════ */

/**
 * Сохранить ключи пользователя. Перезаписывает существующие.
 * @returns {{ ok: boolean, error?: string }}
 */
function saveCredentials(uid, apiKey, apiSecret, testnet) {
    if (!uid)                       return { ok: false, error: 'uid обязателен' };
    if (!apiKey || !apiSecret)      return { ok: false, error: 'apiKey и apiSecret обязательны' };

    try {
        const enc = encryptPair(String(apiKey), String(apiSecret));
        const store = readStore();
        // Удаляем все старые записи "uid:botId" этого пользователя если есть
        const prefix = String(uid) + ':';
        for (const k of Object.keys(store)) {
            if (k.indexOf(prefix) === 0) delete store[k];
        }
        store[userKey(uid)] = {
            cipher:    enc.cipher,
            iv:        enc.iv,
            authTag:   enc.authTag,
            testnet:   !!testnet,
            updatedAt: Date.now(),
        };
        writeStore(store);
        return { ok: true };
    } catch (e) {
        console.error('[CREDS] Save failed:', e.message);
        return { ok: false, error: e.message };
    }
}

/**
 * Загрузить ключи пользователя. Возвращает расшифрованные значения.
 * Если есть только старая запись "uid:botId" — мигрирует в новый формат.
 * @returns {{ ok: boolean, apiKey?, apiSecret?, testnet?, updatedAt?, error? }}
 */
function loadCredentials(uid) {
    if (!uid) return { ok: false, error: 'uid обязателен' };
    try {
        const store = readStore();
        const rec = readUserRecord(store, uid);
        if (!rec) return { ok: false, error: 'not_found' };
        const { apiKey, apiSecret } = decryptPair(rec.cipher, rec.iv, rec.authTag);
        return {
            ok:        true,
            apiKey,
            apiSecret,
            testnet:   !!rec.testnet,
            updatedAt: rec.updatedAt || 0,
        };
    } catch (e) {
        console.error('[CREDS] Load failed:', e.message);
        return { ok: false, error: e.message };
    }
}

/**
 * Проверить что ключи сохранены, без расшифровки.
 * Также мигрирует старый формат если есть.
 * @returns {{ saved: boolean, testnet?: boolean, updatedAt?: number }}
 */
function hasCredentials(uid) {
    if (!uid) return { saved: false };
    const store = readStore();
    const rec = readUserRecord(store, uid);
    if (!rec) return { saved: false };
    return { saved: true, testnet: !!rec.testnet, updatedAt: rec.updatedAt || 0 };
}

/**
 * Удалить ключи пользователя (а заодно и все старые "uid:botId" записи).
 */
function deleteCredentials(uid) {
    if (!uid) return { ok: false, error: 'uid обязателен' };
    try {
        const store = readStore();
        const k = userKey(uid);
        let existed = !!store[k];
        if (existed) delete store[k];
        // Дополнительно чистим все старые "uid:botId" записи этого пользователя
        const prefix = String(uid) + ':';
        for (const otherK of Object.keys(store)) {
            if (otherK.indexOf(prefix) === 0) {
                delete store[otherK];
                existed = true;
            }
        }
        if (existed) writeStore(store);
        return { ok: true, existed };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    saveCredentials,
    loadCredentials,
    hasCredentials,
    deleteCredentials,
};
