<p align="center">
  <img src="public/icons/mga-icon-512.png" alt="Molecular Galaxy Atlas icon" width="180" />
</p>

**繁體中文** | [English](README.en.md)

# Molecular Galaxy Atlas

## 歡迎來到分子宇宙

化學分子的種類多得驚人，就像宇宙中的星星一樣。從日常生活裡熟悉的小分子，到構成生命的複雜分子，每一種都有自己的性質與故事。

Molecular Galaxy Atlas（MGA，分子星系圖鑑）把分子存在的「化學空間」類比成宇宙空間，將 3,000 多個真實、可追溯來源的分子，依照十個化學家族排列成不同星系。在這座宇宙裡，每個分子就是一個星體。

穿梭星系時，試著尋找微微閃爍的發光星體。選中一顆星，就能認識一個分子，看看它的結構與基本資料，並發覺藏在這個分子背後的冷知識和參考文獻。

選定分子後繼續放大，星體會展開成一個有恆星與行星的小系統。恆星的大小和行星的數量並不是隨機決定的，猜猜看，它們分別和分子的什麼化學性質有關？

<details>
<summary>揭曉星體設計</summary>

恆星大小對應分子量；環繞恆星的行星數量，對應分子的氫鍵供體數（HBD）。

</details>

**線上探索：** https://studio6-02.github.io/MGA-public/

## 公開資料

瀏覽器使用的分子資料位於 `public/datasets/demo`。每個有冷知識的星體都會在介紹卡片中顯示可點擊的 `Reference: 文獻名稱` 連結。

已核准的 featured facts 與引用資料也整理在 `data/molecule-facts.yml`，方便直接閱讀與人工確認。完整研究資料庫、草稿、證據蒐集內容與內部審核流程則保留在另一個 private repository。詳細資料來源與公開邊界請見 [DATA_SOURCES.md](DATA_SOURCES.md)。

## 本機執行

```bash
npm ci
npm run validate:public
npm run dev
```

## 建置

```bash
npm run build
```

每次 push 到 `main` 時，GitHub Actions 都會先驗證公開資料，再將建置完成的 `dist/` 部署至 GitHub Pages。
