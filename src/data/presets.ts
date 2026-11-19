// 内置测试板件与光源数据（车载/工控典型尺寸）
import type { Project } from '../types';

export interface BuiltInTemplate {
  id: string;
  label: string;
  desc: string;
  project: Project;
}

function baseProject(partial: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  const now = Date.now();
  return {
    panel: {
      shape: 'rectangle',
      width: 150,
      height: 90,
      thickness: 0.8,
      chamfer: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
    },
    led: {
      edges: ['left'],
      countPerEdge: 24,
      pitch: 3.5,
      fluxPerLed: 8,
      colorTemp: 6500,
      couplingEfficiency: 0.85,
    },
    dot: {
      gridPitch: 0.6,
      minDiameter: 0.08,
      maxDiameter: 0.35,
      densityCurve: [
        { x: 0, y: 0.25 },
        { x: 0.5, y: 0.55 },
        { x: 1, y: 0.95 },
      ],
      distribution: 'linear',
      jitter: 0.35,
      seed: 20261120,
    },
    film: {
      reflectorReflectance: 0.95,
      diffuserHaze: 0.88,
      diffusionDistance: 1.2,
      dotAlbedo: 0.97,
    },
    createdAt: now,
    updatedAt: now,
    correction: null,
    ...partial,
  };
}

export const BUILTIN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'tpl-7inch-auto',
    label: '7寸车载中控屏 (165×100mm)',
    desc: '单边入光、30 颗 LED、切角异形，典型车载中控规格',
    project: baseProject({
      id: 'tpl-7inch-auto',
      name: '7寸车载中控方案',
      panel: {
        shape: 'chamfered',
        width: 165,
        height: 100,
        thickness: 0.8,
        chamfer: { topLeft: 6, topRight: 6, bottomLeft: 3, bottomRight: 3 },
      },
      led: { edges: ['left'], countPerEdge: 30, pitch: 3.2, fluxPerLed: 9, colorTemp: 7000, couplingEfficiency: 0.86 },
      dot: {
        gridPitch: 0.6, minDiameter: 0.07, maxDiameter: 0.38,
        densityCurve: [{ x: 0, y: 0.22 }, { x: 0.5, y: 0.55 }, { x: 1, y: 0.96 }],
        distribution: 'exponential', jitter: 0.4, seed: 7001,
      },
    }),
  },
  {
    id: 'tpl-10inch-industrial',
    label: '10.1寸工控屏 (223×126mm)',
    desc: '双边对入光、42 颗 LED，长行程导光板',
    project: baseProject({
      id: 'tpl-10inch-industrial',
      name: '10.1寸工控双边方案',
      panel: { shape: 'rectangle', width: 223, height: 126, thickness: 1.0, chamfer: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 } },
      led: { edges: ['left', 'right'], countPerEdge: 42, pitch: 3.0, fluxPerLed: 10, colorTemp: 6500, couplingEfficiency: 0.85 },
      dot: {
        gridPitch: 0.7, minDiameter: 0.09, maxDiameter: 0.42,
        densityCurve: [{ x: 0, y: 0.3 }, { x: 0.5, y: 0.92 }, { x: 1, y: 0.3 }],
        distribution: 'linear', jitter: 0.35, seed: 10101,
      },
    }),
  },
  {
    id: 'tpl-5inch-handheld',
    label: '5寸手持终端 (120×72mm)',
    desc: '短边单边入光、21 颗 LED，便携工控终端',
    project: baseProject({
      id: 'tpl-5inch-handheld',
      name: '5寸手持终端方案',
      panel: { shape: 'rectangle', width: 120, height: 72, thickness: 0.6, chamfer: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 } },
      led: { edges: ['bottom'], countPerEdge: 21, pitch: 3.4, fluxPerLed: 6.5, colorTemp: 5500, couplingEfficiency: 0.84 },
      dot: {
        gridPitch: 0.5, minDiameter: 0.06, maxDiameter: 0.3,
        densityCurve: [{ x: 0, y: 0.28 }, { x: 1, y: 0.9 }],
        distribution: 'radial', jitter: 0.3, seed: 50505,
      },
    }),
  },
  {
    id: 'tpl-4edge-square',
    label: '四边入光方形板 (100×100mm)',
    desc: '四边 LED、径向网点分布，验证对称光型',
    project: baseProject({
      id: 'tpl-4edge-square',
      name: '四边入光方形验证板',
      panel: { shape: 'chamfered', width: 100, height: 100, thickness: 0.8, chamfer: { topLeft: 8, topRight: 8, bottomLeft: 8, bottomRight: 8 } },
      led: { edges: ['left', 'right', 'top', 'bottom'], countPerEdge: 20, pitch: 4.5, fluxPerLed: 7, colorTemp: 6500, couplingEfficiency: 0.85 },
      dot: {
        gridPitch: 0.55, minDiameter: 0.08, maxDiameter: 0.34,
        densityCurve: [{ x: 0, y: 0.9 }, { x: 1, y: 0.25 }],
        distribution: 'radial', jitter: 0.45, seed: 40404,
      },
    }),
  },
];
