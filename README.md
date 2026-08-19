# Trip Spend

離線記帳 PWA。旅行日期、account 名喺 app 入面嘅 Settings 設定；UI 全英文。

**https://dcwhung.github.io/trip-expense-tracker/**

Safari 開個網址 → 分享 → 加入主畫面。之後全螢幕、冇網址列、飛行模式一樣用得。

- 規格同決定紀錄：[`PLAN.md`](PLAN.md)
- 資料淨係存喺部電話（`localStorage`），冇雲端。**記得備份** —— 見 `PLAN.md` §4

## 開發

冇 build step、冇 dependency。改完 `index.html` / `app.js` / `styles.css` 就得。

改咗任何 cache 住嘅檔案，記住喺 `sw.js` 頂 bump 個 `CACHE` 版本號，否則舊版會繼續喺部電話度跑。

下次旅行：喺 app 嘅 Settings 改日期就得。換貨幣先要改 `app.js` 頂嗰個 `CURRENCY` 常數再 push——PWA 會自動攞新版，唔使重新安裝。

## Demo 版

**https://dcwhung.github.io/trip-expense-tracker/demo/**

同真app一模一樣，但入面係一個假嘅 7 日意大利 trip（兩個 account、16 筆支出、3 次 top up），可以攞去 show 唔使碰真數據。每一版嘅標題旁邊有個 `DEMO` 章。

日期係開嗰陣先計出嚟——trip 永遠係「第 3 日（共 7 日）」，所以幾時 show 都唔會過期。

兩邊同一個 origin，所以有兩件事係特登處理咗：

- demo 嘅 `localStorage` key 全部加咗 `tripspend.demo.` 前綴，睇唔到亦寫唔到真數據
- demo **完全冇註冊 service worker**。真app個 worker 一 activate 就會刪走所有唔屬於佢嘅 cache，所以多開一個 worker 會反而整到真app冇咗離線功能

Demo 玩完之後想 reset 返做原本嘅假數據，開 `demo/?reseed` 就得。

`demo/` 係生成出嚟嘅，唔好直接改：

```sh
python3 tools/make-demo.py      # 真app改完之後重新生成
```

## 測試

```sh
node tests/logic.test.js                        # 純邏輯，唔使瀏覽器
npx http-server -p 8099 -c-1 .                  # 另一個 terminal
NODE_PATH=$(npm root -g) node tests/e2e.browser.js    # 匯出 / 還原 / 離線
NODE_PATH=$(npm root -g) node tests/smoke.browser.js  # 截圖 + 入數流程
NODE_PATH=$(npm root -g) node tests/demo.browser.js   # demo 唔會撈亂真數據
```

`tools-mkicon.py` 重新生成 `icons/`（純 Python，唔使 PIL）。
