# Trip Spend — 規格與實施計劃

> 平台：iPhone PWA（Safari → 加入主畫面）
> 網址：https://dcwhung.github.io/trip-expense-tracker/
> UI 語言：**全英文**
> 本文件經 4 輪 grilling 定案，之後按實際使用再修訂。

---

## 0. 決定紀錄

| # | 決定 | 註 |
|---|---|---|
| 1 | 旅行日期**由 Settings 設定**，唔再硬編碼 | 有 range validation + 自動計日數 |
| 2 | **未設定日期就入唔到數**，會出 alert + 阻擋畫面 | |
| 3 | 記錄用，**唔做 AA 結算** | `Account` 只係標籤 |
| 4 | Budget **完全由 Top up 產生** —— 第一次 top up 就係 initial budget | Settings 冇 budget 欄 |
| 5 | **Top up 唔係支出** —— 唔入 CSV、唔計入總支出 | 只影響 budget 餘額 |
| 6 | 貨幣 **EUR 硬編碼**，唔換算 | 資料仍存 `currency` 欄位 |
| 7 | Export：**CSV + JSON + 純文字摘要** | |
| 8 | Host：public repo + GitHub Pages | |
| 9 | 純 vanilla HTML/CSS/JS，**零 build step、零 dependency** | |
| 10 | 儲存：`localStorage`，金額用**整數分位** | |
| 11 | 日期跟**裝置本地時間** | 之後喺日本／香港用都啱 |
| 12 | 日期**唔受旅程範圍綁死** —— 出發前嘅 booking、departure 前嘅 top up 都入得 | 用 `Today` 掣 |
| 13 | 換匯／增值 **唔當支出** | 用 Top up 處理 |

---

## 1. 資料模型

### Settings — `tripspend.settings.v1`
```js
{
  tripStart: "2026-08-22",   // 空 = 未設定，入數版會被鎖
  tripEnd:   "2026-08-28",
  accounts:  ["Donald", "Kwan"]   // 固定兩個，可改名
}
```

### Expense — `tripspend.entries.v1`
```js
{
  id, schemaVersion: 2,
  date: "2026-08-24",        // 一定係 trip range 入面（由 date strip 揀）
  amountMinor: 1450,          // 整數（歐仙），避免浮點誤差
  currency: "EUR",
  account: "Donald",          // sticky
  payment: "Global Money",    // sticky
  category: "Food",
  description: "",            // optional — 現金即場打；刷卡可留空，事後由月結單補
  remarks: "",                // optional
  createdAt, updatedAt
}
```

### Top-up — `tripspend.topups.v1`
```js
{ id, schemaVersion: 2, date, amountMinor, currency, account, createdAt }
```
**唔係支出。** 唔入 CSV、唔計入總支出，只加落該 account 嘅 budget。

### Category（六個，3×2 grid）
`Transportation` · `Food` · `Household` · `Entertainment` · `Shopping` · `Kids`
冇 `Other`、冇 `Accommodation`、冇 `Bank` —— 已知並接受（見 §8）。

### Payment（sticky，預設 Global Money）
`Global Money` · `Cash` · `Credit Card`

---

## 2. 畫面

### Expense（入數）
1. **Date** — 橫向可 scroll 嘅日期掣，最前係 **Today**，之後按 trip range 每日一格，label 係 `24/8`
   - `Today` **永遠揀得**，即使今日喺旅程之外 —— 出發前嘅 booking expense 同 top up 都要入得
   - **預設揀今日**；今日唔喺 range 就唔預揀（要你主動撳）
   - 標題右邊：範圍內顯示 `Day 3`，**範圍外顯示實際日期**（例如 `18/8`）；未揀就唔顯示
   - 儲存一筆之後**留喺同一日**，方便連續入
2. **Category** — 3×2 icon grid，下面加一格**全闊虛線嘅 `Top Up`**
3. **Amount** — `inputmode="decimal"`，逐個 keystroke 過濾，**最多兩位小數**
4. **Payment**（sticky） 5. **Account**（sticky）
6. **Description**（optional） 7. **Remarks**（optional）
8. **Save** — 固定喺底部，跟住鍵盤浮上去

