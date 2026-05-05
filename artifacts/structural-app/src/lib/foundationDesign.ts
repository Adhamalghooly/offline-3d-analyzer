/**
 * Foundation Design - UBC 1997 / ASD (Working Stress Method)
 * Isolated Spread Footings for individual columns
 * Reference: UBC 1997 Chapter 18, ACI 318-99 Appendix A (ASD)
 */

export interface ColumnReactionInput {
  colId: string;
  x: number;   // column center X in meters
  y: number;   // column center Y in meters
  P_DL: number; // Dead load axial reaction kN (service, positive = compression)
  P_LL: number; // Live load axial reaction kN (service, positive = compression)
  Mx_DL?: number; // Dead load moment kN.m
  Mx_LL?: number;
  My_DL?: number;
  My_LL?: number;
  colB: number; // column width mm (x-direction)
  colH: number; // column depth mm (y-direction)
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
  B: number;             // footing width mm (x-direction)
  L: number;             // footing length mm (y-direction)
  t: number;             // total footing thickness mm
  d: number;             // effective depth mm
  q_net_allow: number;   // net allowable bearing pressure kN/m²
  q_actual: number;      // actual net bearing pressure kN/m²
  bearing_ok: boolean;

  // Flexure - x direction (reinforcement runs in y direction, parallel to L)
  M_x: number;           // design moment kN.m/m (per unit width)
  As_x_req: number;      // required As mm²/m (x-direction cantilever)
  As_x_use: number;      // used As mm²/m (after min steel check)
  bars_x: number;        // total bars in x-direction
  dia_x: number;         // bar diameter mm
  spacing_x: number;     // bar spacing mm

  // Flexure - y direction
  M_y: number;           // design moment kN.m/m
  As_y_req: number;
  As_y_use: number;
  bars_y: number;
  dia_y: number;
  spacing_y: number;

  // Shear checks
  Vu_wide: number;       // wide beam shear demand kN
  Vc_wide: number;       // wide beam shear capacity kN
  wide_shear_ok: boolean;
  Vu_punch: number;      // punching shear demand kN
  Vc_punch: number;      // punching shear capacity kN
  punch_shear_ok: boolean;

  // WSM constants
  fc_allow: number;
  fs_allow: number;
  n: number;
  k: number;
  j: number;
  As_min_pm: number;     // minimum As per meter width mm²/m

  // Computed cantilever
  a_x: number;           // cantilever x mm
  a_y: number;           // cantilever y mm

  adequate: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Select bar arrangement for required total steel area over given width
 */
function selectRebar(
  As_req_total: number,   // mm² total over full width
  width: number,          // mm
  cover: number,          // mm
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
    // If spacing too small, try next diameter
  }
  // Fallback to 25mm
  const dia = 25;
  const ab = Math.PI * dia * dia / 4;
  const bars = Math.max(2, Math.ceil(As_req_total / ab));
  const spacing = bars > 1 ? (width - 2 * cover - dia) / (bars - 1) : 100;
  return { bars, dia, spacing: Math.round(Math.max(75, spacing)), As_provided: bars * ab };
}

// ─── Main design function ─────────────────────────────────────────────────────

/**
 * Design isolated spread footing per UBC 1997 / Working Stress Method
 *
 * Steps:
 * 1. Net allowable bearing = qa - overburden weight
 * 2. Required area = service load / q_net_allow → B (square footing)
 * 3. Flexure at column face using WSM transformed section
 * 4. Check wide-beam shear and punching shear at d from col face
 * 5. Iterate thickness if shear governs
 */
