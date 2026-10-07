import { createHash, randomUUID } from 'node:crypto';
import { ProtectionError, checkText, characterCount } from './cost-policy.js';

// Fixed across deployments; all keys share a Redis hash slot.
export const STORE_PREFIX = 'line-bot:{cost-v1}';
export const LEDGER_KEY = `${STORE_PREFIX}:ledger`;
const EVENT_TTL = 8 * 86400;
export const AUDIO_TTL = 3600;
const VALIDATE_LEDGER = `
local values = redis.call('HMGET', KEYS[1], 'schema', 'day', 'translation', 'tts')
if values[1] ~= '1' then return {-3} end
local day = tonumber(values[2])
local translation = tonumber(values[3])
local tts = tonumber(values[4])
if not day or not translation or not tts or day < 0 or translation < 0 or tts < 0
  or day ~= math.floor(day) or translation ~= math.floor(translation) or tts ~= math.floor(tts) then return {-3} end
local now = tonumber(redis.call('TIME')[1]) + 0.0
local today = math.floor(now / 86400)
if day > today then return {-3} end
local timestamp = tonumber(ARGV[1])
if not timestamp or timestamp < now * 1000 - 600000 or timestamp > now * 1000 + 30000 then return {-2} end
`;
export const CLAIM_SCRIPT = `${VALIDATE_LEDGER}
if redis.call('EXISTS', KEYS[2]) == 1 then return {0} end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return {1}
`;
export const RESERVE_SCRIPT = `${VALIDATE_LEDGER}
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return {-4} end
if redis.call('EXISTS', KEYS[3]) == 1 then return {0} end
local service = ARGV[3]
if service ~= 'translation' and service ~= 'tts' then return {-4} end
local amount = tonumber(ARGV[4])
if not amount or amount < 1 or amount > 300 or amount ~= math.floor(amount) then return {-4} end
local used = service == 'translation' and translation or tts
if day < today then used = 0 end
-- Hard ceiling cannot be raised by environment variables.
if used + amount > 1500 then return {2} end
if day < today then redis.call('HSET', KEYS[1], 'day', today, 'translation', 0, 'tts', 0) end
redis.call('HINCRBY', KEYS[1], service, amount)
redis.call('SET', KEYS[3], amount, 'EX', ARGV[5])
return {1}
`;
export const INIT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local today = math.floor(tonumber(redis.call('TIME')[1]) / 86400)
redis.call('HSET', KEYS[1], 'schema', 1, 'day', today, 'translation', 0, 'tts', 0)
return 1
`;
export function storeError() {
    return new ProtectionError('STORE', '用量記錄暫時無法確認，已停止翻譯與語音。');
}
export function createCostStore({ url = process.env.COST_REDIS_REST_URL, token = process.env.COST_REDIS_REST_TOKEN, fetchImpl = fetch } = {}) {
    async function command(args) {
        try {
            if (!url || !token) throw storeError();
            const endpoint = new URL(url);
            if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw storeError();
            const response = await fetchImpl(endpoint.href, {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(args), signal: AbortSignal.timeout(5000), redirect: 'error',
            });
            if (!response.ok) throw storeError();
            const data = await response.json();
            if (data.error || !Object.hasOwn(data, 'result')) throw storeError();
            return data.result;
        } catch { throw storeError(); }
    }
    function eventKey(context) {
        return `${STORE_PREFIX}:event:${createHash('sha256').update(context.eventId).digest('hex')}`;
    }
    function resultCode(result) {
        if (!Array.isArray(result) || result.length !== 1 || !Number.isInteger(result[0])) throw storeError();
        return result[0];
    }
    return {
        // Manual initialization only; never invoked by request handlers.
        async initialize() {
            const result = await command(['EVAL', INIT_SCRIPT, '1', LEDGER_KEY]);
            if (result !== 0 && result !== 1) throw storeError();
            return result === 1;
        },
        async claim(event) {
            const context = { eventId: event.webhookEventId, timestamp: event.timestamp, nonce: randomUUID() };
            if (typeof context.eventId !== 'string' || !Number.isSafeInteger(context.timestamp)) throw storeError();
            const code = resultCode(await command(['EVAL', CLAIM_SCRIPT, '2', LEDGER_KEY, eventKey(context),
                String(context.timestamp), context.nonce, String(EVENT_TTL)]));
            if (code === 0 || code === -2) return null;
            if (code !== 1) throw storeError();
            return context;
        },
        async reserve(service, text, context) {
            checkText(text);
            if (!context?.nonce || typeof context.eventId !== 'string' || !Number.isSafeInteger(context.timestamp)) throw storeError();
            const key = eventKey(context);
            const code = resultCode(await command(['EVAL', RESERVE_SCRIPT, '3', LEDGER_KEY, key, `${key}:${service}`,
                String(context.timestamp), context.nonce, service, String(characterCount(text)), String(EVENT_TTL)]));
            if (code === 2) throw new ProtectionError('DAILY_LIMIT', `今日${service === 'translation' ? '翻譯' : '語音'}已達 1,500 字元上限。`);
            if (code === 0) throw new ProtectionError('DUPLICATE', '此請求已處理，不會再次呼叫服務。');
            if (code !== 1) throw storeError();
        },
        async saveAudio(id, data) {
            const result = await command(['SET', `${STORE_PREFIX}:audio:${id}`, JSON.stringify(data), 'EX', String(AUDIO_TTL), 'NX']);
            if (result !== 'OK') throw storeError();
        },
        async readAudio(id) {
            const result = await command(['GET', `${STORE_PREFIX}:audio:${id}`]);
            if (result === null) return null;
            if (typeof result !== 'string') throw storeError();
            try { return JSON.parse(result); } catch { throw storeError(); }
        },
    };
}
