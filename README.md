# ①課題名
Sottra（近くの日本人旅行者とチャットするアプリ）

## ②課題内容（どんな作品か）
- 位置情報を用いて半径約5km以内にいるユーザーを地図（Leaflet）とリストで表示
- 選択した相手と1対1チャット（Firebase Realtime Database）
- ニックネーム入力のみで利用可能（Firebase匿名認証）

## ③アプリのデプロイURL
- 

## ④アプリのログイン用IDまたはPassword（ある場合）
- ID: 不要（匿名認証）
- PW: 不要（匿名認証）

## ⑤工夫した点・こだわった点
- 近距離ユーザーのみ（約5km以内）を抽出し、ニックネーム重複は最も近い1件に整理
- Leafletで自分（青）と近くのユーザー（黄）を表示し、クリックでチャット導線
- 未読数バッジの簡易実装（`roomStates` の `lastSeen` を用いた算出）
- RTDBの`locations`で同一UIDの重複キーを検出し自動クリーンアップ
- 認証遅延時のフォールバックや、セッション維持時のスムーズな遷移

## ⑥難しかった点・次回トライしたいこと（又は機能）
- 位置情報の更新間隔とプライバシー配慮（3分更新）
- RTDB購読の解除管理（MVPでは簡略化）→今後はunsubscribeを導入
- チャット履歴のページング、送信失敗時リトライ制御
- 距離フィルタの可変化、現在地追従のUX改善

## ⑦フリー項目（感想、シェアしたいこと等なんでも）
- [感想] 位置情報とチャットの連携で体験が分かりやすく、近くの人にすぐ相談できるMVPになりました。
- [ローカル起動メモ]
	- macOS / zsh での例：
		- `cd "/Users/sorayamashita/Desktop/g’s Assignment/kadai04_chatApp"`
		- `python3 -m http.server 8000`
		- ブラウザで `http://localhost:8000/index.html` を開く（位置情報許可）
- [参考記事]
	- Leaflet: https://leafletjs.com/
	- Firebase Web v9: https://firebase.google.com/docs/web
	- OpenStreetMap: https://www.openstreetmap.org/