export function designFooting(
  reaction: ColumnReactionInput,
  mat: FootingMaterials,
): FootingDesignResult {
  const { fc, fy, qa, cover, gamma_conc, gamma_soil, Df } = mat;
  const { colId, x, y, P_DL, P_LL, colB, colH } = reaction;

  const P_service = P_DL + P_LL;

  // ── WSM constants ────────────────────────────────────────────────────────────
  const fc_allow = 0.45 * fc;          // MPa — ACI 318 ASD / UBC 97
  const Es = 200_000;                  // MPa
  const Ec = 4700 * Math.sqrt(fc);     // MPa
  const n_raw = Es / Ec;
  const n = Math.max(6, Math.round(n_raw));
  // Allowable steel stress: 0.5fy but ≤ 207 MPa (Grade 60 typical ASD limit)
  const fs_allow = Math.min(0.50 * fy, 207);
  const k = (n * fc_allow) / (n * fc_allow + fs_allow);  // neutral axis ratio
  const j = 1 - k / 3;                                   // lever arm ratio

  // ── Minimum steel (ACI 318 ASD / UBC) ────────────────────────────────────────
  // For footings: temperature & shrinkage = ρ_min × b × h
  // ACI 318-99 §7.12: ρ_temp = 0.0020 (fy<420), 0.0018 (fy≥420)
  const rho_min = fy >= 420 ? 0.0018 : 0.0020;

  // ── Iterate to find self-consistent B and t ───────────────────────────────────
  let t = 400;   // initial footing thickness mm
  let B = 1500;
  let L = 1500;

  for (let iter = 0; iter < 12; iter++) {
    const t_m = t / 1000;

    // Overburden weight per unit area
    const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m; // kN/m²
    const q_net = Math.max(50, qa - w_ov);  // net allowable (min 50 kN/m² guard)

    // Required plan area
    const A_req = P_service / q_net;  // m²
    const B_calc = Math.sqrt(A_req);
    const B_new = roundUpTo(B_calc * 1000, 100);   // round up to 100mm

    B = B_new;
    L = B_new;

    const q_act = P_service / ((B / 1000) * (L / 1000));  // kN/m²

    // Effective depth (assume 12mm bar initially for cover-to-centroid)
    const d = t - cover - 12;

    if (d <= 0) { t += 100; continue; }

    // ── Wide-beam shear check ────────────────────────────────────────────────
    const a_x = (B - colB) / 2;  // cantilever mm
    const a_y = (L - colH) / 2;

    const shear_arm_x = Math.max(0, a_x - d);  // distance beyond d from col face
    const shear_arm_y = Math.max(0, a_y - d);

    const Vu_x = q_act * (shear_arm_x / 1000) * (L / 1000);  // kN (for full L width)
    const Vu_y = q_act * (shear_arm_y / 1000) * (B / 1000);
    const Vu_wide = Math.max(Vu_x, Vu_y);

    // ASD shear: vc = 0.083√f'c MPa (ACI 318-99 App A eq A-4)
    const vc_allow = 0.083 * Math.sqrt(fc);  // MPa
    const Vc_wide_x = vc_allow * (L) * d / 1000;   // kN
    const Vc_wide_y = vc_allow * (B) * d / 1000;
    const Vc_wide = Math.min(Vc_wide_x, Vc_wide_y);

    if (Vu_wide > Vc_wide) {
      // Need more depth — solve: Vu/(vc × b) = d_min, then t = d + cover + 12
      const d_req_x = shear_arm_x > 0 ? (Vu_x * 1000) / (vc_allow * L) : 0;
      const d_req_y = shear_arm_y > 0 ? (Vu_y * 1000) / (vc_allow * B) : 0;
      const d_req = Math.max(d_req_x, d_req_y);
      const t_new = roundUpTo(d_req + cover + 12, 50);
      if (t_new > t) { t = t_new; continue; }
    }

    // ── Punching shear check ─────────────────────────────────────────────────
    const b0 = 2 * ((colB + d) + (colH + d));  // mm
    const A_punch_inside = (colB + d) * (colH + d) / 1e6;  // m²
    const Vu_punch = q_act * ((B * L / 1e6) - A_punch_inside);  // kN

    const betaC = Math.max(colB, colH) / Math.min(colB, colH);
    const vc_punch_limit = Math.min(
      0.083 * (2 + 4 / betaC) * Math.sqrt(fc),
      0.166 * Math.sqrt(fc),
    );  // MPa — ACI 318-99 App A
    const Vc_punch = vc_punch_limit * b0 * d / 1000;  // kN

    if (Vu_punch > Vc_punch) {
      // Increase thickness
      t = roundUpTo(t + 50, 50);
      continue;
    }

    break;  // converged
  }

  // ── Final geometry ─────────────────────────────────────────────────────────
  const t_m = t / 1000;
  const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m;
  const q_net_allow = Math.max(50, qa - w_ov);
  const A_req = P_service / q_net_allow;
  B = roundUpTo(Math.sqrt(A_req) * 1000, 100);
  L = B;
  const q_actual = P_service / ((B / 1000) * (L / 1000));
  const bearing_ok = q_actual <= qa;
  const d = Math.max(100, t - cover - 12);

  const a_x = (B - colB) / 2;
  const a_y = (L - colH) / 2;

  // ── Flexure — per meter width at column face ─────────────────────────────────
  // M = q × c² / 2  (c = cantilever)
  const M_x = q_actual * (a_x / 1000) ** 2 / 2;  // kN.m/m
  const M_y = q_actual * (a_y / 1000) ** 2 / 2;

  // WSM: As = M / (fs × j × d)
  // M in kN.m, d in m, fs in MPa = kN/mm²
  // → As (mm²/m) = M×1e6 / (fs_allow × j × d)   [d in mm]
  const As_x_req = (M_x * 1e6) / (fs_allow * j * d);   // mm²/m
  const As_y_req = (M_y * 1e6) / (fs_allow * j * d);

  const As_min_pm = rho_min * 1000 * d;  // mm²/m
  const As_x_use = Math.max(As_x_req, As_min_pm);
  const As_y_use = Math.max(As_y_req, As_min_pm);

  // Select bars over full footing dimension
  const rb_x = selectRebar(As_x_use * (L / 1000), L, cover);
  const rb_y = selectRebar(As_y_use * (B / 1000), B, cover);

  // ── Final shear checks ────────────────────────────────────────────────────
  const vc_allow = 0.083 * Math.sqrt(fc);
  const shear_arm_x = Math.max(0, a_x - d);
  const shear_arm_y = Math.max(0, a_y - d);
  const Vu_wide_x = q_actual * (shear_arm_x / 1000) * (L / 1000);
  const Vu_wide_y = q_actual * (shear_arm_y / 1000) * (B / 1000);
  const Vu_wide = Math.max(Vu_wide_x, Vu_wide_y);
  const Vc_wide = Math.min(
    vc_allow * L * d / 1000,
    vc_allow * B * d / 1000,
  );
  const wide_shear_ok = Vu_wide <= Vc_wide;

  const b0 = 2 * ((colB + d) + (colH + d));
  const A_punch_inside = (colB + d) * (colH + d) / 1e6;
  const Vu_punch = q_actual * ((B * L / 1e6) - A_punch_inside);
  const betaC = Math.max(colB, colH) / Math.min(colB, colH);
  const vc_punch = Math.min(0.083 * (2 + 4 / betaC) * Math.sqrt(fc), 0.166 * Math.sqrt(fc));
  const Vc_punch = vc_punch * b0 * d / 1000;
  const punch_shear_ok = Vu_punch <= Vc_punch;

  const adequate = bearing_ok && wide_shear_ok && punch_shear_ok;

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
    Vu_wide, Vc_wide,
    wide_shear_ok,
    Vu_punch, Vc_punch,
    punch_shear_ok,
    fc_allow, fs_allow, n, k, j,
    As_min_pm,
    a_x, a_y,
    adequate,
  };
}

