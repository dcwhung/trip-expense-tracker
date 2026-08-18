# Trip Spend — 規格與實施計劃

> 狀態：**規劃完成，等待開工確認**
> 平台：iPhone PWA（Safari → 加入主畫面）
> 網址：https://dcwhung.github.io/trip-expense-tracker/
> 本文件經 4 輪 grilling 定案，取代之前所有假設。

---

## 0. 決定紀錄摘要

| # | 決定 | 註 |
|---|---|---|
| 1 | 意大利 **2026-08-22 → 08-28**（7 日），日期硬編碼 | |
| 2 | 記錄用，**唔做 AA 結算** | `Account` 只係標籤 |
| 3 | 貨幣 **EUR 硬編碼**，唔換算 | 資料仍存 `currency` 欄位 |
| 4 | Export：**CSV + JSON + 純文字摘要** | |
| 5 | Host：**public repo + GitHub Pages**（已開啟）| 旅行後再試 Cloudflare Pages |
| 6 | 純 vanilla HTML/CSS/JS，**零 build step、零 dependency** | |
| 7 | 儲存：`localStorage`，金額用**整數分位** | |
| 8 | 日期跟**裝置本地時間** | 之後喺日本／香港用都啱 |
| 9 | 出發前已付嘅機票酒店 **唔入** app | |
| 10 | 換匯／增值（`Bank`）**唔入** app | 避免雙重計算 |
| 11 | **19/8 code freeze**，只修 showstopper | 見 §7 |

---

## 1. 資料模型

```js
{
  id: "uuid",
  schemaVersion: 1,
  tripId: "italy-2026-08",
  date: "2026-08-23",        // 裝置本地日曆日
  amountMinor: 1450,          // 整數（歐仙），避免浮點誤差
  currency: "EUR",            // 今次固定，將來多幣種靠佢
  account: "Donald",          // Donald | Kwan（sticky）
  payment: "Global Money",    // Global Money | Cash | Credit Card（sticky）
  category: "Food",
  description: "",            // optional — 現金交易即場打；刷卡可留空，事後由月結單補
  remarks: "",                // optional
  createdAt: "ISO8601",
  updatedAt: "ISO8601"
}
```

`schemaVersion` 同 `tripId` 今次用唔著，但將來做多 trip 版本靠佢哋 migrate 舊資料。而家加係免費，事後補係地獄。

### Category（六個，次序如下，3×2 grid）
`Transportation` · `Food` · `Household` · `Entertainment` · `Shopping` · `Kids`

**冇 `Other`、冇 `Accommodation`、冇 `Bank`** —— 已知並接受（見 §8）。

### Account（sticky toggle，預設 Donald）
`Donald` · `Kwan`

### Payment（sticky toggle，預設 Global Money）
`Global Money` · `Cash` · `Credit Card`

Sticky = 記住上次揀咗邊個。連續入十筆同樣付款方式 = 零額外撳掣。

---

## 2. 畫面

### 畫面 1 — 入數（開 app 預設）
由上至下：
1. **金額** — 大字，`inputmode="decimal"`，自動 focus 彈原生數字鍵盤
2. **Category** — 3×2 icon grid，一撳選中
3. **Account** — 兩格 toggle（sticky）
4. **Payment** — 三格 toggle（sticky）
5. **日期** — 預設今日，可改（方便第二朝補入琴晚嗰餐）
6. **Description** — optional，單行
7. **Remarks** — optional，多行
8. **儲存** — 有回饋，表單清空，準備入下一筆

目標：**入一筆 ≤ 8 秒、≤ 3 下撳**（金額 → category → 儲存）。

### 畫面 2 — 紀錄清單
- 頂部：全程總計 + 筆數 + 「第 N 日 / 共 7 日」
- 按日期由新到舊分組，每組標題 `Day 2 · 08-23 · €203.40`
- 撳一筆 → 編輯 / 刪除（刪除要二次確認）

### 畫面 3 — Export / 設定
- Export CSV · Export JSON · 複製純文字摘要
- Import JSON（還原）
- 顯示上次備份時間
- 清除所有資料（要打字確認）

---

## 3. Export 規格

### CSV
欄位（跟圖 1 風格，Payment 獨立成欄）：
```
Account,Date,Payment,Description,EUR,Category,Remarks
```
- **UTF-8 BOM** 開頭 → Excel / Numbers 開中文唔會亂碼
- 日期 **ISO `YYYY-MM-DD`** —— 唯一唔會被 locale 誤讀又排到序嘅格式
- Description / Remarks 空就空，方便返到嚟批量填

想砌返「`Donald - Global Money`」嗰種寫法，Excel 一條 `=A2&" - "&C2` 就得。

### JSON
完整備份，含 `schemaVersion`、`tripId`、全部 entries。可 import 還原。

