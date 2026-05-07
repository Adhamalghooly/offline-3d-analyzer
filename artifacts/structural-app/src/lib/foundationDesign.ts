/**
 * Foundation Design - Working Stress Method (WSM / ASD)
 * Reference: ACI 318-14 Appendix B (ASD), UBC 1997 Chapter 18
 * Isolated Spread Footings — Rectangular proportional to column section
 */

export interface ColumnReactionInput {
  colId: string;
  x: number;   // column center X in meters
  y: number;   // column center Y in meters
  P_DL: number; // Dead load axial reaction kN (service, positive = compression)
  P_LL: number; // Live load axial reaction kN (service, positive = compression)
  Mx_DL?: number;
  Mx_LL?: number;
  My_DL?: number;
  My_LL?: number;
  colB: number; // column width mm  (x-direction)
  colH: number; // column depth mm  (y-direction)
}

export interface FootingMaterials {
  fc: number;         // concrete f'c MPa
  fy: number;         // steel fy MPa
  qa: number;         // allowable soil bearing capacity kN/m²
  cover: number;      // concrete cover mm (typically 75mm for foundations)
  gamma_conc: number; // concrete unit weight kN/m³ (24)
  gamma_soil: number; // soil unit weight kN/m³ (18)
  Df: number;         // foundation depth from natural ground m
}

export interface FootingDesignResult {
  colId: string;
  x: number;
  y: number;
  P_service: number;     // total service load kN (DL+LL)
  B: number;             // footing width  mm  (x-direction, proportional to colB)
  L: number;             // footing length mm  (y-direction, proportional to colH)
  t: number;             // total footing thickness mm
  d: number;             // effective depth mm
  q_net_allow: number;   // net allowable bearing pressure kN/m²
  q_actual: number;      // actual net bearing pressure kN/m²
  bearing_ok: boolean;

  // Flexure — x-direction cantilever (a_x), bars run parallel to x
  M_x: number;           // design moment kN.m/m
  As_x_req: number;      // required As mm²/m
  As_x_use: number;      // used As mm²/m
  bars_x: number;
  dia_x: number;
  spacing_x: number;

  // Flexure — y-direction cantilever (a_y), bars run parallel to y
  M_y: number;
  As_y_req: number;
  As_y_use: number;
  bars_y: number;
  dia_y: number;
  spacing_y: number;

  // Shear checks
  Vu_wide: number;
  Vc_wide: number;
  wide_shear_ok: boolean;
  Vu_punch: number;
  Vc_punch: number;
  punch_shear_ok: boolean;

  // WSM constants
  fc_allow: number;
  fs_allow: number;
  n: number;
  k: number;
  j: number;
  As_min_pm: number;

  a_x: number;
  a_y: number;

