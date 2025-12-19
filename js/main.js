import { initializeApp } from "https://www.gstatic.com/firebasejs/9.1.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.1.0/firebase-auth.js";
import {
	getDatabase,
	ref,
	set,
	update,
	get,
	child,
	onValue,
	push,
	remove
} from "https://www.gstatic.com/firebasejs/9.1.0/firebase-database.js";

// Firebase設定
const firebaseConfig = {
	
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const rtdb = getDatabase(app);

// 画面要素（jQueryキャッシュ）
const $screenSplash = $('#screen-splash');
const $screenHome = $('#screen-home');
const $screenChat = $('#screen-chat');
const $nicknameInput = $('#nicknameInput');
const $loginBtn = $('#loginBtn');
const $registerBtn = $('#registerBtn');
const $myNicknameEl = $('#myNickname');
const $logoutBtn = $('#logoutBtn');
const $userListEl = $('#userList');
const $backBtn = $('#backBtn');
const $chatPartnerNameEl = $('#chatPartnerName');
const $chatDistanceEl = $('#chatDistance');
const $messagesEl = $('#messages');
const $chatTextInput = $('#chatText');
const $sendMessageBtn = $('#sendMessage');
const $helpBtn = $('#helpBtn');
const $helpToastContainer = $('#helpToastContainer');

// 状態（アプリ全体で共有）
let currentUser = null;          // { uid, nickname }
let pendingNickname = null;      // 入力中のニックネーム一時保持
let loginMode = false;           // 既存ユーザーとして開始
let registerMode = false;        // 新規ユーザーとして開始
let myLocation = null;           // { lat, lng }
let map = null;                  // Leafletマップ
let myMarker = null;             // 自分のマーカー
let otherMarkers = {};           // uid -> 他ユーザーマーカー
let nearbyUsers = [];            // 近くのユーザー配列（距離含む）
let activeRoom = null;           // { roomId, partner }
let unsubMessages = null;        // 将来の解除用に保持（未使用）
let incomingListeners = {};      // roomId -> リスナー設置済みフラグ
let unreadCounts = {};           // roomId -> 未読数
let locationsCleaned = false;    // locations重複クリーン実施済み
let locationsSubscribed = false; // locations購読の重複防止
// Help機能の責務を集約
const HelpManager = (() => {
	let activeId = null; // 自分が発した未解決Helpのpushキー
	let circle = null;   // 500m円

	function setButtonState() {
		if (!$helpBtn || !$helpBtn.length) return;
		if (activeId) {
			$helpBtn.text('Helpをキャンセル');
			$helpBtn.removeClass('bg-red-600').addClass('bg-gray-600');
		} else {
			$helpBtn.text('Help（近くに知らせる）');
			$helpBtn.removeClass('bg-gray-600').addClass('bg-red-600');
		}
	}

	async function request() {
		if (!currentUser) { alert('ログインしてください'); return; }
		if (!myLocation) { alert('位置情報が未取得です'); return; }
		const ok = await Ui.confirm('近くの旅人（500m以内）にHelpを知らせます。よろしいですか？');
		if (!ok) return;
		const reqRef = push(ref(rtdb, 'helpRequests'));
		await set(reqRef, {
			id: reqRef.key,
			requesterId: currentUser.uid,
			requesterNickname: currentUser.nickname || '不明',
			lat: myLocation.lat,
			lng: myLocation.lng,
			radiusM: 500,
			status: 'open',
			createdAt: Date.now()
		});
		activeId = reqRef.key;
		try {
			if (circle) { map && map.removeLayer(circle); }
			circle = L.circle([myLocation.lat, myLocation.lng], { radius: 500, color: '#ef4444', fillColor: '#fca5a5', fillOpacity: 0.2 }).addTo(map);
		} catch (_) {}
		showToast({ message: 'Helpを近くの旅人に通知しました（500m）', type: 'success' });
		setButtonState();
	}

	async function cancel() {
		if (!activeId) return;
		try {
			await update(ref(rtdb, `helpRequests/${activeId}`), { status: 'cancelled', cancelledAt: Date.now() });
		} catch (_) {}
		activeId = null;
		if (circle) { try { map && map.removeLayer(circle); } catch(_){} circle = null; }
		showToast({ message: 'Helpをキャンセルしました', type: 'info' });
		setButtonState();
	}

	async function toggle() {
		if (activeId) return cancel();
		return request();
	}

	// 30分超の古い要請を削除
	async function cleanupOld(val) {
		const now = Date.now();
		const oldKeys = Object.keys(val).filter(k => (val[k] && (now - (val[k].createdAt || 0) > 30 * 60 * 1000)));
		await Promise.all(oldKeys.map(k => remove(ref(rtdb, `helpRequests/${k}`)).catch(() => {})));
	}

	function showToast({ message, type = 'info' }) {
		const color = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-gray-800';
		const $el = $(`
			<div class="${color} text-white text-sm px-3 py-2 rounded shadow mb-2">${message}</div>
		`);
		$helpToastContainer.append($el);
		setTimeout(() => { $el.fadeOut(300, () => $el.remove()); }, 2500);
	}

	function showIncomingToast({ id, nickname, distanceLabel, requesterId, distanceKm }) {
		$helpToastContainer.empty();
		const $el = $(`
			<div class="bg-white border rounded shadow p-3 flex items-center gap-3 pointer-events-auto">
				<div class="w-8 h-8 rounded-full bg-red-500"></div>
				<div class="flex-1">
					<div class="text-sm font-medium">近くでHelp要請</div>
					<div class="text-xs text-gray-600">${nickname}・約${distanceLabel}</div>
				</div>
				<button class="px-3 py-1 bg-indigo-600 text-white rounded text-sm" data-act="assist">助ける</button>
				<button class="px-2 py-1 text-sm text-gray-600" data-act="close">閉じる</button>
			</div>
		`);
		$el.on('click', '[data-act="assist"]', async () => {
			try { update(ref(rtdb, `helpRequests/${id}`), { status: 'accepted', acceptedBy: currentUser.uid, acceptedAt: Date.now() }).catch(() => {}); } catch (_) {}
			startChatWithUser({ uid: requesterId, nickname, distanceKm });
			$helpToastContainer.empty();
		});
		$el.on('click', '[data-act="close"]', () => { $helpToastContainer.empty(); });
		$helpToastContainer.append($el);
	}

	function subscribe() {
		const reqRef = ref(rtdb, 'helpRequests');
		onValue(reqRef, async (snap) => {
			const val = snap.val() || {};
			await cleanupOld(val);
			if (!myLocation || !currentUser) return;
			const requests = Object.keys(val)
				.map(k => val[k])
				.filter(r => r && r.status === 'open' && r.requesterId !== currentUser.uid && typeof r.lat === 'number' && typeof r.lng === 'number')
				.map(r => ({ ...r, distanceKm: haversineDistance(myLocation.lat, myLocation.lng, r.lat, r.lng) }))
				.filter(r => r.distanceKm <= 0.5)
				.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
			if (requests.length) {
				const r = requests[0];
				const distLabel = r.distanceKm < 1 ? `${Math.round(r.distanceKm * 1000)}m` : `${r.distanceKm.toFixed(1)}km`;
				showIncomingToast({ id: r.id, nickname: r.requesterNickname || '旅人', distanceLabel: distLabel, requesterId: r.requesterId, distanceKm: r.distanceKm });
			} else {
				$helpToastContainer.empty();
			}
		});
	}

	function reset() {
		activeId = null;
		if (circle) { try { map && map.removeLayer(circle); } catch(_){} circle = null; }
		setButtonState();
		$helpToastContainer.empty();
	}

	function initButton() {
		if ($helpBtn && $helpBtn.length) {
			$helpBtn.off('click').on('click', toggle);
			setButtonState();
		}
	}

	return { initButton, setButtonState, toggle, subscribe, reset };
})();

// UIユーティリティ（jQueryでモーダルを生成）
const Ui = (() => {
	function confirm(message) {
		return new Promise((resolve) => {
			const $overlay = $(`
				<div class="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40">
					<div class="bg-white rounded shadow p-4 w-[90%] max-w-xs">
						<div class="text-sm mb-3">${message}</div>
						<div class="flex gap-2 justify-end">
							<button class="px-3 py-1 text-sm border rounded" data-act="cancel">キャンセル</button>
							<button class="px-3 py-1 text-sm bg-indigo-600 text-white rounded" data-act="ok">OK</button>
						</div>
					</div>
				</div>
			`);
			$overlay.on('click', '[data-act="cancel"]', () => { $overlay.remove(); resolve(false); });
			$overlay.on('click', '[data-act="ok"]', () => { $overlay.remove(); resolve(true); });
			$('body').append($overlay);
		});
	}
	function alert(message) {
		return new Promise((resolve) => {
			const $overlay = $(`
				<div class="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40">
					<div class="bg-white rounded shadow p-4 w-[90%] max-w-xs">
						<div class="text-sm mb-3">${message}</div>
						<div class="flex gap-2 justify-end">
							<button class="px-3 py-1 text-sm bg-indigo-600 text-white rounded" data-act="ok">OK</button>
						</div>
					</div>
				</div>
			`);
			$overlay.on('click', '[data-act="ok"]', () => { $overlay.remove(); resolve(); });
			$('body').append($overlay);
		});
	}
	return { confirm, alert };
})();

// ===== 画面切り替え =====
function showScreen(name) {
	$screenSplash.addClass('hidden');
	$screenHome.addClass('hidden');
	$screenChat.addClass('hidden');
	if (name === 'splash') $screenSplash.removeClass('hidden');
	if (name === 'home') $screenHome.removeClass('hidden');
	if (name === 'chat') $screenChat.removeClass('hidden');
}

// ===== ユーティリティ =====
// Haversine距離計算（km）
function haversineDistance(lat1, lon1, lat2, lon2) {
	const toRad = (v) => (v * Math.PI) / 180;
	const R = 6371; // 地球半径km
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

// ===== Splash: 認証（ログイン/新規） =====
// 匿名ログイン→ユーザー作成
async function startWithNickname() {
	const nickname = $nicknameInput.val().trim();
	if (!nickname) {
		alert('ニックネームを入力してください');
		return;
	}
	// ニックネームの存在を事前チェック
	try {
		const exists = await checkNicknameExists(nickname);
		if (loginMode && !exists) {
			alert('このニックネームは未登録です。ログインできません。');
			return;
		}
		if (registerMode && exists) {
			alert('このニックネームは既に使用されています。新規登録できません。');
			return;
		}
	} catch (e) {
		console.warn('ニックネーム確認に失敗:', e);
	}
	// 認証コールバックで参照するため保持
	pendingNickname = nickname;
	try {
		// 既に匿名認証済みなら再サインインせずそのまま進む（同一UID維持）
		if (auth.currentUser) {
			proceedAfterAuth(auth.currentUser);
			return;
		}
		// 未認証の場合のみ匿名サインイン
		await signInAnonymously(auth);
		// onAuthStateChangedが遅延する環境向けフォールバック（3秒後に進まなければ直進）
		setTimeout(() => {
			if (!currentUser && auth.currentUser && pendingNickname) {
				proceedAfterAuth(auth.currentUser);
			}
		}, 3000);
	} catch (e) {
		console.error('匿名ログインに失敗:', e);
		alert('匿名ログインに失敗しました。Firebaseで匿名認証を有効化し、HTTPサーバー（例: localhost）で実行してください。');
		// 無効化は行っていないため何もしない
	}
	// onAuthStateChanged のコールバックで続き実行
}

// ニックネーム存在チェック（RTDBの users 全件から走査）
async function checkNicknameExists(nickRaw) {
	const norm = String(nickRaw).trim().toLocaleLowerCase();
	const snap = await get(ref(rtdb, 'users'));
	if (!snap.exists()) return false;
	const val = snap.val() || {};
	return Object.keys(val).some((uid) => {
		const n = val[uid] && val[uid].nickname ? String(val[uid].nickname) : '';
		return n.trim().toLocaleLowerCase() === norm;
	});
}

// 認証後の共通処理
async function proceedAfterAuth(user) {
	const uid = user.uid;
	const inputNick = pendingNickname && pendingNickname.trim();
	if (!inputNick) {
		alert('ニックネームは必須です。入力してください。');
		showScreen('splash');
		return;
	}
	let effectiveNickname = inputNick;
	try {
		const userRef = ref(rtdb, `users/${uid}`);
		const snap = await get(userRef);
		if (snap.exists()) {
			await update(userRef, {
				nickname: effectiveNickname,
				lastActiveAt: Date.now()
			});
		} else {
			await set(userRef, {
				nickname: effectiveNickname,
				createdAt: Date.now(),
				lastActiveAt: Date.now()
			});
		}
	} catch (e) {
		console.error('users更新に失敗:', e);
		alert('ユーザー情報の更新に失敗しました。通信状況をご確認ください。');
		showScreen('splash');
		return;
	}
	currentUser = { uid, nickname: effectiveNickname };
	$myNicknameEl.text(effectiveNickname);
	pendingNickname = null;
	loginMode = false;
	registerMode = false;
	showScreen('home');
	try {
		await cleanupDuplicateLocations();
		await initLocationAndMap();
	} catch (e) { console.error('位置情報初期化に失敗:', e); }
	try { if (!locationsSubscribed) { subscribeLocations(); locationsSubscribed = true; } } catch (e) { console.error('locations購読失敗:', e); }
	try { subscribeIncomingMessages(); } catch (e) { console.error('incoming購読失敗:', e); }
	try { HelpManager.subscribe(); } catch (e) { console.error('help購読失敗:', e); }
}
// locationsの重複キーをクリーンアップ（同一uidに対する複数エントリを削除）
async function cleanupDuplicateLocations() {
	try {
		const snap = await get(ref(rtdb, 'locations'));
		if (!snap.exists() || !currentUser) return;
		const val = snap.val() || {};
		// 自分に関する重複のみ削除（安全運用）
		const duplicates = Object.keys(val).filter(key => {
			const entry = val[key];
			return entry && entry.uid === currentUser.uid && key !== currentUser.uid;
		});
		for (const k of duplicates) {
			await remove(ref(rtdb, `locations/${k}`));
		}
	} catch (e) {
		console.error('locations重複クリーンアップ失敗:', e);
	}
}
onAuthStateChanged(auth, async (user) => {
	// サインイン状態変化時、ニックネーム入力がトリガーされている場合のみ進める
	if (!user) return;
	if (!pendingNickname) return; // ログイン済みのセッション維持時は自動遷移しない
	proceedAfterAuth(user);
});

// ログイン（既存UIDで続行）は末尾の初期化で一括バインド

// ===== Home: 位置情報＆マップ =====
async function initLocationAndMap() {
	return new Promise((resolve) => {
		if (!navigator.geolocation) {
			alert('位置情報が取得できません');
			resolve();
			return;
		}
		navigator.geolocation.getCurrentPosition(async (pos) => {
			const lat = pos.coords.latitude;
			const lng = pos.coords.longitude;
			myLocation = { lat, lng };
			// RTDBへ保存
			await set(ref(rtdb, `locations/${currentUser.uid}`), {
				uid: currentUser.uid,
				lat,
				lng,
				updatedAt: Date.now()
			});

			// マップ表示
			if (!map) {
				map = L.map('map', { zoomControl: true }).setView([lat, lng], 15);
				L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
					attribution: '&copy; OpenStreetMap contributors',
					maxZoom: 17,
				}).addTo(map);
			} else {
				map.setView([lat, lng], 15);
			}

			// 自分のピン（青）
			if (myMarker) {
				myMarker.setLatLng([lat, lng]);
			} else {
				myMarker = L.circleMarker([lat, lng], { radius: 8, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.8 }).addTo(map);
				myMarker.bindPopup('あなたの現在地');
			}

			// 数分ごとの更新（プライバシー配慮）
			setInterval(async () => {
				if (!currentUser) return; // ログアウト等でnullなら更新しない
				navigator.geolocation.getCurrentPosition(async (p) => {
					const la = p.coords.latitude;
					const ln = p.coords.longitude;
					myLocation = { lat: la, lng: ln };
					if (myMarker) myMarker.setLatLng([la, ln]);
					await update(ref(rtdb, `locations/${currentUser && currentUser.uid ? currentUser.uid : 'unknown'}`), {
						lat: la,
						lng: ln,
						updatedAt: Date.now()
					});
				});
			}, 1000 * 60 * 3); // 3分ごと

			resolve();
		}, (err) => {
			console.error(err);
			alert('位置情報の取得が拒否されました');
			resolve();
		}, { enableHighAccuracy: true, timeout: 10000 });
	});
}

