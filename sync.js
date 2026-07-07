/* ===================================================================
   基礎型枠 割付計算 — クラウド同期（Firebase Firestore）
   会社共通の「合言葉（コード）」で同じデータにつながる。
   Firebase 未設定でも読み込みエラーにならないよう、全て try/graceful。
   グローバル `Sync` を公開。
   =================================================================== */
window.Sync = (function () {
  const LS_KEY = "kiso-sync-config";
  let cfg = null;          // { fb: {...firebaseConfig}, code: "会社コード" }
  let ref = null;          // Firestore ドキュメント参照
  let unsub = null;        // onSnapshot 解除関数
  let pushTimer = null;
  let lastPushedJSON = "";

  const state = { status: "off" }; // off | connecting | online | offline | error
  const cbData = [];
  const cbStatus = [];

  function emitStatus(s, msg) {
    state.status = s; state.message = msg || "";
    cbStatus.forEach(fn => { try { fn(s, msg); } catch (e) {} });
  }
  function emitData(d) { cbData.forEach(fn => { try { fn(d); } catch (e) {} }); }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
  }
  function saveCfg(c) { localStorage.setItem(LS_KEY, JSON.stringify(c)); }
  function clearCfg() { localStorage.removeItem(LS_KEY); }

  /* Firebase設定を貼り付けテキスト（JS/JSONどちらでも）から抽出 */
  function parseFirebaseConfig(text) {
    if (!text) return null;
    const keys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
    const out = {};
    keys.forEach(k => {
      const m = text.match(new RegExp(k + "[\"']?\\s*[:=]\\s*[\"']([^\"']+)[\"']"));
      if (m) out[k] = m[1];
    });
    return (out.apiKey && out.projectId) ? out : null;
  }

  function firebaseReady() {
    return typeof firebase !== "undefined" && firebase && firebase.initializeApp;
  }

  async function connect(fbConfig, code) {
    if (!firebaseReady()) { emitStatus("error", "Firebaseを読み込めませんでした（オンラインで開き直してください）"); return false; }
    if (!fbConfig || !code) { emitStatus("error", "設定が不足しています"); return false; }
    emitStatus("connecting");
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(fbConfig);
      if (firebase.auth) { try { await firebase.auth().signInAnonymously(); } catch (e) {} }
      const db = firebase.firestore();
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      ref = db.collection("companies").doc(String(code));

      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
      unsub = ref.onSnapshot({ includeMetadataChanges: true }, snap => {
        emitStatus(snap.metadata.fromCache ? "offline" : "online");
        if (snap.exists) { const d = snap.data() || {}; lastPushedJSON = JSON.stringify({ inventory: d.inventory, sites: d.sites }); emitData(d); }
      }, err => emitStatus("error", err && err.message));

      cfg = { fb: fbConfig, code: String(code) };
      saveCfg(cfg);
      return true;
    } catch (e) {
      emitStatus("error", e && e.message);
      return false;
    }
  }

  function disconnect() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    ref = null; cfg = null; clearCfg();
    emitStatus("off");
  }

  /* ローカル変更をクラウドへ（デバウンス）。partial = {inventory, sites} */
  function push(partial) {
    if (!ref) return;
    const json = JSON.stringify({ inventory: partial.inventory, sites: partial.sites });
    if (json === lastPushedJSON) return; // 受信直後の自分のエコーはスキップ
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      lastPushedJSON = json;
      const data = { updatedAt: Date.now() };
      if (partial.inventory) data.inventory = partial.inventory;
      if (partial.sites) data.sites = partial.sites;
      ref.set(data, { merge: true }).catch(err => emitStatus("error", err && err.message));
    }, 500);
  }

  /* 招待リンク（Firebase設定＋会社コードを埋め込む） */
  function inviteLink() {
    if (!cfg) return "";
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
    return location.origin + location.pathname + "#join=" + payload;
  }
  function readInviteFromHash() {
    const m = (location.hash || "").match(/join=([^&]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return null; }
  }
  function clearHash() {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  /* 起動時：招待リンク or 保存済み設定で自動接続 */
  async function autoStart() {
    const invited = readInviteFromHash();
    if (invited && invited.fb && invited.code) { clearHash(); await connect(invited.fb, invited.code); return; }
    const saved = loadCfg();
    if (saved && saved.fb && saved.code) await connect(saved.fb, saved.code);
  }

  window.addEventListener("online", () => { if (ref) emitStatus("online"); });
  window.addEventListener("offline", () => { if (ref) emitStatus("offline"); });

  return {
    get status() { return state.status; },
    get message() { return state.message; },
    get connected() { return !!ref; },
    get code() { return cfg ? cfg.code : ""; },
    get config() { return cfg; },
    onData(fn) { cbData.push(fn); },
    onStatus(fn) { cbStatus.push(fn); },
    parseFirebaseConfig, connect, disconnect, push, inviteLink, autoStart,
    hasInvite() { return !!readInviteFromHash(); },
  };
})();
