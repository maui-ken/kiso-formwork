/* ===================================================================
   基礎型枠 割付計算 PWA  —  app.js
   依存ゼロ / localStorage 永続化
   =================================================================== */

/* 計算エンジンは engine.js（calculate / polygonPoints / TOLERANCE）に分離 */

/* ---------- 状態 ---------- */
const defaultState = () => ({
  project: { name: "", thickness: 150, bothFaces: 1, closed: true, pipeRows: 1, edges: [] },
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
});

let state = load();

function uid() { return Math.random().toString(36).slice(2, 9); }
function save() { localStorage.setItem("kiso-formwork", JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem("kiso-formwork"));
    if (s && s.project && s.inventory) {
      // v1 → v2 移行
      if (s.project.pipeRows == null) s.project.pipeRows = 1;
      s.project.edges.forEach(e => { if (e.corner !== "in" && e.corner !== "out") e.corner = "out"; });
      // コーナー枠の旧データ {leg} → {legA, legB}
      s.inventory.forEach(i => {
        if (i.type === "corner" || i.type === "cornerIn") {
          if (i.legA == null) i.legA = i.leg || 0;
          if (i.legB == null) i.legB = i.legA;
        }
      });
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
}));

/* ---- プロジェクト入力 ---- */
function bindProject() {
  $("#projName").value = state.project.name;
  $("#thickness").value = state.project.thickness;
  $("#bothFaces").value = state.project.bothFaces;
  $("#pipeRows").value = state.project.pipeRows;
  $("#closed").checked = state.project.closed;

  $("#projName").oninput = e => { state.project.name = e.target.value; save(); };
  $("#thickness").oninput = e => { state.project.thickness = +e.target.value || 0; save(); };
  $("#bothFaces").onchange = e => { state.project.bothFaces = +e.target.value; save(); };
  $("#pipeRows").oninput = e => { state.project.pipeRows = Math.max(0, +e.target.value || 0); save(); };
  $("#closed").onchange = e => { state.project.closed = e.target.checked; save(); renderEdges(); };

  $("#addEdge").onclick = () => {
    const v = +$("#edgeLen").value;
    if (!v || v <= 0) return toast("辺の長さを入力してください");
    state.project.edges.push({ id: uid(), length: v, corner: "out" });
    $("#edgeLen").value = ""; save(); renderEdges();
  };
  $("#edgeLen").addEventListener("keydown", e => { if (e.key === "Enter") $("#addEdge").click(); });

  $("#addRect").onclick = () => {
    const w = +$("#rectW").value, d = +$("#rectD").value;
    if (!w || !d) return toast("横・縦を入力してください");
    [w, d, w, d].forEach(len => state.project.edges.push({ id: uid(), length: len, corner: "out" }));
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
  const n = state.project.edges.length;
  state.project.edges.forEach((e, i) => {
    if (e.corner !== "in") e.corner = "out";
    const showCorner = state.project.closed || i < n - 1;
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
  renderPreview(edges);
}

/* ---- 平面図プレビュー ---- */
function renderPreview(edges) {
  const box = $("#shapePreview");
  if (edges.length < 3) { box.innerHTML = ""; box.style.display = "none"; return; }
  const g = polygonPoints(edges, state.project.closed);
  const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const pad = Math.max(w, h) * 0.08;
  const ptsAttr = g.pts.map(p => `${p.x},${p.y}`).join(" ");

  let status = "";
  if (state.project.closed) {
    if (g.outCount - g.inCount !== 4) status = `<span class="pv-warn">⚠ 出隅${g.outCount}・入隅${g.inCount}（出隅−入隅=4 が正）</span>`;
    else if (g.gap > TOLERANCE) status = `<span class="pv-warn">⚠ 閉じません（誤差 ${Math.round(g.gap)}mm）</span>`;
    else status = `<span class="pv-ok">✓ 形が閉じています（出隅${g.outCount}・入隅${g.inCount}）</span>`;
  }

  box.style.display = "block";
  box.innerHTML = `
    <svg viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" preserveAspectRatio="xMidYMid meet">
      <${state.project.closed ? "polygon" : "polyline"} points="${ptsAttr}"
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
      </div>`;
  } else if (invType === "corner" || invType === "cornerIn") {
    f.innerHTML = `
      <div class="row two">
        <div><label>脚A(mm)<small>角の片側の寸法</small></label><input id="ila" type="number" inputmode="numeric" placeholder="例 150" /></div>
        <div><label>脚B(mm)<small>反対側。同じなら空欄でOK</small></label><input id="ilb" type="number" inputmode="numeric" placeholder="例 235" /></div>
      </div>
      <div class="row two">
        <div><label>所有枚数</label><input id="iq" type="number" inputmode="numeric" placeholder="例 8" /></div>
        <div></div>
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
      </div>`;
  }
}

function addInventory() {
  if (invType === "straight") {
    const w = +$("#iw").value, q = +$("#iq").value;
    if (!w) return toast("横幅を入力してください");
    state.inventory.push({ id: uid(), type: "straight", width: w, qty: q || 0 });
  } else if (invType === "corner" || invType === "cornerIn") {
    const a = +$("#ila").value, b = +$("#ilb").value || a, q = +$("#iq").value;
    if (!a) return toast("脚Aを入力してください");
    state.inventory.push({ id: uid(), type: invType, legA: a, legB: b, qty: q || 0 });
  } else if (invType === "pipe") {
    const l = +$("#ip").value, q = +$("#iq").value;
    if (!l) return toast("長さを入力してください");
    state.inventory.push({ id: uid(), type: "pipe", length: l, qty: q || 0 });
  } else {
    const min = +$("#imin").value || 0, max = +$("#imax").value, q = +$("#iq").value, cut = $("#icut").value === "1";
    if (!cut && !max) return toast("対応最大を入力してください");
    state.inventory.push({ id: uid(), type: "adjust", minW: min, maxW: max || 999999, qty: q || 0, cuttable: cut });
  }
  save(); renderInvList(); toast("在庫に追加しました");
}

function delInv(id) {
  state.inventory = state.inventory.filter(x => x.id !== id);
  save(); renderInvList();
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

function otherRowHTML(i) {
  let label, badge, unit = "枚";
  const la = i.legA != null ? i.legA : (i.leg || 0);
  const lb = i.legB != null ? i.legB : la;
  if (i.type === "corner") { badge = "出隅"; label = `<b>${cornerDim(la, lb)}</b> 出隅コーナー枠`; }
  else if (i.type === "cornerIn") { badge = "入隅"; label = `<b>${cornerDim(la, lb)}</b> 入隅コーナー枠`; }
  else if (i.type === "pipe") { badge = "単管"; label = `<b>${i.length}mm</b> 単管`; unit = "本"; }
  else { badge = "調整"; label = i.cuttable ? `<b>板</b> 任意長カット` : `<b>${i.minW}〜${i.maxW}mm</b> スライドパネル`; }
  return `
    <span class="badge ${i.type}">${badge}</span>
    <span class="name">${label}</span>
    <span class="qty">${i.cuttable ? "—" : i.qty + unit}</span>
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
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = `
        <span class="rank">${idx + 1}</span>
        <span class="badge straight">パネル</span>
        <span class="name"><b>${i.width}mm</b> ヒラパネル</span>
        <span class="qty">${i.qty}枚</span>
        <span class="reorder">
          <button class="up" ${idx === 0 ? "disabled" : ""} aria-label="優先度を上げる">▲</button>
          <button class="down" ${idx === straights.length - 1 ? "disabled" : ""} aria-label="優先度を下げる">▼</button>
        </span>
        <button class="del">×</button>`;
      row.querySelector(".up").onclick = () => moveStraight(i.id, -1);
      row.querySelector(".down").onclick = () => moveStraight(i.id, 1);
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
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = otherRowHTML(i);
      row.querySelector(".del").onclick = () => delInv(i.id);
      list.appendChild(row);
    });
  }
}

/* ---- 結果表示 ---- */
function renderResult() {
  const area = $("#resultArea");
  const r = calculate(state);
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
      : `ヒラパネル ${u.width}mm`;
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

/* ---- 初期化 ---- */
bindProject();
bindInventory();
renderEdges();
renderInvList();

/* ---- Service Worker 登録（PWA） ---- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
