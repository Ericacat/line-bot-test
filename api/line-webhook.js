import { middleware, Client } from "@line/bot-sdk";

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const mdw = middleware(config);
    await new Promise((resolve, reject) =>
        mdw(req, res, (err) => (err ? reject(err) : resolve()))
    );

    const events = req.body?.events ?? [];
    await Promise.all(
        events.map(async (event) => {
            if (event.type !== "message" || event.message.type !== "text") return;
            const text = event.message.text.trim();
            await client.replyMessage(event.replyToken, {
                type: "text",
                text: `你說：「${text}」`,
            });
        })
    );

    res.status(200).send("OK");
}