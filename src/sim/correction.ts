// 按照度误差图反推一轮网点密度修正（乘性更新 + 松弛 + 邻域平滑）
import type { Project, SimResult } from '../types';
import { clamp } from './geometry';
import { sampleGrid } from './simulator';
import type { DotFieldModel } from './dotField';

export interface CorrectionOutput {
  factors: Float32Array;
  stats: { changed: number; meanFactor: number; maxFactor: number; minFactor: number };
}

const RELAX = 0.6; // 松弛系数，防止过冲振荡
const FACTOR_LO = 0.5;
const FACTOR_HI = 2.0;
const SMOOTH_KERNEL = 0.5; // 中心权重，其余分给有效邻居

export function computeCorrection(
  project: Project,
  dots: DotFieldModel,
  result: SimResult,
): CorrectionOutput {
  const { cols, rows } = dots;
  const prev = project.correction?.factors;
  const factors = new Float32Array(cols * rows).fill(1);
  const raw = new Float32Array(cols * rows).fill(1);
  const target = result.avgIrradiance;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      if (dots.field.counts[cell] === 0 && !(prev && prev[cell] !== 1)) {
        // 完全无网点且无历史修正的单元保持 1
      }
      const x = dots.field.originX + (cx + 0.5) * dots.field.pitch;
      const y = dots.field.originY + (cy + 0.5) * dots.field.pitch;
      const localE = sampleGrid(
        result.irradiance,
        result.gridCols,
        result.gridRows,
        project.panel,
        x,
        y,
      );      if (localE <= 1e-9) {
        raw[cell] = FACTOR_HI;
      } else {
        const ratio = target / localE;
        raw[cell] = clamp(1 + RELAX * (ratio - 1), FACTOR_LO, FACTOR_HI);
      }
    }
  }

  // 邻域平滑，抑制高频振荡（切角/无效邻居跳过）
  let changed = 0;
  let sumF = 0;
  let maxF = 0;
  let minF = Infinity;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      let neighborSum = 0;
      let neighborN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          neighborSum += raw[ny * cols + nx];
          neighborN++;
        }
      }
      const smoothed = raw[cell] * SMOOTH_KERNEL + (neighborN ? neighborSum / neighborN : raw[cell]) * (1 - SMOOTH_KERNEL);
      const base = prev ? prev[cell] : 1;
      const f = clamp(base * smoothed, FACTOR_LO, FACTOR_HI);
      factors[cell] = f;
      if (Math.abs(f - base) > 0.02) changed++;
      sumF += f;
      if (f > maxF) maxF = f;
      if (f < minF) minF = f;
    }
  }

  return {
    factors,
    stats: {
      changed,
      meanFactor: sumF / (cols * rows),
      maxFactor: maxF,
      minFactor: isFinite(minF) ? minF : 1,
    },
  };
}
