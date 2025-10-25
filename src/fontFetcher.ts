import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseBdf, BdfFont } from './bdf';
import * as https from 'https';

export function extractU8g2FontNames(code: string): string[] {
  const names = new Set<string>();
  const re = /setFont\s*\(\s*(u8g2_font_[A-Za-z0-9_]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) names.add(m[1]);
  return Array.from(names);
}

export function candidatesFor(fontToken: string): string[] {

  const raw = fontToken.replace(/^u8g2_font_/, '');
  const parts = raw.split('_').filter(Boolean);
  const cands = new Set<string>();
  for (let k = parts.length; k >= 1; k--) {
    const name = parts.slice(0, k).join('_');
    pushName(name);
  }

  const base = parts.join('_');
  const mm = base.match(/^(.*?)[0-9]+$/);
  if (mm && mm[1]) pushName(mm[1]);

  if (/japanese\d?/i.test(base)) {
    const size = guessSizeFromName(base) || 16;
    cands.add(`unifont_japanese-${size}.bdf`);
    cands.add(`unifont_japanese1-${size}.bdf`);
    cands.add(`unifont_japanese2-${size}.bdf`);
    cands.add(`unifont_japanese3-${size}.bdf`);
  }

  return Array.from(cands);

  function pushName(name: string) {
    cands.add(`${name}.bdf`);
    cands.add(`${name.toLowerCase()}.bdf`);
    const xy = name.match(/^([A-Za-z]+)(\d+)x(\d+)$/);
    if (xy) {
      const hy = `${xy[1]}-${xy[2]}x${xy[3]}.bdf`;
      cands.add(hy);
      cands.add(hy.toLowerCase());
    }
  }
}

function guessSizeFromName(name: string): number | undefined {
  const pair = name.match(/(\d+)x(\d+)/i);
  if (pair) return Math.max(parseInt(pair[1], 10), parseInt(pair[2], 10));
  const nums = Array.from(name.matchAll(/(\d+)/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
  if (nums.length) return Math.max(...nums);
  return undefined;
}

export class FontFetcher {
  constructor(private ctx: vscode.ExtensionContext, private output: vscode.OutputChannel) {}

  private fontsDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.ctx.globalStorageUri, 'fonts');
  }

  async ensureCacheDir() {
    await vscode.workspace.fs.createDirectory(this.fontsDir());
  }

  async clearCache() {
    try { await vscode.workspace.fs.delete(this.fontsDir(), { recursive: true }); } catch {}
    await this.ensureCacheDir();
  }

  async fetchIfNeeded(fontToken: string, cfg: vscode.WorkspaceConfiguration): Promise<BdfFont | undefined> {
    await this.ensureCacheDir();
    const baseUrl = (cfg.get<string>('font.fetchBaseUrl') || '').replace(/\/$/, '');
    const limitMB = cfg.get<number>('font.cacheLimitMB') ?? 100;
    const dir = this.fontsDir();

    for (const cand of candidatesFor(fontToken)) {
      const furi = vscode.Uri.joinPath(dir, cand);
      try {
        const bin = await vscode.workspace.fs.readFile(furi);
        const text = Buffer.from(bin).toString('utf8');
        const font = parseBdf(text);
        this.output.appendLine(`[font] 命中缓存: ${cand}`);
        return font;
      } catch {}
    }

    const auto = cfg.get<boolean>('font.autoFetch') ?? true;
    if (!auto || !baseUrl) return undefined;
    for (const cand of candidatesFor(fontToken)) {
      const url = `${baseUrl}/${encodeURIComponent(cand)}`;
      try {
        const txt = await httpGetText(url);

        if (!/^STARTFONT/m.test(txt)) throw new Error('not a BDF');

        const furi = vscode.Uri.joinPath(dir, cand);
        await vscode.workspace.fs.writeFile(furi, Buffer.from(txt, 'utf8'));

        await this.trimCache(dir, (limitMB|0) * 1024 * 1024);
        const font = parseBdf(txt);
        this.output.appendLine(`[font] 已拉取: ${cand}`);
        return font;
      } catch (e: any) {
        this.output.appendLine(`[font] 拉取失败 ${url}: ${e?.message ?? e}`);
        continue;
      }
    }
    return undefined;
  }

  private async trimCache(dir: vscode.Uri, maxBytes: number) {
    try {
      const list = await vscode.workspace.fs.readDirectory(dir);
      const stats: { name: string; size: number; mtime: number }[] = [];
      for (const [name, type] of list) {
        if (type !== vscode.FileType.File) continue;
        const f = vscode.Uri.joinPath(dir, name);
        const s = fs.statSync(f.fsPath);
        stats.push({ name, size: s.size, mtime: s.mtimeMs });
      }
      let total = stats.reduce((a, b) => a + b.size, 0);
      if (total <= maxBytes) return;

      stats.sort((a, b) => a.mtime - b.mtime);
      for (const it of stats) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, it.name));
        total -= it.size;
        if (total <= maxBytes) break;
      }
    } catch {}
  }
}

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetText(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

