import { middleware, Client } from '@line/bot-sdk';

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

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

            await client.replyMessage(event.replyToken, {
                type: 'audio',
                originalContentUrl: ttsUrl,
                duration: estDuration,
            });
        }));

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('Webhook error', e);
        return res.status(200).json({ ok: false });
    }
}
