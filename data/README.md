# 粵語影片例句索引

資料來源：[OrcinusOrca/YouTube-Cantonese](https://huggingface.co/datasets/OrcinusOrca/YouTube-Cantonese)，以及 [ming030890/youtube_caption_yue](https://huggingface.co/datasets/ming030890/youtube_caption_yue)。前者自述為創作者上傳字幕、頁面標示 MIT；後者自述為人工字幕與 SenseVoice 比對篩選，README 標示研究用途並要求核對原 YouTube 授權，不能視為影音／字幕的通用 MIT 授權。本專案只保存候選字幕文字、標題、影片 ID 和原片時間，播放連回原 YouTube，不複製影音。

## 目前收錄與品質限制

2026-10-21 擴充至 **56 支影片、2,233 句候選字幕**：

| 頻道 | 影片 | 候選句 |
|---|---:|---:|
| Maviskuku 雞蛋妹 | 32 | 2,112 |
| Mill MILK | 6 | 10 |
| MPWeekly 明周 | 3 | 69 |
| 阿豬 Ah Ju | 2 | 9 |
| Sun Channel | 1 | 18 |
| Pinky Talks | 1 | 4 |
| mingjai14 | 1 | 1 |
| McFatty 麥花田 | 2 | 2 |
| 夫妻廢片 | 8 | 8 |

新增題材含職場、人際關係、人物訪談及理財，但句數仍大多來自科技影片，飲食、交通、日常對話仍需繼續補充。前輪 50 支候選中有 4 支無法取得 YouTube oEmbed 資訊，因此不收錄；這輪另加入 10 支料理與生活影片，各一個短句片段，並非整支影片字幕；詳見 `cantonese-video-sources.json` 的排除清單。

這不是完整頻道資料庫，也不是人工核對過的逐字稿。來源多數字幕偏書面中文，因此原來源只留下含「唔、佢、嘅、咗、喺、啲、哋、嗰、咁、冇、乜、嘢、嚟」的候選句，不把整支影片的所有字幕視為粵語逐字稿。此方法仍可能保留混合書面語或誤字，也會漏掉沒有特徵字的正確句子。未逐句聽音核對。新來源則只取原始 `caption`，限定核對過作者的料理／生活影片及飲食、交通、住宿相關短句；不用 `sensevoice_caption` 改寫字幕，也不要求每句一定有上述口語特徵字。

每支收錄影片均取得 YouTube oEmbed 回應，頻道歸屬和標題採其回傳資訊；這不等於已驗證每句字幕的發音、時間或各地播放權限。未來影片也可能下架。

原來源 `start` / `end` 直接取 `segments[].start_time/end_time`，新來源直接取數字欄位 `start/end`（來源文件明示為原始音訊秒數），不使用 `sensevoice_words` 的句內相對時間，為原片絕對秒數，不再加 `clip_start`。連結向下取整秒，從字幕句附近播放，不聲稱定位到單字。查詢先比對完整文字；未命中時可抽取重點詞搜尋相關字幕。相關例句標示非完整原句，不使用近義詞或自動翻譯改寫字幕。

## 常用詞命中率

在擴充前先固定 `cantonese-common-words.json` 的 100 個試查詞，同一套搜尋規則的**字幕字面命中**由 20/100 增至 68/100（上一輪為 67/100）。這不是發音準確率，也不代表任何輸入有 67% 機會命中。

| 類別 | 命中 |
|---|---:|
| 人物與位置 | 13/15 |
| 問句與常用說法 | 16/20 |
| 飲食與購物 | 10/20 |
| 日常與交通 | 7/15 |
| 感受與描述 | 12/15 |
| 時間與動作 | 10/15 |

逐詞結果、例句連結和 32 個未命中詞保存在 `cantonese-coverage.json`。下一輪優先補「唔該、返工、瞓覺、食嘢」等缺詞及飲食、交通題材。

重新量測：

```sh
node scripts/report-cantonese-coverage.js data/cantonese-coverage.json
```

這份清單是固定測試表，不會記錄使用者查詢，也沒有建立持久的使用紀錄儲存。

## 可重複的更新流程

`cantonese-sample-plan.json` 列出本輪實際對索引有貢獻的 37 份公開 API 回應、網址、資料集版本及當時回應 SHA-256。原始回應包含暫存音訊網址，未提交到專案；不下載音訊。來源 API 日後可能回傳不同版本，所以重新抓取後要重新審查，不能假定會得到完全相同的資料。

```sh
node scripts/fetch-cantonese-samples.js /tmp/cantonese-samples
node scripts/import-cantonese-examples.js /tmp/cantonese-samples/*.json
node scripts/report-cantonese-coverage.js data/cantonese-coverage.json
npm test
```

下載腳本逐一取得樣本，遇到 HTTP 錯誤（含 429）就停止，沒有自動重試；再次執行會跳過已存檔案。新頻道／影片先抽查字幕，再透過 YouTube oEmbed 核對歸屬，更新 `cantonese-video-sources.json` 的影片清單與檢查日期。匯入只接受清單內已檢查影片，拒絕頻道不符、錯誤時間、越界時間和重複句子；保留原字幕，不自動改寫。

匯入工具也接受檔名含清單中影片 ID 的 `.srt`（需自行先確認與原片時間相符）。本輪曾查看 CantoCaptions 的三部肥爸爸故事字幕，但對應 YouTube 資訊無法取得，因此沒有加入索引。

更新索引後檢查變更、重新量測，再部署。正式 webhook 仍只讀取本機索引，不連接資料庫、Hugging Face 或 YouTube 搜尋 API；點開影片由 YouTube 播放。

## 旅居學習清單

傳送 `旅居學習` 看八個分類，或 `旅居學習：點餐`、`旅居學習：問句與句型` 查看內容。`travel-learning.json` 收錄 85 個詞句與繁體中文解釋，包含問候、代名詞、問句、點餐、味道、購物、問路住宿及數字。教學句型是編寫的學習材料，不冒充影片原句。

清單逐個顯示「有影片例句」或「影片待補」，再直接傳送粵語詞句即可查看粵拼；提供合成語音（需啟用），找到完整或相關字幕時另附影片連結。`例句：` 前綴亦採相同流程。分類指令只回本機文字，不呼叫翻譯或 TTS。一般文字及翻譯功能維持原有用法。

旅居詞表目前 **50/85** 有字面命中，詳見 `travel-coverage.json`；這與固定 100 詞的通用測試表分開，沒有為提高舊分數而更換測試詞。整句必須完整命中才算，不以命中單字假裝找到完整句型。單字命中亦不代表已人工核對發音或影片情境。數字採字面搜尋，數字字元出現在較長數字裡也會命中。

新增片段取自新來源 train/test 的 `first-rows` 各 100 筆公開樣本，只留下指定生活／料理作者且含飲食交通住宿詞的短句，原片秒數直接保留。oEmbed 作者網址需與 `uploader_id` 一致才收錄。其他來源的十頁抽查未找到適合大量補點餐詞句的逐字字幕，未整批加入。

重新量測旅居清單：

```sh
node scripts/report-travel-coverage.js data/travel-coverage.json
```

更新索引後需同時重新生成兩份 coverage 報告，再執行測試。仍需優先補點餐整句（餐牌、堂食、外賣、唔要辣、埋單等）；未宣稱 85 個詞句都已有影片。


相關例句搜尋不改變上述兩份 coverage 指標：報告與學習清單仍使用 `findExamples` 的完整文字命中。實際聊天用 `searchExamples`：完整命中優先，找不到才取至少兩字元的重點詞搜尋，最多八個詞、三個結果。排除常見代名詞、功能詞和數量詞；保留命中重點詞數最高的候選，偏好不同影片。回覆顯示原字幕與實際命中詞，不能將相關片段當成整句的發音示範。
