// JXA test: osascript -l JavaScript test_engine.js
// engine.js を読み込んで calculate() を検証する
ObjC.import('Foundation');
function read(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}
eval(read('engine.js'));

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

function inv() {
  return [
    { type: 'straight', width: 1800, qty: 20 },
    { type: 'straight', width: 900,  qty: 20 },
    { type: 'straight', width: 600,  qty: 20 },
    { type: 'straight', width: 300,  qty: 20 },
    { type: 'corner',   leg: 150,    qty: 8  },
    { type: 'cornerIn', leg: 150,    qty: 8  },
    { type: 'adjust',   minW: 0, maxW: 300, cuttable: true, qty: 0 },
    { type: 'pipe',     length: 4000, qty: 20 },
    { type: 'pipe',     length: 2000, qty: 20 },
    { type: 'pipe',     length: 1000, qty: 20 },
  ];
}
function edges(arr){ return arr.map(l => Array.isArray(l) ? { length: l[0], corner: l[1] } : { length: l, corner: 'out' }); }

// ---- 1) 長方形 9100x7280 / 両面 / 閉じ ----
console.log('Test 1: rectangle 9100x7280 both faces closed');
let r = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, pipeRows: 0, edges: edges([9100,7280,9100,7280]) },
  inventory: inv(),
});
assert('no error', !r.error, r.error);
assert('faces = 外内', r.faces.join('') === '外内');
assert('edgeResults = 8 (4辺×2面)', r.edgeResults.length === 8, r.edgeResults.length);
// 外面は出隅枠×4、内面は同じ角を入隅枠×4で納める
let cu = r.usage.find(u => u.type === 'corner');
let ci = r.usage.find(u => u.type === 'cornerIn');
assert('出隅コーナー need = 4', cu.need === 4, cu.need);
assert('入隅コーナー need = 4', ci.need === 4, ci.need);
let e1 = r.edgeResults[0];
let w1800 = e1.pieces.filter(p => p.label === '1800').length;
assert('外辺1: 1800枠 x4', w1800 === 4, w1800);
assert('外辺1: コーナー1枚(出隅)', e1.pieces.filter(p => p.kind==='corner' && p.label.indexOf('出隅')===0).length === 1);
assert('形状警告なし', r.shapeWarnings.length === 0, JSON.stringify(r.shapeWarnings));
assert('要確認なし', r.unresolved.length === 0, JSON.stringify(r.unresolved));
console.log('  外辺1 pieces:', e1.pieces.map(p=>p.label).join(', '));

// ---- 2) 内面が基礎幅で短くなる（長方形＝両端出隅で −300） ----
console.log('Test 2: inner face shortened by thickness');
let outer1 = r.edgeResults.find(e => e.face==='外' && e.idx===1).length;
let inner1 = r.edgeResults.find(e => e.face==='内' && e.idx===1).length;
assert('内辺1 = 外辺1 - 300', inner1 === outer1 - 300, outer1 + '/' + inner1);

// ---- 3) コの字（入隅あり） ----
console.log('Test 3: U-shape with two inside corners');
// 時計回り: E9000(出) S6000(出) W3000(出) N2000(入) W3000(入) S2000(出) W3000(出) N6000(出)
let uEdges = edges([[9000,'out'],[6000,'out'],[3000,'out'],[2000,'in'],[3000,'in'],[2000,'out'],[3000,'out'],[6000,'out']]);
let r3 = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, pipeRows: 0, edges: uEdges },
  inventory: inv(),
});
assert('no error', !r3.error, r3.error);
assert('形状警告なし（閉じる）', r3.shapeWarnings.length === 0, JSON.stringify(r3.shapeWarnings));
let g3 = polygonPoints(uEdges, true);
assert('出隅6・入隅2', g3.outCount === 6 && g3.inCount === 2, g3.outCount + '/' + g3.inCount);
assert('閉じている gap≈0', g3.gap <= TOLERANCE, g3.gap);
// 両面合計: 出隅枠 = 外6 + 内2 = 8, 入隅枠 = 外2 + 内6 = 8
let cu3 = r3.usage.find(u => u.type === 'corner');
let ci3 = r3.usage.find(u => u.type === 'cornerIn');
assert('出隅コーナー need = 8', cu3.need === 8, cu3.need);
assert('入隅コーナー need = 8', ci3.need === 8, ci3.need);
// 内面の長さ: 辺5(3000・両端入隅) = 3000+300, 辺1(9000・両端出隅) = 9000-300
let in5 = r3.edgeResults.find(e => e.face==='内' && e.idx===5).length;
let in1 = r3.edgeResults.find(e => e.face==='内' && e.idx===1).length;
assert('内辺5 = 3300 (入隅で+150×2)', in5 === 3300, in5);
assert('内辺1 = 8700 (出隅で-150×2)', in1 === 8700, in1);

