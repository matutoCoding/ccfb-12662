// 网点场：稠密网格单元存储 + 自由链表 O(1) 分配，支持生成、刷子增删、序列化
import type { DotConfig, DotField, PanelParams, Project, SerializedDotField } from '../types';
import { Rng, mixSeed } from './rng';
import { clamp, lerp, pointInPanel } from './geometry';

export const CELL_CAPACITY = 4;

/** 几何投影率 → 有效散射系数的标定系数（经验光学常数） */
export const MU_CALIBRATION = 0.0025;

export class DotFieldModel {
  field: DotField;

  constructor(field: DotField) {
    this.field = field;
  }

  get cols() {
    return this.field.cols;
  }
  get rows() {
    return this.field.rows;
  }
  get totalDots(): number {
    let n = 0;
    for (let i = 0; i < this.field.counts.length; i++) n += this.field.counts[i];
    return n;
  }

  cellIndex(cx: number, cy: number): number {
    return cy * this.field.cols + cx;
  }

  cellAt(x: number, y: number): number {
    const cx = Math.floor((x - this.field.originX) / this.field.pitch);
    const cy = Math.floor((y - this.field.originY) / this.field.pitch);
    if (cx < 0 || cy < 0 || cx >= this.field.cols || cy >= this.field.rows) return -1;
    return this.cellIndex(cx, cy);
  }

  localDensity(cell: number): number {
    if (cell < 0) return 0;
    return this.field.counts[cell] / this.field.capacity;
  }

  /** 该单元网点平均直径；无网点返回 0 */
  meanDiameter(cell: number): number {
    if (cell < 0 || this.field.counts[cell] === 0) return 0;
    const off = this.field.cellOffset[cell];
    const n = this.field.counts[cell];
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.field.diameters[off + k];
    return sum / n;
  }

  private alloc(): number {
    const head = this.field.freeHead;
    if (head < 0) return -1;
    this.field.freeHead = this.field.nextFree[head];
    this.field.nextFree[head] = -2;
    return head;
  }

  private free(slot: number): void {
    this.field.nextFree[slot] = this.field.freeHead;
    this.field.freeHead = slot;
  }

  /** 在单元内加一颗网点；槽满返回 false */
  addDot(cell: number, x: number, y: number, diameter: number): boolean {
    if (cell < 0 || this.field.counts[cell] >= this.field.capacity) return false;
    const slot = this.alloc();
    if (slot < 0) return false;
    const off = this.field.cellOffset[cell];
    const k = this.field.counts[cell];
    this.field.xs[off + k] = x;
    this.field.ys[off + k] = y;
    this.field.diameters[off + k] = diameter;
    this.field.counts[cell] = k + 1;
    return true;
  }

  /** 删除单元内最后一颗网点，返回其直径（空单元返回 0） */
  removeDot(cell: number): number {
    if (cell < 0 || this.field.counts[cell] === 0) return 0;
    const off = this.field.cellOffset[cell];
    const k = this.field.counts[cell] - 1;
    const d = this.field.diameters[off + k];
    this.free(off + k);
    this.field.counts[cell] = k;
    return d;
  }

  /**
   * 2D 散射系数 μ [1/mm]：单元内网点投影宽度之和 / 单元面积，再乘经验标定系数。
   * 标定系数把几何投影率折算为实际散射概率（网点印刷接触面积/光学增益），
   * 使典型密度下 μ≈1e-3~1e-2/mm，光需经过数十毫米传播才被显著抽取。
   */
  scatteringMu(cell: number): number {
    if (cell < 0 || this.field.counts[cell] === 0) return 0;
    const area = this.field.pitch * this.field.pitch;
    const geometric = (this.field.counts[cell] * this.meanDiameter(cell)) / area;
    return geometric * MU_CALIBRATION;
  }

  /** 悬停查询：最近网点直径与局部密度 */
  probe(x: number, y: number): { diameter: number; density: number; cell: number } {
    const cell = this.cellAt(x, y);
    if (cell < 0) return { diameter: 0, density: 0, cell: -1 };
    const off = this.field.cellOffset[cell];
    const n = this.field.counts[cell];
    let best = Infinity;
    let d = 0;
    for (let k = 0; k < n; k++) {
      const dx = this.field.xs[off + k] - x;
      const dy = this.field.ys[off + k] - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < best) {
        best = dist2;
        d = this.field.diameters[off + k];
      }
    }
    return { diameter: d, density: this.localDensity(cell), cell };
  }

  serialize(): SerializedDotField {
    const f = this.field;
    return {
      cols: f.cols,
      rows: f.rows,
      pitch: f.pitch,
      originX: f.originX,
      originY: f.originY,
      capacity: f.capacity,
      counts: Array.from(f.counts),
      xs: Array.from(f.xs),
      ys: Array.from(f.ys),
      diameters: Array.from(f.diameters),
      cellOffset: Array.from(f.cellOffset),
    };
  }

  static deserialize(s: SerializedDotField): DotFieldModel {
    const total = s.cols * s.rows * s.capacity;
    const nextFree = new Int32Array(total).fill(-2);
    let freeHead = -1;
    for (let i = 0; i < s.cols * s.rows; i++) {
      const off = s.cellOffset[i];
      for (let k = s.counts[i]; k < s.capacity; k++) {
        const slot = off + k;
        nextFree[slot] = freeHead;
        freeHead = slot;
      }
    }
    return new DotFieldModel({
      cols: s.cols,
      rows: s.rows,
      pitch: s.pitch,
      originX: s.originX,
      originY: s.originY,
      capacity: s.capacity,
      counts: Uint32Array.from(s.counts),
      xs: Float32Array.from(s.xs),
      ys: Float32Array.from(s.ys),
      diameters: Float32Array.from(s.diameters),
      nextFree,
      freeHead,
      cellOffset: Uint32Array.from(s.cellOffset),
    });
  }
}

