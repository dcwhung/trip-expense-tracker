# Italy Trip Expense Tracker — 可行性研究 + 實施計劃

> 狀態：規劃確認中
> 目標平台：iPhone (iOS Safari, PWA — 加去主畫面)
> Deadline：出發前（一星期內）

---

## 1. 可行性結論

**可行，屬細型 project。** 唔需要 App Store、唔需要 Apple Developer 帳號（$99/年）、唔需要後端伺服器、成本 HK$0。

做法係一個 **PWA（Progressive Web App）**：一個靜態網頁 app，用 Safari 開一次，撳「加入主畫面」，之後就有 icon、全螢幕、冇網址列，用落同 native app 冇分別。

| 需求 | 可行 | 實現方式 |
|---|---|---|
| iPhone 上似 app | ✅ | `manifest.json` + Add to Home Screen（standalone display mode）|
| 意大利冇網絡都用到 | ✅ | Service Worker 全部 cache，執行時零網絡請求 |
| 逐日記支出 | ✅ | `localStorage` 存 JSON |
| Category + description + remarks | ✅ | 純表單 |
| 旅行完 export | ✅ | Web Share API（叫出 iOS share sheet）+ download fallback |
| Host | ✅ | GitHub Pages（免費、自帶 HTTPS，PWA 必須 HTTPS）|

---

## 2. 已確認嘅範圍決定

| 項目 | 決定 |
|---|---|
| 使用者 | **淨係自己一個**，唔做分帳 |
| 貨幣 | **淨係歐元 (EUR)，唔做匯率換算** |
| Export 格式 | **CSV（UTF-8 BOM）+ JSON 完整備份 + 純文字每日摘要**，三樣都要 |
| 時間 | 一星期內出發 |

### 明確 Non-goals（今次唔做）
- ❌ AA 分帳 / 多人結算
- ❌ 匯率換算、多幣種
- ❌ 收據影相（會食爆 storage，令 export 複雜化）
- ❌ 雲端同步 / 帳號登入 / 多裝置
- ❌ 預算上限提示
- ❌ PDF 報表

呢啲全部係「旅行後想繼續用先加」嘅嘢，唔好喺出發前趕。

---

## 3. 最大風險同對策

### 🔴 R1 — 資料流失（唯一真正嚴重嘅風險）
資料 100% 存喺你部電話本機，冇雲端備份。

- iOS 有 ITP，7 日冇用會清網站資料。**但加咗上主畫面嘅 PWA 係豁免嘅**，你日日用，正常情況安全。
- 真正殺手：手殘 delete 咗個主畫面 icon、或者 Safari「清除網站數據」→ 全部支出消失，無得 recover。

**對策（必做，非 nice-to-have）：**
1. 上次 export 超過 24 小時 → 首頁頂出橫額提醒備份。
2. 「一撳複製全部 JSON」按鈕 → 貼落 Apple Notes / send 俾自己 email 就係一個備份。
3. 支援 JSON import 還原。

### 🟠 R2 — iOS standalone 模式嘅 download 行為
PWA 全螢幕模式下 `<a download>` 歷史上會失敗或者亂開新視窗。**唔可以淨靠佢。**

**對策：三層 fallback**
1. `navigator.share({ files: [...] })` — iOS 15+ 支援，叫出 share sheet，可以存去 Files、email、WhatsApp。**主力方案。**
2. `<a download>` + Blob URL。
3. 全文顯示喺 `<textarea>` 俾你 select-all copy。永遠唔會 fail。

### 🟠 R3 — 入一筆太慢就會放棄用
記帳 app 死因九成係「入一筆要 30 秒」。

**對策：目標「入一筆 ≤ 8 秒、≤ 3 下撳」**
- 開 app 直接就係入數畫面，金額欄自動 focus 彈數字鍵盤
- Category 係大 icon grid，一撳即中（唔用下拉選單）
- description / remarks **兩個都 optional**，唔填照樣可以儲存

### 🟡 R4 — 日期界線
意大利同香港差 6–7 個鐘。凌晨食完宵夜嗰筆算邊日？

**對策：** 用裝置本地時間（即意大利時間）嘅日曆日。日期欄預設今日但**可以改**，方便第二朝先補入琴晚嗰餐。

### 🟡 R5 — 出發前先發現 app 壞咗
**對策：** 出發前 48 小時做完整 device test（見第 7 節 checklist），之後 code freeze，唔好再改。

---

## 4. 技術方案

**刻意選擇：零 build step、零 dependency、純 vanilla HTML/CSS/JS。**

理由：一星期 deadline 下，多一層 build（Vite / React / npm）就多一層可以喺出發前一晚爆嘅嘢。呢個 app 嘅複雜度完全唔需要框架。

```
/
├─ index.html        # 全部 UI（三個 view，用 CSS 切換）
├─ app.js            # 資料層 + UI 邏輯 + export
├─ styles.css        # 手機優先，safe-area-inset，深色模式
├─ sw.js             # Service Worker，cache-first
├─ manifest.json     # PWA manifest，display: standalone
└─ icons/            # 180×180 apple-touch-icon, 192/512 PNG
```

