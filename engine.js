/* ===================================================================
   基礎型枠 割付計算エンジン（純粋関数・DOM非依存）
   ブラウザでは global の calculate / TOLERANCE を定義。
   テスト(JXA/Node)では eval してそのまま利用可能。
   =================================================================== */

var TOLERANCE = 5; // mm 未満の端は目地公差として無視

function calculate(state) {
  const p = state.project;
  const edges = p.edges.filter(e => e.length > 0);
  if (!edges.length) return { error: "辺の長さが入力されていません。" };

  const straights = state.inventory
    .filter(i => i.type === "straight" && i.width > 0)
    .sort((a, b) => b.width - a.width);
  if (!straights.length) return { error: "直線枠が在庫に登録されていません。" };

  const corner = state.inventory.find(i => i.type === "corner");
  const cornerLeg = corner ? corner.leg : 0;
  const adjusters = state.inventory.filter(i => i.type === "adjust").sort((a, b) => a.maxW - b.maxW);
  const board = adjusters.find(a => a.cuttable);

  const faces = p.bothFaces ? ["外", "内"] : ["外"];
  const need = {};
  straights.forEach(s => need[s.width] = 0);
  let cornerNeed = 0;
  let adjustNeed = 0;
  let boardCuts = [];
  const unresolved = [];
  const edgeResults = [];

  for (const face of faces) {
    edges.forEach((edge, ei) => {
      let L = edge.length;
      if (face === "内") L = Math.max(0, L - 2 * p.thickness);

      const hasStartCorner = p.closed || ei > 0;
      const hasEndCorner   = p.closed || ei < edges.length - 1;
      const legCount = (hasStartCorner ? 1 : 0) + (hasEndCorner ? 1 : 0);
      const cornerUnits = p.closed ? 1 : (hasStartCorner ? 1 : 0);

      let remaining = L - legCount * cornerLeg;
      cornerNeed += cornerUnits;

      const pieces = [];
      for (let c = 0; c < cornerUnits; c++) pieces.push({ kind: "corner", label: "コーナー(脚" + cornerLeg + ")" });

      if (remaining < -TOLERANCE) {
        unresolved.push(face + "・辺" + (ei + 1) + ": 長さ " + L + "mm がコーナー寸法に足りません");
        edgeResults.push({ face, idx: ei + 1, length: Math.round(L), pieces, leftover: 0, short: true });
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
          pieces.push({ kind: "adjust", label: "調整枠 " + leftover.toFixed(0) });
        } else if (board) {
          boardCuts.push(Math.round(leftover));
          pieces.push({ kind: "adjust", label: "板カット " + leftover.toFixed(0) });
        } else {
          unresolved.push(face + "・辺" + (ei + 1) + ": 端 " + leftover.toFixed(0) + "mm を埋める調整枠/板がありません");
          pieces.push({ kind: "short", label: "未処理 " + leftover.toFixed(0) });
        }
        leftover = 0;
      }

      edgeResults.push({ face, idx: ei + 1, length: Math.round(L), pieces, leftover, short: false });
    });
  }

  const usage = straights.map(s => ({
    type: "straight", width: s.width, need: need[s.width], have: s.qty,
    short: Math.max(0, need[s.width] - s.qty),
  }));
  if (corner) usage.push({ type: "corner", leg: corner.leg, need: cornerNeed, have: corner.qty, short: Math.max(0, cornerNeed - corner.qty) });

  const totalPieces = usage.reduce((a, u) => a + u.need, 0) + adjustNeed + boardCuts.length;
  const totalShort = usage.reduce((a, u) => a + u.short, 0);

  return { faces, usage, adjustNeed, boardCuts, unresolved, edgeResults, totalPieces, totalShort, edgeCount: edges.length };
}

if (typeof module !== "undefined" && module.exports) module.exports = { calculate, TOLERANCE };
