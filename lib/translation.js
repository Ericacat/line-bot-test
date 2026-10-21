import { googleAccessToken, serviceAccount } from './google-auth.js';
import { MAX_CHARACTERS } from './cost-policy.js';

export const MAX_TRANSLATION_CHARACTERS = MAX_CHARACTERS;
export const TRANSLATION_HELP = '翻譯用法：\n翻譯：這個多少錢？\n翻譯：你食咗飯未？\n有粵語特徵詞時翻成中文，其他情況預設翻成粵語；判斷不合預期時可用「粵語：」或「中文：」指定方向。\n一般文字回覆粵拼；有例句就附影片連結，沒有例句時提供合成語音（需啟用）。直接輸入即可，「例句：」也適用相同流程。\n旅居學習：查看分類。每次最多 300 字元。';

export class TranslationError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function createTranslationQuotaGuard({ now = () => new Date() } = {}) {
    const exhausted = new Map();
    const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
    return {
        assertAvailable(project) {
            if (exhausted.get(project) === day()) {
                throw new TranslationError('QUOTA', '今日翻譯額度已用完，請等 Google 配額重設後再試。');
            }
        },
        exhaust(project) { exhausted.set(project, day()); },
    };
}
const sharedQuotaGuard = createTranslationQuotaGuard();

// Local heuristic avoids an extra paid language-detection call. Shared/ambiguous
// Chinese phrases default to Cantonese as the learning target; explicit prefixes override.
const CANTONESE_CUES = /[佢唔冇嘅咗喺啲哋嗰咩乜嘢嚟噉㗎咁瞓攰]|係咪|係唔係|邊個|邊度|幾錢|幾多|點解|點樣|食飯|食嘢|返工|返學|埋單|^係[呀啊喎囉]?$/u;
export function parseTranslation(text) {
    const match = text.match(/^(翻譯|粵語|中文)\s*[:：]\s*([\s\S]*)$/u);
    if (!match) return null;
    const content = match[2].trim();
    const toCantonese = match[1] === '粵語' || (match[1] === '翻譯' && !CANTONESE_CUES.test(content));
    return {
        text: content,
        source: toCantonese ? 'zh-TW' : 'yue',
        target: toCantonese ? 'yue' : 'zh-TW',
    };
}

export async function translateText(request, {
    enabled = process.env.TRANSLATION_ENABLED === 'true',
    getToken = googleAccessToken,
    getProject = () => process.env.GOOGLE_CLOUD_PROJECT || serviceAccount().project_id,
    fetchImpl = fetch,
    context,
    store,
    quotaConfirmed = process.env.TRANSLATION_QUOTA_CONFIRMED === 'true',
    quotaGuard = sharedQuotaGuard,
} = {}) {
    if (!request.text) throw new TranslationError('EMPTY', '請在冒號後輸入要翻譯的文字。');
    if ([...request.text].length > MAX_TRANSLATION_CHARACTERS) {
        throw new TranslationError('TOO_LONG', `每次最多翻譯 ${MAX_TRANSLATION_CHARACTERS} 字元，請分段傳送。`);
    }
    if (![['zh-TW', 'yue'], ['yue', 'zh-TW']].some(([source, target]) => source === request.source && target === request.target)) {
        throw new TranslationError('LANGUAGE', '不支援這個翻譯方向。');
    }
    if (!enabled) throw new TranslationError('DISABLED', '翻譯功能尚未啟用。');
    if (!store && !quotaConfirmed) {
        throw new TranslationError('QUOTA_CONFIG', '請先確認 Google 翻譯每日硬配額已設為 1,500 字元，再啟用翻譯。');
    }
    const project = getProject();
    if (!project) throw new Error('Google project not configured');
    // Retain the existing reservation protection for any explicitly supplied store.
    // The default production flow relies on Google's project-wide NMT hard quota.
    if (store) await store.reserve('translation', request.text, context);
    quotaGuard.assertAvailable(project);
    const token = await getToken();
    const parent = `projects/${encodeURIComponent(project)}/locations/global`;
    const response = await fetchImpl(`https://translation.googleapis.com/v3/${parent}:translateText`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
        body: JSON.stringify({
            contents: [request.text],
            mimeType: 'text/plain',
            sourceLanguageCode: request.source,
            targetLanguageCode: request.target,
            model: `${parent}/models/general/nmt`,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
    });
    const data = await response.json();
    if (!response.ok) {
        const message = data.error?.message || '';
        if (response.status === 429 || (response.status === 403 && /quota|limit exceeded|resource.exhausted/iu.test(message))) {
            if (/daily/iu.test(message)) quotaGuard.exhaust(project);
            throw new TranslationError('QUOTA', /daily/iu.test(message)
                ? '今日翻譯額度已用完，請等 Google 配額重設後再試。'
                : '翻譯使用量已達上限，請稍後再試。');
        }
        throw new Error(`Google Translation failed (${response.status})`);
    }
    const translated = data.translations?.[0]?.translatedText;
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('Invalid translation response');
    return translated;
}
