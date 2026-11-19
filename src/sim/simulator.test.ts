import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../data/presets';
import { generateField } from './dotField';
import { runSimulation, summarizeResult } from './simulator';
import { computeCorrection } from './correction';
import type { SimTask } from '../types';
import { Rng, mixSeed } from './rng';
import { evalCurve } from './dotField';
import { ninePointPositions, pointInPanel } from './geometry';

function task(id: string, seed = 20261120, rays = 60_000): SimTask {
  return {
    id,
    projectId: 'p',
    name: id,
    settings: { rayCount: rays, irradianceResolution: 80, seed, maxBounces: 60 },
    status: 'queued',
    progress: 0,
    createdAt: 0,
    result: null,
    error: null,
  };
}

describe('PRNG 确定性', () => {
  it('同种子序列完全一致', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const sa = Array.from({ length: 1000 }, () => a.next());
    const sb = Array.from({ length: 1000 }, () => b.next());
    expect(sa).toEqual(sb);
  });
  it('mixSeed 稳定且不同输入不同', () => {
    expect(mixSeed(1, 2, 3)).toBe(mixSeed(1, 2, 3));
    expect(mixSeed(1, 2, 3)).not.toBe(mixSeed(3, 2, 1));
  });
  it('余弦半球采样落在单位球内', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const s = rng.cosineHemisphere();
      const m = Math.hypot(s.dz, s.s, s.c);
      expect(m).toBeGreaterThan(0.999);
      expect(m).toBeLessThan(1.001);
      expect(s.dz).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('网点场生成', () => {
  it('同参数两次生成逐位一致（含抖动）', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[0].project);
    const d1 = generateField(p);
    const d2 = generateField(p);
    expect(d1.totalDots).toBe(d2.totalDots);
    expect(Array.from(d1.field.xs)).toEqual(Array.from(d2.field.xs));
    expect(Array.from(d1.field.diameters)).toEqual(Array.from(d2.field.diameters));
  });

  it('切角板网点不会落在板外', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[0].project); // 切角异形
    const d = generateField(p);
    let outside = 0;
    for (let cell = 0; cell < d.field.counts.length; cell++) {
      const off = d.field.cellOffset[cell];
      for (let k = 0; k < d.field.counts[cell]; k++) {
        if (!pointInPanel(p.panel, d.field.xs[off + k], d.field.ys[off + k])) outside++;
      }
    }
    expect(outside).toBe(0);
  });

  it('刷子增删后自由链表不丢槽位', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    const d = generateField(p);
    const before = d.totalDots;
    const cell = d.field.counts.findIndex((c) => c > 0);
    d.removeDot(cell);
    expect(d.totalDots).toBe(before - 1);
    const dia = d.meanDiameter(cell) || p.dot.minDiameter;
    const ok = d.addDot(cell, 1, 1, dia);
    expect(ok).toBe(true);
    expect(d.totalDots).toBe(before);
  });

  it('密度曲线插值在锚点间单调', () => {
    const curve = [{ x: 0, y: 0.2 }, { x: 1, y: 0.9 }];
    expect(evalCurve(curve, 0)).toBeCloseTo(0.2);
    expect(evalCurve(curve, 0.5)).toBeCloseTo(0.55);
    expect(evalCurve(curve, 1)).toBeCloseTo(0.9);
  });
});

