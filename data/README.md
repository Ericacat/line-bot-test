# 粵語影片例句試用索引

來源：https://huggingface.co/datasets/OrcinusOrca/YouTube-Cantonese

設定 `maviskuku`，頻道 Maviskuku 雞蛋妹。來源資料集自述為創作者上傳字幕，資料集頁面標示 MIT；此標示不代表原 YouTube 影音權利轉移。本專案只保存候選字幕文字、標題、影片 ID 和原片時間，播放連回原 YouTube，不複製影音。

## 抽樣與限制

2026-10-21 取得 Hugging Face Dataset Viewer 的 `first-rows`，以及 `rows` 的 offset 100、500、1500、3000（每頁 length 100）。以包含粵語口語字的句子作候選篩選，去重後留下 5 支影片、178 句。這是試用樣本，不是全頻道索引，也不是已人工審核的逐字稿。

同時抽查 Mill MILK、毛記、明仔等來源，樣本大多偏書面中文，因此第一版不匯入。口語字篩選仍可能保留混合書面語、誤字，也會漏掉沒有特徵字的正確粵語句子。尚未逐句聽音核對，尚未驗證句內每個詞的發音和時間。五支影片的 YouTube oEmbed 於整理時均回傳 200 且作者名稱相符；不保證所有地區、未來時間仍可播放。

`start` / `end` 直接取來源 `segments[].start_time/end_time`，是原 YouTube 影片的絕對秒數，不再加 `clip_start`。連結向下取整秒，從字幕句開頭附近播放，不聲稱精確定位到單字。

## 更新索引

將上述 API 的 JSON 回應保存在本機，再執行：

```sh
node scripts/import-cantonese-examples.js sample1.json sample2.json
```

腳本只讀取提供的本機檔案，產生 `data/cantonese-examples.json`；執行後需檢查差異並更新這份抽樣說明。正式 webhook 不會下載資料集、音檔或即時呼叫外部搜尋。
