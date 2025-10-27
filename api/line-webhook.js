// /api/line-webhook.js
import { middleware, Client } from '@line/bot-sdk';

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

export default async function handler(req, res) {
    // 讓 GET 不報錯，方便你用瀏覽器開來看
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        // 驗簽（一定要在讀取 body 前作為 middleware 套上）
        const mdw = middleware(config);
        await new Promise((resolve, reject) =>
            mdw(req, res, (err) => (err ? reject(err) : resolve()))
        );

        const events = req.body?.events || [];
        await Promise.all(
            events.map(async (event) => {
                if (event.type === 'message' && event.message.type === 'text') {
                    const replyText = `你說：「${event.message.text}」`;
                    await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                }
            })
        );

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('Webhook error', e);
        // 回 200 讓 LINE 不重送過多次
        return res.status(200).json({ ok: false });
    }
}