/**
 * Generate foundation drawing HTML (printable)
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
  if (results.length === 0) return '';

  const xs = results.map(r => r.x);
  const ys = results.map(r => r.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const margin = 3;  // m
  const totalW = maxX - minX + 2 * margin;
  const totalH = maxY - minY + 2 * margin;

  // Scale to fit ~700px wide SVG
  const svgW = 720;
  const svgH = Math.max(400, Math.round(svgW * (totalH / totalW)));
  const scale = svgW / totalW;  // px per meter

  function toSvgX(mx: number) { return Math.round((mx - minX + margin) * scale); }
  function toSvgY(my: number) { return Math.round(svgH - (my - minY + margin) * scale); }

  const footingElems = results.map(r => {
    const cx = toSvgX(r.x);
    const cy = toSvgY(r.y);
    const bpx = (r.B / 1000) * scale;
    const lpx = (r.L / 1000) * scale;
    const colBpx = Math.max(8, (r.B / 5000) * scale);
    const colHpx = Math.max(8, (r.L / 5000) * scale);

    return `
    <!-- Footing ${r.colId} -->
    <rect x="${cx - bpx / 2}" y="${cy - lpx / 2}" width="${bpx}" height="${lpx}"
      fill="none" stroke="#1a3a5c" stroke-width="1.5" stroke-dasharray="4,2"/>
    <!-- Column outline -->
    <rect x="${cx - colBpx / 2}" y="${cy - colHpx / 2}" width="${colBpx}" height="${colHpx}"
      fill="#1a3a5c" fill-opacity="0.15" stroke="#1a3a5c" stroke-width="1"/>
    <!-- Dimensions labels -->
    <text x="${cx}" y="${cy - lpx / 2 - 4}" text-anchor="middle" font-size="8" fill="#1a3a5c">
      ${r.B}×${r.L}mm
    </text>
    <!-- Column label -->
    <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9" font-weight="bold" fill="#1a3a5c">
      ${r.colId}
    </text>
    <!-- Rebar label -->
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="7.5" fill="#c00">
      ${r.bars_x}Ø${r.dia_x}@${r.spacing_x}
    </text>`;
  }).join('\n');

  // Center lines
  const gridLines = results.map(r => {
    const cx = toSvgX(r.x);
    const cy = toSvgY(r.y);
    return `<line x1="${cx}" y1="10" x2="${cx}" y2="${svgH - 10}" stroke="#aac" stroke-width="0.5" stroke-dasharray="3,3"/>
            <line x1="10" y1="${cy}" x2="${svgW - 10}" y2="${cy}" stroke="#aac" stroke-width="0.5" stroke-dasharray="3,3"/>`;
  }).join('\n');

  // Summary table rows
  const tableRows = results.map(r => `
    <tr>
      <td>${r.colId}</td>
      <td>${r.B}×${r.L}</td>
      <td>${r.t}</td>
      <td>${r.q_actual.toFixed(0)}</td>
      <td style="color:${r.bearing_ok ? 'green' : 'red'}">${r.bearing_ok ? '✓' : '✗'}</td>
      <td>${r.bars_x}Ø${r.dia_x}@${r.spacing_x}</td>
      <td>${r.bars_y}Ø${r.dia_y}@${r.spacing_y}</td>
      <td style="color:${r.wide_shear_ok ? 'green' : 'red'}">${r.wide_shear_ok ? '✓' : '✗'}</td>
      <td style="color:${r.punch_shear_ok ? 'green' : 'red'}">${r.punch_shear_ok ? '✓' : '✗'}</td>
    </tr>`).join('');

  const today = titleBlock.date || new Date().toLocaleDateString('ar-EG');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>لوحة الأساسات - ${titleBlock.projectName || 'المشروع'}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 10mm; color: #111; }
  h1 { font-size: 14pt; text-align: center; border-bottom: 2px solid #1a3a5c; padding-bottom: 6px; margin-bottom: 8px; }
  .title-block { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; border: 1px solid #888; padding: 6px; font-size: 8pt; margin-bottom: 10px; }
  .title-block div { border-left: 1px solid #ccc; padding: 2px 6px; }
  svg { width: 100%; border: 1px solid #ccc; background: #f8f9fa; }
  .notes { font-size: 8pt; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 10px; }
  th { background: #1a3a5c; color: #fff; padding: 4px 6px; text-align: center; border: 1px solid #fff; }
  td { border: 1px solid #ccc; padding: 3px 6px; text-align: center; }
  tr:nth-child(even) td { background: #f0f4f8; }
  .legend { font-size: 7pt; color: #555; margin-top: 4px; }
  .mat-notes { font-size: 8pt; background: #f0f4f8; padding: 6px; border: 1px solid #ccc; margin-top: 8px; }
  @media print { body { margin: 5mm; } }
  .section-title { font-size: 10pt; font-weight: bold; margin: 10px 0 4px; border-bottom: 1px solid #1a3a5c; }
</style>
</head>
<body>
<h1>لوحة تنفيذية - تصميم الأساسات المنفردة (Working Stress Method / UBC 1997)</h1>
<div class="title-block">
  <div><b>المشروع:</b> ${titleBlock.projectName || '—'}</div>
  <div><b>المكتب:</b> ${titleBlock.firmName || '—'}</div>
  <div><b>رقم اللوحة:</b> ${titleBlock.drawingNumber || 'F-01'}</div>
  <div><b>صمّمه:</b> ${titleBlock.designedBy || '—'}</div>
  <div><b>راجعه:</b> ${titleBlock.checkedBy || '—'}</div>
  <div><b>التاريخ:</b> ${today}</div>
</div>

<div class="section-title">مسقط الأساسات - Foundation Plan</div>
<svg viewBox="0 0 ${svgW} ${svgH}">
  ${gridLines}
  ${footingElems}
  <text x="${svgW / 2}" y="${svgH - 5}" text-anchor="middle" font-size="8" fill="#888">
    مسقط الأساسات - المقياس تقريبي
  </text>
</svg>
<div class="legend">
  ▬ ▬  حدود الأساس المنفرد  |  ■ موضع العمود  |  الأرقام الحمراء: تسليح القاعدة
</div>

<div class="section-title">جدول أبعاد الأساسات والتسليح</div>
<table>
  <thead>
    <tr>
      <th>العمود</th>
      <th>B×L (mm)</th>
      <th>السُّمك t (mm)</th>
      <th>q فعلي (kN/m²)</th>
      <th>ضغط التربة</th>
      <th>تسليح B</th>
      <th>تسليح L</th>
      <th>قص عريض</th>
      <th>ثقب</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>

<div class="mat-notes">
  <b>المعطيات المادية:</b>
  &nbsp;&nbsp; f'c = ${mat.fc} MPa &nbsp;|&nbsp;
  fy = ${mat.fy} MPa &nbsp;|&nbsp;
  qa = ${mat.qa} kN/m² &nbsp;|&nbsp;
  fc,allow = ${(0.45 * mat.fc).toFixed(1)} MPa &nbsp;|&nbsp;
  fs,allow = ${Math.min(0.5 * mat.fy, 207).toFixed(0)} MPa &nbsp;|&nbsp;
  الغطاء الخرساني = ${mat.cover} mm &nbsp;|&nbsp;
  عمق التأسيس Df = ${mat.Df} m
</div>

<div class="notes">
  <b>ملاحظات التنفيذ:</b><br/>
  ١- تُصَب طبقة نظافة سُمكها 50mm من الخرسانة العادية قبل وضع الحديد.<br/>
  ٢- يُراعى تحقيق منسوب تأسيس موحد أو تدريجي وفق مخطط القطوع.<br/>
  ٣- الغطاء الخرساني للأساسات ≥ ${mat.cover}mm (UBC 1997 §1907.7.1).<br/>
  ٤- يُراجع المهندس المشرف التربة ميدانياً للتثبت من قدرة الحمل المفروضة.<br/>
  ٥- الحديد المستخدم: ${mat.fy === 420 ? 'Grade 60 (fy=420 MPa)' : mat.fy === 280 ? 'Grade 40 (fy=280 MPa)' : `fy=${mat.fy} MPa`}.<br/>
  ٦- الخرسانة: f'c = ${mat.fc} MPa ، الوزن الحجمي = ${mat.gamma_conc} kN/m³.
</div>
</body>
</html>`;
}
