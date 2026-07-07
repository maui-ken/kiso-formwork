/* ===================================================================
   基礎型枠 割付計算エンジン（純粋関数・DOM非依存）
   ブラウザでは global の calculate / polygonPoints / TOLERANCE を定義。
   テスト(JXA/Node)では eval してそのまま利用可能。

   データモデル:
   - edge: { length, corner } corner は「この辺の終点の角」の種類
     "out"=出隅(凸) / "in"=入隅(凹)。閉じた形なら辺の数＝角の数。
   - inventory type: straight(ヒラパネル) / corner(出隅コーナー枠) /
     cornerIn(入隅コーナー枠) / adjust(スライドパネル・板) / pipe(単管)
   =================================================================== */

var TOLERANCE = 5; // mm 未満の端は目地公差として無視

/* 平面図の頂点列を計算（全角90°前提・時計回り）。
   閉じるかどうかの検証とプレビュー描画に使う。 */
function polygonPoints(edges, closed) {
  let x = 0, y = 0, dx = 1, dy = 0;
  const pts = [{ x: 0, y: 0 }];
  let outCount = 0, inCount = 0;
  edges.forEach((e, i) => {
    x += dx * e.length; y += dy * e.length;
    pts.push({ x, y });
    const isLast = i === edges.length - 1;
    if (closed || !isLast) {
      if (e.corner === "in") { inCount++;  const nx = dy,  ny = -dx; dx = nx; dy = ny; }
      else                   { outCount++; const nx = -dy, ny = dx;  dx = nx; dy = ny; }
    }
  });
  const gap = closed ? Math.hypot(pts[pts.length - 1].x, pts[pts.length - 1].y) : 0;
  return { pts, outCount, inCount, gap };
}

/* その角で使うコーナー枠の種類。
   建物の出隅は 外面=出隅枠 / 内面=入隅枠、入隅の角はその逆。 */
function frameTypeAt(cornerType, face) {
  if (face === "外") return cornerType === "in" ? "in" : "out";
  return cornerType === "in" ? "out" : "in";
}

/* 長さ v が所有パネル幅の組合せでちょうど作れるか（部分和・各幅は何枚でも可）を
   0..maxLen まで前計算する。割り切れる寸法の判定に使う。 */
function bestReachable(maxLen, widths) {
  const reach = new Uint8Array(Math.max(0, maxLen) + 1);
  reach[0] = 1;
  for (let v = 1; v <= maxLen; v++) {
    for (let k = 0; k < widths.length; k++) {
      const w = widths[k];
      if (w > 0 && w <= v && reach[v - w]) { reach[v] = 1; break; }
    }
  }
  return reach;
}

/* 残り長さ R を、なるべく割り切れる（端数を最小化する）ように所有パネルで埋める。
   ① まず R 以下で「パネルだけでちょうど作れる」最大長 target を求める（端数最小）。
   ② その target を、使用優先順位（priorityWidths の並び）を尊重して分解する
      ＝上位の枠を、残りが割り切れる範囲で可能な限り多く使う。
   端数（R - target）はスライド枠/板で仕上げるため leftover として返す。 */
function packPanels(R, priorityWidths, reach) {
  R = Math.round(R);
  if (R <= TOLERANCE) return { counts: {}, seq: [], leftover: Math.max(0, R) };

  let target = Math.min(R, reach.length - 1);
  while (target > 0 && !reach[target]) target--;

  const counts = {};
  const seq = [];
  let remaining = target, guard = 0;
  for (let k = 0; k < priorityWidths.length; k++) {
    const w = priorityWidths[k];
    while (w > 0 && w <= remaining && reach[remaining - w] && guard++ < 100000) {
      counts[w] = (counts[w] || 0) + 1;
      seq.push(w);
      remaining -= w;
    }
  }

  let leftover = R - target;
  if (remaining > 0) leftover += remaining; // 念のための保険（通常 remaining は 0）
  return { counts, seq, leftover };
}

/* コーナー枠の脚寸法。旧データ {leg} は A=B、新データは {legA, legB}。 */
function legsOfItem(i) {
  const a = +i.legA || +i.leg || 0;
  const b = +i.legB || a;
  return { a, b };
}

/* 各角に「どのコーナー枠を・どの向きで」使うかを選ぶ。
   選択肢 = 所有バリエーション × 向き（脚A/Bが違う枠は回転できる）。
   辺ごとの端数（パネルで割り切れない余り）の合計が最小になる組合せを探す。
   組合せが少なければ全探索、多ければ1角ずつの局所改善で近似する。 */
