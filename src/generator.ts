import { createRng, type Rng } from './rng';
import type {
  Focus,
  Kind,
  Menu,
  Params,
  Section,
  SectionKey,
  SetItem,
  Stroke,
  Zone,
} from './types';

export const GENERATOR_VERSION = 1;

interface Ctx {
  rng: Rng;
  p: Params;
}

// ───────────────────────── 共通ヘルパー ─────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** unit の倍数に丸める（最小 unit） */
const roundTo = (v: number, unit: number) => Math.max(unit, Math.round(v / unit) * unit);

/** プール長で割り切れない距離を補正（50m プールで 25 → 50 など） */
const poolDist = (c: Ctx, d: number) => (d % c.p.pool === 0 ? d : roundTo(d, c.p.pool));

/** 予算に近い本数を求める */
const fitReps = (budget: number, dist: number, min: number, max: number) => {
  const exact = budget / dist;
  let r = Math.round(exact);
  // 予算が小さいときは最小本数より少なくてもよい
  r = clamp(r, Math.min(min, Math.max(1, r)), max);
  // 本数は偶数に寄せる（1 本はそのまま）
  if (r > 1 && r % 2 === 1) {
    const up = r + 1;
    const down = r - 1;
    r = up <= max && (exact >= r || down < 2) ? up : down;
  }
  return r;
};

/** セット数が 1 のときは sets を省略する */
const setsOrNone = (n: number) => (n > 1 ? n : undefined);

export const itemTotal = (i: SetItem) => (i.sets ?? 1) * i.reps * i.dist;
export const sectionTotal = (s: Section) => s.items.reduce((a, i) => a + itemTotal(i), 0);

const STROKE_F: Record<Stroke, number> = { Fr: 1, Ba: 1.08, Br: 1.18, Fly: 1.12, IM: 1.1, Choice: 1.08 };
const KIND_F: Record<Kind, number> = { swim: 1, kick: 1.4, pull: 1.05, drill: 1.25 };
/**
 * EN2 の 100m サイクルに含まれるレスト（秒）。
 * 例: EN2 を 1:40 で回している → 実際の泳速は約 1:28/100m と推定する。
 */
export const EN2_REST = 12;

/** EN2 の 100m サイクルから、EN2 で泳ぐときの泳速（秒/100m）を推定 */
export const swimPace = (baseCycle: number) => Math.max(40, baseCycle - EN2_REST);

/** ゾーン別の泳速係数（EN2 の泳速 = 1.0） */
const PACE_F: Record<Zone, number> = { EN1: 1.1, EN2: 1.0, EN3: 0.95, AN: 0.86, SP: 0.8 };

/** 実際に泳いでいる時間（秒） */
function swimSec(p: Params, dist: number, zone: Zone, kind: Kind, stroke: Stroke): number {
  return (dist / 100) * swimPace(p.baseCycle) * PACE_F[zone] * KIND_F[kind] * STROKE_F[stroke];
}

/**
 * サイクル（秒）= 泳ぐ時間 + ゾーンごとのレスト。5 秒単位に切り上げ。
 * EN2・Fr・Swim・100m・強度 3 のとき、ちょうど入力された EN2 サイクルになる。
 */
export function cycleSec(p: Params, dist: number, zone: Zone, kind: Kind, stroke: Stroke): number {
  const swim = swimSec(p, dist, zone, kind, stroke);
  const i = p.intensity;
  let sec: number;
  switch (zone) {
    case 'EN1':
      sec = swim + 15;
      break;
    case 'EN2':
      sec = swim + EN2_REST - (i - 3) * 2; // 強度が高いほど少しタイトに
      break;
    case 'EN3':
      sec = swim + 15 - (i - 3) * 3;
      break;
    case 'AN':
      sec = swim * (3 - (i - 3) * 0.2); // 泳ぎ:休み = 1:2 前後
      break;
    case 'SP':
      sec = Math.max(swim * 4, swim + 30); // 質を保つため長めに休む
      break;
  }
  return Math.ceil(sec / 5) * 5;
}

const cycle = (c: Ctx, dist: number, zone: Zone, kind: Kind, stroke: Stroke) => cycleSec(c.p, dist, zone, kind, stroke);

/** 泳法モードに応じてメインで使う泳法を選ぶ */
function mainStroke(c: Ctx, dist: number): Stroke {
  if (c.p.strokeMode === 'fr') return 'Fr';
  const opts: Stroke[] = ['Fr', 'Fr', 'Ba', 'Br'];
  if (dist <= 100) opts.push('Fly');
  if (dist >= c.p.pool * 4) opts.push('IM', 'IM');
  return c.rng.pick(opts);
}