// ===== Home: 近くのユーザー＆リスト =====
function subscribeLocations() {
	const locationsRef = ref(rtdb, 'locations');
	onValue(locationsRef, (snap) => {
		// 認証前は自分判定ができず自分を含めてしまう可能性があるためスキップ
		if (!currentUser) return;
		// 初回のみ全体の重複（uidに対してキーが複数）をクリーンアップ
		if (!locationsCleaned) {
			try { cleanupAllDuplicateLocations(snap.val() || {}); } catch (e) { console.warn('全体重複クリーン失敗:', e); }
			locationsCleaned = true;
		}
		nearbyUsers = [];
		Object.values(otherMarkers).forEach(m => map && map.removeLayer(m));
		otherMarkers = {};
		const val = snap.val() || {};
		const seen = new Set();
		Object.keys(val).forEach((keyUid) => {
			const { uid, lat, lng } = val[keyUid];
			// データにuidがない/合わないケースに備え、キーと値両方で自己判定
			const isSelf = (currentUser && (keyUid === currentUser.uid || uid === currentUser.uid));
			if (!myLocation || isSelf) return;
			// 位置が未定義なレコードはスキップ
			if (typeof lat !== 'number' || typeof lng !== 'number') return;
			const distKm = haversineDistance(myLocation.lat, myLocation.lng, lat, lng);
			if (distKm <= 5) {
				const targetUid = uid || keyUid;
				// 念のため二重の自己除外（不整合データ対策）
				if (currentUser && targetUid === currentUser.uid) return;
				// 同一UIDの重複除外（同じユーザーを複数表示しない）
				if (seen.has(targetUid)) return;
				seen.add(targetUid);
				nearbyUsers.push({ uid: targetUid, lat, lng, distanceKm: distKm });
				const marker = L.circleMarker([lat, lng], { radius: 7, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 0.8 }).addTo(map);
				marker.on('click', () => openUserMiniCard(targetUid));
				otherMarkers[targetUid] = marker;
			}
		});
		// 念のためリスト側でも自己除外を保証
		nearbyUsers = nearbyUsers.filter(u => !currentUser || u.uid !== currentUser.uid);
		renderUserList();
	});
}


