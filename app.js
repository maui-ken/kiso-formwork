/* ===================================================================
   基礎型枠 割付計算 PWA  —  app.js
   依存ゼロ / localStorage 永続化
   =================================================================== */

/* 計算エンジンは engine.js（calculate / TOLERANCE）に分離 */

/* ---------- 状態 ---------- */
const defaultState = () => ({
  project: { name: "", thickness: 150, bothFaces: 1, closed: true, edges: [] },
  inventory: [
    // 初期サンプル（編集・削除可）
    { id: uid(), type: "straight", width: 1800, qty: 20 },
    { id: uid(), type: "straight", width: 900,  qty: 20 },
    { id: uid(), type: "straight", width: 600,  qty: 20 },
    { id: uid(), type: "straight", width: 300,  qty: 20 },
    { id: uid(), type: "corner",   leg: 150,    qty: 8  },
    { id: uid(), type: "adjust",   minW: 0, maxW: 300, cuttable: true, qty: 0 },
  ],
});

let state = load();

function uid() { return Math.random().toString(36).slice(2, 9); }
function save() { localStorage.setItem("kiso-formwork", JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem("kiso-formwork"));
    if (s && s.project && s.inventory) return s;
  } catch (e) {}
  return defaultState();
}

/* ===================================================================
   UI
   =================================================================== */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---- タブ切替 ---- */
