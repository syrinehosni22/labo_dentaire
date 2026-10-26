import { useMemo } from 'react';
import { bridgesOf, toothOrder } from '../format';

/*
 * 2D odontogram, FDI numbering. Viewer faces the patient: quadrants 1 and 4 (patient's right) are on the left.
 * Permanent arch: 18..11 | 21..28 above, 48..41 | 31..38 below. Temporary arch (51..85) drawn inside.
 */

const PERM_Q = { 1: [8, 7, 6, 5, 4, 3, 2, 1], 2: [1, 2, 3, 4, 5, 6, 7, 8], 4: [8, 7, 6, 5, 4, 3, 2, 1], 3: [1, 2, 3, 4, 5, 6, 7, 8] };
const TEMP_Q = { 5: [5, 4, 3, 2, 1], 6: [1, 2, 3, 4, 5], 8: [5, 4, 3, 2, 1], 7: [1, 2, 3, 4, 5] };

const kind = (n, temp) => {
  const p = n % 10;
  if (temp) return p <= 2 ? 'incisor' : p === 3 ? 'canine' : 'molar';
  return p <= 2 ? 'incisor' : p === 3 ? 'canine' : p <= 5 ? 'premolar' : 'molar';
};
const WIDTH = { molar: 1.25, premolar: 0.92, canine: 0.88, incisor: 0.82 };
const SIZE = { molar: [43, 42], premolar: [33, 37], canine: [30, 39], incisor: [29, 33] };

export const PERMANENT_TEETH = [...PERM_Q[1].map((p) => 10 + p), ...PERM_Q[2].map((p) => 20 + p), ...PERM_Q[4].map((p) => 40 + p), ...PERM_Q[3].map((p) => 30 + p)];
export const TEMPORARY_TEETH = [...TEMP_Q[5].map((p) => 50 + p), ...TEMP_Q[6].map((p) => 60 + p), ...TEMP_Q[8].map((p) => 80 + p), ...TEMP_Q[7].map((p) => 70 + p)];
export const isTemporary = (n) => n >= 51;

// Lay out one arch (upper or lower) along a half-ellipse, spacing teeth by their width.
function layoutArch(teeth, { cx, cy, rx, ry, upper, temp, scale = 1 }) {
  const widths = teeth.map((t) => WIDTH[kind(t, temp)]);
  const total = widths.reduce((a, b) => a + b, 0);
  const margin = 0.16;
  const span = Math.PI - 2 * margin;
  let acc = 0;
  return teeth.map((t, i) => {
    const mid = (acc + widths[i] / 2) / total; acc += widths[i];
    const theta = upper ? Math.PI + margin + mid * span : Math.PI - margin - mid * span;
    const x = cx + rx * Math.cos(theta);
    const y = cy + ry * Math.sin(theta);
    // outward normal of the ellipse, used for rotation and label placement
    const nx = Math.cos(theta) / rx; const ny = Math.sin(theta) / ry;
    const len = Math.hypot(nx, ny);
    const angle = (Math.atan2(ny / len, nx / len) * 180) / Math.PI + 90;
    const k = kind(t, temp);
    const [w, h] = SIZE[k].map((v) => v * scale);
    return { n: t, x, y, angle, k, w, h, lx: x + (nx / len) * (h / 2 + 13 * scale), ly: y + (ny / len) * (h / 2 + 13 * scale), temp };
  });
}

function toothPath(k, w, h) {
  const hw = w / 2; const hh = h / 2;
  switch (k) {
    case 'molar':
      return `M${-hw + 5},${-hh} Q0,${-hh - 3} ${hw - 5},${-hh} Q${hw},${-hh} ${hw},${-hh + 6} L${hw},${hh - 6} Q${hw},${hh} ${hw - 5},${hh} Q0,${hh + 3} ${-hw + 5},${hh} Q${-hw},${hh} ${-hw},${hh - 6} L${-hw},${-hh + 6} Q${-hw},${-hh} ${-hw + 5},${-hh}Z`;
    case 'premolar':
      return `M0,${-hh} C${hw},${-hh} ${hw},${-hh * 0.2} ${hw},0 C${hw},${hh * 0.7} ${hw * 0.6},${hh} 0,${hh} C${-hw * 0.6},${hh} ${-hw},${hh * 0.7} ${-hw},0 C${-hw},${-hh * 0.2} ${-hw},${-hh} 0,${-hh}Z`;
    case 'canine':
      return `M0,${-hh - 2} C${hw * 0.7},${-hh * 0.6} ${hw},${-hh * 0.1} ${hw},${hh * 0.25} C${hw},${hh * 0.8} ${hw * 0.5},${hh} 0,${hh} C${-hw * 0.5},${hh} ${-hw},${hh * 0.8} ${-hw},${hh * 0.25} C${-hw},${-hh * 0.1} ${-hw * 0.7},${-hh * 0.6} 0,${-hh - 2}Z`;
    default:
      return `M${-hw + 3},${-hh} L${hw - 3},${-hh} Q${hw},${-hh} ${hw},${-hh + 4} L${hw - 1},${hh - 6} Q${hw - 2},${hh} ${hw - 7},${hh} L${-hw + 7},${hh} Q${-hw + 2},${hh} ${-hw + 1},${hh - 6} L${-hw},${-hh + 4} Q${-hw},${-hh} ${-hw + 3},${-hh}Z`;
  }
}