// ---- 4) 単管の本数計算 ----
console.log('Test 4: pipe counts (no overlap, side by side)');
let r4 = calculate({
  project: { thickness: 150, bothFaces: 0, closed: true, pipeRows: 2, edges: edges([9100,7280,9100,7280]) },
  inventory: inv(),
});
assert('pipe結果あり', !!r4.pipe, JSON.stringify(r4.pipe));
assert('段数=2', r4.pipe.rows === 2);
// 9100: 4000x2 + 2000x1 / 7280: 4000x1 + 4000(仕上げ)→ 4000x2
// 片面: 4000 = (2+2)x2辺ずつ = 8, 2000 = 2 → 2段で 4000:16, 2000:4
let p4000 = r4.pipe.usage.find(u => u.length === 4000);
let p2000 = r4.pipe.usage.find(u => u.length === 2000);
assert('4000 need = 16', p4000.need === 16, p4000.need);
assert('2000 need = 4', p2000.need === 4, p2000.need);
assert('4000 在庫20で OK', p4000.short === 0, p4000.short);
let er4 = r4.edgeResults[0];
assert('辺1に単管内訳', er4.pipeText.indexOf('4000×2') >= 0, er4.pipeText);
console.log('  辺1 単管:', er4.pipeText);

// ---- 5) 形が閉じない場合の警告 ----
console.log('Test 5: shape that does not close');
let r5 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([9000,6000,8000,6000]) },
  inventory: inv(),
});
assert('閉じない警告あり', r5.shapeWarnings.some(w => w.indexOf('閉じません') >= 0), JSON.stringify(r5.shapeWarnings));
let r5b = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([[9000,'out'],[6000,'in'],[9000,'out'],[6000,'out']]) },
  inventory: inv(),
});
assert('出隅−入隅≠4 警告あり', r5b.shapeWarnings.some(w => w.indexOf('出隅−入隅') >= 0), JSON.stringify(r5b.shapeWarnings));

// ---- 6) コーナーに足りない短辺 ----
console.log('Test 6: edge too short for corners');
let r6 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([200]) },
  inventory: inv(),
});
assert('未処理(unresolved)あり', r6.unresolved.length > 0, JSON.stringify(r6.unresolved));

// ---- 7) 在庫不足の検出 ----
console.log('Test 7: shortage detection');
let lowInv = inv();
lowInv[0].qty = 1; // 1800を1枚しか持っていない
let r7 = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, pipeRows: 0, edges: edges([9100,7280,9100,7280]) },
  inventory: lowInv,
});
let u1800 = r7.usage.find(u => u.width === 1800);
assert('1800の必要 > 在庫', u1800.need > u1800.have, u1800.need + '/' + u1800.have);
assert('1800に不足数', u1800.short === u1800.need - 1, u1800.short);
assert('totalShort > 0', r7.totalShort > 0, r7.totalShort);

// ---- 8) ピッタリ（余りなし） ----
console.log('Test 8: exact fit, no leftover');
let r8 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([3900,3900,3900,3900]) },
  inventory: inv(),
});
let e8 = r8.edgeResults[0];
assert('余りなし: 1800 x2', e8.pieces.filter(p=>p.label==='1800').length === 2, JSON.stringify(e8.pieces.map(p=>p.label)));
assert('余りなし: 調整/板なし', !e8.pieces.some(p=>p.kind==='adjust'));
assert('leftover ~ 0', e8.leftover <= 5, e8.leftover);

// ---- 9) スライドパネルが範囲内なら優先使用 ----
console.log('Test 9: slide panel used when in range');
let invA = inv().filter(i => !i.cuttable); // 板を外す
invA.push({ type: 'adjust', minW: 50, maxW: 250, cuttable: false, qty: 4 });
let r9 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([4000,4000]) },
  inventory: invA,
});
assert('スライド使用 adjustNeed>0', r9.adjustNeed > 0, r9.adjustNeed);
assert('板カットなし', r9.boardCuts.length === 0, r9.boardCuts.length);

