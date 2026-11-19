// 蒙特卡洛导光板仿真核心（2.5D 介质传播模型，确定性、可取消）
//
// 物理模型：
//  - 光线在 PMMA 板内以 2D 方向传播，厚度方向的全反射使折叠光程等价于平面传播；
//  - 网点按单元聚合成 2D 散射系数场 μ(x,y)，沿光程指数衰减（Beer-Lambert），
//    每个散射事件的能量由真实网点覆盖率推导，不存在凭空赋亮度；
//  - 散射事件：一部分能量从顶面抽出为有效出光，底面抽出经反射片按反射率回收，
//    网点吸收与反射片损失计入能量审计，剩余能量按前向锥重新发射继续传播；
//  - 板边界：理想导光边界，板内光全部全反射，能量只经网点抽取离开导光体；
//  - 扩散片对出光照度做雾度加权的高斯展宽。
import type { FilmParams, PanelParams, Project, SimResult, SimSettings, SimTask, LightEdge } from '../types';
import type { DotFieldModel } from './dotField';
import { Rng, mixSeed } from './rng';
import { edgeGeometry, ninePointPositions, pointInPanel, panelPolygon, type Vec2 } from './geometry';

const PMMA_IOR = 1.49;
const AIR_IOR = 1.0;
const CRIT_COS = Math.sqrt(1 - (AIR_IOR / PMMA_IOR) ** 2); // 临界角的 cos（与边法线夹角）

export interface ProgressInfo {
  raysDone: number;
  totalRays: number;
  checkpoint?: { rays: number; uniformity: number };
}

export interface RunOptions {
  onProgress?: (p: ProgressInfo) => void;
  shouldCancel?: () => boolean;
}

/** 预计算的单元散射系数场与几何加速结构 */
export interface ScatterField {
  mu: Float32Array;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  originX: number;
  originY: number;
  valid: Uint8Array;
}

export function buildScatterField(panel: PanelParams, dots: DotFieldModel): ScatterField {
  const { cols, rows } = dots;
  const cellW = panel.width / cols;
  const cellH = panel.height / rows;
  const mu = new Float32Array(cols * rows);
  const valid = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      const ccx = dots.field.originX + (cx + 0.5) * dots.field.pitch;
      const ccy = dots.field.originY + (cy + 0.5) * dots.field.pitch;
      valid[cell] = pointInPanel(panel, ccx, ccy) ? 1 : 0;
      mu[cell] = dots.scatteringMu(cell);
    }
  }
  return { mu, cols, rows, cellW, cellH, originX: 0, originY: 0, valid };
}

/** 双线性采样散射系数，板外返回 0 */
function sampleMu(field: ScatterField, x: number, y: number): number {
  const gx = x / field.cellW - 0.5;
  const gy = y / field.cellH - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  if (x0 < 0 || y0 < 0 || x0 >= field.cols - 1 || y0 >= field.rows - 1) {
    const cx = Math.max(0, Math.min(field.cols - 1, Math.floor(x / field.cellW)));
    const cy = Math.max(0, Math.min(field.rows - 1, Math.floor(y / field.cellH)));
    return field.valid[cy * field.cols + cx] ? field.mu[cy * field.cols + cx] : 0;
  }
  const fx = gx - x0;
  const fy = gy - y0;
  const i00 = y0 * field.cols + x0;
  const i10 = i00 + 1;
  const i01 = i00 + field.cols;
  const i11 = i01 + 1;
  return (
    field.mu[i00] * (1 - fx) * (1 - fy) +
    field.mu[i10] * fx * (1 - fy) +
    field.mu[i01] * (1 - fx) * fy +
    field.mu[i11] * fx * fy
  );
}

interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
  weight: number;
}

/** 射线与多边形边界的最近交点及命中边法向 */
function hitBoundary(poly: Vec2[], x: number, y: number, dx: number, dy: number): { t: number; nx: number; ny: number; edge: number } | null {
  let bestT = Infinity;
  let nx = 0;
  let ny = 0;
  let edge = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - x) * ey - (a.y - y) * ex) / denom;
    const u = ((a.x - x) * dy - (a.y - y) * dx) / denom;
    if (t > 1e-9 && t < bestT && u >= 0 && u <= 1) {
      bestT = t;
      edge = i;
      // 边的内向法线（顶点逆时针排列时，内向法线为边方向顺时针转 90°）
      const len = Math.hypot(ex, ey);
      nx = -ey / len;
      ny = ex / len;
    }
  }
  if (!isFinite(bestT)) return null;
  return { t: bestT, nx, ny, edge };
}