function item(
  c: Ctx,
  o: Omit<SetItem, 'cycle'> & { cycleZone?: Zone; noCycle?: boolean; cycleFactor?: number },
): SetItem {
  const { cycleZone, noCycle, cycleFactor, ...rest } = o;
  const it: SetItem = { ...rest, dist: poolDist(c, rest.dist) };
  if (!noCycle && it.rest === undefined) {
    const cy = cycle(c, it.dist, cycleZone ?? it.zone, it.kind, it.stroke);
    it.cycle = Math.ceil((cy * (cycleFactor ?? 1)) / 5) * 5;
  }
  return it;
}

const DRILLS = [
  'キャッチアップ',
  '片手スイム',
  'フィストスイム',
  'スカーリング',
  '6キック1ストローク',
  'ヘッドアップ',
  'スイムの 25 ずつ泳法チェンジ',
  'ストローク数を数える',
];

// ───────────────────────── テンプレート ─────────────────────────

type Builder = (c: Ctx, budget: number) => SetItem[];
interface Tpl {
  build: Builder;
  weight?: number;
  /** 使用可能な強度範囲 */
  minI?: number;
  maxI?: number;
}

const pickTpl = (c: Ctx, tpls: Tpl[]): Builder => {
  const ok = tpls.filter((t) => c.p.intensity >= (t.minI ?? 1) && c.p.intensity <= (t.maxI ?? 5));
  return c.rng.weighted(ok.map((t) => ({ item: t.build, weight: t.weight ?? 1 })));
};

// W-up
const WU: Tpl[] = [
  {
    build: (c, b) => {
      const first = roundTo(b * c.rng.pick([0.4, 0.5, 0.6]), 100);
      const n = fitReps(b - first, 50, 2, 16);
      return [
        item(c, { reps: 1, dist: first, kind: 'swim', stroke: 'Choice', zone: 'EN1', noCycle: true, note: 'ゆっくり大きく' }),
        item(c, {
          reps: n, dist: 50, kind: 'swim', stroke: c.p.strokeMode === 'mixed' ? 'IM' : 'Choice', zone: 'EN1',
          note: c.p.strokeMode === 'mixed' ? 'IM 順に 1 本ずつ' : '泳法自由',
        }),
      ];
    },
  },
  {
    build: (c, b) => {
      if (b < 400) return [item(c, { reps: fitReps(b, 100, 1, 4), dist: 100, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: 'Swim / Kick / Pull / Swim by 25' })];
      return [item(c, { reps: fitReps(b, 200, 1, 5), dist: 200, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: 'Swim / Kick / Pull / Swim by 50' })];
    },
  },
  {
    build: (c, b) => {
      const first = roundTo(b * 0.4, 100);
      return [
        item(c, { reps: 1, dist: first, kind: 'swim', stroke: 'Fr', zone: 'EN1', noCycle: true }),
        item(c, {
          reps: fitReps(b - first, 100, 1, 8), dist: 100, kind: 'swim',
          stroke: c.p.strokeMode === 'mixed' ? 'IM' : 'Fr', zone: 'EN1',
          note: c.p.strokeMode === 'mixed' ? 'IM ドリル/スイム by 25' : '25 ドリル + 75 スイム',
        }),
      ];
    },
  },
  {
    build: (c, b) => [
      item(c, { reps: fitReps(b, 100, 2, 10), dist: 100, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: c.rng.pick(['50 Fr + 50 Ba', '奇数 Fr / 偶数 Choice', '1 本ごとに少しずつ上げる']) }),
    ],
  },
];

