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
    { type: 'adjust',   minW: 0, maxW: 300, cuttable: true, qty: 0 },
  ];
}
function edges(arr){ return arr.map(l => ({ length: l })); }

// ---- 1) 長方形 9100x7280 / 両面 / 閉じ ----
console.log('Test 1: rectangle 9100x7280 both faces closed');
let r = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, edges: edges([9100,7280,9100,7280]) },
  inventory: inv(),
});
assert('no error', !r.error, r.error);
assert('faces = 外内', r.faces.join('') === '外内');
assert('edgeResults = 8 (4辺×2面)', r.edgeResults.length === 8, r.edgeResults.length);
// コーナー必要数 = 4辺×2面×1 = 8
let cu = r.usage.find(u => u.type === 'corner');
assert('corner need = 8', cu.need === 8, cu.need);
// 外・辺1 (9100): remaining 9100-300=8800 -> 1800x4,900,600,余100→板
let e1 = r.edgeResults[0];
let w1800 = e1.pieces.filter(p => p.label === '1800').length;
assert('外辺1: 1800枠 x4', w1800 === 4, w1800);
assert('外辺1: コーナー1枚', e1.pieces.filter(p => p.kind==='corner').length === 1);
assert('外辺1: 板カット端あり', e1.pieces.some(p => p.kind==='adjust'), JSON.stringify(e1.pieces.map(p=>p.label)));
console.log('  外辺1 pieces:', e1.pieces.map(p=>p.label).join(', '));

// ---- 2) 内面が基礎幅で短くなる ----
console.log('Test 2: inner face shortened by thickness');
let outer1 = r.edgeResults.find(e => e.face==='外' && e.idx===1).length;
let inner1 = r.edgeResults.find(e => e.face==='内' && e.idx===1).length;
assert('内辺1 = 外辺1 - 300', inner1 === outer1 - 300, outer1 + '/' + inner1);

// ---- 3) コーナーに足りない短辺 ----
console.log('Test 3: edge too short for corners');
let r3 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, edges: edges([200]) },
  inventory: inv(),
});
assert('未処理(unresolved)あり', r3.unresolved.length > 0, JSON.stringify(r3.unresolved));

// ---- 4) 在庫不足の検出 ----
console.log('Test 4: shortage detection');
let lowInv = inv();
lowInv[0].qty = 1; // 1800を1枚しか持っていない
let r4 = calculate({
  project: { thickness: 150, bothFaces: 1, closed: true, edges: edges([9100,7280,9100,7280]) },
  inventory: lowInv,
});
let u1800 = r4.usage.find(u => u.width === 1800);
assert('1800の必要 > 在庫', u1800.need > u1800.have, u1800.need + '/' + u1800.have);
assert('1800に不足数', u1800.short === u1800.need - 1, u1800.short);
assert('totalShort > 0', r4.totalShort > 0, r4.totalShort);

// ---- 5) ピッタリ（余りなし） ----
console.log('Test 5: exact fit, no leftover');
// L=3900, closed, thickness0, leg150 -> remaining 3900-300=3600 = 1800x2
let r5 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, edges: edges([3900,3900,3900,3900]) },
  inventory: inv(),
});
let e5 = r5.edgeResults[0];
assert('余りなし: 1800 x2', e5.pieces.filter(p=>p.label==='1800').length === 2, JSON.stringify(e5.pieces.map(p=>p.label)));
assert('余りなし: 調整/板なし', !e5.pieces.some(p=>p.kind==='adjust'));
assert('leftover ~ 0', e5.leftover <= 5, e5.leftover);

// ---- 6) 伸縮枠が範囲内なら優先使用 ----
console.log('Test 6: stretch adjuster used when in range');
let invA = inv();
invA = invA.filter(i => !i.cuttable); // 板を外す
invA.push({ type: 'adjust', minW: 50, maxW: 250, cuttable: false, qty: 4 });
// L=4000 closed leg150 -> rem 3700: 1800x2=3600 rem100 -> 伸縮枠(50-250)使用
let r6 = calculate({
  project: { thickness: 0, bothFaces: 0, closed: true, edges: edges([4000,4000]) },
  inventory: invA,
});
assert('伸縮枠使用 adjustNeed>0', r6.adjustNeed > 0, r6.adjustNeed);
assert('板カットなし', r6.boardCuts.length === 0, r6.boardCuts.length);

console.log('\n==== RESULT: ' + pass + ' passed, ' + fail + ' failed ====');
