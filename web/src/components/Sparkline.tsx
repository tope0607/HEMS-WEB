import { useMemo } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

/** Tiny area sparkline for the live-power hero. Pure SVG, no library. */
export function Sparkline({ values, width = 132, height = 44 }: SparklineProps) {
  const d = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 3;
    const stepX = (width - pad * 2) / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const fill = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
    return { line, fill };
  }, [values, width, height]);

  if (!d) return <svg className="spark" width={width} height={height} aria-hidden="true" />;

  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path className="spark-fill" d={d.fill} />
      <path className="spark-line" d={d.line} />
    </svg>
  );
}