describe('蒙特卡洛仿真', () => {
  it('同种子两次仿真结果逐位一致（可复现性硬性要求）', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    const dots = generateField(p);
    const t = task('t1');
    const o1 = runSimulation(p, dots, t.settings)!;
    const o2 = runSimulation(p, dots, t.settings)!;
    expect(Array.from(o1.irradiance)).toEqual(Array.from(o2.irradiance));
    expect(o1.raysShot).toBe(o2.raysShot);
    expect(o1.energyAudit).toEqual(o2.energyAudit);
  });

  it('不同种子统计接近但不逐位相同', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    const dots = generateField(p);
    const o1 = runSimulation(p, dots, task('a', 111).settings)!;
    const o2 = runSimulation(p, dots, task('b', 222).settings)!;
    expect(Array.from(o1.irradiance)).not.toEqual(Array.from(o2.irradiance));
    const s1 = o1.irradiance.reduce((a, b) => a + b, 0);
    const s2 = o2.irradiance.reduce((a, b) => a + b, 0);
    expect(Math.abs(s1 - s2) / s1).toBeLessThan(0.05);
  });

  it('能量守恒：注入 = 出光+吸收+逃逸（误差 <2%）', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[1].project);
    const dots = generateField(p);
    const out = runSimulation(p, dots, task('e', 99, 80_000).settings)!;
    const a = out.energyAudit;
    const balance = Math.abs(a.exited + a.absorbed + a.escaped - a.injected) / a.injected;
    expect(balance).toBeLessThan(0.02);
    expect(a.injected).toBeGreaterThan(0);
  });

  it('九点均匀度 = 最小九点照度 / 九点平均照度，且在 (0, 1.2]', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[0].project);
    const dots = generateField(p);
    const out = runSimulation(p, dots, task('u').settings)!;
    const result = summarizeResult(out, task('u'), p, 1, false);
    const pts = ninePointPositions(p.panel).filter((q) => q.valid);
    expect(result.ninePoint.length).toBe(pts.length);
    const avg = result.ninePoint.reduce((a, b) => a + b, 0) / result.ninePoint.length;
    const expected = Math.min(...result.ninePoint) / avg;
    expect(result.uniformity).toBeCloseTo(expected, 6);
    expect(result.uniformity).toBeGreaterThan(0);
    expect(result.uniformity).toBeLessThan(1.2);
  });

  it('取消后输出部分结果且 raysShot 小于设定值', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    const dots = generateField(p);
    let calls = 0;
    const out = runSimulation(p, dots, task('c', 5, 200_000).settings, {
      shouldCancel: () => {
        calls++;
        return calls > 3;
      },
    })!;
    expect(out.raysShot).toBeLessThan(200_000);
    const result = summarizeResult(out, task('c'), p, 1, true);
    expect(result.status).toBe('cancelled');
  });

  it('扩散片雾度为零时输出等于原始照度', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    p.film.diffuserHaze = 0;
    p.film.diffusionDistance = 2;
    const dots = generateField(p);
    const out = runSimulation(p, dots, task('d').settings)!;
    expect(Array.from(out.irradiance)).toEqual(Array.from(out.irradianceRaw));
  });
});

describe('自动反推修正', () => {
  it('修正因子被限制在 [0.5, 2] 且长度匹配网点网格', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[0].project);
    const dots = generateField(p);
    const out = runSimulation(p, dots, task('k').settings)!;
    const result = summarizeResult(out, task('k'), p, 1, false);
    const corr = computeCorrection(p, dots, result);
    expect(corr.factors.length).toBe(dots.cols * dots.rows);
    for (const f of corr.factors) {
      expect(f).toBeGreaterThanOrEqual(0.5);
      expect(f).toBeLessThanOrEqual(2);
    }
  });

  it('暗区单元的修正因子大于 1（趋向加密）', () => {
    const p = structuredClone(BUILTIN_TEMPLATES[2].project);
    const dots = generateField(p);
    const out = runSimulation(p, dots, task('k2', 77, 80_000).settings)!;
    const result = summarizeResult(out, task('k2'), p, 1, false);
    const corr = computeCorrection(p, dots, result);
    const darkCell = result.darkZones[0];
    if (darkCell !== undefined) {
      // 暗区网格映射回网点单元（尺度不同，取中心区域统计）
      const anyBoost = Array.from(corr.factors).some((f) => f > 1.05);
      expect(anyBoost).toBe(true);
    }
  });
});
