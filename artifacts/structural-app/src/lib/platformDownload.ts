/**
 * Platform-aware file download utility.
 *
 * - On the web: uses Blob + <a download> (standard browser download).
 * - On Android/iOS (Capacitor): writes the file to the device cache via
 *   @capacitor/filesystem, then opens the OS share sheet so the user
 *   can save to Downloads, open with another app, etc.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type jsPDF from 'jspdf';

/** True when running inside a native Capacitor shell (Android / iOS). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Convert an ArrayBuffer to a base-64 string (required by Capacitor Filesystem). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Text files (DXF, CSV, SVG …) ────────────────────────────────────────────

export async function downloadTextFile(content: string, filename: string): Promise<void> {
  if (isNative()) {
    await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: `حفظ أو فتح ${filename}` });
  } else {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    triggerBrowserDownload(blob, filename);
  }
}

// ─── CSV files (with UTF-8 BOM for Excel Arabic support) ─────────────────────

export async function downloadCSVFile(content: string, filename: string): Promise<void> {
  const withBOM = '\uFEFF' + content;
  if (isNative()) {
    await Filesystem.writeFile({
      path: filename,
      data: withBOM,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: `حفظ أو فتح ${filename}` });
  } else {
    const blob = new Blob([withBOM], { type: 'text/csv;charset=utf-8;' });
    triggerBrowserDownload(blob, filename);
  }
}

// ─── PDF via jsPDF instance ───────────────────────────────────────────────────

export async function savePDF(doc: jsPDF, filename: string): Promise<void> {
  if (isNative()) {
    const buffer = doc.output('arraybuffer');
    const base64 = arrayBufferToBase64(buffer);
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: `حفظ أو فتح ${filename}` });
  } else {
    doc.save(filename);
  }
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