// Kick / Drill / Pull
const kick: Builder = (c, b) => {
  const d = b >= 600 && c.rng.chance(0.5) ? 100 : 50;
  const reps = fitReps(b, d, 2, 16);
  const notes = ['ボード無し', 'サイドキック', '一定ペース', '25 強 / 25 弱'];
  if (reps >= 4) notes.push('ディセンディング 1→4');
  return [
    item(c, {
      reps, dist: d, kind: 'kick',
      stroke: c.p.strokeMode === 'mixed' ? c.rng.pick<Stroke>(['Fr', 'Fly', 'Br', 'Choice']) : 'Fr',
      zone: c.p.intensity >= 4 ? 'EN3' : 'EN2',
      note: c.rng.pick(notes),
    }),
  ];
};
const drill: Builder = (c, b) => [
  item(c, {
    reps: fitReps(b, 50, 2, 16), dist: 50, kind: 'drill',
    stroke: c.p.strokeMode === 'mixed' ? c.rng.pick<Stroke>(['Fr', 'Ba', 'Br', 'Fly']) : 'Fr',
    zone: 'EN1', note: `${c.rng.pick(DRILLS)}（ドリル/スイム by 25）`,
  }),
];
const pull: Builder = (c, b) => {
  const d = b >= 800 && c.rng.chance(0.5) ? 200 : 100;
  return [
    item(c, {
      reps: fitReps(b, d, 1, 10), dist: d, kind: 'pull', stroke: 'Fr', zone: 'EN2',
      note: c.rng.pick(['呼吸 3/5/7', 'パドル使用', 'DPS（1 ストロークで大きく進む）', 'ストローク数を一定に']),
    }),
  ];
};
const half = (a: Builder, bb: Builder): Builder => (c, b) => (b < 300 ? a(c, b) : [...a(c, b / 2), ...bb(c, b / 2)]);

const KDP: Tpl[] = [
  { build: kick },
  { build: drill },
  { build: pull },
  { build: half(kick, drill), weight: 1.5 },
  { build: half(kick, pull), weight: 1.5 },
  { build: half(drill, pull) },
];
const KDP_RECOVERY: Tpl[] = [{ build: drill, weight: 2 }, { build: half(drill, kick) }, { build: half(drill, pull) }];

// Pre-main
const PRE: Record<Focus, Tpl[]> = {
  sprint: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 25, 4, 12), dist: 25, kind: 'swim', stroke: 'Fr', zone: 'EN3', cycleZone: 'EN1', cycleFactor: 1.2, note: c.p.pool === 50 ? '15m ダッシュ + easy' : '12.5m ダッシュ + easy' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 2, 8), dist: 50, kind: 'swim', stroke: 'Fr', zone: 'EN3', cycleZone: 'EN1', note: 'ビルドアップ（徐々に上げる）' })] },
  ],
  lactate: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 4, 8), dist: 50, kind: 'swim', stroke: 'Fr', zone: 'EN3', cycleZone: 'EN1', note: 'ディセンディング 1→4' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 2, 6), dist: 100, kind: 'swim', stroke: 'Fr', zone: 'EN3', cycleZone: 'EN1', note: 'ビルドアップ' })] },
  ],
  endurance: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 2, 6), dist: 100, kind: 'swim', stroke: 'Fr', zone: 'EN2', note: 'メインのペース確認' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 4, 8), dist: 50, kind: 'swim', stroke: 'Choice', zone: 'EN2', note: 'ディセンディング 1→4' })] },
  ],
  recovery: [],
};