$$(".tab").forEach(btn => btn.addEventListener("click", () => {
  $$(".tab").forEach(b => b.classList.remove("active"));
  $$(".panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  $("#tab-" + btn.dataset.tab).classList.add("active");
  if (btn.dataset.tab === "result") renderResult();
}));

/* ---- プロジェクト入力 ---- */
function bindProject() {
  $("#projName").value = state.project.name;
  $("#thickness").value = state.project.thickness;
  $("#bothFaces").value = state.project.bothFaces;
  $("#closed").checked = state.project.closed;

  $("#projName").oninput = e => { state.project.name = e.target.value; save(); };
  $("#thickness").oninput = e => { state.project.thickness = +e.target.value || 0; save(); };
  $("#bothFaces").onchange = e => { state.project.bothFaces = +e.target.value; save(); };
  $("#closed").onchange = e => { state.project.closed = e.target.checked; save(); renderEdges(); };

  $("#addEdge").onclick = () => {
    const v = +$("#edgeLen").value;
    if (!v || v <= 0) return toast("辺の長さを入力してください");
    state.project.edges.push({ id: uid(), length: v });
    $("#edgeLen").value = ""; save(); renderEdges();
  };
  $("#edgeLen").addEventListener("keydown", e => { if (e.key === "Enter") $("#addEdge").click(); });

  $("#addRect").onclick = () => {
    const w = +$("#rectW").value, d = +$("#rectD").value;
    if (!w || !d) return toast("横・縦を入力してください");
    [w, d, w, d].forEach(len => state.project.edges.push({ id: uid(), length: len }));
    $("#rectW").value = ""; $("#rectD").value = ""; save(); renderEdges();
    toast("4辺を追加しました");
  };

  $("#calcBtn").onclick = () => {
    $$(".tab").forEach(b => b.classList.remove("active"));
    $$(".panel").forEach(p => p.classList.remove("active"));
    document.querySelector('.tab[data-tab="result"]').classList.add("active");
    $("#tab-result").classList.add("active");
    renderResult();
  };
}

function renderEdges() {
  const list = $("#edgeList");
  list.innerHTML = "";
  state.project.edges.forEach((e, i) => {
    const row = document.createElement("div");
    row.className = "edge-item";
    row.innerHTML = `
      <div class="idx">${i + 1}</div>
      <input type="number" inputmode="numeric" value="${e.length}" />
      <span class="unit">mm</span>
      <button class="del" title="削除">×</button>`;
    row.querySelector("input").oninput = ev => { e.length = +ev.target.value || 0; save(); updateTotals(); };
    row.querySelector(".del").onclick = () => {
      state.project.edges = state.project.edges.filter(x => x.id !== e.id);
      save(); renderEdges();
    };
    list.appendChild(row);
  });
  updateTotals();
}

function updateTotals() {
  const edges = state.project.edges.filter(e => e.length > 0);
  const sum = edges.reduce((a, e) => a + e.length, 0);
  $("#edgeTotals").textContent = edges.length
    ? `辺数: ${edges.length}　外周合計: ${(sum / 1000).toFixed(2)} m（${sum}mm）`
    : "";
}

/* ---- 在庫入力 ---- */
let invType = "straight";
function bindInventory() {
  $$("#typeSeg .seg-btn").forEach(b => b.addEventListener("click", () => {
    $$("#typeSeg .seg-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    invType = b.dataset.type;
    renderInvForm();
  }));
  renderInvForm();
  $("#addInv").onclick = addInventory;
}

function renderInvForm() {
  const f = $("#invForm");
  if (invType === "straight") {
    f.innerHTML = `
      <div class="row two">
        <div><label>横幅(mm)</label><input id="iw" type="number" inputmode="numeric" placeholder="例 1800" /></div>
        <div><label>所有枚数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 20" /></div>
      </div>`;
  } else if (invType === "corner") {
    f.innerHTML = `
      <div class="row two">
        <div><label>脚の長さ(mm)<small>角で消費する各辺の寸法</small></label><input id="il" type="number" inputmode="numeric" placeholder="例 150" /></div>
        <div><label>所有枚数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 8" /></div>
      </div>`;
  } else {
    f.innerHTML = `
      <div class="row two">
        <div><label>対応最小(mm)</label><input id="imin" type="number" inputmode="numeric" value="0" /></div>
        <div><label>対応最大(mm)</label><input id="imax" type="number" inputmode="numeric" placeholder="例 300" /></div>
      </div>
      <div class="row two">
        <div><label>所有数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 4" /></div>
        <div><label>板(任意長カット)</label><select id="icut"><option value="0">いいえ(伸縮枠)</option><option value="1">はい(板)</option></select></div>
      </div>`;
  }
}

function addInventory() {
  if (invType === "straight") {
    const w = +$("#iw").value, q = +$("#iq").value;
    if (!w) return toast("横幅を入力してください");
    state.inventory.push({ id: uid(), type: "straight", width: w, qty: q || 0 });
  } else if (invType === "corner") {
    const l = +$("#il").value, q = +$("#iq").value;
    if (!l) return toast("脚の長さを入力してください");
    state.inventory.push({ id: uid(), type: "corner", leg: l, qty: q || 0 });
  } else {
    const min = +$("#imin").value || 0, max = +$("#imax").value, q = +$("#iq").value, cut = $("#icut").value === "1";
    if (!cut && !max) return toast("対応最大を入力してください");
    state.inventory.push({ id: uid(), type: "adjust", minW: min, maxW: max || 999999, qty: q || 0, cuttable: cut });
  }
  save(); renderInvList(); toast("在庫に追加しました");
}

function renderInvList() {
  const list = $("#invList");
  list.innerHTML = "";
  const order = { straight: 0, corner: 1, adjust: 2 };
  const items = [...state.inventory].sort((a, b) =>
    (order[a.type] - order[b.type]) || ((b.width || b.leg || b.maxW) - (a.width || a.leg || a.maxW)));
  if (!items.length) { list.innerHTML = `<p class="empty">在庫が未登録です</p>`; return; }
  items.forEach(i => {
    const row = document.createElement("div");
    row.className = "inv-row";
    let label, badge;
    if (i.type === "straight") { badge = "直線"; label = `<b>${i.width}mm</b> 直線枠`; }
    else if (i.type === "corner") { badge = "コーナー"; label = `<b>脚 ${i.leg}mm</b> コーナー枠`; }
    else { badge = "調整"; label = i.cuttable ? `<b>板</b> 任意長カット` : `<b>${i.minW}〜${i.maxW}mm</b> 伸縮枠`; }
    row.innerHTML = `
      <span class="badge ${i.type}">${badge}</span>
      <span class="name">${label}</span>
      <span class="qty">${i.cuttable ? "—" : i.qty + "枚"}</span>
      <button class="del">×</button>`;
    row.querySelector(".del").onclick = () => {
      state.inventory = state.inventory.filter(x => x.id !== i.id);
      save(); renderInvList();
    };
    list.appendChild(row);
  });
}

/* ---- 結果表示 ---- */
function renderResult() {
  const area = $("#resultArea");
  const r = calculate(state);
  if (r.error) { area.innerHTML = `<p class="empty">${r.error}</p>`; return; }

  const shortCls = r.totalShort > 0 ? "bad" : "";
  const unresCls = r.unresolved.length ? "warn" : "";

  let html = `
    <div class="kpis">
      <div class="kpi"><div class="v">${r.totalPieces}</div><div class="l">必要ピース総数（${r.faces.join("・")}面）</div></div>
      <div class="kpi ${shortCls}"><div class="v">${r.totalShort}</div><div class="l">在庫不足の枚数</div></div>
    </div>`;

  // 在庫突き合わせ表
  html += `<div class="card"><h2>必要数量 と 在庫</h2>
    <table class="tbl">
      <tr><th>種類</th><th>必要</th><th>在庫</th><th>判定</th></tr>`;
  r.usage.forEach(u => {
    const name = u.type === "corner" ? `コーナー(脚${u.leg})` : `直線 ${u.width}mm`;
    const judge = u.short > 0 ? `<span class="tag-short">不足 ${u.short}</span>` : `<span class="tag-ok">OK</span>`;
    html += `<tr><td>${name}</td><td>${u.need}</td><td>${u.have}</td><td>${judge}</td></tr>`;
  });
  if (r.adjustNeed) html += `<tr><td>調整枠(伸縮)</td><td>${r.adjustNeed}</td><td>—</td><td>—</td></tr>`;
  if (r.boardCuts.length) html += `<tr><td>板カット</td><td>${r.boardCuts.length}本</td><td>—</td><td>—</td></tr>`;
  html += `</table>`;
  if (r.boardCuts.length) {
    html += `<p class="hint" style="margin-top:10px">板カット寸法: ${r.boardCuts.map(c => c + "mm").join(" / ")}</p>`;
  }
  html += `</div>`;

  if (r.unresolved.length) {
    html += `<div class="card ${unresCls}"><h2>⚠️ 要確認</h2>` +
      r.unresolved.map(u => `<p class="hint" style="color:#e3b341">${u}</p>`).join("") + `</div>`;
  }

  // 辺ごとの割付
  html += `<div class="card"><h2>辺ごとの割付</h2>`;
  r.edgeResults.forEach(er => {
    html += `<div class="edge-result">
      <div class="eh"><b>${er.face}面・辺${er.idx}</b><span>${er.length}mm</span></div>
      <div class="pieces">` +
      er.pieces.map(pc => `<span class="chip ${pc.kind === 'corner' ? 'corner' : pc.kind === 'adjust' ? 'adjust' : pc.kind === 'short' ? 'short' : ''}">${pc.label}</span>`).join("") +
      `</div></div>`;
  });
  html += `</div>`;

  area.innerHTML = html;
}

/* ---- 初期化 ---- */
bindProject();
bindInventory();
renderEdges();
renderInvList();

/* ---- Service Worker 登録（PWA） ---- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