function chooseCorners(faceLens, cornerOptions, closed, best, tol) {
  const M = cornerOptions.length;
  if (!M) return [];
  const N = faceLens.length;
  const maxIdx = best.length - 1;

  function cost(idx) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const endC = i < M ? i : -1;
      const startC = i > 0 ? i - 1 : (closed ? M - 1 : -1);
      let R = faceLens[i];
      if (endC >= 0) R -= cornerOptions[endC][idx[endC]].toPrev;
      if (startC >= 0) R -= cornerOptions[startC][idx[startC]].toNext;
      if (R < -tol) { sum += 1e9; continue; }
      const r = Math.max(0, Math.round(R));
      sum += r - best[Math.min(r, maxIdx)];
    }
    return sum;
  }

  let total = 1;
  for (let c = 0; c < M; c++) { total *= cornerOptions[c].length; if (total > 65536) break; }

  const idx = new Array(M).fill(0);
  if (total <= 65536) {
    let bestIdx = idx.slice(), bestCost = cost(idx);
    while (bestCost > 0) {
      let k = 0;
      while (k < M) { idx[k]++; if (idx[k] < cornerOptions[k].length) break; idx[k] = 0; k++; }
      if (k === M) break;
      const c = cost(idx);
      if (c < bestCost) { bestCost = c; bestIdx = idx.slice(); }
    }
    return bestIdx.map((oi, c) => cornerOptions[c][oi]);
  }

  // 局所改善（座標降下）
  let cur = cost(idx);
  for (let pass = 0; pass < 50 && cur > 0; pass++) {
    let improved = false;
    for (let c = 0; c < M; c++) {
      let bi = idx[c], bc = cur;
      for (let oi = 0; oi < cornerOptions[c].length; oi++) {
        if (oi === bi) continue;
        idx[c] = oi;
        const c2 = cost(idx);
        if (c2 < bc) { bc = c2; bi = oi; }
      }
      idx[c] = bi;
      if (bc < cur) { cur = bc; improved = true; }
    }
    if (!improved) break;
  }
  return idx.map((oi, c) => cornerOptions[c][oi]);
}

/* 1本の走行長 L を所有単管の組合せで覆う（重ね代なし・隣に並べる）。
   大きい順に詰め、最後はその余りを覆える最小の1本で仕上げる。 */
function pipeCombo(L, lengths) {
  const counts = {};
  let rem = L;
  while (rem > TOLERANCE) {
    const finisher = lengths.filter(l => l >= rem).sort((a, b) => a - b)[0];
    if (finisher) { counts[finisher] = (counts[finisher] || 0) + 1; rem = 0; break; }
    const largest = lengths[0];
    counts[largest] = (counts[largest] || 0) + 1;
    rem -= largest;
  }
  return counts;
}

