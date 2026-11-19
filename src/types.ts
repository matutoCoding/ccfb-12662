// 全局类型定义 —— 导光板网点设计与仿真系统

export type DistributionType = 'linear' | 'exponential' | 'radial';
export type LightEdge = 'left' | 'right' | 'top' | 'bottom';
export type PanelShape = 'rectangle' | 'chamfered';

/** 切角定义：四个角的切角量(mm)，0 表示不切 */
export interface Chamfer {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export interface PanelParams {
  shape: PanelShape;
  /** 外形尺寸 mm */
  width: number;
  height: number;
  thickness: number;
  chamfer: Chamfer;
}

export interface LedParams {
  /** 启用的入光边 */
  edges: LightEdge[];
  /** 每条边 LED 颗数 */
  countPerEdge: number;
  /** LED 间距 mm（自动模式下由边长与颗数推导，手动时参与排布） */
  pitch: number;
  /** 单灯光通量 lm */
  fluxPerLed: number;
  /** 色温 K（用于报告与显示，不参与能量守恒计算） */
  colorTemp: number;
  /** 光耦合效率 0~1（入光损耗） */
  couplingEfficiency: number;
}

export interface DotConfig {
  /** 网格间距 mm（网格生成基准） */
  gridPitch: number;
  /** 网点直径上下限 mm */
  minDiameter: number;
  maxDiameter: number;
  /** 初始密度曲线 0~1 的锚点，x 为归一化位置 */
  densityCurve: CurvePoint[];
  distribution: DistributionType;
  /** 随机抖动幅度，占网格间距比例 0~1 */
  jitter: number;
  /** 随机抖动种子 */
  seed: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface FilmParams {
  /** 反射片反射率 0~1 */
  reflectorReflectance: number;
  /** 扩散片雾度 0~1 */
  diffuserHaze: number;
  /** 扩散距离 mm（高斯展宽尺度） */
  diffusionDistance: number;
  /** 网点散射单次反照率 0~1（吸收损失） */
  dotAlbedo: number;
}

/** 修正层（自动反推产生的局部密度乘区，按网格单元存储，空数组表示无修正） */
export interface CorrectionLayer {
  /** 每个单元的密度倍率，长度 = cols*rows，1 表示不变 */
  factors: Float32Array;
  createdAt: number;
  /** 产生该修正的仿真任务 id */
  sourceTaskId: string;
}

export interface Project {
  id: string;
  name: string;
  panel: PanelParams;
  led: LedParams;
  dot: DotConfig;
  film: FilmParams;
  createdAt: number;
  updatedAt: number;
  /** 修正层（可为空） */
  correction: CorrectionLayer | null;
}

/** 网点场：稠密网格单元 + 每单元网点缓冲 */
export interface DotField {
  cols: number;
  rows: number;
  pitch: number;
  originX: number;
  originY: number;
  /** 单元容量（每格最大网点数） */
  capacity: number;
  /** 每格实际数量 Uint32Array(cols*rows) */
  counts: Uint32Array;
  /** 扁平存储的网点 x(mm) */
  xs: Float32Array;
  ys: Float32Array;
  /** 直径 mm */
  diameters: Float32Array;
  /** 自由链表：-1 结尾；-2 表示已占用 */
  nextFree: Int32Array;
  freeHead: number;
  /** 单元起始槽位表（构建后固定） */
  cellOffset: Uint32Array;
}

export interface SimSettings {
  rayCount: number;
  /** 照度网格分辨率（长边方向） */
  irradianceResolution: number;
  seed: number;
  maxBounces: number;
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'error';

export interface ConvergencePoint {
  /** 已投射线数 */
  rays: number;
  /** 当前九点均匀度 */
  uniformity: number;
}

export interface SimResult {
  taskId: string;
  projectId: string;
  /** 参数快照，保证结果可追溯 */
  projectSnapshot: Project;
  settings: SimSettings;
  status: TaskStatus;
  /** 出光照度网格（已扩散），归一化 lm/m² 比例值，行优先 [row][col] */
  irradiance: Float32Array;
  gridCols: number;
  gridRows: number;
  cellW: number;
  cellH: number;
  /** 板内有效单元掩码（切角外为 0） */
  validMask: Uint8Array;
  /** 九点照度（归一化平均值后的相对值） */
  ninePoint: number[];
  uniformity: number;
  avgIrradiance: number;
  minIrradiance: number;
  maxIrradiance: number;
  /** 暗区单元索引 */
  darkZones: number[];
  /** 入光边亮带单元索引 */
  brightBands: number[];
  convergence: ConvergencePoint[];
  /** 实际投射线数（取消时 < rayCount） */
  raysShot: number;
  /** 能量审计：总入光 / 出光 / 吸收 / 边界逃逸 */
  energyAudit: { injected: number; exited: number; absorbed: number; escaped: number };
  createdAt: number;
  elapsedMs: number;
}

export interface SimTask {
  id: string;
  projectId: string;
  name: string;
  settings: SimSettings;
  status: TaskStatus;
  progress: number;
  createdAt: number;
  result: SimResult | null;
  error: string | null;
}

/** 导出文件结构 */
export interface ExportBundle {
  format: 'lgp-studio-bundle';
  version: 1;
  exportedAt: number;
  project: Project;
  dotField: SerializedDotField | null;
  tasks: SimTask[];
}

export interface SerializedDotField {
  cols: number;
  rows: number;
  pitch: number;
  originX: number;
  originY: number;
  capacity: number;
  counts: number[];
  xs: number[];
  ys: number[];
  diameters: number[];
  cellOffset: number[];
}

export const DEFAULT_SETTINGS: SimSettings = {
  rayCount: 200_000,
  irradianceResolution: 160,
  seed: 20261120,
  maxBounces: 60,
};
