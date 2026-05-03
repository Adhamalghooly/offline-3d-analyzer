import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Toast } from '@capacitor/toast';

const isNative = () => Capacitor.isNativePlatform();

async function showToast(text: string) {
  if (isNative()) {
    try {
      await Toast.show({ text, duration: 'long' });
    } catch {
      console.warn('Toast failed:', text);
    }
  }
}

async function requestStoragePermission(): Promise<boolean> {
  try {
    const { Filesystem: FS } = await import('@capacitor/filesystem');
    const perm = await FS.requestPermissions();
    return perm.publicStorage === 'granted';
  } catch {
    return true;
  }
}

export async function downloadText(filename: string, content: string, mimeType = 'text/plain'): Promise<void> {
  if (!isNative()) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  try {
    await requestStoragePermission();

    const result = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: `حفظ ${filename}`,
    });
  } catch (err: any) {
    console.error('Capacitor file save error:', err);
    await showToast(`حدث خطأ أثناء حفظ الملف: ${err?.message || ''}`);
  }
}

export async function downloadTextWithBOM(filename: string, content: string): Promise<void> {
  return downloadText(filename, '\uFEFF' + content, 'text/csv;charset=utf-8;');
}

export async function downloadBase64(filename: string, base64Data: string, mimeType = 'application/octet-stream'): Promise<void> {
  if (!isNative()) {
    const byteChars = atob(base64Data);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  try {
    await requestStoragePermission();

    const result = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: `حفظ ${filename}`,
    });
  } catch (err: any) {
    console.error('Capacitor base64 save error:', err);
    await showToast(`حدث خطأ أثناء حفظ الملف: ${err?.message || ''}`);
  }
}

export async function downloadDXF(content: string, filename: string): Promise<void> {
  return downloadText(filename, content, 'application/dxf');
}

export async function downloadCSV(filename: string, content: string): Promise<void> {
  return downloadTextWithBOM(filename, content);
}

export async function downloadJsPDF(doc: any, filename: string): Promise<void> {
  if (!isNative()) {
    doc.save(filename);
    return;
  }
  try {
    await requestStoragePermission();

    const base64 = doc.output('datauristring').split(',')[1];
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: `حفظ ${filename}`,
    });
  } catch (err: any) {
    console.error('PDF save error:', err);
    await showToast(`حدث خطأ أثناء حفظ PDF: ${err?.message || ''}`);
  }
}

export async function openHTMLForPrint(htmlContent: string, jobName = 'اللوحات الإنشائية'): Promise<void> {
  if (!isNative()) {
    const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, '_blank');
    if (w) {
      w.addEventListener('load', () => {
        setTimeout(() => {
          w.print();
          URL.revokeObjectURL(blobUrl);
        }, 800);
      });
    }
    return;
  }

  try {
    const { PrintPlugin } = await import('@/lib/printPlugin');
    await PrintPlugin.printHTML({ html: htmlContent, jobName });
  } catch (err: any) {
    console.error('Android print error:', err);
    await showToast('جاري فتح مربع حوار الطباعة...');
    // Fallback: save as HTML file and share so user can print
    try {
      const filename = `sheets_${Date.now()}.html`;
      const result = await Filesystem.writeFile({
        path: filename,
        data: htmlContent,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await Share.share({
        title: jobName,
        url: result.uri,
        dialogTitle: 'حفظ أو فتح اللوحات للطباعة',
      });
    } catch (e2: any) {
      await showToast('حدث خطأ أثناء تصدير اللوحات للطباعة');
    }
  }
}