// 全ユーザーのlocations重複をクリーンアップ（各uidにつきキーはuidのみを残す）
async function cleanupAllDuplicateLocations(val) {
	const byUid = new Map(); // uid -> array of keys
	Object.keys(val).forEach((key) => {
		const entry = val[key];
		const u = entry && entry.uid ? entry.uid : key;
		if (!byUid.has(u)) byUid.set(u, []);
		byUid.get(u).push(key);
	});
	const ops = [];
	byUid.forEach((keys, u) => {
		// 正規キーは uid と一致するもの。なければ最初のキーを残して他を削除。
		const canonical = keys.find(k => k === u) || keys[0];
		keys.forEach((k) => {
			if (k !== canonical) {
				ops.push(remove(ref(rtdb, `locations/${k}`)));
			}
		});
	});
	if (ops.length) {
		await Promise.all(ops);
	}
}

// ユーザーリスト描画（ニックネーム取得+距離表示）
async function renderUserList() {
	$userListEl.empty();
	// ニックネーム単位で重複排除：同じニックネームは最も近い1件のみ表示
	const bestByNick = new Map(); // nickname -> { uid, distanceKm }
	for (const u of nearbyUsers) {
		const userSnap = await get(child(ref(rtdb), `users/${u.uid}`));
		const data = userSnap.exists() ? userSnap.val() : null;
		// 正規化：前後空白除去＆小文字化（見た目同じでも文字列差異を吸収）
		const nickname = (data && data.nickname ? String(data.nickname) : '不明').trim().toLocaleLowerCase();
		const existing = bestByNick.get(nickname);
		if (!existing || u.distanceKm < existing.distanceKm) {
			bestByNick.set(nickname, { uid: u.uid, distanceKm: u.distanceKm });
		}
	}
	console.debug('render list nicknames:', Array.from(bestByNick.keys()));
	for (const [nickname, info] of bestByNick.entries()) {
		const distanceLabel = info.distanceKm < 1 ? `${Math.round(info.distanceKm * 1000)}m` : `${info.distanceKm.toFixed(1)}km`;
		const roomId = currentUser ? [currentUser.uid, info.uid].sort().join('_') : null;
		const badgeCount = roomId ? (unreadCounts[roomId] || 0) : 0;

		const $li = $('<li/>', { class: 'px-4 py-3 flex items-center gap-3' });
		const badgeHtml = badgeCount > 0 ? `<span class="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full px-1">${badgeCount}</span>` : '';
		const $avatar = $(`<div class="relative w-8 h-8 rounded-full bg-orange-400">${badgeHtml}</div>`);
		const $info = $(`<div class="flex-1"><div class="text-sm font-medium">${nickname}</div><div class="text-xs text-gray-500">${distanceLabel}</div></div>`);
		const $btn = $('<button/>', { class: 'bg-indigo-600 text-white rounded px-3 py-1 text-sm', text: 'チャット' });
		$btn.on('click', () => startChatWithUser({ uid: info.uid, nickname, distanceKm: info.distanceKm }));
		$li.append($avatar, $info, $btn);
		$userListEl.append($li);
	}
}