export interface SimEngineOutput {
  irradianceRaw: Float32Array;
  irradiance: Float32Array;
  gridCols: number;
  gridRows: number;
  cellW: number;
  cellH: number;
  validMask: Uint8Array;
  raysShot: number;
  energyAudit: { injected: number; exited: number; absorbed: number; escaped: number };
  checkpoints: { rays: number; uniformity: number }[];
}

export function runSimulation(
  project: Project,
  dots: DotFieldModel,
  settings: SimSettings,
  opts: RunOptions = {},
): SimEngineOutput | null {
  const { panel, led, film } = project;
  const poly = panelPolygon(panel);
  const scatter = buildScatterField(panel, dots);

  // 照度网格
  const gridCols = settings.irradianceResolution;
  const gridRows = Math.max(8, Math.round((panel.height / panel.width) * gridCols));
  const cellW = panel.width / gridCols;
  const cellH = panel.height / gridRows;
  const raw = new Float32Array(gridCols * gridRows);
  const validMask = new Uint8Array(gridCols * gridRows);
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      validMask[r * gridCols + c] = pointInPanel(panel, (c + 0.5) * cellW, (r + 0.5) * cellH) ? 1 : 0;
    }
  }

  // LED 注入位置表
  const injectors: { x: number; y: number; dx: number; dy: number; weight: number }[] = [];
  const totalLed = led.edges.length * led.countPerEdge;
  for (const edge of led.edges as LightEdge[]) {
    const g = edgeGeometry(edge, panel);
    for (let i = 0; i < led.countPerEdge; i++) {
      const f = led.countPerEdge === 1 ? 0.5 : i / (led.countPerEdge - 1);
      injectors.push({
        x: g.start.x + (g.end.x - g.start.x) * f,
        y: g.start.y + (g.end.y - g.start.y) * f,
        dx: g.inward.x,
        dy: g.inward.y,
        weight: (led.fluxPerLed * led.couplingEfficiency) / totalLed,
      });
    }
  }

  const audit = { injected: 0, exited: 0, absorbed: 0, escaped: 0 };
  const checkpoints: { rays: number; uniformity: number }[] = [];
  const CHECK_RAYS = 8;
  const checkAt = new Set<number>();
  for (let k = 1; k <= CHECK_RAYS; k++) checkAt.add(Math.round((settings.rayCount * k) / CHECK_RAYS));

  const deposit = (x: number, y: number, energy: number) => {
    const c = Math.floor(x / cellW);
    const r = Math.floor(y / cellH);
    if (c < 0 || r < 0 || c >= gridCols || r >= gridRows) return;
    raw[r * gridCols + c] += energy;
  };

  let raysShot = 0;

  for (let ri = 0; ri < settings.rayCount; ri++) {
    if (opts.shouldCancel?.()) break;
    if ((ri & 2047) === 0) opts.onProgress?.({ raysDone: ri, totalRays: settings.rayCount });

    // 固定种子可复现：每根光线独立 Rng 流，注入器/角度全部确定性抽取
    const rng = new Rng(mixSeed(settings.seed, ri));
    const injector = injectors[Math.floor(rng.next() * injectors.length)];
    // 注入角度：LED 朗伯分布的板内投影，限制在 TIR 导波锥（传播轴偏角 < 90°-临界角）
    const guideCone = (Math.PI / 2 - Math.acos(CRIT_COS)) * 0.9;
    const ang = (rng.next() * 2 - 1) * guideCone;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ray: Ray = {
      x: injector.x + injector.dx * 0.05,
      y: injector.y + injector.dy * 0.05,
      dx: injector.dx * ca - injector.dy * sa,
      dy: injector.dx * sa + injector.dy * ca,
      weight: injector.weight,
    };
    audit.injected += ray.weight;

    for (let bounce = 0; bounce < settings.maxBounces && ray.weight > 1e-7; bounce++) {
      const hit = hitBoundary(poly, ray.x, ray.y, ray.dx, ray.dy);
      if (!hit) {
        // 数值异常（极罕见）：终止该光线，剩余权重计为吸收而非凭空消失
        audit.absorbed += ray.weight;
        break;
      }
      // 沿光程积分网点散射（Beer-Lambert，散射系数来自真实网点覆盖率）
      const steps = Math.max(1, Math.ceil(hit.t / Math.max(scatter.cellW, scatter.cellH)));
      const segLen = hit.t / steps;
      let px = ray.x;
      let py = ray.y;
      let terminated = false;

      for (let s = 0; s < steps; s++) {
        const mu = sampleMu(scatter, px, py);
        if (mu > 0) {
          const tau = mu * segLen;
          const scatterFraction = 1 - Math.exp(-tau);
          const interacted = ray.weight * scatterFraction;
          // 1) 网点吸收（反照率损失）
          const absorbed = interacted * (1 - film.dotAlbedo);
          audit.absorbed += absorbed;
          // 2) 散射能量：顶面直接出光 / 底面抽出经反射片 / 反射片损失
          const scattered = interacted * film.dotAlbedo;
          const topFrac = 0.5;
          const toTop = scattered * topFrac;
          const toBottom = scattered * (1 - topFrac);
          const recycled = toBottom * film.reflectorReflectance;
          const reflectorLoss = toBottom - recycled;
          audit.absorbed += reflectorLoss;
          // 顶面为有效出光；反射片回收光中约 35% 在邻近位置漫射出顶面，其余重回导光体继续传播
          const recycledExit = recycled * 0.35;
          const recycledKept = recycled - recycledExit;
          deposit(px, py, toTop + recycledExit);
          audit.exited += toTop + recycledExit;
          // 3) 能量守恒：本光束只保留未被散射的部分 + 反射片回收保留部分
          ray.weight = ray.weight - interacted + recycledKept;

          // 散射重定向：以前向为主的小角度偏转（余弦加权），偏转限制在 TIR 导波锥内。
          // 沿板传播方向与边法线夹角须保持 > 临界角，即传播轴偏角不超过 90°-临界角
          const maxDeflect = (Math.PI / 2 - Math.acos(CRIT_COS)) * 0.9;
          const hemi = rng.cosineHemisphere();
          const deflect = maxDeflect * (1 - Math.sqrt(hemi.dz));
          const baseAng = Math.atan2(ray.dy, ray.dx);
          const sign = rng.next() < 0.5 ? 1 : -1;
          const newAng = baseAng + sign * deflect;
          ray.dx = Math.cos(newAng);
          ray.dy = Math.sin(newAng);
        }
        px += ray.dx * segLen;
        py += ray.dy * segLen;
        if (ray.weight <= 1e-7) {
          terminated = true;
          break;
        }
      }
      if (terminated) break;

      ray.x = px;
      ray.y = py;
      // 理想导光边界：板内传播光在所有边界全反射（PMMA 平板波导的标准假设）。
      // 能量离开导光体的唯一途径是网点散射抽取，边界本身不产生能量损失。
      // 反射点严格保持在边界上，不做外移，避免数值越界。
      const dotN = ray.dx * hit.nx + ray.dy * hit.ny;
      ray.dx -= 2 * dotN * hit.nx;
      ray.dy -= 2 * dotN * hit.ny;
    }
    raysShot = ri + 1;
    if (checkAt.has(raysShot)) {
      const cp = { rays: raysShot, uniformity: currentUniformity(raw, gridCols, gridRows, panel) };
      checkpoints.push(cp);
      opts.onProgress?.({ raysDone: raysShot, totalRays: settings.rayCount, checkpoint: cp });
    } else if ((ri & 8191) === 0) {
      opts.onProgress?.({ raysDone: ri, totalRays: settings.rayCount });
    }
  }
  opts.onProgress?.({ raysDone: raysShot, totalRays: settings.rayCount });

  const irradiance = applyDiffuser(raw, validMask, gridCols, gridRows, cellW, cellH, film);
  return {
    irradianceRaw: raw,
    irradiance,
    gridCols,
    gridRows,
    cellW,
    cellH,
    validMask,
    raysShot,
    energyAudit: audit,
    checkpoints,
  };
}

