# LINE 粵語機器人：Google 硬配額模式

Node.js 20+，部署在 Vercel，由你自行 push／部署。預設流程不連接 Redis 或其他外部儲存：文字翻譯使用 Google Cloud Translation 一般 NMT，單次上限 300 字元；每日總量由 Google 專案硬配額限制。粵拼在本機轉換，語音保留每次 300 字元限制，沒有每日硬上限；由你沿用既有預算提醒並手動停用。

## Google Translation 每日 1,500 字元

Google 支援 **Characters sent to general model per project per day (v2 and v3)** 硬配額；預設不限量，你需要在 Google 控制台把這一列設為 **1500**，並確認已生效。Google 保存專案用量，不因 Vercel 執行個體切換、重新部署或程序記憶體清空而歸零。所有使用者及同專案的一般模型呼叫共享額度。

進入 [Google 配額頁面](https://console.cloud.google.com/iam-admin/quotas)，選擇實際翻譯專案，篩選 Cloud Translation API，編輯上述 **per day** 字元配額。實際專案是 `GOOGLE_CLOUD_PROJECT`；未設定時使用 `GOOGLE_APPLICATION_CREDENTIALS_JSON` 的 `project_id`。程式明確使用該專案的 `models/general/nmt`，不呼叫 Translation LLM、批次翻譯或其他模型。

每日按 **美國太平洋時間午夜** 重設，配額調整可能需要最多 24 小時生效。超額時 Google 拒絕請求，程式回覆提示，不重試、不切換其他模型。同一程序收到每日超額後，會暫停該專案的後續翻譯呼叫直到下一個太平洋日期；這只是減少被拒絕的請求，不是每日計數器。新執行個體仍由 Google 判斷是否可用，不會重設 Google 用量。

[Google 官方配額說明](https://docs.cloud.google.com/translate/quotas)。Google 控制台設定尚未由此程式驗證或修改。

## TTS 原生配額與限制

保留的語音程式使用 `https://texttospeech.googleapis.com/v1/text:synthesize`，香港粵語女聲 `yue-HK-Standard-A`，MP3，速度 1.0。

| 原生限制 | 官方預設值／範圍 | 能否替代每日 1,500 字元 |
|---|---|---|
| 每次請求內容大小 | 5,000 bytes，不是字元；不可提高 | 不能，只限制單次大小 |
| `RequestsPerMinutePerProject` | 1,000 次／分鐘／專案，適用目前 Standard 音色 | 不能，只限制請求速率 |
| 其他音色專屬每分鐘配額 | Chirp3 200；Neural2、Polyglot 各 1,000；Studio 500 | 不能；目前程式不使用這些音色 |
| 串流並行數 | 每專案 100 個 sessions | 不能；目前程式不使用串流 |
| 每日字元總量 | 官方公開配額表沒有列出此設定 | 無法用已確認的原生配額保證 |

[Google TTS 官方配額](https://docs.cloud.google.com/text-to-speech/quotas)。沒有登入你的專案確認個別配額欄位，因此不能宣稱你的專案存在其他每日字元限制。

降低每分鐘請求數可減緩用量，但不等於每日字元上限：即使設為每分鐘 1 次，單次 300 字元，理論上仍可達每天 432,000 字元。Standard 的每月免費額度也不是停用開關，超額仍可能收費。預算**通知**不會自動封頂；目前官方 Spend Cap Budget 支援清單也未列 Cloud TTS，因此不能用它取代 TTS 每日字元防護。[預算通知說明](https://docs.cloud.google.com/billing/docs/how-to/budgets)、[Spend Cap 支援服務](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)。

## 語音：預算提醒與手動停用模式

依你的選擇，預設正式流程不接外部儲存、不強制語音每日 1,500 字元；沿用你表示已設定的預算提醒，由你決定停用。我們未登入確認該提醒的範圍或收件人。預算通知有延遲，不會自動停用 TTS；免费額度內的字元用量也不一定會觸發費用通知。

Webhook 通過 LINE 簽章及單次字元檢查後，產生有效 10 分鐘的加密、驗證語音網址。文字不以明文放入網址。LINE 下載音檔時才呼叫固定 Google Standard 音色；沒有自動重試或其他付費供應商。一般文字與粵語翻譯回覆語音，繁體中文翻譯回覆文字。翻譯結果超過 300 字元時只回覆文字與提示，不合成語音。

同一執行個體會共用並行下載、快取音檔以及失敗結果，直到網址到期；快取滿時拒絕新合成。**跨 Vercel 執行個體、重新部署或程序重啟的下載可能重新合成並增加 Google 用量。** 這不是持久去重或每日計數。過期、遭竄改的網址及舊 `/api/tts?text=…` 皆不呼叫 Google。只有簽章有效且未過期的網址可下載，持有網址者在期限內仍可重播。

要手動停止語音，在 Vercel 把 `TTS_ENABLED` 設為 `false`，再重新部署讓變數生效；文字與翻譯繼續運作。要立刻在 Google 停止 TTS，可手動停用該專案 Cloud Text-to-Speech API，不必停用整個專案的帳單。

舊持久計數及已存音檔程式保留作為測試／未來明確注入儲存的選項，不在預設正式流程中使用。不建立或連接 Redis；設定 Redis 環境變數不會自行啟用此路徑。

## 保留的費用與 webhook 保護

- 每次原始文字最多 **300 Unicode code points**，包含指令、空白、標點及 emoji；翻譯函式也獨立檢查 300 字元上限。
- 所有人可用，沒有 LINE user ID 白名單；LINE request 原始位元組仍須通過簽章驗證。
- 翻譯預設關閉；必須先確認 Google 每日硬配額，再設定啟用與確認變數。
- Google 呼叫有逾時、沒有自動重試與付費備援；Google 或 LINE 回覆失敗不重跑翻譯或自行重試語音。
- 過舊事件／缺事件 ID 或 timestamp 不處理；無儲存模式直接跳過 LINE 標示的 `isRedelivery=true`。
- 同一程序保留短期事件 ID 記錄，並行重複事件只執行一次。記錄滿時停止接收新請求，不淘汰尚有效的去重記錄。
- **此短期去重不能保證跨執行個體／重新部署精確一次。** 不宣稱記憶體能替代持久去重。跨執行個體可能收到未標記重送的同一事件，仍可能重複翻譯或生成新的語音網址；翻譯字元總量由 Google 每日硬配額保護，語音沒有每日上界。
- 有效 webhook 中已處理的服務失敗仍回覆 HTTP 200，避免 LINE 因錯誤狀態重送；無效簽章回覆 401，不呼叫 Google。
- 語音網址需要加密驗證與有效期限，下載端再次檢查每次 300 字元及啟用開關；不能以任意文字網址呼叫 Google。
- 既有持久計數、錯誤時停止、事件 reservation、已存音檔的簽章與期限檢查未刪除。沒有把它們換成不可靠的本機每日計數。

## Vercel 環境變數

在 Vercel 專案 **Settings → Environment Variables** 設定，下次由你部署生效。

| 變數 | 設定 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 沿用既有值 |
| `LINE_CHANNEL_SECRET` | 沿用既有值 |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | 沿用既有服務帳戶 JSON |
| `GOOGLE_CLOUD_PROJECT` | 可省略，預設服務帳戶的 `project_id` |
| `TRANSLATION_ENABLED` | 翻譯準備好後設 `true` |
| **`TRANSLATION_QUOTA_CONFIRMED`** | **新增**；確認實際專案的每日 NMT 配額已設為 1500 且生效後，才設 `true` |
| `TTS_ENABLED` | 未設定時保留原本語音；`true` 啟用，`false` 停止，變更後重新部署 |
| `PUBLIC_BASE_URL` | 可省略，正式環境優先使用 Vercel 自動提供的 `VERCEL_PROJECT_PRODUCTION_URL`，其次 `VERCEL_URL`；也可指定正式 HTTPS 網址，不含路徑或查詢參數 |
| `AUDIO_URL_SIGNING_SECRET` | 可省略，使用既有 `LINE_CHANNEL_SECRET` 衍生獨立用途的加密密鑰；自行設定需至少 32 bytes，不能留空 |

`TRANSLATION_QUOTA_CONFIRMED` 是操作者對控制台設定的確認，不會建立、提高、修改或讀取 Google 配額；設為 true 不能代替實際的雲端硬配額。配額沒設定、設在錯誤專案或之後被提高，都會失去所要求的每日 1500 字元上界，因此不要在這些情況確認啟用。

目前不需要 `COST_REDIS_REST_URL`、`COST_REDIS_REST_TOKEN`，也不需要初始化 ledger。若先前已設定 Redis 變數，程式預設不使用它們。不要刪除既有計數資料；未來若恢復持久保護，不應把既有用量重設為零。

沒有自動建立雲端資源、啟用 API、提高配額、修改計費、購買資源、push 或部署。Google 翻譯 API 和服務帳戶權限仍需要原本可用的設定；任何新服務或計費操作先由你決定。`.env.example` 是範本，程式不自行讀取 `.env`，secret 不提交到 Git。

## 用法、費用及測試

- `粵語：你好，你吃飯了嗎？`：回覆粵語翻譯、粵拼及語音。
- `中文：你食咗飯未？`：回覆繁體書面中文。
- `翻譯說明`：顯示指令。
- 一般文字：回覆原文、粵拼及語音。

可能收費的項目仍包括 Google NMT 翻譯、Google Standard TTS、Vercel 執行／日誌／傳輸及 LINE 官方帳號付費方案；本次預設流程會產生 TTS 用量，不產生 Redis 用量。NMT 公告每月前 50 萬字元免費；保留的 Standard TTS 公告每月前 400 萬字元免費，超額分別標準價 US$20／US$4 每百萬字元。其他應用可能共享免費額度，不能保證整個帳單為零。[翻譯定價](https://cloud.google.com/products/translate/pricing)、[TTS 定價](https://cloud.google.com/text-to-speech/pricing)、[LINE 計費](https://developers.line.biz/en/docs/messaging-api/pricing/)。

`npm test`：測試無儲存翻譯流程、配額確認閘門、Google 超額提示與不重試、太平洋日期切換、單次限制、重送與事件快取，以及無儲存語音網址、單次限制、下載快取與停用開關；也保留測試舊持久計數與音檔保護。Google／LINE 回應皆為模擬，Redis 是本機測試替身，實際執行 production Lua 腳本。不建立外部測試儲存，也不呼叫付費生成服務。尚未驗證你的 Google 控制台配額或實際 Vercel 部署。
