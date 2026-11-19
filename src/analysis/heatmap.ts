// 照度伪彩图：Canvas2D 离屏渲染、伪彩色映射、九点/暗区/亮带叠加、PNG/CSV 导出
import type { SimResult } from '../types';
import { ninePointPositions } from '../sim/geometry';

/** 工业常用 jet-like 伪彩（蓝→青→绿→黄→红） */
export function colormap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1))));
  return [r, g, b];
}

export interface HeatmapOptions {
  showNinePoint?: boolean;
  showZones?: boolean;
  profile?: { x1: number; y1: number; x2: number; y2: number } | null;
  width?: number;
}

export function renderHeatmap(result: SimResult, opts: HeatmapOptions = {}): HTMLCanvasElement {
  const { gridCols: cols, gridRows: rows, irradiance, validMask } = result;
  const W = opts.width ?? 720;
  const H = Math.round((W * result.gridRows) / result.gridCols);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < irradiance.length; i++) {
    const t = result.avgIrradiance > 0 ? irradiance[i] / (result.avgIrradiance * 1.6) : 0;
    const [r, g, b] = validMask[i] ? colormap(t) : [18, 22, 28];
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 放大到目标尺寸并叠加标注
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.drawImage(canvas, 0, 0, W, H);
  const panel = result.projectSnapshot.panel;
  const sx = W / panel.width;
  const sy = H / panel.height;

  if (opts.showZones) {
    octx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const idx of result.darkZones) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      octx.fillRect(c * (W / cols), r * (H / rows), W / cols + 1, H / rows + 1);
    }
    octx.strokeStyle = 'rgba(255,80,80,0.9)';
    octx.lineWidth = 1.5;
    for (const idx of result.brightBands) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      octx.strokeRect(c * (W / cols), r * (H / rows), W / cols + 1, H / rows + 1);
    }
  }

  if (opts.showNinePoint) {
    const pts = ninePointPositions(panel);
    octx.font = 'bold 12px sans-serif';
    pts.forEach((p, i) => {
      if (!p.valid) return;
      const x = p.x * sx;
      const y = H - p.y * sy;
      octx.beginPath();
      octx.arc(x, y, 5, 0, Math.PI * 2);
      octx.fillStyle = '#fff';
      octx.fill();
      octx.strokeStyle = '#111';
      octx.stroke();
      octx.fillStyle = '#111';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText(String(i + 1), x, y);
    });
  }

  if (opts.profile) {
    const { x1, y1, x2, y2 } = opts.profile;
    octx.beginPath();
    octx.moveTo(x1 * sx, H - y1 * sy);
    octx.lineTo(x2 * sx, H - y2 * sy);
    octx.strokeStyle = '#ffd34d';
    octx.lineWidth = 2;
    octx.setLineDash([6, 4]);
    octx.stroke();
    octx.setLineDash([]);
  }
  return out;
}

/** 沿任意剖面线采样亮度曲线（等距 200 点，双线性） */
export function sampleProfile(result: SimResult, x1: number, y1: number, x2: number, y2: number, samples = 200): { d: number; v: number }[] {
  const out: { d: number; v: number }[] = [];
  const len = Math.hypot(x2 - x1, y2 - y1);
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    out.push({ d: len * t, v: bilinear(result, x, y) });
  }
  return out;
}

function bilinear(result: SimResult, x: number, y: number): number {
  const { gridCols: cols, gridRows: rows, irradiance } = result;
  const panel = result.projectSnapshot.panel;
  const gx = x / (panel.width / cols) - 0.5;
  const gy = y / (panel.height / rows) - 0.5;
  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const fx = Math.max(0, Math.min(1, gx - x0));
  const fy = Math.max(0, Math.min(1, gy - y0));
  const i00 = y0 * cols + x0;
  return (
    irradiance[i00] * (1 - fx) * (1 - fy) +
    irradiance[i00 + 1] * fx * (1 - fy) +
    irradiance[i00 + cols] * (1 - fx) * fy +
    irradiance[i00 + cols + 1] * fx * fy
  );
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

export function downloadText(content: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 照度网格导出 CSV */
export function irradianceToCsv(result: SimResult): string {
  const { gridCols: cols, gridRows: rows, irradiance, validMask } = result;
  const lines: string[] = [];
  lines.push('row,col,x_mm,y_mm,relative_irradiance,valid');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      lines.push(
        [r, c, ((c + 0.5) * result.cellW).toFixed(3), ((r + 0.5) * result.cellH).toFixed(3), irradiance[i].toExponential(4), validMask[i] ? 1 : 0].join(','),
      );
    }
  }
  return lines.join('\n');
}

/** 色条 canvas（供图例使用） */
export function renderColorBar(height = 220, width = 18): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < height; y++) {
    const t = 1 - y / height;
    const [r, g, b] = colormap(t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, width, 1);
  }
  return c;
}