function currentUniformity(grid: Float32Array, cols: number, rows: number, panel: PanelParams): number {
  const pts = ninePointPositions(panel).filter((p) => p.valid);
  const vals = pts.map((p) => sampleGrid(grid, cols, rows, panel, p.x, p.y));
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg <= 0) return 0;
  return Math.min(...vals) / avg;
}

export function sampleGrid(
  grid: Float32Array,
  cols: number,
  rows: number,
  panel: PanelParams,
  x: number,
  y: number,
): number {
  // cellW = panel.width/cols，因此 x/cellW 直接是连续网格列坐标（单元中心在 i+0.5）
  const gx = x / (panel.width / cols) - 0.5;
  const gy = y / (panel.height / rows) - 0.5;
  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const fx = Math.max(0, Math.min(1, gx - x0));
  const fy = Math.max(0, Math.min(1, gy - y0));
  const i00 = y0 * cols + x0;
  return (
    grid[i00] * (1 - fx) * (1 - fy) +
    grid[i00 + 1] * fx * (1 - fy) +
    grid[i00 + cols] * (1 - fx) * fy +
    grid[i00 + cols + 1] * fx * fy
  );
}

/** 扩散片：雾度加权高斯展宽，两次一维卷积，无效单元不参与且不接收 */
function applyDiffuser(
  src: Float32Array,
  valid: Uint8Array,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  film: FilmParams,
): Float32Array {
  const sigmaCells = (film.diffusionDistance * film.diffuserHaze) / Math.max(cellW, cellH);
  if (sigmaCells <= 0.05) return Float32Array.from(src);
  const radius = Math.min(12, Math.ceil(sigmaCells * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let kSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigmaCells * sigmaCells));
    kernel[k + radius] = w;
    kSum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!valid[i]) continue;
      let acc = 0;
      let wsum = 0;
      for (let k = -radius; k <= radius; k++) {
        const cc = c + k;
        if (cc < 0 || cc >= cols || !valid[r * cols + cc]) continue;
        acc += src[r * cols + cc] * kernel[k + radius];
        wsum += kernel[k + radius];
      }
      tmp[i] = wsum > 0 ? acc / wsum : src[i];
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!valid[i]) continue;
      let acc = 0;
      let wsum = 0;
      for (let k = -radius; k <= radius; k++) {
        const rr = r + k;
        if (rr < 0 || rr >= rows || !valid[rr * cols + c]) continue;
        acc += tmp[rr * cols + c] * kernel[k + radius];
        wsum += kernel[k + radius];
      }
      out[i] = wsum > 0 ? acc / wsum : tmp[i];
    }
  }
  return out;
}

