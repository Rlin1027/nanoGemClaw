# Web Dashboard 與 Apple Container 部署偵錯學習筆記

> 日期：2026-02-08

## 📋 問題概述

在將 NanoGemClaw Web Dashboard 部署到新環境（clone repo）並搭配 Apple Container 運行時，遭遇三個連鎖問題：

1. **Dashboard 空白頁面 + CORS 錯誤** — 瀏覽器訪問 `localhost:3000` 顯示空白，API 請求被 CORS 阻擋
2. **Apple Container EROFS 錯誤** — Gemini CLI 無法寫入 session 檔案，回報 `EROFS: read-only file system`
3. **Session Resume 失敗** — 清除 EROFS 問題後，Gemini CLI 嘗試恢復不存在的舊 session，exit code 42

---

## 🔍 根本原因分析

### 問題 1：CORS 錯誤

**原因：** `src/server.ts` 中的 `ALLOWED_ORIGINS` 預設值只包含開發用的 port（`5173` 和 `3001`），但 production 模式下 Dashboard 從 port `3000` 提供服務。瀏覽器發出的請求帶有 `Origin: http://localhost:3000`，不在允許清單中。

**技術細節：**
```typescript
// 修正前 — 缺少 port 3000
const ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3001'

// 修正後 — 動態包含 Dashboard 自身 port
const ALLOWED_ORIGINS = `http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT},http://localhost:5173,http://localhost:3001`
```

**關鍵概念：** 即使前端和後端在同一台機器上，如果 port 不同，瀏覽器仍視為不同的 origin（Same-Origin Policy）。`localhost` 和 `127.0.0.1` 也被視為不同 origin。

### 問題 2：Apple Container EROFS

**原因：** 程式碼嘗試做「巢狀掛載覆蓋」：
- 父路徑 `/home/node/.gemini` → readonly（保護 OAuth 憑證）
- 子路徑 `/home/node/.gemini/tmp` → read-write（session 資料）

Docker 支援這種巢狀掛載覆蓋，但 **Apple Container 不支援** — readonly 的父掛載會壓過子路徑的 writable 設定。

**技術細節：**
```typescript
// 修正前 — readonly 父掛載壓過 writable 子掛載
mounts.push({
  hostPath: hostGeminiDir,
  containerPath: '/home/node/.gemini',
  readonly: true,  // ❌ Apple Container 會讓子路徑也變 readonly
});

// 修正後 — read-write，容器是 --rm 所以不影響 host
mounts.push({
  hostPath: hostGeminiDir,
  containerPath: '/home/node/.gemini',
  readonly: false,  // ✅ 子路徑 /tmp 也可寫入
});
```

**關鍵概念：** Docker 和 Apple Container 在 bind mount 行為上有差異。Apple Container 更接近 VM 語義，不支援在 readonly 掛載的子目錄中覆蓋一個 writable 掛載。

### 問題 3：Session Resume 失敗

**原因：** `data/sessions.json` 保存了先前執行的 session ID。修改 mount 設定後，舊 session 檔案位置改變或遺失，但程式仍嘗試用 `--resume <old-session-id>` 恢復，導致 Gemini CLI 找不到 session 而以 exit code 42 退出。

**技術細節：**
```typescript
// 修正前 — resume 失敗直接回報錯誤
if (output.status === 'error') {
  logger.error(...);
  return null;  // ❌ 使用者看到「發生錯誤，請稍後再試」
}

// 修正後 — 自動 fallback 到新 session
if (output.status === 'error') {
  if (sessionId && output.error?.includes('No previous sessions found')) {
    delete sessions[group.folder];
    // 🔄 不帶 sessionId 重試一次
    const retryOutput = await runContainerAgent(group, { ...input, sessionId: undefined });
    // ...
  }
}
```

---

## 🛠️ 解決過程

### Step 1：診斷 Dashboard 空白頁面
1. 確認 `dashboard/dist/` 存在且有 `index.html` 和 `assets/`
2. 確認 `src/server.ts` 的 static file serving 邏輯正確
3. 發現終端機有 `Error: Not allowed by CORS`
4. 檢查 `ALLOWED_ORIGINS` 發現缺少 port 3000

### Step 2：修正 CORS
1. 將 `DASHBOARD_PORT` 動態加入 `ALLOWED_ORIGINS`
2. 同時加入 `localhost` 和 `127.0.0.1` 兩個 origin
3. Commit: `4c82ca2`

### Step 3：診斷 Container EROFS
1. 觸發 bot 後出現 `EROFS` 錯誤
2. 檢查 `container-runner.ts` 的 mount 設定
3. 發現 `~/.gemini` (readonly) 和 `~/.gemini/tmp` (writable) 的巢狀掛載
4. 確認 Apple Container 不支援此模式

### Step 4：修正 EROFS
1. 將 `~/.gemini` 改為 read-write（容器是 `--rm`，安全無虞）
2. Commit: `8e08feb`

### Step 5：診斷 Session Resume 失敗
1. EROFS 修正後出現新錯誤 `No previous sessions found`
2. 發現 `data/sessions.json` 保存了舊 session ID
3. 手動清除 `echo "{}" > data/sessions.json` 解決

### Step 6：加入自動容錯
1. 在 `runAgent()` 中加入 session resume 失敗自動重試邏輯
2. 清除失效的 session ID 並以新 session 重試
3. Commit: `82e21ee`

---

## ✅ 最終解法

| Commit | 檔案 | 變更 |
|--------|------|------|
| `4c82ca2` | `src/server.ts` | CORS 允許清單加入 Dashboard 自身 origin |
| `8e08feb` | `src/container-runner.ts` | `~/.gemini` mount 改為 read-write |
| `82e21ee` | `src/index.ts` | Session resume 失敗自動 fallback |

---

## 📚 自我學習指南

### 下次遇到類似問題時...

#### CORS 相關
- [ ] 先在瀏覽器 DevTools > Console 確認是否為 CORS 錯誤
- [ ] 確認 `Origin` header 的值是否在 server 的允許清單中
- [ ] 記住 `localhost` ≠ `127.0.0.1`，port 不同也算不同 origin

#### Apple Container 相關
- [ ] 避免在 readonly 掛載中做巢狀 writable 子掛載
- [ ] 測試前先在容器內確認掛載點是否可寫入
- [ ] Docker 行為 ≠ Apple Container 行為，不要假設兩者相同

#### Session/State 相關
- [ ] 修改 storage 路徑後，記得清除舊的 session/state 檔案
- [ ] 程式應有 graceful fallback — resume 失敗就從新 session 開始
- [ ] 持久化的 state 檔案（如 `sessions.json`）是常見的「幽靈錯誤」來源

### 相關資源
- [MDN CORS 說明](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Apple Container 文件](https://developer.apple.com/documentation/virtualization)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)

---

## 🎯 預防措施

1. **新功能的 CORS** — 任何新增的 web server port 都要加入 ALLOWED_ORIGINS，最好動態產生
2. **容器相容性測試** — 在 Docker 和 Apple Container 兩個環境都測試 mount 行為
3. **Session 容錯** — 所有依賴持久化 session 的邏輯都應有 fallback 機制
4. **部署文件** — Quick Start 要包含完整步驟（包括 `cd dashboard && npm install`），避免新使用者遺漏
5. **CI/CD** — 考慮加入容器建置和 Dashboard 建置到 CI pipeline 中
