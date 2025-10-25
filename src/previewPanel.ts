import * as vscode from 'vscode';
import { parseToOps } from './parser';
import * as path from 'path';
import { parseBdf, BdfFont } from './bdf';
import { FontFetcher, extractU8g2FontNames } from './fontFetcher';

export class PreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly ctx: vscode.ExtensionContext;
  private readonly output: vscode.OutputChannel;
  private cachedFontKey: string | undefined;
  private cachedFont: BdfFont | undefined;
  private fontFetcher: FontFetcher | undefined;

  constructor(ctx: vscode.ExtensionContext, output: vscode.OutputChannel) {
    this.ctx = ctx;
    this.output = output;
  }

  get visible() { return !!this.panel; }

  show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'u8g2Preview',
      'U8g2 Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => { this.panel = undefined; });

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') {
        const ed = vscode.window.activeTextEditor;
        if (ed) this.updateFromText(ed.document);
      }
    });
  }

  async updateFromText(doc: vscode.TextDocument) {
    if (!this.panel) return;
    const cfg = vscode.workspace.getConfiguration('u8g2Preview');
    let width = cfg.get<number>('width') ?? 128;
    let height = cfg.get<number>('height') ?? 64;
    const scale = cfg.get<number>('scale') ?? 2;
    const invert = cfg.get<boolean>('invert') ?? false;
    const grid = cfg.get<boolean>('grid') ?? false;
    const textUseDrawColor = cfg.get<boolean>('font.useDrawColor') ?? true;

    const code = doc.getText();
    const hinted = this.extractSizeFromComments(code);
    if (hinted) {
      width = hinted.w; height = hinted.h;
      this.output.appendLine(`[hint] 娉ㄩ噴涓寚瀹氬昂瀵? ${width}x${height}`);
    }
    const t0 = Date.now();
    const { ops, stats, errors } = parseToOps(code, { width, height });
    const dt = Date.now() - t0;

    this.output.appendLine(`[瑙ｆ瀽] ops=${ops.length} lines=${stats.lines} defines=${stats.defines} consts=${stats.consts} in ${dt}ms`);
    if (errors.length) {
      for (const e of errors) this.output.appendLine(`[warn] ${e}`);
    }

    const fonts = await this.loadFontsMap(doc, code);
    this.panel.webview.postMessage({ type: 'render', payload: { width, height, scale, invert, grid, ops, fonts, textUseDrawColor } });
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'styles.css'));
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>U8g2 Preview</title>
  </head>
<body>
  <div class="toolbar">
    <div class="left">
      <button id="zoom-out" title="缩小">-</button>
      <button id="zoom-reset" title="重置到 100%">100%</button>
      <button id="zoom-in" title="放大">+</button>
      <button id="zoom-fit" title="适配视口">适配</button>
    </div>
    <span id="info" class="info"></span>
  </div>
  <div class="stage">
    <canvas id="screen"></canvas>
  </div>
  <script src="${scriptUri}"></script>
  </body>
  </html>`;
  }

  private extractSizeFromComments(code: string): { w: number; h: number } | undefined {
    const single: string[] = (code.match(/\/\/[^\n]*/g) ?? []) as unknown as string[];
    const block: string[] = (code.match(/\/\*[\s\S]*?\*\//g) ?? []) as unknown as string[];
    const texts: string[] = single.concat(block);
    const re = /\bsize\s*[:=]?\s*(\d+)\s*[xX脳]\s*(\d+)\b/;
    for (const t of texts) {
      const m = t.match(re);
      if (m) {
        const w = parseInt(m[1], 10);
        const h = parseInt(m[2], 10);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
      }
    }
    return undefined;
  }

  public extractSizeFromCommentsPublic(code: string): { w: number; h: number } | undefined {
    return this.extractSizeFromComments(code);
  }

  public postRender(payload: any) {
    this.panel?.webview.postMessage({ type: 'render', payload });
  }

  private async loadBdfFontIfConfigured(doc: vscode.TextDocument): Promise<BdfFont | undefined> {
    const cfg = vscode.workspace.getConfiguration('u8g2Preview');
    const p = (cfg.get<string>('font.bdfPath') || '').trim();
    if (!p) { this.cachedFont = undefined; this.cachedFontKey = undefined; return undefined; }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri;
    let uri: vscode.Uri;
    if (path.isAbsolute(p)) uri = vscode.Uri.file(p);
    else if (folder) uri = vscode.Uri.joinPath(folder, p);
    else uri = vscode.Uri.file(p);

    const key = uri.toString();
    if (this.cachedFont && this.cachedFontKey === key) return this.cachedFont;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(data).toString('utf8');
      const font = parseBdf(text);
      this.cachedFont = font; this.cachedFontKey = key;
      this.output.appendLine(`[font] 宸插姞杞?BDF 瀛椾綋: ${font.name}, lineHeight=${font.lineHeight}`);
      return font;
    } catch (e: any) {
      this.output.appendLine(`[font] 鍔犺浇澶辫触 ${p}: ${e?.message ?? e}`);
      this.cachedFont = undefined; this.cachedFontKey = undefined;
      return undefined;
    }
  }

  private async loadFontsMap(doc: vscode.TextDocument, code: string): Promise<Record<string, BdfFont>> {

    const cfg = vscode.workspace.getConfiguration('u8g2Preview');
    const map: Record<string, BdfFont> = {};
    const explicit = await this.loadBdfFontIfConfigured(doc);
    if (explicit) map['__explicit__'] = explicit;

    if (!this.fontFetcher) this.fontFetcher = new FontFetcher(this.ctx, this.output);
    const fonts = extractU8g2FontNames(code);
    for (const token of fonts) {
      const got = await this.fontFetcher.fetchIfNeeded(token, cfg);
      if (got) map[token] = got;
    }
    return map;
  }
}


