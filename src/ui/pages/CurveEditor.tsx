import { useEffect, useRef } from 'react';
import type { CurvePoint } from '../../types';

/** 密度曲线编辑：拖拽锚点，双击空白加点，双击锚点删除（首尾不可删） */
export function CurveEditor(props: { value: CurvePoint[]; onChange: (v: CurvePoint[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragIdx = useRef<number>(-1);
  const W = 460;
  const H = 220;
  const PAD = 28;

  const draw = () => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#12171e';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a3340';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = PAD + (i / 4) * (W - PAD * 2);
      const y = PAD + (i / 4) * (H - PAD * 2);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    }
    ctx.fillStyle = '#8b95a5';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) ctx.fillText(`${i * 0.25}`, PAD + (i / 4) * (W - PAD * 2), H - 8);
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText(`${1 - i * 0.25}`, PAD - 6, PAD + (i / 4) * (H - PAD * 2) + 3);

    const pts = [...props.value].sort((a, b) => a.x - b.x);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = PAD + p.x * (W - PAD * 2);
      const y = H - PAD - p.y * (H - PAD * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#5db1ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    pts.forEach((p, i) => {
      const x = PAD + p.x * (W - PAD * 2);
      const y = H - PAD - p.y * (H - PAD * 2);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 || i === pts.length - 1 ? '#e8a33d' : '#5db1ff';
      ctx.fill();
      ctx.strokeStyle = '#0b0e13';
      ctx.stroke();
    });
  };

  useEffect(draw, [props.value]);

  const toPoint = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return {
      px: Math.max(0, Math.min(1, (x - PAD) / (W - PAD * 2))),
      py: Math.max(0, Math.min(1, 1 - (y - PAD) / (H - PAD * 2))),
    };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="curve-editor"
        width={W}
        height={H}
        style={{ maxWidth: '100%' }}
        onMouseDown={(e) => {
          const { px, py } = toPoint(e);
          const pts = [...props.value].sort((a, b) => a.x - b.x);
          let hit = -1;
          pts.forEach((p, i) => {
            if (Math.abs(p.x - px) < 0.03 && Math.abs(p.y - py) < 0.08) hit = i;
          });
          if (hit >= 0) dragIdx.current = hit;
        }}
        onMouseMove={(e) => {
          if (dragIdx.current < 0) return;
          const { px, py } = toPoint(e);
          const pts = [...props.value].sort((a, b) => a.x - b.x);
          const i = dragIdx.current;
          const isEnd = i === 0 || i === pts.length - 1;
          pts[i] = { x: isEnd ? pts[i].x : px, y: py };
          props.onChange(pts);
        }}
        onMouseUp={() => (dragIdx.current = -1)}
        onMouseLeave={() => (dragIdx.current = -1)}
        onDoubleClick={(e) => {
          const { px, py } = toPoint(e);
          const pts = [...props.value].sort((a, b) => a.x - b.x);
          const hit = pts.findIndex((p) => Math.abs(p.x - px) < 0.03 && Math.abs(p.y - py) < 0.08);
          if (hit >= 0 && hit !== 0 && hit !== pts.length - 1) {
            pts.splice(hit, 1);
          } else if (hit < 0 && px > 0.02 && px < 0.98) {
            pts.push({ x: px, y: py });
          }
          props.onChange(pts.sort((a, b) => a.x - b.x));
        }}
      />
      <div className="muted" style={{ marginTop: 6 }}>
        横轴：归一化位置（距入光边 / 径向距离）；纵轴：初始密度。拖拽锚点调整，双击空白加锚点，双击中间锚点删除，首尾锚点固定横坐标。
      </div>
    </div>
  );
}
