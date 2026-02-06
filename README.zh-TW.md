<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  由 <strong>Gemini CLI</strong> 驅動的個人 AI 助手。在容器中安全運行，輕量且易於理解和自訂。
</p>

<p align="center">
  <em>Fork 自 <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - 將 Claude Agent SDK 替換為 Gemini CLI，WhatsApp 替換為 Telegram</em>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <strong>繁體中文</strong> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 為什麼選擇 NanoGemClaw？

**NanoGemClaw** 是一個輕量、安全且可自訂的 AI 助手，在隔離的容器中執行 **Gemini CLI**。

| 功能 | NanoClaw | NanoGemClaw |
|------|----------|-------------|
| **Agent 運行時** | Claude Agent SDK | Gemini CLI |
| **訊息平台** | WhatsApp (Baileys) | Telegram Bot API |
| **費用** | Claude Max ($100/月) | 免費方案 (60 次/分鐘) |
| **多媒體支援** | 僅文字 | 圖片、語音、音訊、影片、文件 |
| **網頁瀏覽** | 僅搜尋 | 完整 `agent-browser` (Playwright) |
| **進階工具** | - | STT (語音轉文字), 圖片生成, Webhooks |

---

## 🚀 核心功能

- **多模態 I/O** - 傳送圖片、語音訊息、影片或文件，Gemini 會直接處理。
- **語音轉文字 (STT)** - 語音訊息會自動轉錄並由 Agent 進行分析。
- **圖片生成** - 要求 Agent 使用 **Imagen 3** 建立圖片。
- **瀏覽器自動化** - Agent 使用 `agent-browser` 處理複雜網頁任務（互動、截圖）。
- **多輪任務追蹤** - 追蹤並管理複雜的多步驟背景任務。
- **人格定義 (Persona)** - 透過 `/admin persona` 定義機器人的個性和行為。
- **多語言支援 (i18n)** - 介面完整支援繁中、簡中、英文、日文及西班牙文。
- **容器隔離** - 每個群組在各自的沙盒（Apple Container 或 Docker）中執行。

---

## 🛠️ 安裝說明

### 前置需求

| 工具 | 用途 | 安裝方式 |
|------|------|----------|
| **Node.js 20+** | 邏輯引擎 | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AI Agent 核心 | `npm install -g @google/gemini-cli` |
| **FFmpeg** | 音訊處理 | `brew install ffmpeg` (STT 必需) |

### 快速開始

1. **複製與安裝：**

   ```bash
   git clone https://github.com/Rlin1027/NanoGemClaw.git
   cd NanoGemClaw
   npm install
   ```

2. **設定機器人：**
   - 從 Telegram 的 **@BotFather** 取得 Token。
   - 根據 `.env.example` 建立 `.env` 檔案。
   - 執行 `npm run setup:telegram` 進行驗證。

3. **建置與執行：**

   ```bash
   cd container && ./build.sh && cd ..
   npm run dev
   ```

---

## 📖 使用範例

### 訊息處理與生產力

- `@Andy 翻譯這段語音訊息並摘要`
- `@Andy 生成一張 16:9 的未來網路龐克城市圖片`
- `@Andy 瀏覽 https://news.google.com 並告訴我今日頭條`

### 任務自動化

- `@Andy 每天早上 8 點檢查天氣並建議穿搭`
- `@Andy 監控我的網站，如果斷線請發送 Webhook 通知`

---

## ⚙️ 管理控制

直接對機器人發送以下指令：

- `/admin language <lang>` - 切換機器人介面語言。
- `/admin persona <name>` - 變更機器人人格設定。
- `/admin report` - 取得每日活動摘要報告。

---

## 🏗️ 架構設計

```mermaid
graph LR
    TG[Telegram] --> DB[(SQLite)]
    DB --> Main[Node.js Host]
    Main --> STT[ffmpeg/STT]
    Main --> IPC[FS IPC]
    IPC --> Container[Gemini Agent]
    Container --> Browser[agent-browser]
```

- **宿主機 (Node.js)**：處理 Telegram API、STT 轉換及容器生命週期。
- **容器 (Alpine)**：執行 Gemini CLI。透過 `agent-browser` 存取網路。與宿主機隔離。
- **持久化**：使用 SQLite 儲存任務；JSON 儲存 Session 與狀態。

---

## 🛠️ 問題排解

- **機器人無回應？** 檢查 `npm run logs` 並確認機器人已設為群組管理員。
- **STT 失敗？** 確認宿主機已安裝 `ffmpeg` (`brew install ffmpeg`)。
- **無法處理多媒體？** 確認 `.env` 中的 `GEMINI_API_KEY` 已正確設定。
- **容器問題？** 執行 `./container/build.sh` 確保映像檔為最新版本。

## 常見問題排解

| 問題 | 解決方案 |
|------|----------|
| `container: command not found` | 安裝 Apple Container 或 Docker |
| Bot 無回應 | 確認 Bot 是群組管理員、Token 正確 |
| `Gemini CLI not found` | 執行 `npm install -g @google/gemini-cli` |
| OAuth 失敗 | 執行 `gemini` 重新登入 |

## 授權

MIT

## 致謝

- 原始 [NanoClaw](https://github.com/gavrielc/nanoclaw) 由 [@gavrielc](https://github.com/gavrielc) 開發
- 由 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 驅動
