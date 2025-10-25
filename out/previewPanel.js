"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewPanel = void 0;
const vscode = __importStar(require("vscode"));
const parser_1 = require("./parser");
const path = __importStar(require("path"));
const bdf_1 = require("./bdf");
const fontFetcher_1 = require("./fontFetcher");
class PreviewPanel {
    constructor(ctx, output) {
        this.ctx = ctx;
        this.output = output;
    }
    get visible() { return !!this.panel; }
    show() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        this.panel = vscode.window.createWebviewPanel('u8g2Preview', 'U8g2 Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        this.panel.onDidDispose(() => { this.panel = undefined; });
        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'ready') {
                const ed = vscode.window.activeTextEditor;
                if (ed)
                    this.updateFromText(ed.document);
            }
        });
    }
    async updateFromText(doc) {
        if (!this.panel)
            return;
        const cfg = vscode.workspace.getConfiguration('u8g2Preview');
        let width = cfg.get('width') ?? 128;
        let height = cfg.get('height') ?? 64;
        const scale = cfg.get('scale') ?? 2;
        const invert = cfg.get('invert') ?? false;
        const grid = cfg.get('grid') ?? false;
        const textUseDrawColor = cfg.get('font.useDrawColor') ?? true;
        const code = doc.getText();
        const hinted = this.extractSizeFromComments(code);
        if (hinted) {
            width = hinted.w;
            height = hinted.h;
            this.output.appendLine(`[hint] 娉ㄩ噴涓寚瀹氬昂瀵? ${width}x${height}`);
        }
        const t0 = Date.now();
        const { ops, stats, errors } = (0, parser_1.parseToOps)(code, { width, height });
        const dt = Date.now() - t0;
        this.output.appendLine(`[瑙ｆ瀽] ops=${ops.length} lines=${stats.lines} defines=${stats.defines} consts=${stats.consts} in ${dt}ms`);
        if (errors.length) {
            for (const e of errors)
                this.output.appendLine(`[warn] ${e}`);
        }
        const fonts = await this.loadFontsMap(doc, code);
        this.panel.webview.postMessage({ type: 'render', payload: { width, height, scale, invert, grid, ops, fonts, textUseDrawColor } });
    }
    getHtml() {
        const webview = this.panel.webview;
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
    extractSizeFromComments(code) {
        const single = (code.match(/\/\/[^\n]*/g) ?? []);
        const block = (code.match(/\/\*[\s\S]*?\*\//g) ?? []);
        const texts = single.concat(block);
        const re = /\bsize\s*[:=]?\s*(\d+)\s*[xX脳]\s*(\d+)\b/;
        for (const t of texts) {
            const m = t.match(re);
            if (m) {
                const w = parseInt(m[1], 10);
                const h = parseInt(m[2], 10);
                if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
                    return { w, h };
            }
        }
        return undefined;
    }
    extractSizeFromCommentsPublic(code) {
        return this.extractSizeFromComments(code);
    }
    postRender(payload) {
        this.panel?.webview.postMessage({ type: 'render', payload });
    }
    async loadBdfFontIfConfigured(doc) {
        const cfg = vscode.workspace.getConfiguration('u8g2Preview');
        const p = (cfg.get('font.bdfPath') || '').trim();
        if (!p) {
            this.cachedFont = undefined;
            this.cachedFontKey = undefined;
            return undefined;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri;
        let uri;
        if (path.isAbsolute(p))
            uri = vscode.Uri.file(p);
        else if (folder)
            uri = vscode.Uri.joinPath(folder, p);
        else
            uri = vscode.Uri.file(p);
        const key = uri.toString();
        if (this.cachedFont && this.cachedFontKey === key)
            return this.cachedFont;
        try {
            const data = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(data).toString('utf8');
            const font = (0, bdf_1.parseBdf)(text);
            this.cachedFont = font;
            this.cachedFontKey = key;
            this.output.appendLine(`[font] 宸插姞杞?BDF 瀛椾綋: ${font.name}, lineHeight=${font.lineHeight}`);
            return font;
        }
        catch (e) {
            this.output.appendLine(`[font] 鍔犺浇澶辫触 ${p}: ${e?.message ?? e}`);
            this.cachedFont = undefined;
            this.cachedFontKey = undefined;
            return undefined;
        }
    }
    async loadFontsMap(doc, code) {
        const cfg = vscode.workspace.getConfiguration('u8g2Preview');
        const map = {};
        const explicit = await this.loadBdfFontIfConfigured(doc);
        if (explicit)
            map['__explicit__'] = explicit;
        if (!this.fontFetcher)
            this.fontFetcher = new fontFetcher_1.FontFetcher(this.ctx, this.output);
        const fonts = (0, fontFetcher_1.extractU8g2FontNames)(code);
        for (const token of fonts) {
            const got = await this.fontFetcher.fetchIfNeeded(token, cfg);
            if (got)
                map[token] = got;
        }
        return map;
    }
}
exports.PreviewPanel = PreviewPanel;
//# sourceMappingURL=previewPanel.js.map