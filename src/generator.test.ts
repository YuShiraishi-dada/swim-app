import { describe, expect, it } from 'vitest';
import { cycleSec, generateMenu, itemTotal, menuToText } from './generator';
import type { Focus, Params, Pool } from './types';

const focuses: Focus[] = ['sprint', 'lactate', 'endurance', 'recovery'];
const pools: Pool[] = [25, 50];

function allParams(): Params[] {
  const out: Params[] = [];
  for (const focus of focuses)
    for (const pool of pools)
      for (const intensity of [1, 2, 3, 4, 5] as const)
        for (const distance of [1000, 1500, 2000, 3000, 4000, 5000, 6000])
          for (const strokeMode of ['fr', 'mixed'] as const)
            out.push({ focus, pool, intensity, distance, strokeMode, baseCycle: 100 });
  return out;
}

describe('generateMenu', () => {
  it('同じシードなら同じメニューになる', () => {
    const p: Params = { focus: 'endurance', pool: 25, intensity: 3, distance: 3000, strokeMode: 'fr', baseCycle: 100 };
    expect(generateMenu(p, 'abc123')).toEqual(generateMenu(p, 'abc123'));
  });

  it('シードが違えばメニューがばらつく', () => {
    const p: Params = { focus: 'sprint', pool: 25, intensity: 3, distance: 3000, strokeMode: 'mixed', baseCycle: 100 };
    const texts = new Set(Array.from({ length: 20 }, (_, i) => menuToText(generateMenu(p, `s${i}`))));
    expect(texts.size).toBeGreaterThan(10);
  });

  it('全パラメータで総距離が目安に近く、距離がプール長の倍数', () => {
    for (const p of allParams()) {
      for (let s = 0; s < 15; s++) {
        const m = generateMenu(p, `seed${s}`);
        const tol = Math.max(200, p.distance * 0.12);
        if (Math.abs(m.total - p.distance) > tol) {
          throw new Error(`total ${m.total} vs ${p.distance}\n${JSON.stringify(p)}\n${menuToText(m)}`);
        }
        expect(m.sections.find((x) => x.key === 'main')).toBeTruthy();
        for (const sec of m.sections)
          for (const i of sec.items) {
            expect(i.dist % p.pool).toBe(0);
            expect(i.reps).toBeGreaterThan(0);
            if (i.reps > 1 && i.reps % 2 === 1) throw new Error(`奇数本数 ${i.reps}\n${JSON.stringify(p)}\n${menuToText(m)}`);
            expect(itemTotal(i)).toBeGreaterThan(0);
          }
        expect(m.minutes).toBeGreaterThan(0);
      }
    }
  });

  it('EN2 の 100m サイクルは入力値そのもの（強度 3）', () => {
    for (const baseCycle of [75, 90, 100, 115, 130]) {
      const p: Params = { focus: 'endurance', pool: 25, intensity: 3, distance: 3000, strokeMode: 'fr', baseCycle };
      expect(cycleSec(p, 100, 'EN2', 'swim', 'Fr')).toBe(Math.ceil(baseCycle / 5) * 5);
    }
  });

  it('速い人ほどサイクルが短い', () => {
    const fast: Params = { focus: 'endurance', pool: 25, intensity: 3, distance: 3000, strokeMode: 'fr', baseCycle: 80 };
    const slow: Params = { ...fast, baseCycle: 130 };
    for (const z of ['EN1', 'EN2', 'EN3', 'AN', 'SP'] as const) {
      expect(cycleSec(fast, 100, z, 'swim', 'Fr')).toBeLessThan(cycleSec(slow, 100, z, 'swim', 'Fr'));
    }
  });

  it('練習時間を指定すると、その時間に収まる', () => {
    for (const focus of focuses)
      for (const minutes of [30, 45, 60, 90])
        for (const baseCycle of [80, 100, 130])
          for (let s = 0; s < 10; s++) {
            const p: Params = { focus, pool: 25, intensity: 4, distance: 6000, strokeMode: 'fr', baseCycle, minutes };
            const m = generateMenu(p, `t${s}`);
            if (m.minutes > minutes + 3) throw new Error(`${m.minutes}分 > ${minutes}分\n${JSON.stringify(p)}\n${menuToText(m)}`);
            if (m.total < 5000) expect(m.notice).toBeTruthy();
            expect(generateMenu(p, `t${s}`)).toEqual(m);
          }
  });
});
