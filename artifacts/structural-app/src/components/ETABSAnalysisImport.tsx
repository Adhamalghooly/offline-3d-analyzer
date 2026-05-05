/**
 * ETABSAnalysisImport — استيراد نتائج التحليل من ETABS
 * صيغة الملف المتوقعة (Element Forces - Beams):
 *   Row 0: Story | Beam | Unique Name | Output Case | Case Type | Station | P | V2 | V3 | T | M2 | M3 | ...
 *   Row 1: (units) — m, kN, kN-m, ...
 *   Row 2+: data
 */

import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, Check, Eye, ChevronDown, ChevronUp, Info } from 'lucide-react';

export interface ETABSBeamResult {
  beamId: string;
  story: string;
  Mleft: number;   // kN-m (hogging left support)
  Mmid: number;    // kN-m (sagging midspan)
  Mright: number;  // kN-m (hogging right support)
  Vu: number;      // kN (max shear)
  combCount: number;
  stationCount: number;
}

interface Props {
  onApply: (results: ETABSBeamResult[]) => void;
  appliedCount?: number;
}

function parseETABSExcel(file: File): Promise<ETABSBeamResult[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        // Detect header row (find row with "Beam" and "M3")
        let dataStartRow = 2; // default: row 0=headers, row 1=units, row 2=data
        // Find column indices by header name
        const headers = (rows[0] || []).map((h: any) => String(h ?? '').toLowerCase().trim());
        const COL_STORY   = Math.max(headers.findIndex((h: string) => h === 'story'), 0);
        const COL_BEAM    = Math.max(headers.findIndex((h: string) => h === 'beam'), 1);
        const COL_CASE    = Math.max(headers.findIndex((h: string) => h.includes('output case') || h === 'output case'), 3);
        const COL_STATION = Math.max(headers.findIndex((h: string) => h === 'station'), 5);
        const COL_V2      = Math.max(headers.findIndex((h: string) => h === 'v2'), 7);
        const COL_M3      = Math.max(headers.findIndex((h: string) => h === 'm3'), 11);

        // Group: { beam → { station → { m3, v2 }[] } }
        type Pt = { station: number; m3: number; v2: number; caseType: string };
        const beamMap = new Map<string, { story: string; pts: Pt[]; cases: Set<string> }>();

        for (let i = dataStartRow; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < Math.max(COL_M3, COL_V2, COL_STATION) + 1) continue;
          const beamName = String(row[COL_BEAM] ?? '').trim();
          if (!beamName || beamName === 'Beam') continue;
          const story = String(row[COL_STORY] ?? '').trim();
          const caseType = String(row[COL_CASE] ?? '').trim();
          const station = Number(row[COL_STATION]) || 0;
          const v2 = Number(row[COL_V2]) || 0;
          const m3 = Number(row[COL_M3]) || 0;

          if (!beamMap.has(beamName)) {
            beamMap.set(beamName, { story, pts: [], cases: new Set() });
          }
          const entry = beamMap.get(beamName)!;
          entry.pts.push({ station, m3, v2, caseType });
          entry.cases.add(caseType);
        }

        // Compute design envelope for each beam
        const results: ETABSBeamResult[] = [];
        for (const [beamId, { story, pts, cases }] of beamMap) {
          if (pts.length === 0) continue;

          const stations = pts.map(p => p.station);
          const minSt = Math.min(...stations);
          const maxSt = Math.max(...stations);
          const beamLen = maxSt - minSt;
          // Left zone: first 25% | Right zone: last 25%
          const leftZone  = minSt + beamLen * 0.25;
          const rightZone = maxSt - beamLen * 0.25;

          let Mleft = 0, Mmid = 0, Mright = 0, Vu = 0;

          for (const pt of pts) {
            const absV = Math.abs(pt.v2);
            if (absV > Vu) Vu = absV;

            // Max hogging (absolute) at left support zone
            if (pt.station <= leftZone) {
              if (Math.abs(pt.m3) > Mleft) Mleft = Math.abs(pt.m3);
            }
            // Max hogging (absolute) at right support zone
            if (pt.station >= rightZone) {
              if (Math.abs(pt.m3) > Mright) Mright = Math.abs(pt.m3);
            }
            // Max sagging (positive M3) anywhere
            if (pt.m3 > Mmid) Mmid = pt.m3;
          }

          results.push({
            beamId, story,
            Mleft: parseFloat(Mleft.toFixed(3)),
            Mmid:  parseFloat(Mmid.toFixed(3)),
            Mright: parseFloat(Mright.toFixed(3)),
            Vu: parseFloat(Vu.toFixed(3)),
            combCount: cases.size,
            stationCount: pts.length,
          });
        }

        // Sort by story then beam name
        results.sort((a, b) => a.story.localeCompare(b.story) || a.beamId.localeCompare(b.beamId));
        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export default function ETABSAnalysisImport({ onApply, appliedCount }: Props) {
  const [results, setResults] = useState<ETABSBeamResult[]>([]);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setStatus('');
    try {
      const parsed = await parseETABSExcel(file);
      if (parsed.length === 0) {
        setStatus('لم يتم العثور على بيانات — تأكد من أن الملف يحتوي على ورقة "Element Forces - Beams"');
      } else {
        setResults(parsed);
        setShowPreview(true);
        setStatus(`✓ تم تحليل ${parsed.length} جسر من ${new Set(parsed.map(r => r.story)).size} دور`);
      }
    } catch {
      setStatus('✗ خطأ في قراءة الملف');
    }
    setLoading(false);
    if (e.target) e.target.value = '';
  }, []);

  return (
    <Card className="border-orange-200 dark:border-orange-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={15} className="text-orange-500" />
            استيراد نتائج التحليل من ETABS
            {appliedCount !== undefined && appliedCount > 0 && (
              <Badge variant="default" className="text-[10px] bg-green-600">{appliedCount} جسر نشط</Badge>
            )}
          </CardTitle>
          <button onClick={() => setShowGuide(v => !v)} className="text-muted-foreground hover:text-foreground">
            {showGuide ? <ChevronUp size={14} /> : <Info size={14} />}
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showGuide && (
          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-xs space-y-1.5">
            <p className="font-semibold text-orange-700 dark:text-orange-300">صيغة ملف ETABS المطلوبة (Element Forces - Beams):</p>
            <p>من ETABS: <strong>Display → Show Tables → Analysis Results → Element Output → Frame Output → Element Forces - Beams</strong></p>
            <p>ثم: <strong>File → Export Current Table → To Excel (xlsx)</strong></p>
            <div className="overflow-x-auto mt-2">
              <table className="text-[10px] border-collapse w-full">
                <thead>
                  <tr className="bg-orange-100 dark:bg-orange-900/50">
                    {['Story','Beam','Unique Name','Output Case','Case Type','Station','P','V2','V3','T','M2','M3','...'].map(h => (
                      <th key={h} className="border border-orange-200 dark:border-orange-700 px-1 py-0.5 font-mono">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-muted-foreground">
                    {['','','','','','m','kN','kN','kN','kN-m','kN-m','kN-m',''].map((u, i) => (
                      <td key={i} className="border border-orange-200 dark:border-orange-700 px-1 py-0.5 text-center italic">{u}</td>
                    ))}
                  </tr>
                  <tr>
                    {['Story1','B1','7','Comb1','Combination','0.10','-0.82','-13.51','0.02','0.64','0.01','-0.70','7'].map((v, i) => (
                      <td key={i} className="border border-orange-200 dark:border-orange-700 px-1 py-0.5 font-mono">{v}</td>
                    ))}
                  </tr>
                  <tr className="bg-muted/30">
                    {['Story1','B1','7','Comb1','Combination','0.60','-0.82','-10.66','0.02','0.64','0.00','5.44','7'].map((v, i) => (
                      <td key={i} className="border border-orange-200 dark:border-orange-700 px-1 py-0.5 font-mono">{v}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">التطبيق يستخدم عمود <strong>M3</strong> (العزم الرئيسي kN-m) و<strong>V2</strong> (القص kN) لجميع التوليفات ويأخذ المغلّف (Envelope).</p>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />

        <Button
          variant="outline"
          className="w-full min-h-[44px] gap-2 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
        >
          <Upload size={16} className="text-orange-500" />
          {loading ? 'جاري القراءة...' : 'اختر ملف ETABS (xlsx)'}
        </Button>

        {status && (
          <p className={`text-xs font-medium px-2 py-1 rounded ${status.startsWith('✓') ? 'text-green-700 bg-green-50 dark:bg-green-950/30' : 'text-destructive bg-destructive/10'}`}>
            {status}
          </p>
        )}

        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <button
                className="text-xs text-primary flex items-center gap-1 underline underline-offset-2"
                onClick={() => setShowPreview(v => !v)}
              >
                <Eye size={12} /> {showPreview ? 'إخفاء' : 'معاينة'} النتائج ({results.length} جسر)
                {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {showPreview && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto rounded border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['الدور', 'الجسر', 'M يسار (kN-m)', 'M وسط (kN-m)', 'M يمين (kN-m)', 'Vu (kN)', 'توليفات'].map(h => (
                        <TableHead key={h} className="text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map(r => (
                      <TableRow key={`${r.story}-${r.beamId}`}>
                        <TableCell className="text-xs text-muted-foreground">{r.story}</TableCell>
                        <TableCell className="font-mono text-xs font-bold">{r.beamId}</TableCell>
                        <TableCell className="font-mono text-xs text-red-600">{r.Mleft.toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-xs text-green-600">{r.Mmid.toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-xs text-red-600">{r.Mright.toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.Vu.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.combCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <Button
              className="w-full min-h-[44px] gap-2 bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => onApply(results)}
            >
              <Check size={16} />
              استخدام هذه النتائج للتصميم ({results.length} جسر)
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
