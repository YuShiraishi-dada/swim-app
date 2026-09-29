# SwimMenu 🏊 水泳メニュー自動生成アプリ

強度・距離・狙いを選ぶだけで、水泳の練習メニューを自動生成する Web アプリ（PWA）です。
Android では「ホーム画面に追加」でアプリとして使えます（オフライン対応）。

- **入力項目**
  - 必須: メインの狙い（スプリント・対乳酸・エンデュランス・アクティブレスト）/ 強度 (1〜5) / 距離の目安 (1,000〜6,000m) / **EN2 で回している 100m のサイクル**
  - 任意: 練習時間（指定するとその時間に収まるよう距離を自動調整）/ プール長 (25m/50m) / 泳法（クロール中心 / 4 泳法ミックス）
- **ランダム生成**: 作るたびに違うメニュー（本数はなるべく偶数）。シード値つき URL で同じメニューを再現・共有できる
- **PDF 出力**（カラー / 印刷向けの白黒）/ **画像保存** / **X に投稿**（スマホは共有シートから画像つき投稿、PC は画像保存＋投稿画面を開く）
- **お気に入り保存**（端末内に保存。JSON で書き出し / 読み込み可）

## 運用コスト

| 項目 | サービス | 費用 |
| --- | --- | --- |
| ソース管理 | GitHub | 無料 |
| ビルド・デプロイ | GitHub Actions | 無料（公開リポジトリは無制限） |
| ホスティング | GitHub Pages | 無料 |
| データ保存 | 端末のブラウザ (localStorage) | 無料・サーバー不要 |

サーバーを持たない構成なので、ランニングコストは 0 円です。

## 初回セットアップ（GitHub への公開）

前提: [Node.js](https://nodejs.org/) 22 以上と Git がインストール済み。

```bash
cd C:\Claude\swim-app
npm install
npm run dev          # http://localhost:5173 で動作確認
```

> **初回のみ**: フォルダ内の `_github` を `.github` にリネームしてください（自動デプロイ設定が入っています）。
> PowerShell なら `Rename-Item _github .github`

GitHub に空のリポジトリ（例: `swim-app`）を作成してから:

```bash
git init -b main
git add .
git commit -m "first commit"
git remote add origin https://github.com/<ユーザー名>/swim-app.git
git push -u origin main
```

GitHub のリポジトリ画面で **Settings → Pages → Build and deployment → Source を「GitHub Actions」** に変更します。
以降は `main` に push するたびに自動でテスト → ビルド → 公開され、
`https://<ユーザー名>.github.io/swim-app/` でアクセスできます。

### Android にインストール

Chrome で公開 URL を開き、メニューの「ホーム画面に追加」（または「アプリをインストール」）を選びます。

> 将来 Google Play に出したくなった場合は、同じ PWA を [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) で TWA 化できます（Play Console 登録料 $25 のみ）。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm test` | メニュー生成ロジックのテスト（全パラメータの組み合わせで距離・プール長をチェック） |
| `npm run build` | 型チェック + 本番ビルド（`dist/`） |
| `npm run preview` | ビルド結果の確認 |

## 構成

```
src/
  generator.ts   メニュー生成ロジック（テンプレート・距離配分・サークル計算）
  rng.ts         シード付き乱数（同じシードで同じメニューを再現）
  types.ts       型定義・表示ラベル
  logo.ts        ロゴ（SVG）
  export.ts      Canvas 描画 → 画像 / PDF (jsPDF) / X 共有
  storage.ts     お気に入り・前回の設定の保存 (localStorage)
  main.ts        画面
  style.css
public/
  manifest.webmanifest, sw.js, icons/   PWA 用
scripts/
  make-icons.py                         アプリアイコン SVG の生成元
.github/workflows/deploy.yml            GitHub Pages 自動デプロイ
```

## デザイン

- フォント: [Zen Kaku Gothic New](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New)（SIL Open Font License）を `@fontsource` で同梱。端末にフォントが無くても同じ見た目になり、オフラインでも使えます
- ロゴ: コウテイペンギンのヒナ（2 色: ネイビー `#0f2433` / シルバーグレー `#9fb3c0`、白い顔は背景色 `#eef3f6` の抜き）。形は `src/logo.ts`（画面・画像・PDF 用）と `scripts/make-icons.py`（アプリアイコン用）で共通
- アイコン: `python scripts/make-icons.py` で SVG を再生成できます。PNG（192/512）は SVG をブラウザで書き出したものです
- 色: ネイビー `#0f2433` / ブランド `#1580a6` / アクセント `#35b6d6`

## メニュー生成の仕組み

1. 狙いごとの配分比でセクション（W-up / Kick・Drill・Pull / Pre Main / Main / Aerobic / Down）に距離を割り振る。強度が高いほど Main が厚くなる
2. 各セクションのテンプレート群から乱数で 1 つ選び、本数・距離・泳法・ドリルの種類などもランダムに決める
3. Main を先に作り、余りを他のセクションに配分、最後に Down で総距離を目安に合わせる
4. サイクルは「EN2 で回している 100m のサイクル」から泳速を推定（サイクル − 12 秒）し、ゾーンごとに「泳ぐ時間 + レスト」で計算して 5 秒単位に切り上げ
   - EN1: 泳速 ×1.1 + 15 秒 / EN2: 泳速 + 12 秒（= 入力したサイクル）/ EN3: 泳速 ×0.95 + 15 秒
   - AN: 泳速 ×0.86 で泳ぎ、泳ぎ:休み ≒ 1:2 / SP: 泳速 ×0.8 で泳ぎ、泳ぎ:休み ≒ 1:3
   - Kick ×1.4、Drill ×1.25、Pull ×1.05、泳法（Br ×1.18 など）で泳ぐ時間を補正。強度が高いほどレストを短く
5. 練習時間が指定されていれば、所要時間の見積もりがその時間に収まるまで距離を減らして作り直す

| ゾーン | 意味 |
| --- | --- |
| EN1 | 楽に（回復・アップ） |
| EN2 | 有酸素（一定ペース） |
| EN3 | きつめの有酸素 |
| AN | 対乳酸（全力に近い） |
| SP | スプリント（全力） |

メニューの種類を増やしたいときは `src/generator.ts` の `MAIN` / `PRE` / `KDP` / `WU` にテンプレートを追加してください。
なお、共有 URL は「シード + パラメータ」から再生成する方式のため、テンプレートを変更すると以前共有した URL から開くメニューも変わります（お気に入りはメニュー本体を保存しているので影響を受けません）。
