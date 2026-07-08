/* ===================================================================
   基礎型枠 割付計算 PWA  —  app.js
   依存ゼロ / localStorage 永続化
   =================================================================== */

/* 計算エンジンは engine.js（calculate / polygonPoints / TOLERANCE）に分離 */

/* ---------- 状態 ---------- */
function uid() { return Math.random().toString(36).slice(2, 9); }

function newSite(name) {
  return { id: uid(), name: name || "", thickness: 150, bothFaces: 1, closed: true, pipeRows: 1, formHeight: 0, edges: [] };
}

const defaultState = () => {
  const s = newSite("現場1");
  return {
    sites: [s],
    currentSiteId: s.id,
    inventory: [
      // 初期サンプル（編集・削除可）
      { id: uid(), type: "straight", width: 1800, qty: 20 },
      { id: uid(), type: "straight", width: 900,  qty: 20 },
      { id: uid(), type: "straight", width: 600,  qty: 20 },
      { id: uid(), type: "straight", width: 300,  qty: 20 },
      { id: uid(), type: "corner",   legA: 150, legB: 150, qty: 8 },
      { id: uid(), type: "cornerIn", legA: 150, legB: 150, qty: 8 },
      { id: uid(), type: "adjust",   minW: 0, maxW: 300, cuttable: true, qty: 0 },
      { id: uid(), type: "pipe",     length: 4000, qty: 10 },
      { id: uid(), type: "pipe",     length: 2000, qty: 10 },
    ],
  };
};

let state = load();

/* 現在編集中の現場（無ければ生成・修復） */
function curSite() {
  if (!state.sites || !state.sites.length) {
    const s = newSite("現場1"); state.sites = [s]; state.currentSiteId = s.id;
  }
  let s = state.sites.find(x => x.id === state.currentSiteId);
  if (!s) { s = state.sites[0]; state.currentSiteId = s.id; }
  return s;
}

/* 現場データの正規化（移行・防御） */
function normalizeSite(p) {
  if (!p.id) p.id = uid();
  if (p.pipeRows == null) p.pipeRows = 1;
  if (p.formHeight == null) p.formHeight = 0;
  if (!Array.isArray(p.edges)) p.edges = [];
  p.edges.forEach(e => { if (e.corner !== "in" && e.corner !== "out") e.corner = "out"; });
  return p;
}
function normalizeInventory(inv) {
  (inv || []).forEach(i => {
    if (i.type === "corner" || i.type === "cornerIn") {
      if (i.legA == null) i.legA = i.leg || 0;
      if (i.legB == null) i.legB = i.legA;
    }
  });
  return inv || [];
}

function save() {
  localStorage.setItem("kiso-formwork", JSON.stringify(state));
  if (window.Sync && Sync.connected) Sync.push({ inventory: state.inventory, sites: state.sites });
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem("kiso-formwork"));
    if (s && s.inventory) {
      normalizeInventory(s.inventory);
      // v2（単一project） → v3（複数sites）移行
      if (!s.sites && s.project) {
        const p = normalizeSite(s.project);
        s.sites = [p]; s.currentSiteId = p.id; delete s.project;
      }
      if (!s.sites || !s.sites.length) { const p = newSite("現場1"); s.sites = [p]; s.currentSiteId = p.id; }
      s.sites.forEach(normalizeSite);
      if (!s.currentSiteId || !s.sites.find(x => x.id === s.currentSiteId)) s.currentSiteId = s.sites[0].id;
      return s;
    }
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
  if (btn.dataset.tab === "sync") renderSyncTab();
}));

