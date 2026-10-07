import { middleware, Client } from '@line/bot-sdk';
import { getJyutpingText } from 'to-jyutping';
import { parseTranslation, translateText, TranslationError, TRANSLATION_HELP } from '../lib/translation.js';
import { checkText, isFreshEvent, ProtectionError } from '../lib/cost-policy.js';
import { createEventGuard } from '../lib/event-guard.js';
import { createSpeech } from '../lib/speech.js';

// Preserve the original bytes for LINE signature verification on Vercel.
export const config = { api: { bodyParser: false } };
const TONE_MARKS = { 1: '¯', 2: '↗', 3: '→', 4: '↘', 5: '⤴', 6: '_' };
function toJyutping(text) {
    try {
        const value = getJyutpingText(text)?.trim();
        if (!value || value === '[…]') return null;
        return value.replace(/([1-6])(?!\d)/g, (digit) => digit + TONE_MARKS[digit]);
    } catch { return null; }
}
async function replyMessage(replyToken, messages) {
    const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        httpConfig: { timeout: 10000 } });
    await client.replyMessage(replyToken, messages);
}

const sharedEventGuard = createEventGuard();
export function createWebhookHandler({ store, eventGuard = sharedEventGuard, reply = replyMessage,
    translate = translateText, speech = createSpeech } = {}) {
    async function handleEvent(event) {
        if (event.type !== 'message' || event.message?.type !== 'text' || typeof event.message.text !== 'string') return;
        // No user whitelist; only signed LINE events can issue speech URLs.
        if (!isFreshEvent(event)) return;
        let context;
        let messages;
        try {
            context = store ? await store.claim(event) : eventGuard.claim(event);
            if (!context) return;
            checkText(event.message.text);
            const text = event.message.text.trim();
            if (text === '翻譯說明') {
                messages = [{ type: 'text', text: TRANSLATION_HELP }];
            } else {
                const translation = parseTranslation(text);
                let audioText = text;
                let replyText = text;
                if (translation) {
                    const translated = await translate(translation, { context, store });
                    replyText = `${translation.target === 'yue' ? '粵語' : '中文'}翻譯：${translated}`;
                    audioText = translated;
                }
                if (translation?.target === 'zh-TW') {
                    messages = [{ type: 'text', text: replyText }];
                } else {
                    const jyutping = toJyutping(audioText);
                    messages = [{ type: 'text', text: jyutping ? `${replyText}\n粵拼：${jyutping}` : replyText }];
                    if (process.env.TTS_ENABLED === 'true') {
                        try {
                            messages.push(await speech(audioText, context, { store }));
                        } catch (error) {
                            const reason = error instanceof ProtectionError ? error.message : '語音暫時無法使用，不會自動重試。';
                            messages[0].text += `\n${reason}`;
                            console.error('Speech stopped', error.code || 'SERVICE_ERROR');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Request stopped', error.code || 'SERVICE_ERROR');
            messages = [{ type: 'text', text: error instanceof ProtectionError || error instanceof TranslationError
                ? error.message : '服務暫時無法使用，不會自動重試。' }];
        }
        // Reply failure never restarts translation or synthesis.
        try { await reply(event.replyToken, messages); }
        catch { console.error('LINE reply failed'); }
    }
    return async function handler(req, res) {
        if (req.method !== 'POST') return res.status(200).send('OK');
        try {
            const verify = middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET });
            await new Promise((resolve, reject) => verify(req, res, (error) => error ? reject(error) : resolve()));
        } catch {
            return res.status(401).json({ ok: false });
        }
        // Sequential within a webhook; Google enforces the durable NMT daily quota.
        for (const event of Array.isArray(req.body?.events) ? req.body.events : []) {
            await handleEvent(event);
        }
        // Acknowledge handled failures to prevent webhook retry loops.
        return res.status(200).json({ ok: true });
    };
}
export default createWebhookHandler();