**Top up 冇獨立 modal** —— 撳 `Top Up` 就係切換同一個表單嘅模式：
- 收起 Payment / Description / Remarks
- 淨低 Date / Amount / Account
- 掣由 `Save` 變 `Confirm`
- 確認完自動彈返做 expense 模式，留喺同一日
- **改緊一筆 expense 時，`Top Up` 格會隱藏** —— 一筆支出唔應該變成 top-up
- **改緊一筆 top-up 時，成個 Category 區隱藏** —— top-up 冇 category，中途轉類型即係另一筆紀錄
- 共用同一條 date strip，所以 top-up 一樣可以用 `Today` 記喺出發前

**未設定 trip dates**：整個表單隱藏，出阻擋畫面 + `alert()`，有掣直接去 Settings。

### Records
- 頂部：總支出 + **仲剩幾多錢**（`€414.00 left`，= 全部 top up − 全部支出）+ `22/8 → 28/8 · 7 days · Day 3 of 7`。**唔再顯示筆數**
- **Budget left** — 每個 account 一張卡：餘額大字，下面兩行 `Topped up: €500.00` / `Spent: -€86.00`（英文字前、數字後；Spent 帶負號兼紅色）
  - **少過 €100 → 紅色**；**≥ €100 或者未扣過數 → 綠色**
- **Top-ups** — 區標題右邊有**總數**：`+€500.00`、綠色。逐筆嘅金額**唔加正號、用一般字色**。撳一下開返表單改（金額 / 日期 / account），有 Update / Delete / Cancel，同 expense 一致
- **Expenses** — 按日期由新到舊分組，每組 `Day N · 日期 · 小計`；撳一筆去編輯／刪除
  - 逐筆金額**唔加負號、用一般字色**；**每日小計先加負號兼用紅色**（`-€48.00`）。最頂綠卡嘅總支出保持正數
  - 主行顯示 **Description 或 Remarks**，兩樣都有就用 ` | ` 分隔
  - **兩樣都冇就唔顯示任何 placeholder** —— `Category · Account · Payment` 直接升做主行

### Export
CSV · JSON · 純文字摘要 · Import JSON · 上次備份時間 · 清除所有資料

### Settings
保留 card title（`Trip dates` / `Accounts`）作分區，但**冇欄位 label**，一律用 placeholder；`<input type="date">` 唔支援 placeholder，所以用 `start → end` 同一行 + 落面條狀態行表達。

- **Trip dates** — start / end 同一行，即時驗證同顯示日數
- **Accounts** — 兩個名（placeholder `Account 1` / `Account 2`），改名會**同步更新所有現有紀錄同 top-up**
- **一個 Save 掣**存晒全部。錯誤已經 inline 即時顯示，所以按 Save 唔會再彈同一句 toast —— 有錯就靜靜哋唔存

---

## 3. Export 規格

### CSV
```
Account,Date,Payment,Description,EUR,Category,Remarks
```
UTF-8 BOM、日期 ISO `YYYY-MM-DD`、金額冇千位分隔。**Top-up 唔會出現。**

### JSON
`schemaVersion: 2`，包含 `settings`、`entries`、`topups`。可 import 還原（連 settings 一齊）。

### 純文字摘要
每日小計 + 當日 category 細分；如果有 top up，最後加 Budget left 一段。

### 交付方式（三層 fallback）
1. `navigator.share({ files })` → 2. `<a download>` → 3. 全文入 textarea 俾你 copy

---

## 4. 備份機制

資料 100% 淨係喺部電話。加咗上主畫面嘅 PWA 唔受 iOS 7 日清資料規則影響，但**delete 個 icon 或者 Safari「清除網站數據」= 全部消失**。

1. **本地時間 20:00 之後第一次開 app** → 頂部橫額，一日一次，撳走即收
2. 撳落去 = 全部 JSON 入剪貼簿 → 貼落 Apple Notes
3. Import JSON 還原

---

## 5. 技術

```
index.html · app.js · styles.css · sw.js · manifest.json · icons/ · .nojekyll
```
- 部署：`main` branch `/ (root)` → GitHub Pages
- 開發喺 `claude/italy-trip-expense-tracker-6gscf5`，測試 OK 先 merge 落 `main`
- **改咗任何 cache 住嘅檔案，一定要 bump `sw.js` 頂嘅 `CACHE` 版本號**
- 下次旅行：Settings 改日期就得；換貨幣先要改 `app.js` 嘅 `CURRENCY` 常數

---

## 6. 驗收 Checklist（必須喺真部 iPhone 做）

