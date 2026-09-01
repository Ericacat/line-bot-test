// 粵拼 -> 注音（近似）轉換工具
//
// 只處理羅馬字母粵拼音節（含聲母＋韻母＋可省略的聲調數字 1-6），
// 不處理漢字、翻譯或語意；聲調數字只用來辨識音節邊界，不會出現在輸出中。

// 聲母表；gw / kw / j / w 不在此表中，會在 combineInitialAndFinal() 特別處理
const INITIALS = {
    ng: 'ㄫ',
    b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ',
    d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ',
    g: 'ㄍ', k: 'ㄎ', h: 'ㄏ',
    z: 'ㄗ', c: 'ㄘ', s: 'ㄙ',
};

// 聲母最長匹配順序：兩個字母的 gw/kw/ng 必須排在單一字母之前
const INITIAL_ORDER = ['gw', 'kw', 'ng', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'z', 'c', 's', 'j', 'w'];

// 韻母表（不含聲調）。ㄨㄨ/ㄧㄧ 等重複滑音已在 combine 階段處理，這裡只放「本體」注音。
// p/t/k 入聲韻尾、oe/eo 等注音無法完全對應的音，統一採用內部一致的近似值。
const FINALS = {
    aa: 'ㄚ', aai: 'ㄞ', aau: 'ㄠ', aam: 'ㄚㄇ', aan: 'ㄢ', aang: 'ㄤ', aap: 'ㄚ', aat: 'ㄚ', aak: 'ㄚ',
    ai: 'ㄞ', au: 'ㄠ', am: 'ㄚㄇ', an: 'ㄣ', ang: 'ㄤ', ap: 'ㄚ', at: 'ㄚ', ak: 'ㄚ',
    e: 'ㄝ', ei: 'ㄟ', eu: 'ㄝㄨ', em: 'ㄝㄇ', eng: 'ㄥ', ep: 'ㄝ', ek: 'ㄝ',
    i: 'ㄧ', iu: 'ㄧㄡ', im: 'ㄧㄇ', in: 'ㄧㄣ', ing: 'ㄧㄥ', ip: 'ㄧ', it: 'ㄧ', ik: 'ㄧ',
    o: 'ㄛ', oi: 'ㄛㄧ', ou: 'ㄡ', on: 'ㄢ', ong: 'ㄤ', ot: 'ㄛ', ok: 'ㄛ',
    oe: 'ㄩㄝ', oeng: 'ㄩㄥ', oek: 'ㄩㄝ',
    eoi: 'ㄨㄟ', eon: 'ㄨㄣ', eot: 'ㄨ',
    u: 'ㄨ', ui: 'ㄨㄧ', un: 'ㄨㄣ', ung: 'ㄨㄥ', ut: 'ㄨ', uk: 'ㄨ',
    yu: 'ㄩ', yun: 'ㄩㄣ', yut: 'ㄩ',
};

// j／w 是滑音，融入韻母開頭；若韻母本身已帶相同性質的滑音（ㄧ/ㄩ 或 ㄨ），
// 不重複疊加，避免出現 ㄧㄧ／ㄨㄨ 這種機械拼接的結果
function mergeGlide(glide, finalBopomofo) {
    if (glide === 'ㄧ' && (finalBopomofo.startsWith('ㄧ') || finalBopomofo.startsWith('ㄩ'))) {
        return finalBopomofo;
    }
    if (glide === 'ㄨ' && finalBopomofo.startsWith('ㄨ')) {
        return finalBopomofo;
    }
    return glide + finalBopomofo;
}

function splitInitialAndFinal(body) {
    for (const initial of INITIAL_ORDER) {
        if (body.length > initial.length && body.startsWith(initial)) {
            return { initial, final: body.slice(initial.length) };
        }
    }
    return { initial: '', final: body };
}

function combineInitialAndFinal(initial, final) {
    const finalBopomofo = FINALS[final];
    if (!finalBopomofo) return null;

    switch (initial) {
        case '':
            return finalBopomofo;
        case 'j':
            return mergeGlide('ㄧ', finalBopomofo);
        case 'w':
            return mergeGlide('ㄨ', finalBopomofo);
        case 'gw':
            return 'ㄍ' + mergeGlide('ㄨ', finalBopomofo);
        case 'kw':
            return 'ㄎ' + mergeGlide('ㄨ', finalBopomofo);
        default: {
            const consonant = INITIALS[initial];
            return consonant ? consonant + finalBopomofo : null;
        }
    }
}

// 將單一粵拼音節（如 "hai2"）轉為注音（如 "ㄏㄞ"）；無法辨識時回傳 null
function jyutpingSyllableToBopomofo(syllable) {
    if (typeof syllable !== 'string') return null;

    // 只取字串開頭「字母(+聲調數字)」的部分，容忍後面黏著的標點符號
    const match = /^[a-z]+[1-6]?/.exec(syllable.toLowerCase());
    if (!match) return null;

    const body = match[0].replace(/[1-6]$/, '');
    if (!body) return null;

    // 可獨立成音節的鼻音 m／ng（例如「唔」m4、「五」ng5）
    if (body === 'm') return 'ㄇ';
    if (body === 'ng') return 'ㄫ';

    const { initial, final } = splitInitialAndFinal(body);
    return combineInitialAndFinal(initial, final);
}

// 將整串粵拼文字（如 "hai2 bin1 dou6 dang2"，可用空白分隔多個音節）轉為注音字串
// 無法辨識的音節會被略過，不會產生假的注音；若整串都無法辨識則回傳 null
function jyutpingTextToBopomofo(jyutpingText) {
    if (!jyutpingText || typeof jyutpingText !== 'string') return null;

    const bopomofoSyllables = jyutpingText
        .trim()
        .split(/\s+/)
        .map(jyutpingSyllableToBopomofo)
        .filter(Boolean);

    return bopomofoSyllables.length ? bopomofoSyllables.join(' ') : null;
}

export { jyutpingTextToBopomofo, jyutpingSyllableToBopomofo };