// Main
const MAIN: Record<Focus, Tpl[]> = {
  sprint: [
    {
      build: (c, b) => {
        const d = poolDist(c, 25);
        return [item(c, { reps: fitReps(b, d, 6, 16), dist: d, kind: 'swim', stroke: mainStroke(c, d), zone: 'SP', note: c.rng.pick(['全力', '飛び込み or 壁けりで全力', 'ブレイクアウト重視で全力']) })];
      },
    },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 4, 10), dist: 50, kind: 'swim', stroke: mainStroke(c, 50), zone: 'SP', note: '全力・1 本ずつ質を保つ' })], minI: 2 },
    {
      build: (c, b) => {
        const d = poolDist(c, 25);
        const reps = 4;
        const sets = setsOrNone(clamp(Math.round(b / (reps * d)), 1, 4));
        return [item(c, { sets, reps, dist: d, kind: 'swim', stroke: mainStroke(c, d), zone: 'SP', note: 'セット間 2 分レスト' })];
      },
    },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 4, 12), dist: 50, kind: 'swim', stroke: 'Fr', zone: 'SP', cycleZone: 'EN1', cycleFactor: 1.2, note: '15m ダッシュ + 35m easy' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 2, 6), dist: 100, kind: 'swim', stroke: mainStroke(c, 100), zone: 'SP', rest: 180, note: 'レースペース（50 で 10 秒休む Broken 可）' })], minI: 4 },
  ],
  lactate: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 3, 10), dist: 100, kind: 'swim', stroke: mainStroke(c, 100), zone: 'AN', note: '全力でタイムをホールド' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 6, 16), dist: 50, kind: 'swim', stroke: mainStroke(c, 50), zone: 'AN', note: '1 本ごとに全力' })] },
    {
      build: (c, b) => {
        const reps = c.rng.pick([4, 6]);
        const sets = setsOrNone(clamp(Math.round(b / (reps * 50)), 1, 4));
        return [item(c, { sets, reps, dist: 50, kind: 'swim', stroke: mainStroke(c, 50), zone: 'AN', cycleZone: 'EN2', cycleFactor: 1.15, note: '短いサークルで粘る / セット間 2〜3 分レスト' })];
      },
      minI: 3,
    },
    { build: (c, b) => [item(c, { reps: fitReps(b, 200, 2, 5), dist: 200, kind: 'swim', stroke: mainStroke(c, 200), zone: 'AN', note: 'Broken（50 ごとに 10 秒休み）全力' })], minI: 3 },
    { build: (c, b) => [item(c, { reps: fitReps(b, 75, 4, 12), dist: poolDist(c, 75), kind: 'swim', stroke: mainStroke(c, 75), zone: 'AN', note: 'ディセンディング 1→4 を繰り返す' })] },
  ],
  endurance: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 200, 3, 12), dist: 200, kind: 'swim', stroke: mainStroke(c, 200), zone: 'EN2', note: '一定ペース' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 400, 2, 6), dist: 400, kind: 'swim', stroke: 'Fr', zone: 'EN2', note: 'ネガティブスプリット（後半を速く）' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 6, 30), dist: 100, kind: 'swim', stroke: mainStroke(c, 100), zone: c.p.intensity >= 3 ? 'EN3' : 'EN2', note: 'サークルを守り切る' })] },
    {
      // ピラミッド 100-200-...-peak-...-100
      build: (c, b) => {
        let peak = 200;
        const sum = (pk: number) => { let s = 0; for (let d = 100; d <= pk; d += 100) s += d; return 2 * s - pk; };
        while (peak < 800 && Math.abs(sum(peak + 100) - b) < Math.abs(sum(peak) - b)) peak += 100;
        const ds: number[] = [];
        for (let d = 100; d <= peak; d += 100) ds.push(d);
        for (let d = peak - 100; d >= 100; d -= 100) ds.push(d);
        return ds.map((d, i) => item(c, { reps: 1, dist: d, kind: 'swim', stroke: 'Fr', zone: 'EN2', rest: 15, note: i === 0 ? 'ピラミッド（各 15 秒レスト）' : undefined }));
      },
    },
    { build: (c, b) => [item(c, { reps: 1, dist: clamp(roundTo(b, 100), 400, 3000), kind: 'swim', stroke: 'Fr', zone: 'EN2', note: '長く一定ペースで泳ぎ続ける' })], weight: 0.7 },
    {
      build: (c, b) => {
        const sets = setsOrNone(clamp(Math.round(b / 400), 1, 6));
        return [item(c, { sets, reps: 4, dist: 100, kind: 'swim', stroke: mainStroke(c, 100), zone: 'EN3', note: 'ディセンディング 1→4' })];
      },
    },
  ],
  recovery: [
    { build: (c, b) => [item(c, { reps: fitReps(b, 100, 2, 16), dist: 100, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: '泳法を変えながらゆったり' })] },
    { build: (c, b) => [item(c, { reps: 1, dist: clamp(roundTo(b, 100), 200, 2000), kind: 'swim', stroke: 'Choice', zone: 'EN1', noCycle: true, note: '長く・ゆっくり・フォーム重視' })] },
    { build: (c, b) => [item(c, { reps: fitReps(b, 50, 4, 20), dist: 50, kind: 'drill', stroke: c.p.strokeMode === 'mixed' ? 'IM' : 'Fr', zone: 'EN1', note: `${c.rng.pick(DRILLS)}（フォーム確認）` })] },
  ],
};

const SUB_AEROBIC: Builder = (c, b) => [
  item(c, { reps: fitReps(b, 100, 1, 8), dist: 100, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: 'フォームを整えながら' }),
];

// ───────────────────────── 距離配分 ─────────────────────────

const SHARES: Record<Focus, Partial<Record<SectionKey, number>>> = {
  sprint: { wu: 0.25, kdp: 0.2, pre: 0.12, main: 0.2, sub: 0.1, down: 0.13 },
  lactate: { wu: 0.25, kdp: 0.15, pre: 0.12, main: 0.3, down: 0.18 },
  endurance: { wu: 0.2, kdp: 0.15, pre: 0.1, main: 0.45, down: 0.1 },
  recovery: { wu: 0.3, kdp: 0.3, main: 0.3, down: 0.1 },
};

