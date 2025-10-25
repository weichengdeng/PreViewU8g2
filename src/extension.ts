import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { parseToOps } from './parser';
import { ExecRunner } from './execRunner';
import { FontFetcher } from './fontFetcher';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('U8g2 Preview');

  const panel = new PreviewPanel(context, output);
  const runner = new ExecRunner(context, output);
  const fontFetcher = new FontFetcher(context, output);

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
    if (!ed) { void vscode.window.showWarningMessage('无活动编辑器'); return; }

    const cfg = vscode.workspace.getConfiguration('u8g2Preview');
    let width = cfg.get<number>('width') ?? 128;
    let height = cfg.get<number>('height') ?? 64;
    const hinted = panel.extractSizeFromCommentsPublic(ed.document.getText());
    if (hinted) { width = hinted.w; height = hinted.h; }
    const json = await runner.runActive(ed, width, height);
    if (json && panel.visible) {
      const scale = cfg.get<number>('scale') ?? 2;
      const invert = cfg.get<boolean>('invert') ?? false;
      const grid = cfg.get<boolean>('grid') ?? false;
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

  let debounceTimer: NodeJS.Timeout | undefined;
  const DEBOUNCE_MS = 120;
  const onDocChange = vscode.workspace.onDidChangeTextDocument((e) => {
    if (!vscode.window.activeTextEditor || e.document !== vscode.window.activeTextEditor.document) return;
    if (!panel.visible) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => panel.updateFromText(e.document), DEBOUNCE_MS);
  });
  const onDocSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!vscode.window.activeTextEditor || doc !== vscode.window.activeTextEditor.document) return;
    if (!panel.visible) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => panel.updateFromText(doc), DEBOUNCE_MS);
  });
  context.subscriptions.push(onDocChange, onDocSave);

  const cfg = vscode.workspace.getConfiguration('u8g2Preview');
  const glob = cfg.get<string>('sourceGlob');
  if (glob && vscode.workspace.workspaceFolders?.length) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${glob}`);
    watcher.onDidChange(uri => refreshActiveIfMatches(uri));
    watcher.onDidCreate(uri => refreshActiveIfMatches(uri));
    watcher.onDidDelete(uri => refreshActiveIfMatches(uri));
    context.subscriptions.push(watcher);
  }

  function refreshActiveIfMatches(_uri: vscode.Uri) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    if (!panel.visible) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => panel.updateFromText(ed.document), DEBOUNCE_MS);
  }

  output.appendLine('U8g2 Preview 已激活');
}

export function deactivate() {}

