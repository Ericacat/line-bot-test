import { middleware, Client } from '@line/bot-sdk';
import { getJyutpingText } from 'to-jyutping';

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// 廣東話文字 -> 粵拼；轉換失敗或無結果時回傳 null，呼叫端須自行 fallback
function toJyutping(text) {
    try {
        const jyutping = getJyutpingText(text)?.trim();
        // 完全無法辨識（例如純英數字/表情符號）時，to-jyutping 會回傳 "[…]"
        if (!jyutping || jyutping === '[…]') return null;
        return jyutping;
    } catch (e) {
        console.error('Jyutping conversion error', e);
        return null;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        const mdw = middleware(config);
        await new Promise((resolve, reject) => mdw(req, res, (err) => (err ? reject(err) : resolve())));

        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `https://${host}`;

        const events = req.body?.events || [];
        await Promise.all(events.map(async (event) => {
            if (event.type !== 'message' || event.message.type !== 'text') return;

            const text = event.message.text.trim();
            if (!text) return;

            // 產生 TTS 音檔網址（記得做 URL encode）
            const ttsUrl = `${baseUrl}/api/tts?text=${encodeURIComponent(text)}`;

            // 粗估時長(毫秒)；太短會被 LINE 視為 0 秒
            const estDuration = Math.min(8000, Math.max(1200, text.length * 300));

            const jyutping = toJyutping(text);
            const textMessage = {
                type: 'text',
                text: jyutping ? `${text}\n粵拼：${jyutping}` : text,
            };
            const audioMessage = {
                type: 'audio',
                originalContentUrl: ttsUrl,
                duration: estDuration,
            };

            await client.replyMessage(event.replyToken, [textMessage, audioMessage]);
        }));

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('Webhook error', e);
        return res.status(200).json({ ok: false });
    }
}
