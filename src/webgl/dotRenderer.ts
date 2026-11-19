// WebGL2 网点俯视图渲染器：instanced 圆点单次 draw call，支持平移/缩放/画笔圈/高亮
import type { PanelParams } from '../types';
import { panelPolygon } from '../sim/geometry';
import type { DotFieldModel } from '../sim/dotField';

const VERT = `#version 300 es
layout(location=0) in vec2 aCorner;      // 单位四边形角点 (-1..1)
layout(location=1) in vec2 aCenter;      // 实例中心 (mm)
layout(location=2) in float aRadius;     // 实例半径 (mm)
layout(location=3) in float aShade;      // 颜色明暗 0..1
uniform vec2 uViewport;
uniform vec2 uCamOffset;
uniform float uCamScale;
void main() {
  vec2 world = aCenter + aCorner * aRadius;
  vec2 screen = (world + uCamOffset) * uCamScale;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const FRAG = `#version 300 es
precision highp float;
in float vShade;
uniform vec3 uColorLow;
uniform vec3 uColorHigh;
out vec4 outColor;
void main() {
  vec3 col = mix(uColorLow, uColorHigh, vShade);
  outColor = vec4(col, 0.95);
}
`;

// varying 桥接（顶点把 shade 传片元）
const VERT_FULL = VERT.replace('void main() {', 'out float vShade;\nvoid main() {\n  vShade = aShade;');

const PANEL_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec2 uViewport;
uniform vec2 uCamOffset;
uniform float uCamScale;
void main() {
  vec2 screen = (aPos + uCamOffset) * uCamScale;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const PANEL_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader 编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface Camera {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export class DotRenderer {
  private gl: WebGL2RenderingContext;
  private dotProg: WebGLProgram;
  private panelProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private centerBuf: WebGLBuffer;
  private radiusBuf: WebGLBuffer;
  private shadeBuf: WebGLBuffer;
  private panelVao: WebGLVertexArrayObject;
  private panelBuf: WebGLBuffer;
  private instanceCount = 0;
  private panelVerts = 0;
  camera: Camera = { offsetX: 40, offsetY: 40, scale: 4 };

  constructor(private canvas: HTMLCanvasElement, private panel: PanelParams) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.dotProg = program(gl, VERT_FULL, FRAG);
    this.panelProg = program(gl, PANEL_VERT, PANEL_FRAG);

    // 单位四边形（两个三角形）
    const corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.cornerBuf = this.makeBuffer(corners, 0, 2, gl.FLOAT, false, 0, true);
    this.centerBuf = this.makeEmptyBuffer(1, 2);
    this.radiusBuf = this.makeEmptyBuffer(2, 1);
    this.shadeBuf = this.makeEmptyBuffer(3, 1);
    gl.bindVertexArray(null);

    // 板件轮廓（含切角），三角扇
    this.panelVao = gl.createVertexArray()!;
    const poly = panelPolygon(panel);
    const verts: number[] = [];
    for (const p of poly) verts.push(p.x, p.y);
    // 闭合线用 LINE_LOOP
    this.panelBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.panelVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.panelBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.panelVerts = poly.length;
  }

  private makeBuffer(data: Float32Array, loc: number, size: number, type: number, norm: boolean, stride: number, isCorner: boolean): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    if (isCorner) gl.vertexAttribDivisor(loc, 0);
    gl.vertexAttribPointer(loc, size, type, norm, stride, 0);
    return buf;
  }

  private makeEmptyBuffer(loc: number, size: number): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribDivisor(loc, 1);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buf;
  }

  /** 上传网点数据（重建或刷子结束后调用） */
  uploadDots(dots: DotFieldModel): void {
    const gl = this.gl;
    const f = dots.field;
    const n = dots.totalDots;
    const centers = new Float32Array(n * 2);
    const radii = new Float32Array(n);
    const shades = new Float32Array(n);
    let w = 0;
    for (let cell = 0; cell < f.counts.length; cell++) {
      const off = f.cellOffset[cell];
      const cnt = f.counts[cell];
      const density = cnt / f.capacity;
      for (let k = 0; k < cnt; k++) {
        const slot = off + k;
        centers[w * 2] = f.xs[slot];
        centers[w * 2 + 1] = f.ys[slot];
        const r = f.diameters[slot] / 2;
        radii[w] = r;
        // 明暗随密度：远光区网点更密更亮
        shades[w] = 0.25 + density * 0.75;
        w++;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.centerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, centers, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.radiusBuf);
    gl.bufferData(gl.ARRAY_BUFFER, radii, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shades, gl.DYNAMIC_DRAW);
    this.instanceCount = n;
  }

  /** 仅更新变化单元的直径/明暗（刷子过程中增量刷新，成本低） */
  refreshDots(dots: DotFieldModel): void {
    // 数据布局变化后整体重传（实例数变化无法局部更新），由调用方决定节流
    this.uploadDots(dots);
  }

  fitView(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const sx = (w - 80) / this.panel.width;
    const sy = (h - 80) / this.panel.height;
    this.camera.scale = Math.min(sx, sy);
    this.camera.offsetX = (w / this.camera.scale - this.panel.width) / 2;
    this.camera.offsetY = (h / this.camera.scale - this.panel.height) / 2;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx / this.camera.scale - this.camera.offsetX,
      y: sy / this.camera.scale - this.camera.offsetY,
    };
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private viewportCss(): { w: number; h: number } {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  render(brush?: { x: number; y: number; radiusMm: number } | null): void {
    const gl = this.gl;
    const { w, h } = this.viewportCss();
    gl.clearColor(0.07, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 板件轮廓
    gl.useProgram(this.panelProg);
    this.setCommonUniforms(this.panelProg, w, h);
    gl.uniform4f(gl.getUniformLocation(this.panelProg, 'uColor'), 0.16, 0.2, 0.27, 1);
    gl.bindVertexArray(this.panelVao);
    gl.drawArrays(gl.LINE_LOOP, 0, this.panelVerts);

    // 网点
    if (this.instanceCount > 0) {
      gl.useProgram(this.dotProg);
      this.setCommonUniforms(this.dotProg, w, h);
      gl.uniform3fv(gl.getUniformLocation(this.dotProg, 'uColorLow'), new Float32Array([0.35, 0.62, 0.95]));
      gl.uniform3fv(gl.getUniformLocation(this.dotProg, 'uColorHigh'), new Float32Array([0.75, 0.92, 1.0]));
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    }

    if (brush) {
      this.drawBrushCircle(brush);
    }
    gl.bindVertexArray(null);
  }

  private drawBrushCircle(brush: { x: number; y: number; radiusMm: number }) {
    const gl = this.gl;
    const { w, h } = this.viewportCss();
    const seg = 48;
    const verts: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      verts.push(brush.x + Math.cos(a) * brush.radiusMm, brush.y + Math.sin(a) * brush.radiusMm);
    }
    const buf = gl.createBuffer();
    gl.useProgram(this.panelProg);
    this.setCommonUniforms(this.panelProg, w, h);
    gl.uniform4f(gl.getUniformLocation(this.panelProg, 'uColor'), 1.0, 0.75, 0.3, 0.9);
    gl.bindVertexArray(this.panelVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINE_STRIP, 0, seg + 1);
    gl.deleteBuffer(buf);
  }

  private setCommonUniforms(prog: WebGLProgram, w: number, h: number) {
    const gl = this.gl;
    gl.uniform2f(gl.getUniformLocation(prog, 'uViewport'), w, h);
    gl.uniform2f(gl.getUniformLocation(prog, 'uCamOffset'), this.camera.offsetX, this.camera.offsetY);
    gl.uniform1f(gl.getUniformLocation(prog, 'uCamScale'), this.camera.scale);
  }

  dispose(): void {
    const gl = this.gl;
    [this.cornerBuf, this.centerBuf, this.radiusBuf, this.shadeBuf, this.panelBuf].forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.panelVao);
    gl.deleteProgram(this.dotProg);
    gl.deleteProgram(this.panelProg);
  }
}