// マーカークリック時の簡易カード（ポップアップ代わり）
async function openUserMiniCard(uid) {
	const userSnap = await get(child(ref(rtdb), `users/${uid}`));
	const data = userSnap.exists() ? userSnap.val() : null;
	const nickname = data ? (data.nickname || '不明') : '不明';
	const found = nearbyUsers.find(x => x.uid === uid);
	const distanceLabel = found ? (found.distanceKm < 1 ? `${Math.round(found.distanceKm * 1000)}m` : `${found.distanceKm.toFixed(1)}km`) : '';
	// リスト側に集中する運用。必要ならLeafletのPopupも活用可能。
	alert(`${nickname}（約${distanceLabel}）とチャットを開始します`);
	startChatWithUser({ uid, nickname, distanceKm: found ? found.distanceKm : null });
}

// ===== Chat: 開始＆購読 =====
// チャット開始
async function startChatWithUser(partner) {
	const roomId = [currentUser.uid, partner.uid].sort().join('_');
	const roomRef = ref(rtdb, `rooms/${roomId}`);
	// updateを使ってトップレベルのみ更新し、既存のmessagesサブツリーを消さない
	await update(roomRef, {
		roomId,
		memberIds: [currentUser.uid, partner.uid],
		createdAt: Date.now()
	});

	activeRoom = { roomId, partner };
	$chatPartnerNameEl.text(partner.nickname);
	$chatDistanceEl.text(partner.distanceKm != null ? (partner.distanceKm < 1 ? `${Math.round(partner.distanceKm * 1000)}m` : `${partner.distanceKm.toFixed(1)}km`) : '');
	showScreen('chat');
	subscribeMessages(roomId);

	// チャットを開いた時点で既読にする
	try {
		const stateRef = ref(rtdb, `roomStates/${roomId}/${currentUser.uid}`);
		await update(stateRef, { lastSeen: Date.now() });
		unreadCounts[roomId] = 0;
		renderUserList();
	} catch (e) { console.error('lastSeen更新に失敗:', e); }
}