function toothDetail(k, w, h) {
  const hw = w / 2; const hh = h / 2;
  if (k === 'molar') return `M${-hw * 0.55},${-hh * 0.1} Q0,${hh * 0.25} ${hw * 0.55},${-hh * 0.1} M0,${-hh * 0.6} L0,${hh * 0.55}`;
  if (k === 'premolar') return `M${-hw * 0.5},0 Q0,${hh * 0.25} ${hw * 0.5},0`;
  return '';
}

export default function DentalChart({ mode = 'permanent', worksByTooth, categoryColor, selected, copiedFrom, onToothClick, readOnly }) {
  const teeth = useMemo(() => {
    const out = [];
    const showPerm = mode !== 'temporary';
    const showTemp = mode !== 'permanent';
    if (showPerm) {
      out.push(...layoutArch(PERMANENT_TEETH.slice(0, 16), { cx: 380, cy: 268, rx: 262, ry: 200, upper: true }));
      out.push(...layoutArch(PERMANENT_TEETH.slice(16), { cx: 380, cy: 300, rx: 262, ry: 200, upper: false }));
    }
    if (showTemp) {
      const s = showPerm ? { rx: 165, ry: 118, scale: 0.72 } : { rx: 215, ry: 165, scale: 1.1 };
      out.push(...layoutArch(TEMPORARY_TEETH.slice(0, 10), { cx: 380, cy: 268, ...s, upper: true, temp: true }));
      out.push(...layoutArch(TEMPORARY_TEETH.slice(10), { cx: 380, cy: 300, ...s, upper: false, temp: true }));
    }
    return out;
  }, [mode]);

  // Bridges: a line joins the teeth of each bridge, in chart order
  const bridgeLinks = useMemo(() => {
    const pos = new Map(teeth.map((t) => [t.n, t]));
    const all = [...worksByTooth.values()].flat();
    return [...bridgesOf(all).entries()].map(([id, list]) => {
      const pts = [...list].sort((a, b) => toothOrder(a) - toothOrder(b)).map((n) => pos.get(n)).filter(Boolean);
      return pts.length >= 2 ? { id, pts, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') } : null;
    }).filter(Boolean);
  }, [teeth, worksByTooth]);

  const handleKey = (e, n) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToothClick(n, e); }
  };

  return (
    <svg className="dental-chart" viewBox="70 22 620 540" role="group" aria-label="Schéma dentaire, numérotation FDI">
      <text x="96" y="288" className="chart-side">Droite</text>
      <text x="664" y="288" textAnchor="end" className="chart-side">Gauche</text>
      <text x="380" y="280" textAnchor="middle" className="chart-side">Maxillaire</text>
      <text x="380" y="298" textAnchor="middle" className="chart-side">Mandibule</text>
      <line x1="380" y1="40" x2="380" y2="262" className="chart-midline" />
      <line x1="380" y1="306" x2="380" y2="540" className="chart-midline" />
      {teeth.map((t) => {
        const works = worksByTooth.get(t.n) || [];
        const sel = selected.includes(t.n);
        const has = works.length > 0;
        const fill = has ? categoryColor(works[0]) : undefined;
        const label = `Dent ${t.n}${has ? `, ${works.length} travail${works.length > 1 ? 'x' : ''} : ${[...new Set(works.map((w) => w.designation_label))].join(', ')}` : ''}`;
        return (
          <g key={t.n} className={`tooth ${sel ? 'is-selected' : ''} ${has ? 'has-works' : ''} ${copiedFrom === t.n ? 'is-copied' : ''} ${t.temp ? 'is-temp' : ''}`}
            tabIndex={readOnly ? -1 : 0} role="button" aria-pressed={sel} aria-label={label}
            onClick={(e) => onToothClick(t.n, e)} onKeyDown={(e) => handleKey(e, t.n)}>
            <title>{label}</title>
            <g transform={`translate(${t.x},${t.y}) rotate(${t.angle})`}>
              <path className="tooth-hit" d={toothPath(t.k, t.w + 10, t.h + 10)} />
              <path className="tooth-shape" d={toothPath(t.k, t.w, t.h)} style={fill ? { '--work': fill } : undefined} />
              <path className="tooth-detail" d={toothDetail(t.k, t.w, t.h)} />
            </g>
            <text x={t.lx} y={t.ly + 4} textAnchor="middle" className="tooth-num">{t.n}</text>
            {has && (
              <g transform={`translate(${t.x + t.w * 0.42},${t.y - t.h * 0.42})`} className="tooth-badge">
                <circle r="8" /><text y="3.5" textAnchor="middle">{works.length}</text>
              </g>
            )}
          </g>
        );
      })}
      {bridgeLinks.map((b) => (
        <g key={`b${b.id}`} aria-hidden="true">
          <path className="bridge-link" d={b.d} />
          {b.pts.map((p) => <circle key={p.n} className="bridge-dot" cx={p.x} cy={p.y} r="3.5" />)}
        </g>
      ))}
    </svg>
  );
}