### 純文字摘要
```
Trip Spend · Italy 2026-08-22 → 08-28
總計 €1,234.56 · 87 筆

Day 1 · 08-22 · €156.20
  Food €78.50 · Transportation €45.00 · Shopping €32.70
Day 2 · 08-23 · €203.40
  ...
```
每日小計 + 當日 category 細分，唔逐筆列。

### 交付方式（三層 fallback）
1. `navigator.share({ files })` —— iOS share sheet，存去 Files / email / WhatsApp。**主力**
2. `<a download>` + Blob URL
3. 全文入 `<textarea>` 俾你 select-all copy —— 永遠唔會 fail

---

## 4. 備份機制

資料 100% 淨係喺部電話嘅 `localStorage`，冇雲端。加咗上主畫面嘅 PWA 唔受 iOS 7 日清資料規則影響，但**手殘 delete 個 icon 或者 Safari「清除網站數據」= 全部消失，無得 recover**。

對策：
1. **本地時間 20:00 之後第一次開 app** → 清單頂出一條可撳走嘅橫額：「今日未備份 · 複製全部」。一日淨係出一次。
2. 撳落去 = 全部 JSON 入剪貼簿 → 貼落 Apple Notes / send 俾自己。全程約 10 秒。
3. Import JSON 還原。

**唔喺入數之後彈** —— 唔可以喺你思路最順嗰刻阻你。

---

## 5. 技術

```
/
├─ index.html        # 三個 view，CSS 切換
├─ app.js            # 資料層 + UI + export
├─ styles.css        # 手機優先、safe-area-inset、深色模式
├─ sw.js             # Service Worker，cache-first
├─ manifest.json     # display: standalone
└─ icons/            # 180 / 192 / 512 —— 深綠底、白色 "TS"
```

- 名稱：**Trip Spend**
- 部署：`main` branch `/ (root)` → GitHub Pages（已開啟）
- 開發喺 `claude/italy-trip-expense-tracker-6gscf5`，測試 OK 先 merge 落 `main`
  → `main` 永遠等於「部電話上面跑緊嗰個版本」

---

## 6. 驗收 Checklist（必須喺真部 iPhone 做）

- [ ] Safari 開網址 → 分享 → 加入主畫面 → 有 icon、全螢幕、冇網址列
- [ ] **開飛行模式** → 撳主畫面 icon → 正常開到、入到數
- [ ] 入 10 筆 → 強制關 app（上滑撤走）→ 重開 → 10 筆全在
- [ ] 部機熄機重開 → 資料仲在
- [ ] 金額 `0.01` / `1234.56` / `0` → 顯示正確，小計加得啱
- [ ] Description 同 Remarks 兩個都留空 → 儲存唔出錯
- [ ] Account / Payment sticky 生效：入第二筆自動沿用上一筆
- [ ] 中文 + emoji 打得入、顯示正常、export 冇亂碼
- [ ] CSV → share sheet 彈到 → 存去 Files → Numbers 開到，中文正常，日期認得係日期
- [ ] **JSON export → 清除全部資料 → import 返 → 100% 還原**（唔可以「睇落應該得」）
- [ ] 純文字摘要 copy 到，貼落 Notes 格式正常
- [ ] 刪除一筆 → 小計同總計即時更新
- [ ] 改日期 → 跳去正確嗰日嘅分組
- [ ] 20:00 之後開 app → 橫額出現；撳走 → 當日唔再出
- [ ] 直度 / 橫度 都唔爛版；深色模式睇得清
- [ ] 連續入 20 筆計時 → 平均 ≤ 8 秒／筆

---

## 7. 時間表

| 日期 | 內容 |
|---|---|
| **8/18（今日）** | 全部開發完成 + 部署上 Pages |
| **8/19** | 你真機試用 → 我修最後一輪 → **夜晚 code freeze** |
| **8/20 – 8/21** | **凍結。** 只修 showstopper：①入唔到數 ②資料會唔見 ③export 出唔到。其餘（樣衰、字細、動畫窒）一律唔郁 |
| **8/22** | 出發 🇮🇹 |
| **8/28** | 回程。Export CSV，貼落你張表 |

---

## 8. 已知並接受嘅取捨

1. **冇 `Other` category** —— city tax、行李寄存、廁所費、SIM 卡呢類嘢要硬塞入六格之一
2. **冇 `Accommodation` category** —— 現場找數嘅住宿費要塞入其他格
3. **資料淨係喺一部電話** —— 冇雲端備份，靠 §4 嘅手動流程
4. **19/8 起硬凍結** —— 之後發現嘅非 showstopper 問題，帶住去旅行
5. **EUR 硬編碼** —— 下次去日本／香港要改常數再 push（PWA 會自動更新，唔使重裝）

---

## 9. Plan B（app 喺羅馬壞咗）

1. 強制關 app 再開
2. 唔得就用 Safari 直接開網址（同一個 storage，資料仲在），即刻 export 走
3. 最壞：Apple Notes 逐筆打，返嚟再整理
