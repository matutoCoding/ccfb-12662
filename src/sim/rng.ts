// 确定性伪随机数（mulberry32）+ 可插拔流的高斯采样，保证同种子结果逐位可复现

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0,1) 均匀分布 */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Box-Muller 高斯 */
  gaussian(mean = 0, std = 1): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    return mean + std * mag * Math.cos(2 * Math.PI * u2);
  }

  /** 余弦加权半球采样（Lambert），返回相对法线的 z 分量与方位角 sin/cos */
  cosineHemisphere(): { dz: number; s: number; c: number } {
    const r1 = this.next();
    const r2 = this.next();
    const dz = Math.sqrt(r1);
    const phi = 2 * Math.PI * r2;
    const sr = Math.sqrt(1 - r1);
    return { dz, s: sr * Math.sin(phi), c: sr * Math.cos(phi) };
  }
}

/** 由多个整数混合出一个稳定种子（哈希组合） */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9 >>> 0;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b) >>> 0;
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