// ---- 10) 入隅枠が未登録なら要確認 ----
console.log('Test 10: missing inside-corner stock is flagged');
let invB = inv().filter(i => i.type !== 'cornerIn');
let r10 = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, pipeRows: 0, edges: edges([9100,7280,9100,7280]) },
  inventory: invB,
});
assert('入隅未登録の注意あり', r10.unresolved.some(u => u.indexOf('入隅コーナー枠が在庫未登録') >= 0), JSON.stringify(r10.unresolved));
let ci10 = r10.usage.find(u => u.type === 'cornerIn');
assert('入隅は不足4', ci10.need === 4 && ci10.short === 4, JSON.stringify(ci10));

// ---- 11) パネルの使用優先順位（並び順に従う） ----
console.log('Test 11: panel priority follows inventory order');
// 既定（大きい順）: L=3600 closed leg150 → rem 3300 = 1800+900+600 (rem0)
let r11a = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([3600,3600,3600,3600]) },
  inventory: inv(),
});
let e11a = r11a.edgeResults[0];
assert('既定: 1800を1枚使う', e11a.pieces.filter(p=>p.label==='1800').length === 1, JSON.stringify(e11a.pieces.map(p=>p.label)));

// 900を最優先に並べ替え → 900から先に詰める
let invPri = inv();
invPri.sort((a,b) => {
  if (a.type!=='straight' || b.type!=='straight') return 0;
  const rank = { 900:0, 1800:1, 600:2, 300:3 };
  return (rank[a.width] ?? 9) - (rank[b.width] ?? 9);
});
let r11b = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([3600,3600,3600,3600]) },
  inventory: invPri,
});
let e11b = r11b.edgeResults[0];
let c900 = e11b.pieces.filter(p=>p.label==='900').length;
assert('900優先: 900を3枚使う', c900 === 3, JSON.stringify(e11b.pieces.map(p=>p.label)));
assert('900優先: 1800は使わない', e11b.pieces.filter(p=>p.label==='1800').length === 0, JSON.stringify(e11b.pieces.map(p=>p.label)));
// usage表も優先順位の並びで返る
assert('usage先頭が900', r11b.usage[0].width === 900, r11b.usage[0].width);

// ---- 12) 割り切りを優先（グリーディなら端数が出るケースで exact を見つける） ----
console.log('Test 12: prefer exact division over greedy leftover');
// 幅 1200(優先1) と 900(優先2)。角なし(leg0)、辺1800 → remaining1800。
// グリーディ: 1200 → 端数600 が残る。割り切り探索: 900+900 でピッタリ。
let invDiv = [
  { type: 'straight', width: 1200, qty: 50 },
  { type: 'straight', width: 900,  qty: 50 },
  { type: 'corner',   leg: 0, qty: 9 },
  { type: 'cornerIn', leg: 0, qty: 9 },
];
let rDiv = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([1800,1800,1800,1800]) },
  inventory: invDiv,
});
let eDiv = rDiv.edgeResults[0];
assert('割り切り: 900を2枚', eDiv.pieces.filter(p=>p.label==='900').length === 2, JSON.stringify(eDiv.pieces.map(p=>p.label)));
assert('割り切り: 1200は使わない', eDiv.pieces.filter(p=>p.label==='1200').length === 0, JSON.stringify(eDiv.pieces.map(p=>p.label)));
assert('割り切り: スライド/板/未処理なし', !eDiv.pieces.some(p=>p.kind==='adjust'||p.kind==='short'), JSON.stringify(eDiv.pieces.map(p=>p.kind)));
assert('割り切り: leftover 0', eDiv.leftover <= TOLERANCE, eDiv.leftover);

// ---- 13) 割り切れる範囲で優先順位を最大限尊重 ----
console.log('Test 13: honor priority within exact solutions');
// 1200+900=2100 が exact。優先1=1200 を使える → 1200×1 + 900×1。
let rPri = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([2100,2100,2100,2100]) },
  inventory: invDiv,
});
let ePri = rPri.edgeResults[0];
assert('優先: 1200を1枚', ePri.pieces.filter(p=>p.label==='1200').length === 1, JSON.stringify(ePri.pieces.map(p=>p.label)));
assert('優先: 900を1枚', ePri.pieces.filter(p=>p.label==='900').length === 1, JSON.stringify(ePri.pieces.map(p=>p.label)));
assert('優先: leftover 0', ePri.leftover <= TOLERANCE, ePri.leftover);