const TITLES: Record<SectionKey, string> = {
  wu: 'W-up',
  kdp: 'Kick / Drill / Pull',
  pre: 'Pre Main',
  main: 'Main',
  sub: 'Aerobic',
  down: 'Down',
};

/** 不足分 (excess) を、複数本のアイテムの本数を増やして埋める */
function growToTarget(items: SetItem[], excess: number, pool: number) {
  const multi = items.filter((i) => i.reps > 1 && !i.sets);
  for (let guard = 0; guard < 200 && excess >= 50; guard++) {
    // 偶数本を保つため 2 本ずつ増やす
    const fits = multi.filter((i) => i.dist * 2 <= excess + pool && i.reps < 24);
    if (fits.length) {
      // 一番距離が少ないものから増やして偏りを防ぐ
      const it = fits.reduce((a, b) => (b.reps * b.dist < a.reps * a.dist ? b : a));
      it.reps += 2;
      excess -= it.dist * 2;
      continue;
    }
    const single = items.find((i) => i.reps === 1 && !i.sets);
    if (!single) break;
    const add = Math.floor(excess / 100) * 100 || 50;
    single.dist += add;
    excess -= add;
  }
}

/** 目安を大きく超えたとき、メイン以外の本数/距離を減らして合わせる */
function trimToTarget(sections: Section[], target: number, pool: number) {
  const total = () => sections.reduce((a, s) => a + sectionTotal(s), 0);
  for (let guard = 0; guard < 200 && total() - target > pool; guard++) {
    const over = total() - target;
    const cands = sections
      .filter((s) => s.key !== 'main')
      .flatMap((s) => s.items)
      .filter((i) => (i.reps > 2 && i.dist * 2 * (i.sets ?? 1) <= over + pool) || (i.reps === 1 && !i.sets && i.dist > 100));
    if (!cands.length) break;
    const it = cands.reduce((a, b) => (itemTotal(b) > itemTotal(a) ? b : a));
    if (it.reps > 2) it.reps -= 2;
    else it.dist = Math.max(100, it.dist - Math.max(pool, Math.floor(over / pool) * pool));
  }
  for (const s of sections) s.items = s.items.filter((i) => i.reps > 0);
}

export function estimateMinutes(m: { sections: Section[]; params: Params }): number {
  let sec = 0;
  for (const s of m.sections) {
    for (const i of s.items) {
      const n = (i.sets ?? 1) * i.reps;
      const per = i.cycle ?? swimSec(m.params, i.dist, i.zone, i.kind, i.stroke) + (i.rest ?? 0);
      sec += n * per + ((i.sets ?? 1) - 1) * 120;
    }
    sec += 60; // セクション間
  }
  return Math.round(sec / 60);
}

/**
 * メニューを生成する。練習時間が指定されていれば、その時間に収まるまで距離を減らして作り直す。
 * 同じシード・パラメータなら必ず同じ結果になる。
 */
export function generateMenu(params: Params, seed: string): Menu {
  let menu = buildMenu(params, seed, params.distance);
  const limit = params.minutes;
  if (!limit) return menu;
  let dist = params.distance;
  for (let k = 0; k < 8 && menu.minutes > limit && dist > 500; k++) {
    dist = Math.max(500, Math.floor((dist * (limit / menu.minutes) * 0.98) / 100) * 100);
    menu = buildMenu(params, seed, dist);
  }
  if (dist < params.distance) {
    menu.notice = `練習時間 ${limit} 分に収まるよう、距離を ${params.distance.toLocaleString()}m → ${menu.total.toLocaleString()}m に調整しました`;
  } else if (menu.minutes < limit * 0.7) {
    menu.notice = `練習時間 ${limit} 分に対して約 ${menu.minutes} 分のメニューです。時間いっぱい使うなら距離を増やしてください`;
  }
  return menu;
}

