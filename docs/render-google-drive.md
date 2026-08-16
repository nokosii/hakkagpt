# Render 的 Google Drive 上傳設定

目標資料夾：

https://drive.google.com/drive/folders/1AQ8NQBgruJlb6bYQMVUOPvJPZ0olKFUd

客天光在 Render 上使用 Google OAuth 2.0 的使用者授權，把原始 CSV、PDF 與對應的 RAG 索引檔寫入這個資料夾。Google Drive 分享網址只能指出資料夾，不能單獨提供程式寫入權限。

## 一、Google Cloud 設定

1. 在 Google Cloud Console 建立或選擇專案。
2. 啟用 Google Drive API。
3. 設定 OAuth 同意畫面，並把實際使用的 Google 帳號加入測試使用者。
4. 建立 OAuth 2.0 用戶端，類型選「網頁應用程式」。
5. 在已授權的重新導向 URI 加入：

   https://developers.google.com/oauthplayground

## 二、取得 Refresh Token

1. 開啟 Google OAuth 2.0 Playground。
2. 在設定中開啟「Use your own OAuth credentials」，填入剛建立的 Client ID 與 Client Secret。
3. 授權範圍使用：

   https://www.googleapis.com/auth/drive

4. 用擁有目標資料夾寫入權限的 Google 帳號完成授權。
5. 按下 Exchange authorization code for tokens，保存產生的 Refresh Token。

Refresh Token、Client Secret 都不得寫入原始碼、上傳 GitHub，或貼在公開對話中。

## 三、Render 環境變數

在 Render 服務的 Environment 頁面新增：

```text
GOOGLE_DRIVE_FOLDER_ID=1AQ8NQBgruJlb6bYQMVUOPvJPZ0olKFUd
GOOGLE_DRIVE_CLIENT_ID=你的 OAuth Client ID
GOOGLE_DRIVE_CLIENT_SECRET=你的 OAuth Client Secret
GOOGLE_DRIVE_REFRESH_TOKEN=你的 Refresh Token
```

儲存後重新部署。平台「知識匯入」頁的儲存流程會顯示 Google Drive，成功上傳時通知也會明確標示原檔已存入 Google Drive。

## 四、儲存內容

每次匯入會在指定資料夾建立兩個檔案：

1. 使用者上傳的原始 CSV 或 PDF。
2. 名稱以 `.ketiengong-index-` 開頭的 JSON 索引檔。

索引檔供 Render 上的 RAG 查詢使用，請勿刪除或修改。若只刪除原檔，系統仍可能命中既有索引；若要完整移除一份知識，需同時刪除相同匯入批次的原檔與索引檔。

## 五、安全提醒

Render 的 Secret Files 也可以保存憑證，但本專案目前直接讀取環境變數。設定畫面中請使用 Render 的秘密值功能，並限制 Google Cloud 專案與 OAuth 測試使用者。若 Refresh Token 外洩，應立即在 Google 帳戶的第三方應用程式存取權中撤銷授權，再產生新 Token。
