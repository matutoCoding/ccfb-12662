// 板件几何：矩形/切角异形的包含判定、入光边几何、九点采样位置
import type { LightEdge, PanelParams } from '../types';

export interface Vec2 {
  x: number;
  y: number;
}

/** 切角板的多边形顶点（逆时针，左下起），单位 mm */
export function panelPolygon(p: PanelParams): Vec2[] {
  const { width: w, height: h, chamfer: c } = p;
  if (p.shape === 'rectangle' || (c.topLeft | c.topRight | c.bottomLeft | c.bottomRight) === 0) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const pts: Vec2[] = [];
  if (c.bottomLeft > 0) pts.push({ x: 0, y: c.bottomLeft }, { x: c.bottomLeft, y: 0 });
  else pts.push({ x: 0, y: 0 });
  if (c.bottomRight > 0) pts.push({ x: w - c.bottomRight, y: 0 }, { x: w, y: c.bottomRight });
  else pts.push({ x: w, y: 0 });
  if (c.topRight > 0) pts.push({ x: w, y: h - c.topRight }, { x: w - c.topRight, y: h });
  else pts.push({ x: w, y: h });
  if (c.topLeft > 0) pts.push({ x: c.topLeft, y: h }, { x: 0, y: h - c.topLeft });
  else pts.push({ x: 0, y: h });
  return pts;
}

/** 点是否在板内（射线法，支持切角多边形） */
export function pointInPanel(p: PanelParams, x: number, y: number): boolean {
  const poly = panelPolygon(p);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 边的起止与向内法线（板坐标：x 向右、y 向上） */
export function edgeGeometry(edge: LightEdge, p: PanelParams): { start: Vec2; end: Vec2; inward: Vec2 } {
  const { width: w, height: h } = p;
  switch (edge) {
    case 'left':
      return { start: { x: 0, y: 0 }, end: { x: 0, y: h }, inward: { x: 1, y: 0 } };
    case 'right':
      return { start: { x: w, y: h }, end: { x: w, y: 0 }, inward: { x: -1, y: 0 } };
    case 'bottom':
      return { start: { x: 0, y: 0 }, end: { x: w, y: 0 }, inward: { x: 0, y: 1 } };
    case 'top':
      return { start: { x: w, y: h }, end: { x: 0, y: h }, inward: { x: 0, y: -1 } };
  }
}

export function edgeLength(edge: LightEdge, p: PanelParams): number {
  return edge === 'left' || edge === 'right' ? p.height : p.width;
}

/** 九点采样位置（1/4、1/2、3/4 网格），剔除落在切角外的点 */
export function ninePointPositions(p: PanelParams): { x: number; y: number; valid: boolean }[] {
  const qs = [0.25, 0.5, 0.75];
  const out: { x: number; y: number; valid: boolean }[] = [];
  for (const fy of qs) {
    for (const fx of qs) {
      const x = p.width * fx;
      const y = p.height * fy;
      out.push({ x, y, valid: pointInPanel(p, x, y) });
    }
  }
  return out;
}

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
