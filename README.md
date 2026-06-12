# 工廠雙語即時對話系統

工廠現場中英雙向即時語音對話，搭配 OpenAI Realtime API 轉錄與 gpt-4o-mini 翻譯。

---

## 最小啟動說明

**1. 安裝相依套件**

```bash
npm install
```

**2. 設定環境變數**

將範本複製為 `.env`，填入你的 OpenAI API 金鑰：

```bash
cp .env.example .env
# 編輯 .env，將 OPENAI_API_KEY=sk-... 改為實際金鑰
```

**3. 啟動伺服器**

```bash
npm start
```

**4. 開啟瀏覽器**

前往 [http://localhost:3000](http://localhost:3000)

---

## 環境需求

- Node.js 18 以上
- OpenAI API 金鑰（需開通 Realtime API 使用權限）
- 現代瀏覽器（支援 `getUserMedia` 與 `AudioWorklet`）

## 開發模式（檔案修改後自動重啟）

```bash
npm run dev
```

## 部署

推送至 GitHub 後，Zeabur 平台會自動偵測並部署。請在 Zeabur 環境變數設定中填入 `OPENAI_API_KEY`。