/* ---- プロジェクト入力 ---- */
function bindProject() {
  $("#projName").value = curSite().name;
  $("#thickness").value = curSite().thickness;
  $("#bothFaces").value = curSite().bothFaces;
  $("#pipeRows").value = curSite().pipeRows;
  $("#formHeight").value = curSite().formHeight || "";
  $("#closed").checked = curSite().closed;

  $("#projName").oninput = e => { curSite().name = e.target.value; save(); renderSiteBar(); };
  $("#thickness").oninput = e => { curSite().thickness = +e.target.value || 0; save(); };
  $("#bothFaces").onchange = e => { curSite().bothFaces = +e.target.value; save(); };
  $("#pipeRows").oninput = e => { curSite().pipeRows = Math.max(0, +e.target.value || 0); save(); };
  $("#formHeight").oninput = e => { curSite().formHeight = Math.max(0, +e.target.value || 0); save(); };
  $("#closed").onchange = e => { curSite().closed = e.target.checked; save(); renderEdges(); };

  $("#addEdge").onclick = () => {
    const v = +$("#edgeLen").value;
    if (!v || v <= 0) return toast("辺の長さを入力してください");
    curSite().edges.push({ id: uid(), length: v, corner: "out" });
    $("#edgeLen").value = ""; save(); renderEdges();
  };
  $("#edgeLen").addEventListener("keydown", e => { if (e.key === "Enter") $("#addEdge").click(); });

  $("#addRect").onclick = () => {
    const w = +$("#rectW").value, d = +$("#rectD").value;
    if (!w || !d) return toast("横・縦を入力してください");
    [w, d, w, d].forEach(len => curSite().edges.push({ id: uid(), length: len, corner: "out" }));
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
  const n = curSite().edges.length;
  curSite().edges.forEach((e, i) => {
    if (e.corner !== "in") e.corner = "out";
    const showCorner = curSite().closed || i < n - 1;
    const row = document.createElement("div");
    row.className = "edge-item";
    row.innerHTML = `
      <div class="idx">${i + 1}</div>
      <input type="number" inputmode="numeric" value="${e.length}" />
      <span class="unit">mm</span>
      ${showCorner
        ? `<button class="corner-toggle ${e.corner}" title="次の角: 出隅/入隅">${e.corner === "in" ? "入" : "出"}</button>`
        : `<span class="corner-toggle none">—</span>`}
      <button class="del" title="削除">×</button>`;
    row.querySelector("input").oninput = ev => { e.length = +ev.target.value || 0; save(); updateTotals(); };
    const tg = row.querySelector("button.corner-toggle");
    if (tg) tg.onclick = () => {
      e.corner = e.corner === "in" ? "out" : "in";
      save(); renderEdges();
    };
    row.querySelector(".del").onclick = () => {
      curSite().edges = curSite().edges.filter(x => x.id !== e.id);
      save(); renderEdges();
    };
    list.appendChild(row);
  });
  updateTotals();
}

function updateTotals() {
  const edges = curSite().edges.filter(e => e.length > 0);
  const sum = edges.reduce((a, e) => a + e.length, 0);
  $("#edgeTotals").textContent = edges.length
    ? `辺数: ${edges.length}　外周合計: ${(sum / 1000).toFixed(2)} m（${sum}mm）`
    : "";
  renderPreview(edges);
}

/* ---- 平面図プレビュー ---- */
function renderPreview(edges) {
  const box = $("#shapePreview");
  if (edges.length < 3) { box.innerHTML = ""; box.style.display = "none"; return; }
  const g = polygonPoints(edges, curSite().closed);
  const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const pad = Math.max(w, h) * 0.08;
  const ptsAttr = g.pts.map(p => `${p.x},${p.y}`).join(" ");

  let status = "";
  if (curSite().closed) {
    if (g.outCount - g.inCount !== 4) status = `<span class="pv-warn">⚠ 出隅${g.outCount}・入隅${g.inCount}（出隅−入隅=4 が正）</span>`;
    else if (g.gap > TOLERANCE) status = `<span class="pv-warn">⚠ 閉じません（誤差 ${Math.round(g.gap)}mm）</span>`;
    else status = `<span class="pv-ok">✓ 形が閉じています（出隅${g.outCount}・入隅${g.inCount}）</span>`;
  }

  box.style.display = "block";
  box.innerHTML = `
    <svg viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" preserveAspectRatio="xMidYMid meet">
      <${curSite().closed ? "polygon" : "polyline"} points="${ptsAttr}"
        fill="rgba(31,111,235,.12)" stroke="#4a9eff" stroke-width="${Math.max(w, h) * 0.012}"
        stroke-linejoin="round" />
      <circle cx="0" cy="0" r="${Math.max(w, h) * 0.018}" fill="#e3b341" />
    </svg>
    <p class="pv-status">${status}</p>`;
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
      </div>
      <div class="row two">
        <div><label>高さ(mm)<small>空欄=高さ指定なし</small></label><input id="ih" type="number" inputmode="numeric" placeholder="例 600" /></div>
        <div></div>
      </div>`;
  } else if (invType === "corner" || invType === "cornerIn") {
    f.innerHTML = `
      <div class="row two">
        <div><label>脚A(mm)<small>角の片側の寸法</small></label><input id="ila" type="number" inputmode="numeric" placeholder="例 150" /></div>
        <div><label>脚B(mm)<small>反対側。同じなら空欄でOK</small></label><input id="ilb" type="number" inputmode="numeric" placeholder="例 235" /></div>
      </div>
      <div class="row two">
        <div><label>所有枚数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 8" /></div>
        <div><label>高さ(mm)<small>空欄=指定なし</small></label><input id="ih" type="number" inputmode="numeric" placeholder="例 600" /></div>
      </div>`;
  } else if (invType === "pipe") {
    f.innerHTML = `
      <div class="row two">
        <div><label>長さ(mm)</label><input id="ip" type="number" inputmode="numeric" placeholder="例 4000" /></div>
        <div><label>所有本数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 10" /></div>
      </div>`;
  } else {
    f.innerHTML = `
      <div class="row two">
        <div><label>対応最小(mm)</label><input id="imin" type="number" inputmode="numeric" value="0" /></div>
        <div><label>対応最大(mm)</label><input id="imax" type="number" inputmode="numeric" placeholder="例 300" /></div>
      </div>
      <div class="row two">
        <div><label>所有数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 4" /></div>
        <div><label>板(任意長カット)</label><select id="icut"><option value="0">いいえ(スライド)</option><option value="1">はい(板)</option></select></div>
      </div>
      <div class="row two">
        <div><label>高さ(mm)<small>空欄=指定なし</small></label><input id="ih" type="number" inputmode="numeric" placeholder="例 600" /></div>
        <div></div>
      </div>`;
  }
}

function addInventory() {
  const hEl = $("#ih");
  const h = hEl ? (+hEl.value || 0) : 0;
  if (invType === "straight") {
    const w = +$("#iw").value, q = +$("#iq").value;
    if (!w) return toast("横幅を入力してください");
    state.inventory.push({ id: uid(), type: "straight", width: w, height: h, qty: q || 0 });
  } else if (invType === "corner" || invType === "cornerIn") {
    const a = +$("#ila").value, b = +$("#ilb").value || a, q = +$("#iq").value;
    if (!a) return toast("脚Aを入力してください");
    state.inventory.push({ id: uid(), type: invType, legA: a, legB: b, height: h, qty: q || 0 });
  } else if (invType === "pipe") {
    const l = +$("#ip").value, q = +$("#iq").value;
    if (!l) return toast("長さを入力してください");
    state.inventory.push({ id: uid(), type: "pipe", length: l, qty: q || 0 });
  } else {
    const min = +$("#imin").value || 0, max = +$("#imax").value, q = +$("#iq").value, cut = $("#icut").value === "1";
    if (!cut && !max) return toast("対応最大を入力してください");
    state.inventory.push({ id: uid(), type: "adjust", minW: min, maxW: max || 999999, height: h, qty: q || 0, cuttable: cut });
  }
  save(); renderInvList(); toast("在庫に追加しました");
}

function delInv(id) {
  if (!confirm("この在庫を削除しますか？")) return;
  state.inventory = state.inventory.filter(x => x.id !== id);
  if (editingId === id) editingId = null;
  save(); renderInvList();
}

/* ---- 在庫の編集 ---- */
let editingId = null;
function startEdit(id) { editingId = id; renderInvList(); }
function cancelEdit() { editingId = null; renderInvList(); }

function saveEdit(id) {
  const i = state.inventory.find(x => x.id === id);
  if (!i) return;
  const num = sel => +($(sel) ? $(sel).value : 0) || 0;
  if (i.type === "straight") {
    const w = num("#eiw"); if (!w) return toast("横幅を入力してください");
    i.width = w; i.height = num("#eih"); i.qty = num("#eiq");
  } else if (i.type === "corner" || i.type === "cornerIn") {
    const a = num("#eila"); if (!a) return toast("脚Aを入力してください");
    i.legA = a; i.legB = num("#eilb") || a; i.height = num("#eih"); i.qty = num("#eiq");
    delete i.leg;
  } else if (i.type === "pipe") {
    const l = num("#eip"); if (!l) return toast("長さを入力してください");
    i.length = l; i.qty = num("#eiq");
  } else {
    const cut = $("#eicut").value === "1", max = num("#eimax");
    if (!cut && !max) return toast("対応最大を入力してください");
    i.minW = num("#eimin"); i.maxW = max || 999999; i.cuttable = cut; i.height = num("#eih"); i.qty = num("#eiq");
  }
  editingId = null;
  save(); renderInvList(); toast("更新しました");
}

/* 編集フォーム（種類ごとに項目が異なる。値は既存を反映） */
function editFormHTML(i) {
  const v = x => (x || x === 0) ? x : "";
  let fields = "";
  if (i.type === "straight") {
    fields = `
      <div class="row two">
        <div><label>横幅(mm)</label><input id="eiw" type="number" inputmode="numeric" value="${v(i.width)}" /></div>
        <div><label>所有枚数</label><input id="eiq" type="number" inputmode="numeric" value="${v(i.qty)}" /></div>
      </div>
      <div class="row two">
        <div><label>高さ(mm)<small>空欄=指定なし</small></label><input id="eih" type="number" inputmode="numeric" value="${i.height ? i.height : ""}" placeholder="未指定" /></div>
        <div></div>
      </div>`;
  } else if (i.type === "corner" || i.type === "cornerIn") {
    const la = i.legA != null ? i.legA : (i.leg || "");
    fields = `
      <div class="row two">
        <div><label>脚A(mm)</label><input id="eila" type="number" inputmode="numeric" value="${v(la)}" /></div>
        <div><label>脚B(mm)<small>同じなら空欄</small></label><input id="eilb" type="number" inputmode="numeric" value="${i.legB != null && i.legB !== la ? i.legB : ""}" /></div>
      </div>
      <div class="row two">
        <div><label>所有枚数</label><input id="eiq" type="number" inputmode="numeric" value="${v(i.qty)}" /></div>
        <div><label>高さ(mm)<small>空欄=指定なし</small></label><input id="eih" type="number" inputmode="numeric" value="${i.height ? i.height : ""}" placeholder="未指定" /></div>
      </div>`;
  } else if (i.type === "pipe") {
    fields = `
      <div class="row two">
        <div><label>長さ(mm)</label><input id="eip" type="number" inputmode="numeric" value="${v(i.length)}" /></div>
        <div><label>所有本数</label><input id="eiq" type="number" inputmode="numeric" value="${v(i.qty)}" /></div>
      </div>`;
  } else {
    fields = `
      <div class="row two">
        <div><label>対応最小(mm)</label><input id="eimin" type="number" inputmode="numeric" value="${v(i.minW)}" /></div>
        <div><label>対応最大(mm)</label><input id="eimax" type="number" inputmode="numeric" value="${i.maxW && i.maxW < 999999 ? i.maxW : ""}" /></div>
      </div>
      <div class="row two">
        <div><label>所有数</label><input id="eiq" type="number" inputmode="numeric" value="${v(i.qty)}" /></div>
        <div><label>板(任意長カット)</label><select id="eicut"><option value="0"${i.cuttable ? "" : " selected"}>いいえ(スライド)</option><option value="1"${i.cuttable ? " selected" : ""}>はい(板)</option></select></div>
      </div>
      <div class="row two">
        <div><label>高さ(mm)<small>空欄=指定なし</small></label><input id="eih" type="number" inputmode="numeric" value="${i.height ? i.height : ""}" placeholder="未指定" /></div>
        <div></div>
      </div>`;
  }
  return `<div class="inv-edit">
    ${fields}
    <div class="edit-actions">
      <button class="btn" id="editCancel">キャンセル</button>
      <button class="btn primary" id="editSave">保存</button>
    </div>
  </div>`;
}

function appendEditRow(list, i) {
  const row = document.createElement("div");
  row.className = "inv-row editing";
  row.innerHTML = editFormHTML(i);
  row.querySelector("#editSave").onclick = () => saveEdit(i.id);
  row.querySelector("#editCancel").onclick = cancelEdit;
  list.appendChild(row);
}

/* ヒラパネルの使用優先順位を1つ入れ替える（dir: -1=上, +1=下） */
function moveStraight(id, dir) {
  const idxs = state.inventory
    .map((it, ix) => ({ it, ix }))
    .filter(o => o.it.type === "straight");
  const pos = idxs.findIndex(o => o.it.id === id);
  const swap = pos + dir;
  if (pos < 0 || swap < 0 || swap >= idxs.length) return;
  const a = idxs[pos].ix, b = idxs[swap].ix;
  const tmp = state.inventory[a];
  state.inventory[a] = state.inventory[b];
  state.inventory[b] = tmp;
  save(); renderInvList();
}

/* ヒラパネルを大きい順（既定の優先順位）に並べ替え */
function sortStraightsDesc() {
  const straights = state.inventory.filter(i => i.type === "straight").sort((a, b) => b.width - a.width);
  const others = state.inventory.filter(i => i.type !== "straight");
  state.inventory = [...straights, ...others];
  save(); renderInvList();
}

function cornerDim(a, b) {
  return a === b ? `脚 ${a}mm` : `脚 ${a}×${b}mm`;
}

function heightTag(h) {
  return h ? `<span class="htag">H${h}</span>` : "";
}

function otherRowHTML(i) {
  let label, badge, unit = "枚";
  const la = i.legA != null ? i.legA : (i.leg || 0);
  const lb = i.legB != null ? i.legB : la;
  if (i.type === "corner") { badge = "出隅"; label = `<b>${cornerDim(la, lb)}</b> 出隅コーナー枠${heightTag(i.height)}`; }
  else if (i.type === "cornerIn") { badge = "入隅"; label = `<b>${cornerDim(la, lb)}</b> 入隅コーナー枠${heightTag(i.height)}`; }
  else if (i.type === "pipe") { badge = "単管"; label = `<b>${i.length}mm</b> 単管`; unit = "本"; }
  else { badge = "調整"; label = (i.cuttable ? `<b>板</b> 任意長カット` : `<b>${i.minW}〜${i.maxW}mm</b> スライドパネル`) + heightTag(i.height); }
  return `
    <span class="badge ${i.type}">${badge}</span>
    <span class="name">${label}</span>
    <span class="qty">${i.cuttable ? "—" : i.qty + unit}</span>
    <button class="edit" aria-label="編集">✎</button>
    <button class="del">×</button>`;
}

function renderInvList() {
  const list = $("#invList");
  list.innerHTML = "";
  if (!state.inventory.length) { list.innerHTML = `<p class="empty">在庫が未登録です</p>`; return; }

  const straights = state.inventory.filter(i => i.type === "straight");
  const order = { corner: 1, cornerIn: 2, adjust: 3, pipe: 4 };
  const others = state.inventory.filter(i => i.type !== "straight")
    .sort((a, b) => (order[a.type] - order[b.type]) || ((b.legA || b.leg || b.length || b.maxW || 0) - (a.legA || a.leg || a.length || a.maxW || 0)));

  if (straights.length) {
    const head = document.createElement("div");
    head.className = "list-head";
    head.innerHTML = `<span>ヒラパネル<small>上ほど先に使う</small></span>` +
      (straights.length > 1 ? `<button class="mini" id="sortDesc">大きい順に並べる</button>` : "");
    list.appendChild(head);
    if (straights.length > 1) head.querySelector("#sortDesc").onclick = sortStraightsDesc;

    straights.forEach((i, idx) => {
      if (editingId === i.id) { appendEditRow(list, i); return; }
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = `
        <span class="rank">${idx + 1}</span>
        <span class="badge straight">パネル</span>
        <span class="name"><b>${i.width}mm</b> ヒラパネル${heightTag(i.height)}</span>
        <span class="qty">${i.qty}枚</span>
        <span class="reorder">
          <button class="up" ${idx === 0 ? "disabled" : ""} aria-label="優先度を上げる">▲</button>
          <button class="down" ${idx === straights.length - 1 ? "disabled" : ""} aria-label="優先度を下げる">▼</button>
        </span>
        <button class="edit" aria-label="編集">✎</button>
        <button class="del">×</button>`;
      row.querySelector(".up").onclick = () => moveStraight(i.id, -1);
      row.querySelector(".down").onclick = () => moveStraight(i.id, 1);
      row.querySelector(".edit").onclick = () => startEdit(i.id);
      row.querySelector(".del").onclick = () => delInv(i.id);
      list.appendChild(row);
    });
  }

  if (others.length) {
    const head = document.createElement("div");
    head.className = "list-head";
    head.innerHTML = `<span>コーナー枠・スライド・単管</span>`;
    list.appendChild(head);
    others.forEach(i => {
      if (editingId === i.id) { appendEditRow(list, i); return; }
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = otherRowHTML(i);
      row.querySelector(".edit").onclick = () => startEdit(i.id);
      row.querySelector(".del").onclick = () => delInv(i.id);
      list.appendChild(row);
    });
  }
}

/* ---- 結果表示 ---- */
function renderResult() {
  const area = $("#resultArea");
  const r = calculate({ project: curSite(), inventory: state.inventory });
  if (r.error) { area.innerHTML = `<p class="empty">${r.error}</p>`; return; }

  const shortCls = r.totalShort > 0 ? "bad" : "";

  let html = `
    <div class="kpis">
      <div class="kpi"><div class="v">${r.totalPieces}</div><div class="l">必要ピース総数（${r.faces.join("・")}面）</div></div>
      <div class="kpi ${shortCls}"><div class="v">${r.totalShort}</div><div class="l">在庫不足（枚・本）</div></div>
    </div>`;

  if (r.shapeWarnings.length) {
    html += `<div class="card warn"><h2>⚠️ 形状チェック</h2>` +
      r.shapeWarnings.map(w => `<p class="hint" style="color:#e3b341">${w}</p>`).join("") + `</div>`;
  }

  // 在庫突き合わせ表（型枠）
  html += `<div class="card"><h2>型枠の必要数量 と 在庫</h2>
    <table class="tbl">
      <tr><th>種類</th><th>必要</th><th>在庫</th><th>判定</th></tr>`;
  r.usage.forEach(u => {
    const name = u.type === "corner" ? `出隅コーナー(${cornerDim(u.legA, u.legB).replace("mm", "")})`
      : u.type === "cornerIn" ? `入隅コーナー(${cornerDim(u.legA, u.legB).replace("mm", "")})`
      : `ヒラパネル ${u.width}mm${u.height ? " ×H" + u.height : ""}`;
    const judge = u.short > 0 ? `<span class="tag-short">不足 ${u.short}</span>` : `<span class="tag-ok">OK</span>`;
    html += `<tr><td>${name}</td><td>${u.need}</td><td>${u.have}</td><td>${judge}</td></tr>`;
  });
  if (r.adjustNeed) html += `<tr><td>スライドパネル</td><td>${r.adjustNeed}</td><td>—</td><td>—</td></tr>`;
  if (r.boardCuts.length) html += `<tr><td>板カット</td><td>${r.boardCuts.length}本</td><td>—</td><td>—</td></tr>`;
  html += `</table>`;
  if (r.boardCuts.length) {
    html += `<p class="hint" style="margin-top:10px">板カット寸法: ${r.boardCuts.map(c => c + "mm").join(" / ")}</p>`;
  }
  html += `</div>`;

  // 単管
  if (r.pipe) {
    html += `<div class="card"><h2>単管の必要本数（${r.pipe.rows}段）</h2>
      <table class="tbl">
        <tr><th>長さ</th><th>必要</th><th>在庫</th><th>判定</th></tr>`;
    r.pipe.usage.forEach(u => {
      const judge = u.short > 0 ? `<span class="tag-short">不足 ${u.short}</span>` : `<span class="tag-ok">OK</span>`;
      html += `<tr><td>単管 ${u.length}mm</td><td>${u.need}本</td><td>${u.have}本</td><td>${judge}</td></tr>`;
    });
    html += `</table>
      <p class="hint" style="margin-top:10px">重ね代なしで隣に並べる前提。辺ごとの内訳は下の割付に表示。</p></div>`;
  }

  if (r.unresolved.length) {
    html += `<div class="card warn"><h2>⚠️ 要確認</h2>` +
      r.unresolved.map(u => `<p class="hint" style="color:#e3b341">${u}</p>`).join("") + `</div>`;
  }

  // 辺ごとの割付
  html += `<div class="card"><h2>辺ごとの割付</h2>`;
  const hasAsym = r.usage.some(u => (u.type === "corner" || u.type === "cornerIn") && u.legA !== u.legB && u.need > 0);
  if (hasAsym) {
    html += `<p class="hint">コーナーの「a→b」は向きの指定：a=この辺側の脚 / b=次の辺側の脚（割り切れるように向きを選んでいます）</p>`;
  }
  r.edgeResults.forEach(er => {
    html += `<div class="edge-result">
      <div class="eh"><b>${er.face}面・辺${er.idx}</b><span>${er.length}mm</span></div>
      <div class="pieces">` +
      er.pieces.map(pc => `<span class="chip ${pc.kind === 'corner' ? 'corner' : pc.kind === 'adjust' ? 'adjust' : pc.kind === 'short' ? 'short' : ''}">${pc.label}</span>`).join("") +
      `</div>` +
      (er.pipeText ? `<div class="pipe-line">単管: ${er.pipeText}</div>` : "") +
      `</div>`;
  });
  html += `</div>`;

  area.innerHTML = html;
}

/* ===================================================================
   現場（サイト）の切り替え・追加・削除
   =================================================================== */
function renderSiteBar() {
  const sel = $("#siteSelect");
  if (!sel) return;
  sel.innerHTML = state.sites.map(s =>
    `<option value="${s.id}"${s.id === state.currentSiteId ? " selected" : ""}>${(s.name || "（無名の現場）").replace(/</g, "&lt;")}</option>`
  ).join("");
  $("#siteCount").textContent = state.sites.length + " 現場";
}

function switchSite(id) {
  if (!state.sites.find(s => s.id === id)) return;
  state.currentSiteId = id;
  save();
  bindProject(); renderEdges(); renderSiteBar();
}

function addSite() {
  const s = newSite("現場" + (state.sites.length + 1));
  state.sites.push(s);
  state.currentSiteId = s.id;
  save();
  bindProject(); renderEdges(); renderSiteBar();
  $("#projName").focus();
  toast("現場を追加しました");
}

function deleteSite() {
  if (state.sites.length <= 1) return toast("最後の1現場は削除できません");
  const cur = curSite();
  if (!confirm(`現場「${cur.name || "無名"}」を削除しますか？（全端末から消えます）`)) return;
  state.sites = state.sites.filter(s => s.id !== cur.id);
  state.currentSiteId = state.sites[0].id;
  save();
  bindProject(); renderEdges(); renderSiteBar();
  toast("現場を削除しました");
}

function bindSiteBar() {
  const sel = $("#siteSelect");
  if (!sel) return;
  sel.onchange = e => switchSite(e.target.value);
  $("#addSite").onclick = addSite;
  $("#delSite").onclick = deleteSite;
  renderSiteBar();
}

/* ===================================================================
   クラウド同期（会社コードで在庫・現場を全端末共有）
   =================================================================== */
function applyRemote(data) {
  if (!data) return;
  let touched = false;
  if (data.inventory && JSON.stringify(data.inventory) !== JSON.stringify(state.inventory)) {
    state.inventory = normalizeInventory(data.inventory); touched = "inv";
  }
  if (data.sites && JSON.stringify(data.sites) !== JSON.stringify(state.sites)) {
    state.sites = data.sites.map(normalizeSite);
    if (!state.sites.length) { const p = newSite("現場1"); state.sites = [p]; }
    if (!state.sites.find(s => s.id === state.currentSiteId)) state.currentSiteId = state.sites[0].id;
    touched = touched ? "both" : "sites";
  }
  if (!touched) return;
  localStorage.setItem("kiso-formwork", JSON.stringify(state));

  if (touched === "inv" || touched === "both") renderInvList();
  if (touched === "sites" || touched === "both") {
    renderSiteBar();
    // 編集中の入力を邪魔しないよう、寸法欄にフォーカスがないときだけ再描画
    const active = document.activeElement;
    const editingProject = active && $("#tab-project") && $("#tab-project").contains(active);
    if (!editingProject) { bindProject(); renderEdges(); }
  }
  if ($("#tab-result").classList.contains("active")) renderResult();
}

function syncStatusLabel(s) {
  return { off: "未接続", connecting: "接続中…", online: "オンライン同期中", offline: "オフライン（後で同期）", error: "エラー" }[s] || s;
}

function renderSyncTab() {
  const box = $("#syncArea");
  if (!box) return;
  const connected = window.Sync && Sync.connected;
  const status = window.Sync ? Sync.status : "off";
  const dotCls = status === "online" ? "on" : status === "offline" ? "off-net" : status === "error" ? "err" : "";

  if (!connected) {
    box.innerHTML = `
      <div class="card">
        <h2>会社で在庫・現場を共有する</h2>
        <p class="hint">会社共通の「合言葉（コード）」でつなぐと、在庫と現場が全員のスマホでリアルタイムに共有されます。オフラインでも閲覧でき、電波が戻ると自動同期します。</p>
        <p class="hint">初回のみ、会社で1人が Firebase（無料）を用意します。手順は <b>FIREBASE_SETUP.md</b> を参照。2人目以降は招待リンク/QRを開くだけです。</p>
      </div>
      <div class="card">
        <h2>① Firebase設定（管理者・初回のみ）</h2>
        <label>Firebaseの設定（コンソールの設定をそのまま貼り付け）</label>
        <textarea id="fbCfg" rows="7" placeholder='const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  ...\n};'></textarea>
      </div>
      <div class="card">
        <h2>② 会社コード（合言葉）</h2>
        <label>全員で同じものを使います（推測されにくい長めの語を推奨）</label>
        <input id="joinCode" type="text" placeholder="例: yamada-kensetsu-2024-abc" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <button class="btn primary big" id="connectBtn">接続する</button>
      </div>`;
    $("#connectBtn").onclick = async () => {
      const fb = Sync.parseFirebaseConfig($("#fbCfg").value);
      const code = ($("#joinCode").value || "").trim();
      if (!fb) return toast("Firebase設定を読み取れません。貼り付け内容を確認してください");
      if (code.length < 4) return toast("会社コードは4文字以上にしてください");
      toast("接続しています…");
      const ok = await Sync.connect(fb, code);
      if (ok) { renderSyncTab(); toast("接続しました"); }
      else renderSyncTab();
    };
  } else {
    const link = Sync.inviteLink();
    box.innerHTML = `
      <div class="card">
        <h2>接続状況</h2>
        <p class="sync-line"><span class="sync-dot ${dotCls}"></span>${syncStatusLabel(status)}</p>
        <p class="hint">会社コード: <b>${(Sync.code || "").replace(/</g, "&lt;")}</b></p>
        <p class="hint">在庫と現場は、このコードでつながった全端末で共有されています。</p>
        <button class="btn" id="disconnectBtn">この端末を切断</button>
      </div>
      <div class="card">
        <h2>仲間を招待</h2>
        <p class="hint">下のQRを他の人のスマホのカメラで読むか、リンクを送ってください。開くだけで同じ在庫・現場につながります（Firebase設定の再入力は不要）。</p>
        <div id="inviteQR" class="invite-qr"></div>
        <button class="btn" id="copyInvite">招待リンクをコピー</button>
      </div>`;
    $("#disconnectBtn").onclick = () => {
      if (!confirm("この端末を同期から切断します（データはクラウドに残ります）。よろしいですか？")) return;
      Sync.disconnect(); renderSyncTab(); updateSyncChip();
    };
    $("#copyInvite").onclick = () => navigator.clipboard.writeText(link).then(() => toast("招待リンクをコピーしました"));
    const qbox = $("#inviteQR");
    try {
      const qr = qrcode(0, "M"); qr.addData(link); qr.make();
      qbox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      const svg = qbox.querySelector("svg"); if (svg) { svg.style.width = "180px"; svg.style.height = "180px"; }
    } catch (e) { qbox.innerHTML = `<span class="hint">QRを表示できません。リンクをコピーして共有してください。</span>`; }
  }
}

function updateSyncChip() {
  const chip = $("#syncChip");
  if (!chip) return;
  const status = window.Sync ? Sync.status : "off";
  const connected = window.Sync && Sync.connected;
  chip.className = "sync-chip " + (status === "online" ? "on" : status === "offline" ? "off-net" : status === "error" ? "err" : "");
  chip.textContent = connected ? (status === "online" ? "同期中" : status === "offline" ? "オフライン" : status === "error" ? "同期エラー" : "接続中") : "";
  chip.style.display = connected ? "inline-block" : "none";
}

/* ---- 初期化 ---- */
bindProject();
bindInventory();
bindSiteBar();
renderEdges();
renderInvList();

if (window.Sync) {
  Sync.onData(applyRemote);
  Sync.onStatus(() => { updateSyncChip(); if ($("#tab-sync") && $("#tab-sync").classList.contains("active")) renderSyncTab(); });
  Sync.autoStart();
  renderSyncTab();
  updateSyncChip();
}

/* ---- Service Worker 登録（PWA） ---- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