function calculate(state) {
  const p = state.project;
  const edges = p.edges.filter(e => e.length > 0)
    .map(e => ({ length: e.length, corner: e.corner === "in" ? "in" : "out" }));
  if (!edges.length) return { error: "辺の長さが入力されていません。" };

  // 使用優先順位は在庫内の並び順に従う（先にあるパネルから先に使う）。
  // 既定は大きい順だが、ユーザーが並べ替えれば小さい枠を優先することもできる。
  const straights = state.inventory.filter(i => i.type === "straight" && i.width > 0);
  if (!straights.length) return { error: "ヒラパネルが在庫に登録されていません。" };

  // コーナー枠: 脚A×脚B（左右で長さが違うものに対応。旧データの leg は A=B として扱う）
  // 同じ種類を複数サイズ所有していてもよい。どの角にどれをどの向きで使うかは
  // 「なるべく割り切れる」ように探索して決める。
  const mkVariants = items => items.map(it => {
    const legs = legsOfItem(it);
    return { id: it.id || ("v" + Math.random().toString(36).slice(2, 7)), qty: it.qty || 0, a: legs.a, b: legs.b };
  });
  let outVariants = mkVariants(state.inventory.filter(i => i.type === "corner"));
  let inVariants  = mkVariants(state.inventory.filter(i => i.type === "cornerIn"));
  const outMissing = !outVariants.length;
  const inMissing  = !inVariants.length;
  if (outMissing) outVariants = [{ id: "_outSynth", qty: 0, a: inVariants.length ? inVariants[0].a : 0, b: inVariants.length ? inVariants[0].b : 0, synth: true }];
  if (inMissing)  inVariants  = [{ id: "_inSynth",  qty: 0, a: outVariants[0].a, b: outVariants[0].b, synth: true }];

  const adjusters = state.inventory.filter(i => i.type === "adjust").sort((a, b) => a.maxW - b.maxW);
  const board = adjusters.find(a => a.cuttable);

  const pipes = state.inventory
    .filter(i => i.type === "pipe" && i.length > 0)
    .sort((a, b) => b.length - a.length);
  const pipeRows = Math.max(0, +p.pipeRows || 0);
  const pipeLengths = pipes.map(i => i.length);
  const pipeNeed = {};
  pipes.forEach(i => pipeNeed[i.length] = 0);
  const pipeEdgeCombos = [];

  // 割り切れる組合せ探索の準備（優先順位＝在庫の並び順、重複幅は除く）
  const priorityWidths = [];
  straights.forEach(s => { if (!priorityWidths.includes(s.width)) priorityWidths.push(s.width); });
  const maxLen = Math.round(Math.max(...edges.map(e => e.length)) + 2 * (p.thickness || 0)) + 1;
  const reach = bestReachable(maxLen, priorityWidths);
  // best[v] = v 以下でパネルだけで作れる最大長（端数 = v - best[v]）
  const best = new Int32Array(maxLen + 1);
  for (let v = 1; v <= maxLen; v++) best[v] = reach[v] ? v : best[v - 1];

  const faces = p.bothFaces ? ["外", "内"] : ["外"];
  const need = {};
  straights.forEach(s => need[s.width] = 0);
  const cornerNeed = {};
  let adjustNeed = 0;
  let boardCuts = [];
  const unresolved = [];
  const edgeResults = [];
  const N = edges.length;

  for (const face of faces) {
    // 面ごとの辺の長さ: 内面は隣接する出隅で−基礎幅、入隅で＋基礎幅
    const faceLens = edges.map((edge, ei) => {
      const startCorner = (p.closed || ei > 0) ? edges[(ei - 1 + N) % N].corner : null;
      const endCorner   = (p.closed || ei < N - 1) ? edge.corner : null;
      let L = edge.length;
      if (face === "内") {
        [startCorner, endCorner].forEach(c => {
          if (c === "out") L -= p.thickness;
          else if (c === "in") L += p.thickness;
        });
        L = Math.max(0, L);
      }
      return L;
    });

    // 角ごとの選択肢（所有コーナー枠の種類×向き）。角 c は辺 c と次の辺の間。
    const cornerCount = p.closed ? N : Math.max(0, N - 1);
    const cornerOptions = [];
    for (let c = 0; c < cornerCount; c++) {
      const ft = frameTypeAt(edges[c].corner, face);
      const vars = ft === "in" ? inVariants : outVariants;
      const opts = [];
      vars.forEach(v => {
        opts.push({ ft, v, toPrev: v.a, toNext: v.b });
        if (v.a !== v.b) opts.push({ ft, v, toPrev: v.b, toNext: v.a });
      });
      cornerOptions.push(opts);
    }
    // なるべく割り切れるように、各角の枠と向きを決める
    const choice = chooseCorners(faceLens, cornerOptions, p.closed, best, TOLERANCE);

    edges.forEach((edge, ei) => {
      const endC   = ei < cornerCount ? ei : -1;
      const startC = ei > 0 ? ei - 1 : (p.closed ? cornerCount - 1 : -1);
      const startOpt = startC >= 0 ? choice[startC] : null;
      const endOpt   = endC >= 0 ? choice[endC] : null;
      const L = faceLens[ei];

      // この面でこの辺の両端が消費するコーナー枠の脚
      let legTotal = 0;
      const pieces = [];
      if (startOpt) legTotal += startOpt.toNext;
      if (endOpt) {
        legTotal += endOpt.toPrev;
        // 角は「辺の終点側」で1回だけ数える（閉じた形なら辺数＝角数）
        cornerNeed[endOpt.v.id] = (cornerNeed[endOpt.v.id] || 0) + 1;
        const nm = endOpt.ft === "in" ? "入隅" : "出隅";
        const lbl = endOpt.v.a === endOpt.v.b
          ? nm + "(脚" + endOpt.v.a + ")"
          : nm + "(" + endOpt.toPrev + "→" + endOpt.toNext + ")";
        pieces.push({ kind: "corner", label: lbl });
      }

      let remaining = L - legTotal;

      if (remaining < -TOLERANCE) {
        unresolved.push(face + "・辺" + (ei + 1) + ": 長さ " + L + "mm がコーナー寸法に足りません");
        edgeResults.push({ face, idx: ei + 1, length: Math.round(L), pieces, leftover: 0, short: true, pipeText: "" });
        return;
      }

      // 優先順位を尊重しつつ、割り切れるようにパネルを割り振る
      const pack = packPanels(remaining, priorityWidths, reach);
      pack.seq.forEach(w => {
        need[w]++;
        pieces.push({ kind: "straight", label: "" + w, width: w });
      });

      let leftover = pack.leftover;
      if (leftover > TOLERANCE) {
        const fit = adjusters.find(a => !a.cuttable && leftover >= a.minW && leftover <= a.maxW);
        if (fit) {
          adjustNeed++;
          pieces.push({ kind: "adjust", label: "スライド " + leftover.toFixed(0) });
        } else if (board) {
          boardCuts.push(Math.round(leftover));
          pieces.push({ kind: "adjust", label: "板カット " + leftover.toFixed(0) });
        } else {
          unresolved.push(face + "・辺" + (ei + 1) + ": 端 " + leftover.toFixed(0) + "mm を埋めるスライドパネル/板がありません");
          pieces.push({ kind: "short", label: "未処理 " + leftover.toFixed(0) });
        }
        leftover = 0;
      }

      // 単管（この面の走行長を段数ぶん覆う）
      let pipeText = "";
      if (pipes.length && pipeRows > 0 && L > TOLERANCE) {
        const combo = pipeCombo(L, pipeLengths);
        const parts = [];
        Object.keys(combo).sort((a, b) => b - a).forEach(len => {
          pipeNeed[len] = (pipeNeed[len] || 0) + combo[len] * pipeRows;
          parts.push(len + "×" + combo[len]);
        });
        pipeText = parts.join(" + ") + (pipeRows > 1 ? "（×" + pipeRows + "段）" : "");
      }

      edgeResults.push({ face, idx: ei + 1, length: Math.round(L), pieces, leftover, short: false, pipeText });
    });
  }

  const outNeedTotal = outVariants.reduce((a, v) => a + (cornerNeed[v.id] || 0), 0);
  const inNeedTotal  = inVariants.reduce((a, v) => a + (cornerNeed[v.id] || 0), 0);
  if (outNeedTotal > 0 && outMissing) unresolved.push("出隅コーナー枠が在庫未登録です（必要 " + outNeedTotal + "）");
  if (inNeedTotal > 0 && inMissing) unresolved.push("入隅コーナー枠が在庫未登録です（必要 " + inNeedTotal + "・脚は出隅と同寸で仮計算）");

  const usage = straights.map(s => ({
    type: "straight", width: s.width, need: need[s.width], have: s.qty,
    short: Math.max(0, need[s.width] - s.qty),
  }));
  [[outVariants, "corner"], [inVariants, "cornerIn"]].forEach(pair => {
    const vars = pair[0], type = pair[1];
    vars.forEach(v => {
      const cNeed = cornerNeed[v.id] || 0;
      if (cNeed > 0 || !v.synth) usage.push({
        type, legA: v.a, legB: v.b, leg: v.a,
        need: cNeed, have: v.qty, short: Math.max(0, cNeed - v.qty),
      });
    });
  });

  const pipeUsage = pipes.map(i => ({
    type: "pipe", length: i.length, need: pipeNeed[i.length] || 0, have: i.qty,
    short: Math.max(0, (pipeNeed[i.length] || 0) - i.qty),
  })).filter(u => u.need > 0 || u.have > 0);
  const pipeTotalNeed = pipeUsage.reduce((a, u) => a + u.need, 0);
  const pipeTotalShort = pipeUsage.reduce((a, u) => a + u.short, 0);

  // 形状チェック（閉じた外周・全角90°前提）
  const shapeWarnings = [];
  let geometry = null;
  if (edges.length >= 3) {
    geometry = polygonPoints(edges, p.closed);
    if (p.closed) {
      if (geometry.outCount - geometry.inCount !== 4) {
        shapeWarnings.push("出隅−入隅が4になっていません（出隅" + geometry.outCount + "・入隅" + geometry.inCount + "）。角の出/入を確認してください。");
      } else if (geometry.gap > TOLERANCE) {
        shapeWarnings.push("この辺の長さでは形が閉じません（誤差 " + Math.round(geometry.gap) + "mm）。寸法を確認してください。");
      }
    }
  }

  const totalPieces = usage.reduce((a, u) => a + u.need, 0) + adjustNeed + boardCuts.length;
  const frameShort = usage.reduce((a, u) => a + u.short, 0);
  const totalShort = frameShort + pipeTotalShort;

  return {
    faces, usage, adjustNeed, boardCuts, unresolved, edgeResults,
    totalPieces, totalShort, frameShort, edgeCount: edges.length,
    pipe: pipes.length && pipeRows > 0
      ? { rows: pipeRows, usage: pipeUsage, totalNeed: pipeTotalNeed, totalShort: pipeTotalShort }
      : null,
    shapeWarnings, geometry,
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { calculate, polygonPoints, pipeCombo, packPanels, bestReachable, TOLERANCE };
