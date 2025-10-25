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
exports.FontFetcher = void 0;
exports.extractU8g2FontNames = extractU8g2FontNames;
exports.candidatesFor = candidatesFor;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const bdf_1 = require("./bdf");
const https = __importStar(require("https"));
function extractU8g2FontNames(code) {
    const names = new Set();
    const re = /setFont\s*\(\s*(u8g2_font_[A-Za-z0-9_]+)\s*\)/g;
    let m;
    while ((m = re.exec(code)))
        names.add(m[1]);
    return Array.from(names);
}
function candidatesFor(fontToken) {
    const raw = fontToken.replace(/^u8g2_font_/, '');
    const parts = raw.split('_').filter(Boolean);
    const cands = new Set();
    for (let k = parts.length; k >= 1; k--) {
        const name = parts.slice(0, k).join('_');
        pushName(name);
    }
    const base = parts.join('_');
    const mm = base.match(/^(.*?)[0-9]+$/);
    if (mm && mm[1])
        pushName(mm[1]);
    if (/japanese\d?/i.test(base)) {
        const size = guessSizeFromName(base) || 16;
        cands.add(`unifont_japanese-${size}.bdf`);
        cands.add(`unifont_japanese1-${size}.bdf`);
        cands.add(`unifont_japanese2-${size}.bdf`);
        cands.add(`unifont_japanese3-${size}.bdf`);
    }
    return Array.from(cands);
    function pushName(name) {
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
function guessSizeFromName(name) {
    const pair = name.match(/(\d+)x(\d+)/i);
    if (pair)
        return Math.max(parseInt(pair[1], 10), parseInt(pair[2], 10));
    const nums = Array.from(name.matchAll(/(\d+)/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
    if (nums.length)
        return Math.max(...nums);
    return undefined;
}
class FontFetcher {
    constructor(ctx, output) {
        this.ctx = ctx;
        this.output = output;
    }
    fontsDir() {
        return vscode.Uri.joinPath(this.ctx.globalStorageUri, 'fonts');
    }
    async ensureCacheDir() {
        await vscode.workspace.fs.createDirectory(this.fontsDir());
    }
    async clearCache() {
        try {
            await vscode.workspace.fs.delete(this.fontsDir(), { recursive: true });
        }
        catch { }
        await this.ensureCacheDir();
    }
    async fetchIfNeeded(fontToken, cfg) {
        await this.ensureCacheDir();
        const baseUrl = (cfg.get('font.fetchBaseUrl') || '').replace(/\/$/, '');
        const limitMB = cfg.get('font.cacheLimitMB') ?? 100;
        const dir = this.fontsDir();
        for (const cand of candidatesFor(fontToken)) {
            const furi = vscode.Uri.joinPath(dir, cand);
            try {
                const bin = await vscode.workspace.fs.readFile(furi);
                const text = Buffer.from(bin).toString('utf8');
                const font = (0, bdf_1.parseBdf)(text);
                this.output.appendLine(`[font] 命中缓存: ${cand}`);
                return font;
            }
            catch { }
        }
        const auto = cfg.get('font.autoFetch') ?? true;
        if (!auto || !baseUrl)
            return undefined;
        for (const cand of candidatesFor(fontToken)) {
            const url = `${baseUrl}/${encodeURIComponent(cand)}`;
            try {
                const txt = await httpGetText(url);
                if (!/^STARTFONT/m.test(txt))
                    throw new Error('not a BDF');
                const furi = vscode.Uri.joinPath(dir, cand);
                await vscode.workspace.fs.writeFile(furi, Buffer.from(txt, 'utf8'));
                await this.trimCache(dir, (limitMB | 0) * 1024 * 1024);
                const font = (0, bdf_1.parseBdf)(txt);
                this.output.appendLine(`[font] 已拉取: ${cand}`);
                return font;
            }
            catch (e) {
                this.output.appendLine(`[font] 拉取失败 ${url}: ${e?.message ?? e}`);
                continue;
            }
        }
        return undefined;
    }
    async trimCache(dir, maxBytes) {
        try {
            const list = await vscode.workspace.fs.readDirectory(dir);
            const stats = [];
            for (const [name, type] of list) {
                if (type !== vscode.FileType.File)
                    continue;
                const f = vscode.Uri.joinPath(dir, name);
                const s = fs.statSync(f.fsPath);
                stats.push({ name, size: s.size, mtime: s.mtimeMs });
            }
            let total = stats.reduce((a, b) => a + b.size, 0);
            if (total <= maxBytes)
                return;
            stats.sort((a, b) => a.mtime - b.mtime);
            for (const it of stats) {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, it.name));
                total -= it.size;
                if (total <= maxBytes)
                    break;
            }
        }
        catch { }
    }
}
exports.FontFetcher = FontFetcher;
function httpGetText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(httpGetText(res.headers.location));
            }
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}
//# sourceMappingURL=fontFetcher.js.map