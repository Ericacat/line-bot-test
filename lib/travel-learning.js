import { readFileSync } from 'node:fs';
import { findExamples } from './cantonese-examples.js';
export const travelLearning = JSON.parse(readFileSync(new URL('../data/travel-learning.json', import.meta.url), 'utf8'));
export function travelLearningReply(text) {
    const match = text.match(/^旅居學習(?:\s*[:：]([\s\S]*))?$/u);
    if (!match) return null;
    const name = match[1]?.trim();
    const groups = travelLearning.groups;
    if (!name) {
        const lines = groups.map(group => {
            const hits = group.items.filter(item => findExamples(item.text).length > 0).length;
            return `${group.name}：${group.items.length} 個詞句，${hits} 個有影片例句`;
        });
        return `旅居粵語學習\n\n${lines.join('\n')}\n\n輸入「旅居學習：點餐」查看詞句。再直接傳送想學的粵語詞句，有字幕命中就附影片連結，沒有時提供合成語音（需啟用）。\n清單以完整詞句命中計算，實際查詢也會找相關詞片段。影片字幕未逐句核對發音。`;
    }
    const group = groups.find(group => group.name === name);
    if (!group) return `找不到「${name}」分類。\n可用分類：${groups.map(group => group.name).join('、')}\n例如：旅居學習：點餐`;
    const lines = group.items.map(item => `${item.text}｜${item.meaning}\n${findExamples(item.text).length ? '有影片例句' : '影片待補'}`);
    return `${group.name}\n\n${lines.join('\n\n')}\n\n直接傳送上面的粵語詞句，有字幕命中就附影片連結，沒有時提供合成語音（需啟用）。清單以完整詞句命中計算；「影片待補」仍可能找到相關詞片段。字幕未逐句核對發音。`;
}