/** 汇总引擎输出为完整结果对象（九点均匀度、暗区/亮带检测） */
export function summarizeResult(
  output: SimEngineOutput,
  task: SimTask,
  project: Project,
  elapsedMs: number,
  cancelled: boolean,
): SimResult {
  const { irradiance, gridCols, gridRows, validMask, cellW, cellH } = output;
  const pts = ninePointPositions(project.panel).filter((p) => p.valid);
  const ninePoint = pts.map((p) => sampleGrid(irradiance, gridCols, gridRows, project.panel, p.x, p.y));
  let sum = 0;
  let min = Infinity;
  let max = 0;
  let nValid = 0;
  for (let i = 0; i < irradiance.length; i++) {
    if (!validMask[i]) continue;
    const v = irradiance[i];
    sum += v;
    nValid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const avg = sum / Math.max(1, nValid);
  const nineAvg = ninePoint.reduce((a, b) => a + b, 0) / ninePoint.length;
  // 行业常规九点均匀度 = 最小九点照度 / 九点平均照度
  const uniformity = nineAvg > 0 ? Math.min(...ninePoint) / nineAvg : 0;

  // 暗区：低于全场均值 70%；亮带：入光边附近高于均值 125%
  const darkZones: number[] = [];
  const brightBands: number[] = [];
  const edgeSet = new Set(project.led.edges);
  const bandCells = Math.max(2, Math.round(gridCols * 0.06));
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const i = r * gridCols + c;
      if (!validMask[i]) continue;
      const v = irradiance[i];
      if (v < avg * 0.7) darkZones.push(i);
      const nearEdge =
        (edgeSet.has('left') && c < bandCells) ||
        (edgeSet.has('right') && c >= gridCols - bandCells) ||
        (edgeSet.has('bottom') && r < bandCells) ||
        (edgeSet.has('top') && r >= gridRows - bandCells);
      if (nearEdge && v > avg * 1.25) brightBands.push(i);
    }
  }

  return {
    taskId: task.id,
    projectId: project.id,
    projectSnapshot: structuredClone(project),
    settings: task.settings,
    status: cancelled ? 'cancelled' : 'done',
    irradiance,
    gridCols,
    gridRows,
    cellW,
    cellH,
    validMask,
    ninePoint,
    uniformity,
    avgIrradiance: avg,
    minIrradiance: min,
    maxIrradiance: max,
    darkZones,
    brightBands,
    convergence: output.checkpoints,
    raysShot: output.raysShot,
    energyAudit: output.energyAudit,
    createdAt: Date.now(),
    elapsedMs,
  };
}