function subscribeMessages(roomId) {
	const messagesRef = ref(rtdb, `rooms/${roomId}/messages`);
	const handler = (snap) => {
		$messagesEl.empty();
		const val = snap.val() || {};
		const arr = Object.keys(val).map(k => ({ id: k, ...val[k] })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
		arr.forEach((m) => {
			const isMine = m.senderId === currentUser.uid;
			const $bubble = $('<div/>', {
				class: `max-w-[70%] px-3 py-2 rounded mb-2 ${isMine ? 'ml-auto bg-indigo-600 text-white' : 'mr-auto bg-white border'}`,
				text: m.text || ''
			});
			$messagesEl.append($bubble);
		});
		$messagesEl.scrollTop($messagesEl.prop('scrollHeight'));
	};
	onValue(messagesRef, handler);
}

function subscribeIncomingMessages() {
	const roomsRef = ref(rtdb, 'rooms');
	onValue(roomsRef, (snap) => {
		const rooms = snap.val() || {};
		Object.keys(rooms).forEach((roomId) => {
			const room = rooms[roomId];
			const members = room.memberIds || [];
			if (!currentUser || !Array.isArray(members)) return;
			if (!members.includes(currentUser.uid)) return;

			if (activeRoom && activeRoom.roomId === roomId) return;

			const messagesRef = ref(rtdb, `rooms/${roomId}/messages`);
			if (incomingListeners[roomId]) return;
			incomingListeners[roomId] = true;

			onValue(messagesRef, async (msnap) => {
				const val = msnap.val() || {};
				const arr = Object.keys(val).map(k => ({ id: k, ...val[k] })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
				if (arr.length === 0) {
					unreadCounts[roomId] = 0;
					renderUserList();
					return;
				}
				try {
					const stateSnap = await get(child(ref(rtdb), `roomStates/${roomId}/${currentUser.uid}`));
					const lastSeen = stateSnap.exists() ? (stateSnap.val().lastSeen || 0) : 0;
					const unread = arr.filter(m => (m.senderId !== currentUser.uid) && (m.createdAt || 0) > lastSeen).length;
					unreadCounts[roomId] = unread;
					renderUserList();
				} catch (e) {
					console.error('未読計算に失敗:', e);
				}
			});
		});
	});
}

// ===== 初期化（ボタンのイベントを一括バインド） =====
$(document).ready(() => {
	// ログインボタン
	$loginBtn.off('click').on('click', () => {
		loginMode = true; registerMode = false; startWithNickname();
	});
	// 新規開始ボタン
	$registerBtn.off('click').on('click', async () => {
		try { await signOut(auth); } catch (e) { console.warn('signOut失敗（続行）:', e); }
		registerMode = true; loginMode = false; startWithNickname();
	});

	// 送信ボタン
	$sendMessageBtn.off('click').on('click', async () => {
		const text = $chatTextInput.val().trim();
		if (!text || !activeRoom || !currentUser) return;
		const messagesRef = ref(rtdb, `rooms/${activeRoom.roomId}/messages`);
		const newRef = push(messagesRef);
		await set(newRef, { senderId: currentUser.uid, text, createdAt: Date.now() });
		$chatTextInput.val('');
	});

	// 戻るボタン
	$backBtn.off('click').on('click', () => {
		activeRoom = null;
		$chatTextInput.val('');
		showScreen('home');
	});

	// ログアウトボタン
	$logoutBtn.off('click').on('click', async () => {
		currentUser = null;
		$myNicknameEl.text('');
		$messagesEl.empty();
		$userListEl.empty();
		showScreen('splash');
		HelpManager.reset();
	});

	// Helpボタン
	HelpManager.initButton();
});


