# Trip Spend

離線記帳 PWA，為 Italy 2026-08-22 → 08-28 而做。

**https://dcwhung.github.io/trip-expense-tracker/**

Safari 開個網址 → 分享 → 加入主畫面。之後全螢幕、冇網址列、飛行模式一樣用得。

- 規格同決定紀錄：[`PLAN.md`](PLAN.md)
- 資料淨係存喺部電話（`localStorage`），冇雲端。**記得備份** —— 見 `PLAN.md` §4

## 開發

冇 build step、冇 dependency。改完 `index.html` / `app.js` / `styles.css` 就得。

改咗任何 cache 住嘅檔案，記住喺 `sw.js` 頂 bump 個 `CACHE` 版本號，否則舊版會繼續喺部電話度跑。

下次旅行：改 `app.js` 頂嗰個 `TRIP` 常數（日期、貨幣、符號），push，PWA 會自動攞新版，唔使重新安裝。

## 測試

```sh
node tests/logic.test.js                        # 純邏輯，唔使瀏覽器
npx http-server -p 8099 -c-1 .                  # 另一個 terminal
NODE_PATH=$(npm root -g) node tests/e2e.browser.js    # 匯出 / 還原 / 離線
NODE_PATH=$(npm root -g) node tests/smoke.browser.js  # 截圖 + 入數流程
```

`tools-mkicon.py` 重新生成 `icons/`（純 Python，唔使 PIL）。