**基本**
- [ ] 加入主畫面 → 有 icon、全螢幕、冇網址列
- [ ] **開飛行模式** → 撳 icon → 正常開到、入到數
- [ ] 入 10 筆 → 強制關 app → 重開 → 10 筆全在
- [ ] 部機熄機重開 → 資料仲在

**Settings**
- [ ] 未設定日期時，撳 Add → 出 alert + 入唔到數
- [ ] End date 早過 start date → 有錯誤訊息，儲存唔到
- [ ] 設定 22/8–28/8 → 顯示 `7 days`
- [ ] 改 account 名 → 舊紀錄同 top-up 都跟住改

**入數**
- [ ] Date strip 有 `Today` + 7 個日子掣，scroll 得，揀咗顯示 `Day N`
- [ ] 開 app 預設揀咗今日（今日喺 range 內）；撳 `Today` 跳返今日
- [ ] **出發前**（今日喺 range 外）撳 `Today` → 揀得到，badge 顯示日期而唔係 `Day N`
- [ ] 出發前入一筆 booking expense 同一筆 top up → 兩樣都入得，清單度嗰日冇 `Day` 標籤
- [ ] 撳 `Top Up` → Payment / Description / Remarks 消失，掣變 `Confirm`；確認後彈返正常模式
- [ ] 儲存後留喺同一日
- [ ] 撳金額 → 鍵盤彈出 → **「Save」掣仍然睇到同撳到**
- [ ] 金額打 `12.345` → 自動變 `12.34`
- [ ] Account / Payment sticky 生效
- [ ] Description 同 Remarks 兩個都留空 → 儲存唔出錯

**Budget**
- [ ] Top up €500 → Records 見到 €500 減去已使
- [ ] 用到剩低過 €100 → 卡變紅
- [ ] Summary 顯示 `€X left` 而唔係筆數，數目啱
- [ ] Budget card 個 `Spent:` 有負號兼紅色
- [ ] Top-ups 區標題右邊個總數啱數
- [ ] Expense 逐筆冇符號；每日小計有負號兼紅色
- [ ] Top-up 逐筆冇符號兼一般字色；區標題總數有加號兼綠色
- [ ] 淨有 Description、淨有 Remarks、兩樣都有（`A | B`）、兩樣都冇（唔出 placeholder）四種情況都顯示得啱
- [ ] Top-up 撳一下入到編輯，改金額後餘額跟住郁，唔會多咗一筆
- [ ] 喺編輯畫面撳 Delete 刪得返 top-up
- [ ] 改緊 expense 時 `Top Up` 格唔見；改緊 top-up 時成個 Category 區唔見
- [ ] Top up **唔會**出現喺總支出同 CSV

**Export / 還原**
- [ ] CSV → share sheet → 存去 Files → Numbers 開到，日期認得係日期
- [ ] **JSON export → 清除全部 → import 返 → 紀錄、top-up、settings 全部返晒嚟**
- [ ] 純文字摘要 copy 到
- [ ] 20:00 之後開 app → 橫額出現；撳走 → 當日唔再出

---

## 7. 已知並接受嘅取捨

1. **冇 `Other` category** —— city tax、行李寄存、SIM 卡呢類要硬塞入六格之一
   （旅程範圍外嘅紀錄照樣入得，只係喺清單度冇 `Day N` 標籤）
2. **冇 `Accommodation` category**
3. **固定兩個 account** —— 加減 account 要改 code
4. **資料淨係喺一部電話** —— 冇雲端備份，靠 §4 嘅手動流程
5. **EUR 硬編碼** —— 換貨幣要改常數再 push（PWA 會自動更新，唔使重裝）
6. **Top-up 冇 remarks** —— 淨係 account / 金額 / 日期

---

## 8. 測試

```sh
node tests/logic.test.js                              # 純邏輯
npx http-server -p 8099 -c-1 .                        # 另一個 terminal
NODE_PATH=$(npm root -g) node tests/e2e.browser.js    # 完整流程
NODE_PATH=$(npm root -g) node tests/smoke.browser.js  # 截圖
```

---

## 9. Plan B（app 喺羅馬壞咗）

1. 強制關 app 再開
2. 唔得就用 Safari 直接開網址（同一個 storage，資料仲在），即刻 export 走
3. 最壞：Apple Notes 逐筆打，返嚟再整理