  adequate: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function selectRebar(
  As_req_total: number,
  width: number,
  cover: number,
): { bars: number; dia: number; spacing: number; As_provided: number } {
  const DIAMS = [10, 12, 14, 16, 18, 20, 22, 25, 28, 32];
  for (const dia of DIAMS) {
    const ab = Math.PI * dia * dia / 4;
    const bars = Math.ceil(As_req_total / ab);
    if (bars < 2) continue;
    const spacing = (width - 2 * cover - dia) / (bars - 1);
    if (spacing >= 75 && spacing <= 400) {
      return { bars, dia, spacing: Math.round(spacing), As_provided: bars * ab };
    }
  }
  const dia = 25;
  const ab = Math.PI * dia * dia / 4;
  const bars = Math.max(2, Math.ceil(As_req_total / ab));
  const spacing = bars > 1 ? (width - 2 * cover - dia) / (bars - 1) : 100;
  return { bars, dia, spacing: Math.round(Math.max(75, spacing)), As_provided: bars * ab };
}

// ─── Main design function ─────────────────────────────────────────────────────

/**
 * Design isolated spread footing per WSM / ACI 318
 *
 * Rectangular footing: B (x-dir) is proportional to colB,
 *                      L (y-dir) is proportional to colH.
 * So the footing is elongated in the same direction as the column.
 */
export function designFooting(
  reaction: ColumnReactionInput,
  mat: FootingMaterials,
): FootingDesignResult {
  const { fc, fy, qa, cover, gamma_conc, gamma_soil, Df } = mat;
  const { colId, x, y, P_DL, P_LL, colB, colH } = reaction;

  const P_service = P_DL + P_LL;

  // ── WSM constants ────────────────────────────────────────────────────────────
  const fc_allow = 0.45 * fc;
  const Es = 200_000;
  const Ec = 4700 * Math.sqrt(fc);
  const n = Math.max(6, Math.round(Es / Ec));
  const fs_allow = Math.min(0.50 * fy, 207);
  const k = (n * fc_allow) / (n * fc_allow + fs_allow);
  const j = 1 - k / 3;
  const rho_min = fy >= 420 ? 0.0018 : 0.0020;

  // Aspect ratio for rectangular footing: L/B = colH/colB
  // Ensures the footing is proportionally wider in the column's depth (h) direction
  const rawRatio = colH / colB;
  const aspect = Math.max(rawRatio, 1.0); // L ≥ B always

  let t = 400;
  let B = 1500;
  let L = 1500;

  for (let iter = 0; iter < 15; iter++) {
    const t_m = t / 1000;
    const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m;
    const q_net = Math.max(50, qa - w_ov);

    // Rectangular footing area: A = B × L, L/B = aspect
    // → B = sqrt(A_req / aspect), L = sqrt(A_req × aspect)
    const A_req = P_service / q_net;
    const B_calc = Math.sqrt(A_req / aspect);
    const L_calc = Math.sqrt(A_req * aspect);

    B = Math.max(roundUpTo(B_calc * 1000, 100), colB + 400);
    L = Math.max(roundUpTo(L_calc * 1000, 100), colH + 400);

    const q_act = P_service / ((B / 1000) * (L / 1000));

    const d = t - cover - 12;
    if (d <= 0) { t += 100; continue; }

    const a_x = (B - colB) / 2;
    const a_y = (L - colH) / 2;

    const shear_arm_x = Math.max(0, a_x - d);
    const shear_arm_y = Math.max(0, a_y - d);

    const Vu_x = q_act * (shear_arm_x / 1000) * (L / 1000);
    const Vu_y = q_act * (shear_arm_y / 1000) * (B / 1000);
    const Vu_wide = Math.max(Vu_x, Vu_y);

    const vc_allow = 0.083 * Math.sqrt(fc);
    const Vc_wide_x = vc_allow * L * d / 1000;
    const Vc_wide_y = vc_allow * B * d / 1000;
    const Vc_wide = Math.min(Vc_wide_x, Vc_wide_y);

    if (Vu_wide > Vc_wide) {
      const d_req_x = shear_arm_x > 0 ? (Vu_x * 1000) / (vc_allow * L) : 0;
      const d_req_y = shear_arm_y > 0 ? (Vu_y * 1000) / (vc_allow * B) : 0;
      const d_req = Math.max(d_req_x, d_req_y);
      const t_new = roundUpTo(d_req + cover + 12, 50);
      if (t_new > t) { t = t_new; continue; }
    }

    const b0 = 2 * ((colB + d) + (colH + d));
    const A_punch_inside = (colB + d) * (colH + d) / 1e6;
    const Vu_punch = q_act * ((B * L / 1e6) - A_punch_inside);
    const betaC = Math.max(colB, colH) / Math.min(colB, colH);
    const vc_punch_limit = Math.min(
      0.083 * (2 + 4 / betaC) * Math.sqrt(fc),
      0.166 * Math.sqrt(fc),
    );
    const Vc_punch = vc_punch_limit * b0 * d / 1000;

    if (Vu_punch > Vc_punch) {
      t = roundUpTo(t + 50, 50);
      continue;
    }

    break;
  }

  // ── Final geometry ──────────────────────────────────────────────────────────
  const t_m = t / 1000;
  const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m;
  const q_net_allow = Math.max(50, qa - w_ov);
  const A_req = P_service / q_net_allow;
  B = Math.max(roundUpTo(Math.sqrt(A_req / aspect) * 1000, 100), colB + 400);
  L = Math.max(roundUpTo(Math.sqrt(A_req * aspect) * 1000, 100), colH + 400);

  const q_actual = P_service / ((B / 1000) * (L / 1000));
  const bearing_ok = q_actual <= qa;
  const d = Math.max(100, t - cover - 12);

  const a_x = (B - colB) / 2;
  const a_y = (L - colH) / 2;

  const M_x = q_actual * (a_x / 1000) ** 2 / 2;
  const M_y = q_actual * (a_y / 1000) ** 2 / 2;

  const As_x_req = (M_x * 1e6) / (fs_allow * j * d);
  const As_y_req = (M_y * 1e6) / (fs_allow * j * d);
  const As_min_pm = rho_min * 1000 * d;
  const As_x_use = Math.max(As_x_req, As_min_pm);
  const As_y_use = Math.max(As_y_req, As_min_pm);

  const rb_x = selectRebar(As_x_use * (L / 1000), L, cover);
  const rb_y = selectRebar(As_y_use * (B / 1000), B, cover);

  const vc_allow = 0.083 * Math.sqrt(fc);
  const shear_arm_x = Math.max(0, a_x - d);
  const shear_arm_y = Math.max(0, a_y - d);
  const Vu_wide_x = q_actual * (shear_arm_x / 1000) * (L / 1000);
  const Vu_wide_y = q_actual * (shear_arm_y / 1000) * (B / 1000);
  const Vu_wide = Math.max(Vu_wide_x, Vu_wide_y);
  const Vc_wide = Math.min(vc_allow * L * d / 1000, vc_allow * B * d / 1000);
  const wide_shear_ok = Vu_wide <= Vc_wide;

  const b0 = 2 * ((colB + d) + (colH + d));
  const A_punch_inside = (colB + d) * (colH + d) / 1e6;
  const Vu_punch = q_actual * ((B * L / 1e6) - A_punch_inside);
  const betaC = Math.max(colB, colH) / Math.min(colB, colH);
  const vc_punch = Math.min(
    0.083 * (2 + 4 / betaC) * Math.sqrt(fc),
    0.166 * Math.sqrt(fc),
  );
  const Vc_punch = vc_punch * b0 * d / 1000;
  const punch_shear_ok = Vu_punch <= Vc_punch;

  return {
    colId, x, y,
    P_service,
    B, L, t, d,
    q_net_allow,
    q_actual,
    bearing_ok,
    M_x, M_y,
    As_x_req, As_x_use,
    bars_x: rb_x.bars, dia_x: rb_x.dia, spacing_x: rb_x.spacing,
    As_y_req, As_y_use,
    bars_y: rb_y.bars, dia_y: rb_y.dia, spacing_y: rb_y.spacing,
    Vu_wide, Vc_wide, wide_shear_ok,
    Vu_punch, Vc_punch, punch_shear_ok,
    fc_allow, fs_allow, n, k, j,
    As_min_pm,
    a_x, a_y,
    adequate: bearing_ok && wide_shear_ok && punch_shear_ok,
  };
}

// ─── ACI 318 Foundation Drawing ──────────────────────────────────────────────

/**
 * Generate a printable ACI 318-compliant HTML foundation drawing.
 *
 * The drawing contains:
 *   1. Foundation plan — each footing at its correct building position
 *   2. Typical footing detail section (cross-section A-A)
 *   3. Footing schedule table
 */
export function generateFoundationDrawingHTML(
  results: FootingDesignResult[],
  titleBlock: {
    projectName?: string;
    firmName?: string;
    designedBy?: string;
    checkedBy?: string;
    date?: string;
    drawingNumber?: string;
  },
  mat: FootingMaterials,
): string {
  if (results.length === 0) return '<html><body>لا توجد نتائج</body></html>';

  const today = titleBlock.date || new Date().toLocaleDateString('ar-EG');
  const proj = titleBlock.projectName || 'المشروع';

  // ── Plan geometry ────────────────────────────────────────────────────────────
  const xs = results.map(r => r.x);
  const ys = results.map(r => r.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Padding around the building footprint (in metres)
  const PAD = Math.max(2, Math.max((maxX - minX), (maxY - minY)) * 0.15);
  const worldW = (maxX - minX) + 2 * PAD;  // metres
  const worldH = (maxY - minY) + 2 * PAD;

  // SVG canvas for the plan (px)
  const PLAN_W = 560;
  const PLAN_H = Math.max(300, Math.round(PLAN_W * (worldH / Math.max(worldW, 0.1))));
  const scale = PLAN_W / worldW; // px / m

  function px(mx: number) { return ((mx - minX + PAD) * scale); }
  function py(my: number) { return (PLAN_H - (my - minY + PAD) * scale); }
  function mm2px(mm: number) { return (mm / 1000) * scale; }

  // ── Unique footing types for schedule ────────────────────────────────────────
  // Group identical B×L×t footings
  type FType = { key: string; B: number; L: number; t: number; dia_x: number; bars_x: number; spacing_x: number; dia_y: number; bars_y: number; spacing_y: number; ids: string[] };
  const typeMap = new Map<string, FType>();
  const colToType = new Map<string, string>();
  let typeIdx = 1;
  for (const r of results) {
    const key = `${r.B}x${r.L}x${r.t}`;
    if (!typeMap.has(key)) {
      const label = `F${typeIdx++}`;
      typeMap.set(key, { key: label, B: r.B, L: r.L, t: r.t, dia_x: r.dia_x, bars_x: r.bars_x, spacing_x: r.spacing_x, dia_y: r.dia_y, bars_y: r.bars_y, spacing_y: r.spacing_y, ids: [] });
    }
    const ft = typeMap.get(key)!;
    ft.ids.push(r.colId);
    colToType.set(r.colId, ft.key);
  }

  // ── SVG markers (arrowhead) ───────────────────────────────────────────────
  const markers = `
  <defs>
    <marker id="arr" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
      <path d="M0,0 L6,2 L0,4 Z" fill="#c00"/>
    </marker>
    <marker id="arrl" markerWidth="6" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse">
      <path d="M6,0 L0,2 L6,4 Z" fill="#c00"/>
    </marker>
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#b0b8c8" stroke-width="0.8"/>
    </pattern>
  </defs>`;

  // ── Foundation plan SVG ───────────────────────────────────────────────────
  let planElems = '';
  let dimLines = '';
  let colLabels = '';

  // Grid lines (chain-dotted) across full plan
  const uniqueXs = [...new Set(results.map(r => r.x))].sort((a, b) => a - b);
  const uniqueYs = [...new Set(results.map(r => r.y))].sort((a, b) => a - b);
  for (const mx of uniqueXs) {
    const svgX = px(mx);
    planElems += `<line x1="${svgX.toFixed(1)}" y1="0" x2="${svgX.toFixed(1)}" y2="${PLAN_H}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;
  }
  for (const my of uniqueYs) {
    const svgY = py(my);
    planElems += `<line x1="0" y1="${svgY.toFixed(1)}" x2="${PLAN_W}" y2="${svgY.toFixed(1)}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;
  }

  // Draw footings and columns
  for (const r of results) {
    const cx = px(r.x);
    const cy = py(r.y);
    const bpx = mm2px(r.B);
    const lpx = mm2px(r.L);
    const colBpx = Math.max(5, mm2px(r.B / 5));  // approximate column size in plan (relative to footing)
    // Use actual column dimension scaled to plan
    const colBp = mm2px(Math.min(r.B * 0.3, 400));
    const colHp = mm2px(Math.min(r.L * 0.3, 400));
    const ftype = colToType.get(r.colId) ?? '';

    // Footing outline (dashed)
    planElems += `<rect x="${(cx - bpx / 2).toFixed(1)}" y="${(cy - lpx / 2).toFixed(1)}" width="${bpx.toFixed(1)}" height="${lpx.toFixed(1)}"
      fill="url(#hatch)" fill-opacity="0.4" stroke="#1a3a5c" stroke-width="1.2" stroke-dasharray="5,2.5" rx="1"/>`;
    // Column solid
    planElems += `<rect x="${(cx - colBp / 2).toFixed(1)}" y="${(cy - colHp / 2).toFixed(1)}" width="${colBp.toFixed(1)}" height="${colHp.toFixed(1)}"
      fill="#1a3a5c" fill-opacity="0.8" stroke="#1a3a5c" stroke-width="1"/>`;
    // Type tag
    colLabels += `<text x="${cx.toFixed(1)}" y="${(cy - lpx / 2 - 5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="#1a3a5c">${ftype}</text>`;
    // Column ID
    colLabels += `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold">${r.colId}</text>`;
    // Dimensions below footing
    colLabels += `<text x="${cx.toFixed(1)}" y="${(cy + lpx / 2 + 10).toFixed(1)}" text-anchor="middle" font-size="7" fill="#880000">${r.B}×${r.L}</text>`;
  }

  // Dimension strings along bottom (X-axis spacings) and left (Y-axis spacings)
  if (uniqueXs.length > 1) {
    const dimY = PLAN_H - 5;
    const lineY = PLAN_H + 12;
    for (let i = 0; i < uniqueXs.length - 1; i++) {
      const x1 = px(uniqueXs[i]);
      const x2 = px(uniqueXs[i + 1]);
      const dist = ((uniqueXs[i + 1] - uniqueXs[i]) * 1000).toFixed(0) + ' mm';
      const mid = (x1 + x2) / 2;
      dimLines += `<line x1="${x1.toFixed(1)}" y1="${dimY}" x2="${x2.toFixed(1)}" y2="${dimY}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrl)" marker-end="url(#arr)"/>`;
      dimLines += `<text x="${mid.toFixed(1)}" y="${(dimY - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#c00">${dist}</text>`;
    }
  }
  if (uniqueYs.length > 1) {
    const dimX = PLAN_W - 5;
    for (let i = 0; i < uniqueYs.length - 1; i++) {
      const y1 = py(uniqueYs[i]);
      const y2 = py(uniqueYs[i + 1]);
      const dist = ((uniqueYs[i + 1] - uniqueYs[i]) * 1000).toFixed(0) + ' mm';
      const mid = (y1 + y2) / 2;
      dimLines += `<line x1="${dimX}" y1="${y2.toFixed(1)}" x2="${dimX}" y2="${y1.toFixed(1)}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrl)" marker-end="url(#arr)"/>`;
      dimLines += `<text x="${(dimX - 3).toFixed(1)}" y="${mid.toFixed(1)}" text-anchor="end" font-size="7" fill="#c00">${dist}</text>`;
    }
  }

  // Scale bar
  const scaleBarM = results.length > 1 ? Math.round((maxX - minX) / 5) || 1 : 1;
  const scaleBarPx = scaleBarM * scale;
  const sbX = 10;
  const sbY = PLAN_H - 16;
  const scaleNote = `مقياس الرسم: 1 : ${Math.round(1000 / scale)}`;
  planElems += `<rect x="${sbX}" y="${sbY}" width="${scaleBarPx.toFixed(1)}" height="4" fill="#1a3a5c" stroke="#1a3a5c" stroke-width="0.5"/>
    <text x="${sbX}" y="${sbY + 12}" font-size="7" fill="#333">0</text>
    <text x="${(sbX + scaleBarPx).toFixed(1)}" y="${sbY + 12}" font-size="7" fill="#333">${scaleBarM} m</text>
    <text x="${sbX}" y="${sbY - 3}" font-size="7" fill="#555">${scaleNote}</text>`;

  // North arrow (top right corner)
  const naX = PLAN_W - 22;
  const naY = 22;
  planElems += `<polygon points="${naX},${naY - 12} ${naX - 6},${naY + 8} ${naX},${naY + 3} ${naX + 6},${naY + 8}" fill="#1a3a5c" stroke="#1a3a5c" stroke-width="0.5"/>
    <text x="${naX}" y="${naY + 20}" text-anchor="middle" font-size="9" font-weight="bold" fill="#1a3a5c">N</text>`;

  // ── Typical section detail ────────────────────────────────────────────────
  // Use the footing type with the largest plan area for the "typical" detail
  const repResult = [...results].sort((a, b) => b.B * b.L - a.B * a.L)[0];
  const detSVG = buildDetailSVG(repResult, mat);

  // ── Schedule table rows ───────────────────────────────────────────────────
  const typeRows = [...typeMap.values()].map(ft => `
    <tr>
      <td class="ftype"><b>${ft.key}</b></td>
      <td>${ft.B}</td>
      <td>${ft.L}</td>
      <td>${ft.t}</td>
      <td class="rebar">${ft.bars_x}Ø${ft.dia_x}@${ft.spacing_x}</td>
      <td class="rebar">${ft.bars_y}Ø${ft.dia_y}@${ft.spacing_y}</td>
      <td>${ft.ids.join(', ')}</td>
    </tr>`).join('');

  const detailRows = results.map(r => `
    <tr class="${r.adequate ? '' : 'fail'}">
      <td class="ftype">${colToType.get(r.colId) ?? ''} — ${r.colId}</td>
      <td>${r.P_service.toFixed(0)}</td>
      <td>${r.B}×${r.L}</td>
      <td>${r.t}</td>
      <td>${r.d}</td>
      <td>${r.q_actual.toFixed(0)}</td>
      <td class="${r.bearing_ok ? 'ok' : 'fail'}">${r.bearing_ok ? '✓' : '✗'}</td>
      <td class="rebar">${r.bars_x}Ø${r.dia_x}@${r.spacing_x}</td>
      <td class="rebar">${r.bars_y}Ø${r.dia_y}@${r.spacing_y}</td>
      <td class="${r.wide_shear_ok ? 'ok' : 'fail'}">${r.wide_shear_ok ? '✓' : '✗'}</td>
      <td class="${r.punch_shear_ok ? 'ok' : 'fail'}">${r.punch_shear_ok ? '✓' : '✗'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>لوحة الأساسات — ${proj}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Arial',sans-serif;font-size:9pt;color:#111;background:#fff;padding:8mm}
  /* ─── Title block ─── */
  .title-block{display:grid;grid-template-columns:repeat(6,1fr);border:2px solid #1a3a5c;margin-bottom:8px}
  .tb-main{grid-column:1/5;padding:4px 10px;border-left:1px solid #ccc}
  .tb-main h1{font-size:13pt;color:#1a3a5c;border-bottom:1px solid #ccc;padding-bottom:3px;margin-bottom:3px}
  .tb-main .sub{font-size:8pt;color:#555}
  .tb-side{grid-column:5/7;display:grid;grid-template-rows:repeat(4,1fr);border-right:1px solid #aaa}
  .tb-cell{padding:3px 8px;border-bottom:1px solid #ddd;font-size:8pt;display:flex;justify-content:space-between}
  .tb-cell b{color:#1a3a5c}
  /* ─── Section headers ─── */
  .sec-hdr{background:#1a3a5c;color:#fff;font-size:9pt;font-weight:bold;padding:3px 8px;margin:8px 0 4px}
  /* ─── Drawing layout ─── */
  .draw-row{display:grid;grid-template-columns:55fr 45fr;gap:8px;margin-bottom:8px}
  .draw-box{border:1px solid #ccc;padding:4px;background:#fafbfc}
  .draw-box h3{font-size:8pt;color:#1a3a5c;margin-bottom:3px;padding-bottom:2px;border-bottom:1px solid #ddd}
  svg{display:block;width:100%}
  /* ─── Tables ─── */
  table{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:8px}
  th{background:#1a3a5c;color:#fff;padding:4px 6px;text-align:center;border:1px solid #1a3a5c}
  td{border:1px solid #ccc;padding:3px 5px;text-align:center}
  tr:nth-child(even) td{background:#f4f7fb}
  .ftype{font-weight:bold;color:#1a3a5c}
  .rebar{font-family:monospace;color:#880000;font-weight:bold}
  .ok{color:green}
  .fail{color:red;background:#fff0f0 !important}
  /* ─── Notes ─── */
  .notes{font-size:8pt;border:1px solid #ccc;padding:6px 10px;background:#fafbfc;counter-reset:note}
  .notes li{margin:2px 0;margin-right:16px}
  .mat-bar{display:flex;flex-wrap:wrap;gap:12px;background:#eef3fa;padding:5px 10px;font-size:8pt;border:1px solid #c0cfe0;margin-bottom:6px}
  .mat-bar span{white-space:nowrap}
  .mat-bar b{color:#1a3a5c}
  @media print{body{padding:4mm} .no-print{display:none}}
</style>
</head>
<body>

<!-- ══════════════ TITLE BLOCK ══════════════ -->
<div class="title-block">
  <div class="tb-main">
    <h1>لوحة تنفيذية — تصميم الأساسات المنفردة</h1>
    <div class="sub">طريقة الإجهادات العاملة (WSM / ASD) · ACI 318 · UBC 1997</div>
    <div class="sub" style="margin-top:2px">المشروع: <b>${proj}</b> &nbsp;|&nbsp; مكتب الاستشارات: <b>${titleBlock.firmName || '—'}</b></div>
  </div>
  <div class="tb-side">
    <div class="tb-cell"><b>صمّمه:</b><span>${titleBlock.designedBy || '—'}</span></div>
    <div class="tb-cell"><b>راجعه:</b><span>${titleBlock.checkedBy || '—'}</span></div>
    <div class="tb-cell"><b>التاريخ:</b><span>${today}</span></div>
    <div class="tb-cell"><b>رقم اللوحة:</b><span>${titleBlock.drawingNumber || 'F-01'}</span></div>
  </div>
</div>

<!-- ══════════════ MATERIAL BAR ══════════════ -->
<div class="mat-bar">
  <span><b>f'c</b> = ${mat.fc} MPa</span>
  <span><b>fy</b> = ${mat.fy} MPa</span>
  <span><b>qa</b> = ${mat.qa} kN/m²</span>
  <span><b>fc,allow</b> = ${(0.45 * mat.fc).toFixed(1)} MPa</span>
  <span><b>fs,allow</b> = ${Math.min(0.5 * mat.fy, 207).toFixed(0)} MPa</span>
  <span><b>Df</b> = ${mat.Df} m</span>
  <span><b>Cover</b> = ${mat.cover} mm</span>
  <span><b>n</b> = ${Math.max(6, Math.round(200000 / (4700 * Math.sqrt(mat.fc))))}</span>
</div>

<!-- ══════════════ DRAWINGS ══════════════ -->
<div class="draw-row">
  <!-- Foundation Plan -->
  <div class="draw-box">
    <h3>مسقط الأساسات — Foundation Plan</h3>
    <svg viewBox="0 0 ${PLAN_W} ${PLAN_H}" xmlns="http://www.w3.org/2000/svg">
      ${markers}
      <rect width="${PLAN_W}" height="${PLAN_H}" fill="#f8f9fb"/>
      ${planElems}
      ${dimLines}
      ${colLabels}
    </svg>
    <div style="font-size:7pt;color:#555;margin-top:3px;text-align:center">
      ▬ ▬ حدود الأساس &nbsp;|&nbsp; ■ العمود &nbsp;|&nbsp; F1,F2… نوع القاعدة
    </div>
  </div>

  <!-- Typical Section -->
  <div class="draw-box">
    <h3>قطاع نموذجي — Section A-A &nbsp; (${repResult.colId}: ${repResult.B}×${repResult.L}×${repResult.t} mm)</h3>
    ${detSVG}
    <div style="font-size:7pt;color:#555;margin-top:3px;text-align:center">
      جميع الأبعاد بالمليمتر &nbsp;|&nbsp; الغطاء الخرساني ${mat.cover} مم &nbsp;|&nbsp; طبقة نظافة 50 مم
    </div>
  </div>
</div>

<!-- ══════════════ FOOTING TYPE SCHEDULE ══════════════ -->
<div class="sec-hdr">جدول أنواع الأساسات — Footing Schedule</div>
<table>
  <thead>
    <tr>
      <th>النوع</th>
      <th>B (mm)<br/><small>اتجاه b العمود</small></th>
      <th>L (mm)<br/><small>اتجاه h العمود</small></th>
      <th>السُّمك t (mm)</th>
      <th>تسليح اتجاه B</th>
      <th>تسليح اتجاه L</th>
      <th>الأعمدة</th>
    </tr>
  </thead>
  <tbody>${typeRows}</tbody>
</table>

<!-- ══════════════ DETAIL RESULTS TABLE ══════════════ -->
<div class="sec-hdr">جدول نتائج تصميم الأساسات — Design Results</div>
<table>
  <thead>
    <tr>
      <th>النوع — العمود</th>
      <th>P (kN)</th>
      <th>B×L (mm)</th>
      <th>t (mm)</th>
      <th>d (mm)</th>
      <th>q فعلي<br/>kN/m²</th>
      <th>ضغط التربة</th>
      <th>تسليح B</th>
      <th>تسليح L</th>
      <th>قص عريض</th>
      <th>قص ثقبي</th>
    </tr>
  </thead>
  <tbody>${detailRows}</tbody>
</table>

<!-- ══════════════ NOTES ══════════════ -->
<div class="sec-hdr">ملاحظات تنفيذية — Construction Notes</div>
<ol class="notes">
  <li>تُصَب طبقة نظافة سُمكها <b>50 mm</b> من الخرسانة العادية (lean concrete) قبل وضع حديد التسليح.</li>
  <li>الغطاء الخرساني لأساسات الأرض ≥ <b>${mat.cover} mm</b> من وجه الصب السفلي (ACI 318 §20.6.1.3).</li>
  <li>أبعاد القاعدة (B × L) مُقاربة لأبعاد مقطع العمود بنسبة L/B = h/b، مما يُحقق كفاءة في توزيع الضغط.</li>
  <li>يُراجع المهندس المشرف التربة ميدانياً للتثبت من قدرة الحمل المفترضة (qa = ${mat.qa} kN/m²).</li>
  <li>جميع الحديد ${mat.fy === 420 ? 'Grade 60 (fy = 420 MPa)' : mat.fy === 280 ? 'Grade 40 (fy = 280 MPa)' : `fy = ${mat.fy} MPa`} — يُتحقق من شهادات المصنع.</li>
  <li>طول التماسك الأساسي لحديد الأساسات: ld ≥ 0.02 × fy/√f'c × db (ACI 318 §25.5).</li>
  <li>تُنفَّذ شبكة التسليح من طبقتين متقاطعتين في الاتجاهين، تسليح اتجاه L (الأطول) هو الطبقة السفلية.</li>
  <li>منسوب التأسيس Df = ${mat.Df} m من منسوب الطبيعي — يُعدَّل وفق مخطط القطوع الجيوتكنية.</li>
</ol>

</body>
</html>`;
}

// ─── Cross-section detail SVG ─────────────────────────────────────────────────

function buildDetailSVG(r: FootingDesignResult, mat: FootingMaterials): string {
  const cover = mat.cover;
  const W = 340;
  const H = 300;
  const sv = W / 2;  // horizontal center

  // Scale the drawing to fit the section — normalise to footing width
  // Target: footing B occupies ~60% of W → scale px/mm
  const sc = (W * 0.60) / r.B;

  const footW = r.B * sc;
  const footH = r.t * sc;
  const colW  = Math.max(20, r.dia_x * sc); // approximate col width in px (use colB estimate)
  const dfH   = Math.min(50, r.d * sc * 0.4); // depth of fill above footing (compressed)

  // Layout (top to bottom): ground line, fill, footing, blinding
  const GY = 40;   // ground line Y
  const FY = GY + dfH; // top of footing
  const BY = FY + footH; // bottom of footing
  const BLY = BY + 12;  // bottom of blinding (50mm)

  const fX1 = sv - footW / 2;
  const fX2 = sv + footW / 2;

  // column
  const cW2 = Math.max(18, footW * 0.22);
  const cX1 = sv - cW2 / 2;
  const cX2 = sv + cW2 / 2;
  const cTop = GY - 50;

  // Effective depth line
  const dY = FY + cover * sc + 8;  // centroid of bars ≈ cover + bar/2

  // Rebar dots (bottom mat) — show ~5 bars across
  const nDots = Math.min(7, r.bars_y);
  const barDots = Array.from({ length: nDots }, (_, i) => {
    const bx = fX1 + (footW / (nDots + 1)) * (i + 1);
    return `<circle cx="${bx.toFixed(1)}" cy="${(BY - cover * sc).toFixed(1)}" r="3" fill="#c00"/>`;
  }).join('');

  // Top layer (bars running perpendicular) shown as horizontal lines
  const dY2 = BY - cover * sc - 8;
  const barLines = Array.from({ length: Math.min(5, r.bars_x) }, (_, i) => {
    const bx = fX1 + (footW / (Math.min(5, r.bars_x) + 1)) * (i + 1);
    return `<line x1="${(bx - 3).toFixed(1)}" y1="${dY2.toFixed(1)}" x2="${(bx + 3).toFixed(1)}" y2="${dY2.toFixed(1)}" stroke="#c00" stroke-width="2.5"/>`;
  }).join('');

  // Dimension line helpers
  function hDim(x1: number, x2: number, y: number, label: string, above = true) {
    const yl = above ? y - 8 : y + 12;
    return `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#c00" stroke-width="0.8" marker-start="url(#arrl)" marker-end="url(#arr)"/>
            <line x1="${x1.toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>
            <line x1="${x2.toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>
            <text x="${((x1 + x2) / 2).toFixed(1)}" y="${yl.toFixed(1)}" text-anchor="middle" font-size="8" fill="#c00">${label}</text>`;
  }
  function vDim(x: number, y1: number, y2: number, label: string, left = true) {
    const xl = left ? x - 10 : x + 10;
    return `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c00" stroke-width="0.8" marker-start="url(#arrl)" marker-end="url(#arr)"/>
            <text x="${xl.toFixed(1)}" y="${((y1 + y2) / 2 + 3).toFixed(1)}" text-anchor="${left ? 'end' : 'start'}" font-size="8" fill="#c00">${label}</text>`;
  }

  const marks = `
  <defs>
    <marker id="arr" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
      <path d="M0,0 L6,2 L0,4 Z" fill="#c00"/>
    </marker>
    <marker id="arrl" markerWidth="6" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse">
      <path d="M6,0 L0,2 L6,4 Z" fill="#c00"/>
    </marker>
    <pattern id="concH" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#9ab" stroke-width="1"/>
    </pattern>
    <pattern id="soilH" patternUnits="userSpaceOnUse" width="6" height="4">
      <line x1="0" y1="0" x2="6" y2="4" stroke="#b8a070" stroke-width="0.7"/>
    </pattern>
  </defs>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="height:${H}px;max-height:${H}px">
  ${marks}
  <rect width="${W}" height="${H}" fill="#f8f9fb"/>

  <!-- Soil fill above footing -->
  <rect x="${fX1.toFixed(1)}" y="${GY.toFixed(1)}" width="${footW.toFixed(1)}" height="${dfH.toFixed(1)}" fill="url(#soilH)" fill-opacity="0.7" stroke="none"/>
  <!-- Soil outside footing -->
  <rect x="0" y="${GY.toFixed(1)}" width="${fX1.toFixed(1)}" height="${dfH.toFixed(1)}" fill="url(#soilH)" fill-opacity="0.7" stroke="none"/>
  <rect x="${fX2.toFixed(1)}" y="${GY.toFixed(1)}" width="${(W - fX2).toFixed(1)}" height="${dfH.toFixed(1)}" fill="url(#soilH)" fill-opacity="0.7" stroke="none"/>

  <!-- Ground line -->
  <line x1="0" y1="${GY.toFixed(1)}" x2="${W}" y2="${GY.toFixed(1)}" stroke="#6a5430" stroke-width="1.5" stroke-dasharray="4,2"/>
  <text x="5" y="${(GY - 3).toFixed(1)}" font-size="7.5" fill="#6a5430">G.L. ±0.000</text>

  <!-- Column above footing -->
  <rect x="${cX1.toFixed(1)}" y="${cTop.toFixed(1)}" width="${(2 * cW2).toFixed(1)}" height="${(GY - cTop + dfH).toFixed(1)}"
    fill="url(#concH)" fill-opacity="0.5" stroke="#1a3a5c" stroke-width="1.5"/>
  <text x="${sv.toFixed(1)}" y="${(cTop + 10).toFixed(1)}" text-anchor="middle" font-size="8" fill="#1a3a5c">عمود</text>

  <!-- Footing body -->
  <rect x="${fX1.toFixed(1)}" y="${FY.toFixed(1)}" width="${footW.toFixed(1)}" height="${footH.toFixed(1)}"
    fill="url(#concH)" fill-opacity="0.6" stroke="#1a3a5c" stroke-width="2"/>

  <!-- Blinding (lean concrete) -->
  <rect x="${fX1.toFixed(1)}" y="${BY.toFixed(1)}" width="${footW.toFixed(1)}" height="12"
    fill="#d0d8e0" stroke="#888" stroke-width="0.8"/>
  <text x="${sv.toFixed(1)}" y="${(BY + 9).toFixed(1)}" text-anchor="middle" font-size="7" fill="#555">طبقة نظافة 50 mm</text>

  <!-- Rebar — bottom layer (parallel to L) shown as dots -->
  ${barDots}
  <!-- Rebar — top layer (parallel to B) shown as line segments -->
  ${barLines}

  <!-- Rebar labels -->
  <text x="${(fX2 + 5).toFixed(1)}" y="${(BY - cover * sc - 1).toFixed(1)}" font-size="7.5" fill="#c00">${r.bars_y}Ø${r.dia_y}@${r.spacing_y}</text>
  <text x="${(fX2 + 5).toFixed(1)}" y="${(dY2 + 3).toFixed(1)}" font-size="7.5" fill="#880000">${r.bars_x}Ø${r.dia_x}@${r.spacing_x}</text>
  <text x="${(fX2 + 5).toFixed(1)}" y="${(BY - cover * sc + 14).toFixed(1)}" font-size="6.5" fill="#c00">(اتجاه L)</text>
  <text x="${(fX2 + 5).toFixed(1)}" y="${(dY2 + 13).toFixed(1)}" font-size="6.5" fill="#880000">(اتجاه B)</text>

  <!-- Cover bracket -->
  ${vDim(fX1 - 16, BY - cover * sc, BY, `${mat.cover}`, true)}
  <text x="${(fX1 - 18).toFixed(1)}" y="${(BY - cover * sc / 2 + 10).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#555">cover</text>

  <!-- B dimension -->
  ${hDim(fX1, fX2, BLY + 20, `B = ${r.B} mm`, false)}

  <!-- t dimension -->
  ${vDim(fX1 - 32, FY, BY, `t = ${r.t} mm`)}

  <!-- d dimension -->
  ${vDim(fX1 - 48, BY - cover * sc - 4, FY, `d = ${r.d} mm`)}

  <!-- Df dimension -->
  ${vDim(fX2 + 40, GY, BY, `Df = ${(mat.Df * 1000).toFixed(0)} mm`, false)}

  <!-- Section label -->
  <text x="${sv.toFixed(1)}" y="${(H - 5).toFixed(1)}" text-anchor="middle" font-size="8" fill="#1a3a5c" font-weight="bold">قطاع أ — أ (Section A-A)</text>
</svg>`;
}
