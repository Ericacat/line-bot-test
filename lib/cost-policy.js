export const MAX_CHARACTERS = 300;
export const TRANSLATION_DAILY_LIMIT = 1500;
export const TTS_DAILY_LIMIT = 1500;
export const EVENT_MAX_AGE_MS = 10 * 60 * 1000;

export class ProtectionError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
export const characterCount = (text) => [...text].length;
export function checkText(text) {
    if (typeof text !== 'string' || !text.trim()) throw new ProtectionError('EMPTY', '請輸入文字。');
    if (characterCount(text) > MAX_CHARACTERS) throw new ProtectionError('TOO_LONG', '每次最多 300 字元，請分段傳送。');
}
export function isFreshEvent(event, now = Date.now()) {
    return typeof event.webhookEventId === 'string' && /^[\w-]{1,128}$/.test(event.webhookEventId)
        && Number.isSafeInteger(event.timestamp)
        && event.timestamp <= now + 30000 && event.timestamp >= now - EVENT_MAX_AGE_MS;
}
