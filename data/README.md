# 粵語影片例句索引

資料來源：[OrcinusOrca/YouTube-Cantonese](https://huggingface.co/datasets/OrcinusOrca/YouTube-Cantonese)。資料集自述為創作者上傳字幕，頁面標示 MIT；此標示不代表原 YouTube 影音權利轉移。本專案只保存候選字幕文字、標題、影片 ID 和原片時間，播放連回原 YouTube，不複製影音。

## 目前收錄與品質限制

2026-10-21 擴充至 **46 支影片、2,223 句候選字幕**：

| 頻道 | 影片 | 候選句 |
|---|---:|---:|
| Maviskuku 雞蛋妹 | 32 | 2,112 |
| Mill MILK | 6 | 10 |
| MPWeekly 明周 | 3 | 69 |
| 阿豬 Ah Ju | 2 | 9 |
| Sun Channel | 1 | 18 |
| Pinky Talks | 1 | 4 |
| mingjai14 | 1 | 1 |

新增題材含職場、人際關係、人物訪談及理財，但句數仍大多來自科技影片，飲食、交通、日常對話仍需繼續補充。目標約 50 支，本輪 50 支候選中有 4 支無法取得 YouTube oEmbed 資訊，因此不收錄；詳見 `cantonese-video-sources.json` 的排除清單。

這不是完整頻道資料庫，也不是人工核對過的逐字稿。來源多數字幕偏書面中文，因此只留下含「唔、佢、嘅、咗、喺、啲、哋、嗰、咁、冇、乜、嘢、嚟」的候選句，不把整支影片的所有字幕視為粵語逐字稿。此方法仍可能保留混合書面語或誤字，也會漏掉沒有特徵字的正確句子。未逐句聽音核對。

每支收錄影片均取得 YouTube oEmbed 回應，頻道歸屬和標題採其回傳資訊；這不等於已驗證每句字幕的發音、時間或各地播放權限。未來影片也可能下架。

`start` / `end` 直接取來源 `segments[].start_time/end_time`，為原片絕對秒數，不再加 `clip_start`。連結向下取整秒，從字幕句附近播放，不聲稱定位到單字。查詢只比對文字，未加入近義詞或自動翻譯匹配。

## 常用詞命中率

在擴充前先固定 `cantonese-common-words.json` 的 100 個試查詞，同一套搜尋規則的**字幕字面命中**由 20/100 增至 67/100。這不是發音準確率，也不代表任何輸入有 67% 機會命中。

| 類別 | 命中 |
|---|---:|
| 人物與位置 | 13/15 |
| 問句與常用說法 | 16/20 |
| 飲食與購物 | 9/20 |
| 日常與交通 | 7/15 |
| 感受與描述 | 12/15 |
| 時間與動作 | 10/15 |

逐詞結果、例句連結和 33 個未命中詞保存在 `cantonese-coverage.json`。下一輪優先補「唔該、返工、瞓覺、食嘢」等缺詞及飲食、交通題材。

重新量測：

```sh
node scripts/report-cantonese-coverage.js data/cantonese-coverage.json
```

這份清單是固定測試表，不會記錄使用者查詢，也沒有建立持久的使用紀錄儲存。

## 可重複的更新流程

`cantonese-sample-plan.json` 列出本輪實際對索引有貢獻的 35 份公開 API 回應、網址、資料集版本及當時回應 SHA-256。原始回應包含暫存音訊網址，未提交到專案；不下載音訊。來源 API 日後可能回傳不同版本，所以重新抓取後要重新審查，不能假定會得到完全相同的資料。

```sh
node scripts/fetch-cantonese-samples.js /tmp/cantonese-samples
node scripts/import-cantonese-examples.js /tmp/cantonese-samples/*.json
node scripts/report-cantonese-coverage.js data/cantonese-coverage.json
npm test
```

下載腳本逐一取得樣本，遇到 HTTP 錯誤（含 429）就停止，沒有自動重試；再次執行會跳過已存檔案。新頻道／影片先抽查字幕，再透過 YouTube oEmbed 核對歸屬，更新 `cantonese-video-sources.json` 的影片清單與檢查日期。匯入只接受清單內已檢查影片，拒絕頻道不符、錯誤時間、越界時間和重複句子；保留原字幕，不自動改寫。

匯入工具也接受檔名含清單中影片 ID 的 `.srt`（需自行先確認與原片時間相符）。本輪曾查看 CantoCaptions 的三部肥爸爸故事字幕，但對應 YouTube 資訊無法取得，因此沒有加入索引。

更新索引後檢查變更、重新量測，再部署。正式 webhook 仍只讀取本機索引，不連接資料庫、Hugging Face 或 YouTube 搜尋 API；點開影片由 YouTube 播放。