/** 曲线分段线性插值，锚点按 x 排序 */
export function evalCurve(curve: { x: number; y: number }[], t: number): number {
  if (curve.length === 0) return 0.5;
  const sorted = [...curve].sort((a, b) => a.x - b.x);
  if (t <= sorted[0].x) return sorted[0].y;
  if (t >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.x && t <= b.x) {
      return lerp(a.y, b.y, (t - a.x) / Math.max(1e-9, b.x - a.x));
    }
  }
  return sorted[sorted.length - 1].y;
}

/** 按项目参数生成初始网点场（含修正层与抖动，确定性） */
export function generateField(project: Project): DotFieldModel {
  return generateWith(project.panel, project.dot, project.correction?.factors ?? null, project);
}

export function generateWith(
  panel: PanelParams,
  dot: DotConfig,
  correctionFactors: Float32Array | null,
  project: Project,
): DotFieldModel {
  const pitch = dot.gridPitch;
  const cols = Math.max(1, Math.floor(panel.width / pitch));
  const rows = Math.max(1, Math.floor(panel.height / pitch));
  const originX = (panel.width - cols * pitch) / 2;
  const originY = (panel.height - rows * pitch) / 2;
  const capacity = CELL_CAPACITY;
  const cells = cols * rows;
  const total = cells * capacity;

  const counts = new Uint32Array(cells);
  const cellOffset = new Uint32Array(cells);
  for (let i = 0; i < cells; i++) cellOffset[i] = i * capacity;
  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  const diameters = new Float32Array(total);
  const nextFree = new Int32Array(total);
  const rng = new Rng(mixSeed(dot.seed, Math.round(panel.width * 10), Math.round(panel.height * 10)));
  const edgeSet = new Set(project.led.edges);
  const maxDist = Math.hypot(panel.width, panel.height);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      const ccx = originX + (cx + 0.5) * pitch;
      const ccy = originY + (cy + 0.5) * pitch;
      if (!pointInPanel(panel, ccx, ccy)) continue;

      let t: number;
      if (dot.distribution === 'radial') {
        t = (Math.hypot(ccx - panel.width / 2, ccy - panel.height / 2) / maxDist) * 2;
      } else {
        let dMin = Infinity;
        if (edgeSet.has('left')) dMin = Math.min(dMin, ccx);
        if (edgeSet.has('right')) dMin = Math.min(dMin, panel.width - ccx);
        if (edgeSet.has('bottom')) dMin = Math.min(dMin, ccy);
        if (edgeSet.has('top')) dMin = Math.min(dMin, panel.height - ccy);
        if (!isFinite(dMin)) dMin = ccx;
        t = dMin / (Math.max(panel.width, panel.height) / 2);
      }
      if (dot.distribution === 'exponential') t = (Math.exp(2 * t) - 1) / (Math.E * Math.E - 1);
      let density = evalCurve(dot.densityCurve, clamp(t, 0, 1));
      if (correctionFactors) density *= correctionFactors[cell] ?? 1;
      density = clamp(density, 0, 1);

      const n = Math.round(density * capacity);
      const diameter = lerp(dot.minDiameter, dot.maxDiameter, density);
      let placed = 0;
      const off = cellOffset[cell];
      for (let k = 0; k < n; k++) {
        const jx = dot.jitter > 0 ? rng.range(-0.5, 0.5) * dot.jitter * pitch : 0;
        const jy = dot.jitter > 0 ? rng.range(-0.5, 0.5) * dot.jitter * pitch : 0;
        const sub = capacity > 1 ? (k / (capacity - 1) - 0.5) * pitch * 0.7 : 0;
        const x = clamp(ccx + jx + sub, originX + cx * pitch, originX + (cx + 1) * pitch);
        const y = clamp(ccy + jy - sub, originY + cy * pitch, originY + (cy + 1) * pitch);
        // 切角板：抖动后落到板外的点丢弃，保证所有网点严格在板内
        if (!pointInPanel(panel, x, y)) continue;
        xs[off + placed] = x;
        ys[off + placed] = y;
        diameters[off + placed] = diameter;
        placed++;
      }
      counts[cell] = placed;
    }
  }

  let freeHead = -1;
  for (let i = 0; i < cells; i++) {
    const off = cellOffset[i];
    for (let k = 0; k < capacity; k++) {
      const slot = off + k;
      if (k < counts[i]) nextFree[slot] = -2;
      else {
        nextFree[slot] = freeHead;
        freeHead = slot;
      }
    }
  }

  return new DotFieldModel({
    cols, rows, pitch, originX, originY, capacity,
    counts, xs, ys, diameters, nextFree, freeHead, cellOffset,
  });
}