function buildMenu(params: Params, seed: string, T: number): Menu {
  const c: Ctx = { rng: createRng(`${GENERATOR_VERSION}:${seed}`), p: params };
  const shares = { ...SHARES[params.focus] };
  // 短い練習では Pre Main / Aerobic を省く
  if (T < 1500) {
    shares.main = (shares.main ?? 0) + (shares.pre ?? 0) / 2;
    shares.wu = (shares.wu ?? 0) + (shares.pre ?? 0) / 2 + (shares.sub ?? 0);
    delete shares.pre;
    delete shares.sub;
  }
  // 強度が高いほどメインを厚く、アップを薄く
  const shift = (params.intensity - 3) * 0.03;
  shares.main = (shares.main ?? 0) + shift;
  shares.wu = (shares.wu ?? 0) - shift;

  const built: Partial<Record<SectionKey, SetItem[]>> = {};

  // 1. メインを先に作る（本数が離散的なのでズレを他で吸収する）
  built.main = pickTpl(c, MAIN[params.focus])(c, T * shares.main);
  const mainTotal = built.main.reduce((a, i) => a + itemTotal(i), 0);

  // 2. 残りを他のセクションに配分（down は最後に調整）
  const others = (['wu', 'kdp', 'pre', 'sub'] as SectionKey[]).filter((k) => shares[k]);
  const otherShare = others.reduce((a, k) => a + (shares[k] ?? 0), 0) + (shares.down ?? 0);
  const remaining = Math.max(0, T - mainTotal);
  for (const k of others) {
    const b = Math.max(100, (remaining * (shares[k] ?? 0)) / otherShare);
    if (k === 'wu') built.wu = pickTpl(c, WU)(c, b);
    if (k === 'kdp') built.kdp = pickTpl(c, params.focus === 'recovery' ? KDP_RECOVERY : KDP)(c, b);
    if (k === 'pre' && PRE[params.focus].length) built.pre = pickTpl(c, PRE[params.focus])(c, b);
    if (k === 'sub') built.sub = SUB_AEROBIC(c, b);
  }

  // 3. down が長くなりすぎる分は他のセクションの本数を増やして吸収
  const sumBuilt = () => Object.values(built).flat().reduce((a, i) => a + itemTotal(i!), 0);
  const downTarget = Math.max(100, T * (shares.down ?? 0.1));
  growToTarget(
    (['sub', 'kdp', 'pre', 'wu'] as SectionKey[]).flatMap((k) => built[k] ?? []),
    T - downTarget - sumBuilt(),
    params.pool,
  );

  // 4. down で総距離を目安に合わせる
  const sumSoFar = sumBuilt();
  const downDist = Math.max(100, roundTo(T - sumSoFar, 50));
  if (downDist > 400 && c.rng.chance(0.5)) {
    let n = Math.floor((downDist - 200) / 50);
    n -= n % 2;
    built.down = [
      item(c, { reps: n, dist: 50, kind: 'swim', stroke: 'Choice', zone: 'EN1', note: '泳法自由・ゆっくり' }),
      item(c, { reps: 1, dist: downDist - n * 50, kind: 'swim', stroke: 'Choice', zone: 'EN1', noCycle: true, note: 'easy' }),
    ];
  } else {
    built.down = [item(c, { reps: 1, dist: poolDist(c, downDist), kind: 'swim', stroke: 'Choice', zone: 'EN1', noCycle: true, note: c.rng.pick(['ゆっくり', 'ストレッチしながら', '大きくゆったり']) })];
  }

  const order: SectionKey[] = ['wu', 'kdp', 'pre', 'main', 'sub', 'down'];
  const sections: Section[] = order
    .filter((k) => built[k]?.length)
    .map((k) => ({ key: k, title: TITLES[k], items: built[k]! }));
  trimToTarget(sections, T, params.pool);
  const total = sections.reduce((a, s) => a + sectionTotal(s), 0);
  const menu: Menu = { version: GENERATOR_VERSION, seed, params, sections, total, minutes: 0 };
  menu.minutes = estimateMinutes(menu);
  return menu;
}

// ───────────────────────── 表示用フォーマット ─────────────────────────

export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function formatItem(i: SetItem): { main: string; cycle: string } {
  const head = `${i.sets ? `${i.sets} セット × ` : ''}${i.reps > 1 || i.sets ? `${i.reps} × ` : ''}${i.dist}`;
  const kind = i.kind === 'swim' ? '' : ` ${i.kind[0].toUpperCase()}${i.kind.slice(1)}`;
  const cycleStr = i.cycle ? `@${fmtTime(i.cycle)}` : i.rest ? `R${i.rest}s` : '';
  return { main: `${head} ${i.stroke}${kind}`, cycle: cycleStr };
}

export function menuToText(m: Menu): string {
  const lines: string[] = [];
  for (const s of m.sections) {
    lines.push(`■ ${s.title}`);
    for (const i of s.items) {
      const f = formatItem(i);
      lines.push(`  ${f.main} ${f.cycle}${i.note ? ` (${i.note})` : ''}`.trimEnd());
    }
  }
  lines.push(`Total ${m.total}m / 約${m.minutes}分`);
  return lines.join('\n');
}
