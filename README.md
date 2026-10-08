# 620 路線工作室

TWB 2026 四極點620 的繁體中文路線編輯器。可編輯路線、管理補給及檢錄點、匯入 Garmin 檔案、匯出 Edge 課程，並保存不同版本。

## 使用方式

1. 開啟頁面即載入官方公告嵌入的 Strava 基準軌跡，以及起終點和六個檢錄點。
2. 「編輯路線」：放大至白色節點出現，拖曳節點、點擊插入、右鍵刪除。「延伸路線」依點擊順序增加末端。編輯以直線連接，沒有道路自動貼齊或自動轉彎指示。
3. 「加入點位」：點擊地圖設定名稱、類型、座標與備註；此模式也能拖曳既有點位。點選站點查看公告里程、目前軌跡最近里程、距軌跡距離與關門時間。
4. 「復原／重做」可回復最近 35 次修改；快捷鍵 Ctrl/Cmd+Z、Shift+Ctrl/Cmd+Z。
5. 「儲存版本」會建立不可覆寫的新版本，雲端保存完整路線及點位；「版本紀錄」可載入、比較里程，再編輯成分支。頁面列出最近 100 個版本。重新開頁預設顯示官方基準，可從版本紀錄載入保存內容。
6. 「匯入軌跡」支援 GPX、TCX、FIT 或本程式 JSON 備份。GPX／TCX／FIT 匯入後成為橘色的目前編輯路線，原路線與沿途點位保留，原軌跡以不同顏色虛線疊圖。地圖圖例列出各路線名稱及長度，可移除參考路線並用復原返回；最多保留 8 條參考路線。JSON 匯入會還原備份中的完整圖層。Garmin 騎乘紀錄只匯入 GPS 幾何及可用高度，不保存感測資料。
7. 點數過多時使用路線概覽的「簡化軌跡」，可設定 1–50m 水平容差，預覽點數後套用，並可復原。

未儲存的編輯只存在目前頁面；離開時會提醒。可用「完整編輯備份」下載 JSON 保留完整點位資訊。

沿途點位依目前編輯軌跡的最近里程由小到大排列，公告里程另行標示。雲端版本與 JSON 備份包含參考路線；Garmin 匯出、高度圖和側欄里程以橘色路線為準。「全線」會涵蓋所有路線，即使原路線與匯入路線重疊，寬虛線仍可與橘色實線區分。

## Google Maps

使用右上角「地圖設定」輸入啟用 **Maps JavaScript API** 的 Google Cloud 瀏覽器金鑰；依 Google 要求設定專案計費和網站 HTTP referrer 限制。設定面板顯示目前網站應允許的來源。

金鑰只存於本機瀏覽器的 localStorage，不上傳至版本資料庫或 GitHub。瀏覽器金鑰本來就會送往 Google，務必設網站與 API 限制。尚無金鑰時使用標示清楚的 OpenStreetMap 備用底圖。清除或變更已載入的 Google 金鑰會重新整理頁面，請先儲存版本。

## 匯出到 Garmin Edge

「匯出 Garmin」提供 FIT 課程、TCX、GPX 及完整 JSON 備份。

- 建議使用 FIT 或 TCX 保留課程點。下載後開啟 Garmin Connect 網頁的「訓練與規劃 → 路線」，選擇匯入，再「傳送至裝置」並同步 Edge。
- 支援 USB 檔案傳輸的 Edge 可將 FIT 放入 `Garmin/NewFiles`，安全退出後重新啟動，實際步驟依機型。
- GPX 包含軌跡與獨立 waypoint；不同 Garmin 匯入流程可能不顯示 waypoint。Connect 也可能重算或忽略 FIT/TCX 課程點，請在 Edge 檢查。
- FIT/TCX 的時間為 25km/h 推算的課程時間，非實際活動紀錄；沒有自動產生轉彎提示。含斷開軌跡的路線請用 GPX；FIT 匯出會拒絕跨空隙連線。

已通過官方 FIT SDK 解碼、CRC 與檔案往返測試，尚未以實體 Edge 驗證。

## 路線來源

研究日期 2026-10-08。活動名稱是 620km，官方站點表終點是 615km，而目前嵌入軌跡依座標計算約 602.50km。路線仍為暫定；程式顯示實際計算值。檢錄點座標來源與精確度逐點標示，未確認的感應門不假稱已實測。

詳細公告連結、座標依據、關門時間及資料轉換見 [SOURCES.md](SOURCES.md)。

## 本機開發

需要 Node.js 22.13+（建議 24）與 npm。

```sh
npm ci
npm run build
# 首次建立本機 D1 資料表：
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_optimal_black_tom.sql
npm run dev
```

開啟 `http://127.0.0.1:5173/`。開發模式在 loopback 模擬登入；資料保存在忽略追蹤的 `.wrangler/state`。上線使用 Sites 的登入身分和 D1 儲存，每個使用者只讀寫自己的版本。

```sh
npm run lint:app
npm run typecheck
npm test
npm run build
```

React 19、Vinext／Vite、Leaflet、Google Maps JavaScript API、Garmin FIT SDK、Cloudflare D1／Drizzle。`lib/route.ts` 管理幾何與點位，`lib/files.ts` 處理 Garmin 檔案，`app/api/versions/route.ts` 管理登入後的雲端版本。

每次匯入上限 30MB、50,000 軌跡點、500 點位；雲端單版 JSON 上限 1.8MB。大量軌跡先用「簡化軌跡」；保留未簡化 GPX 或 JSON 做外部備份。金鑰、資料庫、個人路線版本與開發快取不會提交 GitHub，GitHub 同步的是程式和公開基準資料。

GitHub Actions 執行應用 lint、TypeScript、檔案測試與正式建置。Sites 部署使用 `.openai/hosting.json` 的既有站台與 D1 綁定；migration 位於 `drizzle/`，不應以空白資料表覆蓋生產資料。
