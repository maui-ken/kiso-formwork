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

  const cornerOut = state.inventory.find(i => i.type === "corner");
  const cornerIn  = state.inventory.find(i => i.type === "cornerIn");
  const legOut = cornerOut ? cornerOut.leg : (cornerIn ? cornerIn.leg : 0);
  const legIn  = cornerIn ? cornerIn.leg : legOut;
  const legOf = t => t === "in" ? legIn : legOut;

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

  const faces = p.bothFaces ? ["外", "内"] : ["外"];
  const need = {};
  straights.forEach(s => need[s.width] = 0);
  let cornerOutNeed = 0, cornerInNeed = 0;
  let adjustNeed = 0;
  let boardCuts = [];
  const unresolved = [];
  const edgeResults = [];
  const N = edges.length;

  for (const face of faces) {
    edges.forEach((edge, ei) => {
      const hasStartCorner = p.closed || ei > 0;
      const hasEndCorner   = p.closed || ei < N - 1;
      const startCorner = hasStartCorner ? edges[(ei - 1 + N) % N].corner : null;
      const endCorner   = hasEndCorner ? edge.corner : null;

      // 面の長さ: 内面は隣接する出隅で−基礎幅、入隅で＋基礎幅
      let L = edge.length;
      if (face === "内") {
        [startCorner, endCorner].forEach(c => {
          if (c === "out") L -= p.thickness;
          else if (c === "in") L += p.thickness;
        });
        L = Math.max(0, L);
      }

      // この面でこの辺の両端が消費するコーナー枠の脚
      let legTotal = 0;
      const pieces = [];
      if (startCorner) legTotal += legOf(frameTypeAt(startCorner, face));
      if (endCorner) {
        const ft = frameTypeAt(endCorner, face);
        legTotal += legOf(ft);
        // 角は「辺の終点側」で1回だけ数える（閉じた形なら辺数＝角数）
        if (ft === "in") cornerInNeed++; else cornerOutNeed++;
        pieces.push({ kind: "corner", label: (ft === "in" ? "入隅" : "出隅") + "(脚" + legOf(ft) + ")" });
      }

      let remaining = L - legTotal;

      if (remaining < -TOLERANCE) {
        unresolved.push(face + "・辺" + (ei + 1) + ": 長さ " + L + "mm がコーナー寸法に足りません");
        edgeResults.push({ face, idx: ei + 1, length: Math.round(L), pieces, leftover: 0, short: true, pipeText: "" });
        return;
      }

      for (const s of straights) {
        while (s.width > 0 && remaining >= s.width) {
          remaining -= s.width;
          need[s.width]++;
          pieces.push({ kind: "straight", label: "" + s.width, width: s.width });
        }
      }

      let leftover = remaining;
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

  if (cornerOutNeed > 0 && !cornerOut) unresolved.push("出隅コーナー枠が在庫未登録です（必要 " + cornerOutNeed + "）");
  if (cornerInNeed > 0 && !cornerIn) unresolved.push("入隅コーナー枠が在庫未登録です（必要 " + cornerInNeed + "・脚は出隅と同寸で仮計算）");

  const usage = straights.map(s => ({
    type: "straight", width: s.width, need: need[s.width], have: s.qty,
    short: Math.max(0, need[s.width] - s.qty),
  }));
  usage.push({ type: "corner", leg: legOut, need: cornerOutNeed, have: cornerOut ? cornerOut.qty : 0, short: Math.max(0, cornerOutNeed - (cornerOut ? cornerOut.qty : 0)) });
  if (cornerInNeed > 0 || cornerIn) {
    usage.push({ type: "cornerIn", leg: legIn, need: cornerInNeed, have: cornerIn ? cornerIn.qty : 0, short: Math.max(0, cornerInNeed - (cornerIn ? cornerIn.qty : 0)) });
  }

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

if (typeof module !== "undefined" && module.exports) module.exports = { calculate, polygonPoints, pipeCombo, TOLERANCE };
