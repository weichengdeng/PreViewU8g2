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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const previewPanel_1 = require("./previewPanel");
const execRunner_1 = require("./execRunner");
const fontFetcher_1 = require("./fontFetcher");
function activate(context) {
    const output = vscode.window.createOutputChannel('U8g2 Preview');
    const panel = new previewPanel_1.PreviewPanel(context, output);
    const runner = new execRunner_1.ExecRunner(context, output);
    const fontFetcher = new fontFetcher_1.FontFetcher(context, output);
    const openCmd = vscode.commands.registerCommand('u8g2Preview.openPreview', () => {
        panel.show();
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            panel.updateFromText(editor.document);
        }
    });
    context.subscriptions.push(openCmd);
    const runCmd = vscode.commands.registerCommand('u8g2Preview.runExecute', async () => {
        panel.show();
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            void vscode.window.showWarningMessage('无活动编辑器');
            return;
        }
        const cfg = vscode.workspace.getConfiguration('u8g2Preview');
        let width = cfg.get('width') ?? 128;
        let height = cfg.get('height') ?? 64;
        const hinted = panel.extractSizeFromCommentsPublic(ed.document.getText());
        if (hinted) {
            width = hinted.w;
            height = hinted.h;
        }
        const json = await runner.runActive(ed, width, height);
        if (json && panel.visible) {
            const scale = cfg.get('scale') ?? 2;
            const invert = cfg.get('invert') ?? false;
            const grid = cfg.get('grid') ?? false;
            panel.postRender({ width: json.width ?? width, height: json.height ?? height, scale, invert, grid, ops: json.ops ?? [] });
        }
    });
    context.subscriptions.push(runCmd);
    const refreshFonts = vscode.commands.registerCommand('u8g2Preview.fonts.refresh', async () => {
        await fontFetcher.clearCache();
        output.appendLine('[font] 字体缓存已清空');
        void vscode.window.showInformationMessage('U8g2 字体缓存已清空');
    });
    context.subscriptions.push(refreshFonts);
    const statusBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBtn.text = '$(preview) U8g2 Preview';
    statusBtn.tooltip = '打开 U8g2 预览';
    statusBtn.command = 'u8g2Preview.openPreview';
    statusBtn.show();
    context.subscriptions.push(statusBtn);
    let debounceTimer;
    const DEBOUNCE_MS = 120;
    const onDocChange = vscode.workspace.onDidChangeTextDocument((e) => {
        if (!vscode.window.activeTextEditor || e.document !== vscode.window.activeTextEditor.document)
            return;
        if (!panel.visible)
            return;
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => panel.updateFromText(e.document), DEBOUNCE_MS);
    });
    const onDocSave = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!vscode.window.activeTextEditor || doc !== vscode.window.activeTextEditor.document)
            return;
        if (!panel.visible)
            return;
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => panel.updateFromText(doc), DEBOUNCE_MS);
    });
    context.subscriptions.push(onDocChange, onDocSave);
    const cfg = vscode.workspace.getConfiguration('u8g2Preview');
    const glob = cfg.get('sourceGlob');
    if (glob && vscode.workspace.workspaceFolders?.length) {
        const watcher = vscode.workspace.createFileSystemWatcher(`**/${glob}`);
        watcher.onDidChange(uri => refreshActiveIfMatches(uri));
        watcher.onDidCreate(uri => refreshActiveIfMatches(uri));
        watcher.onDidDelete(uri => refreshActiveIfMatches(uri));
        context.subscriptions.push(watcher);
    }
    function refreshActiveIfMatches(_uri) {
        const ed = vscode.window.activeTextEditor;
        if (!ed)
            return;
        if (!panel.visible)
            return;
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => panel.updateFromText(ed.document), DEBOUNCE_MS);
    }
    output.appendLine('U8g2 Preview 已激活');
}
function deactivate() { }
//# sourceMappingURL=extension.js.map