- **儲存**：`localStorage`（5MB，足夠幾千筆純文字紀錄）。唔用 IndexedDB，因為冇影相就冇必要複雜化。
- **金額**：內部用**整數「仙」(cents)** 儲存，避免浮點數 `0.1 + 0.2` 問題。顯示時先除 100。
- **Host**：GitHub Pages。

### 資料模型
```js
{
  id: "uuid",
  date: "2026-08-25",      // 本地日曆日 YYYY-MM-DD
  amountCents: 1450,       // 整數，EUR
  category: "food",
  description: "",         // optional
  remarks: "",             // optional
  createdAt: "ISO8601",
  updatedAt: "ISO8601"
}
```

### 預設 Category（可改，講聲就得）
🍝 食 · 🏨 住 · 🚆 交通 · 🎟️ 景點門票 · 🛍️ 購物 · 💶 其他

---

## 5. 功能規格

### 畫面 1 — 入數（開 app 預設）
- 大金額輸入（`inputmode="decimal"`，自動 focus）
- Category icon grid（6 格，一撳選中）
- 日期（預設今日，可改）
- Description（optional，單行）
- Remarks（optional，多行）
- 儲存 → 有觸覺/視覺回饋 → 表單清空，準備入下一筆

### 畫面 2 — 紀錄清單
- 按日期由新到舊分組，每組有當日小計
- 頂部：全程總計 + 已記錄日數
- 撳一筆 → 編輯 / 刪除（刪除要二次確認）

### 畫面 3 — Export / 設定
- Export CSV（UTF-8 BOM，Excel / Numbers 開唔會亂碼）
- Export JSON（完整備份）
- 複製純文字摘要（每日總結，可直接貼落 WhatsApp / email）
- Import JSON（還原）
- 顯示上次備份時間
- 清除所有資料（要打字確認）

---

## 6. 時間表（出發前一星期）

| 日 | 工作 | 產出 |
|---|---|---|
| D1 | Scaffold + 資料層 + 入數畫面 | 入到數，reload 後仲喺度 |
| D2 | 清單畫面 + 每日小計 + 編輯/刪除 | 核心功能齊 |
| D3 | 三種 export + import + 備份提醒 | 資料攞得出、還原得返 |
| D4 | PWA（manifest / SW / icons）+ deploy 上 GitHub Pages | 真機加到上主畫面 |
| D5 | **真機測試**（見第 7 節）+ 執 bug | 飛行模式下用得正常 |
| D6 | UI 打磨、字體大細、深色模式 | 用落舒服 |
| D7 | **Buffer / code freeze** | 唔再改嘢 |

如果時間再緊：D1–D3 已經係可用嘅 MVP，D4 係「似 app」嘅關鍵，**D5 絕對唔可以省**。

---

## 7. 出發前驗收 Checklist（最重要嗰部分）

要喺**真部 iPhone** 上做，唔可以淨係喺電腦 Chrome 度撳兩下就當 pass。

- [ ] Safari 開網址 → 分享 → 加入主畫面 → 有 icon、有名、全螢幕冇網址列
- [ ] **開飛行模式**，撳主畫面 icon → app 正常開到，入到數
- [ ] 入 10 筆數 → 強制關 app（上滑撤走）→ 重開 → 10 筆全部仲喺度
- [ ] 部機熄機重開 → 資料仲喺度
- [ ] 金額入 `0.01`、`1234.56`、`0` → 顯示正確，小計加得啱
- [ ] Description 同 remarks 留空 → 儲存唔會出錯
- [ ] 中文 + emoji 打得入、顯示正常、export 出嚟冇亂碼
- [ ] Export CSV → share sheet 彈到出 → 存去 Files → 用 Numbers 開到，中文正常
- [ ] Export JSON → 清除全部資料 → import 返 → 資料 100% 還原
- [ ] 純文字摘要 copy 得到，貼落 Notes 格式正常
- [ ] 刪除一筆 → 小計同總計即時更新
- [ ] 改日期 → 該筆跳去正確嗰日嘅分組
- [ ] 直度 / 橫度 都用得（起碼唔會爛版）
- [ ] 深色模式睇得清
- [ ] 連續入 20 筆，計時：平均每筆 ≤ 8 秒

---

## 8. 待確認（我已選咗預設，你唔出聲就照做）

1. **Category 清單** — 預設六個（食/住/交通/景點/購物/其他）夠唔夠？要唔要自訂？
2. **付款方式欄位（現金 / 信用卡）** — 加一個 toggle 成本好低，對事後對信用卡帳單好有用。**預設唔做**（範圍紀律），你話要就加。
3. **App 名同 icon** — 預設叫「Italy 2026」，icon 用簡單文字 + 顏色。
4. **Repo 公開定私人** — GitHub Pages 免費版要 public repo。你嘅支出資料**唔會**入 repo（只存喺電話），但條網址任何人開到（開到嘅係空白 app，唔係你嘅資料）。可接受嘅話最簡單。

---

## 9. Plan B（如果 app 喺羅馬中途壞咗）

1. 先試強制關 app 再開。
2. 唔得就用 Safari 直接開個網址（同一個 storage，資料仲喺度），即刻 export 走。
3. 最壞情況：用 Apple Notes 逐筆打，返嚟先整理。**所以每日 export 一次備份係救命嘅。**