// ---- 14) 割り切れないときは端数最小＋スライド/板 ----
console.log('Test 14: minimal leftover when not divisible');
// packPanels 単体: 幅[1000,700], R=1250 → 1000(端数250) より 700+... 700+? 550無 → max reachable=1000 leftover250?
//   実際 reachable: 700,1000,1400,1700,2000... 1250以下の最大 reachable=1000 → leftover250。
let reach14 = bestReachable(3000, [1000,700]);
let pk14 = packPanels(1250, [1000,700], reach14);
assert('packPanels: 端数250', pk14.leftover === 250, pk14.leftover);
// R=1400 は 700+700 でちょうど
let pk14b = packPanels(1400, [1000,700], reach14);
assert('packPanels: 1400は割り切り(端数0)', pk14b.leftover === 0, pk14b.leftover);
assert('packPanels: 700を2枚', pk14b.counts[700] === 2, JSON.stringify(pk14b.counts));

// ---- 15) 左右で脚の長さが違うコーナー枠（向きを最適化して割り切る） ----
console.log('Test 15: asymmetric corner legs (150x235) oriented for exact fit');
// パネル900のみ。辺1200 = 900+150+150、辺1370 = 900+235+235。
// 各角の150/235の向きを正しく選ばないと割り切れない。
let invAsym = [
  { type: 'straight', width: 900, qty: 50 },
  { type: 'corner', legA: 150, legB: 235, qty: 9 },
];
let r15 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([1200,1370,1200,1370]) },
  inventory: invAsym,
});
assert('no error', !r15.error, r15.error);
r15.edgeResults.forEach(er => {
  assert('辺' + er.idx + ' leftover 0', er.leftover <= TOLERANCE && !er.short, er.leftover);
  assert('辺' + er.idx + ' スライド/未処理なし', !er.pieces.some(p=>p.kind==='adjust'||p.kind==='short'), JSON.stringify(er.pieces.map(p=>p.label)));
});
let cu15 = r15.usage.find(u => u.type === 'corner');
assert('出隅(150×235) need=4', cu15.need === 4 && cu15.legA === 150 && cu15.legB === 235, JSON.stringify(cu15));
let asymChip = r15.edgeResults[0].pieces.find(p => p.kind === 'corner');
assert('チップに向き表記(a→b)', /出隅\(\d+→\d+\)/.test(asymChip.label), asymChip.label);

// ---- 16) コーナー枠を複数サイズ所有 → 割り切れる方を選ぶ ----
console.log('Test 16: multiple corner sizes, pick the divisible one');
let invMulti = [
  { type: 'straight', width: 900, qty: 50 },
  { type: 'corner', legA: 150, legB: 150, qty: 9 },
  { type: 'corner', legA: 235, legB: 235, qty: 9 },
];
let r16 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, pipeRows: 0, edges: edges([1370,1370,1370,1370]) },
  inventory: invMulti,
});
r16.edgeResults.forEach(er => assert('辺' + er.idx + ' leftover 0', er.leftover <= TOLERANCE && !er.short, er.leftover));
let cu235 = r16.usage.find(u => u.type === 'corner' && u.legA === 235);
let cu150 = r16.usage.find(u => u.type === 'corner' && u.legA === 150);
assert('235角を4枚使用', cu235.need === 4, JSON.stringify(cu235));
assert('150角は不使用', cu150.need === 0, JSON.stringify(cu150));

// ---- 17) 旧データ {leg} の互換（legA/B なし） ----
console.log('Test 17: legacy {leg} corner data still works');
let r17 = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, pipeRows: 0, edges: edges([9100,7280,9100,7280]) },
  inventory: inv(), // corner/cornerIn は leg:150 のまま
});
let cu17 = r17.usage.find(u => u.type === 'corner');
assert('旧leg: 出隅 need=4 / legA=150', cu17.need === 4 && cu17.legA === 150 && cu17.legB === 150, JSON.stringify(cu17));

console.log('\n==== RESULT: ' + pass + ' passed, ' + fail + ' failed ====');
