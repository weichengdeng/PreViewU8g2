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
exports.ExecRunner = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs_1 = require("fs");
function execFile(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        const child = cp.spawn(cmd, args, { shell: false, ...opts });
        let out = '';
        let err = '';
        child.stdout?.on('data', d => { out += d.toString(); });
        child.stderr?.on('data', d => { err += d.toString(); });
        child.on('close', code => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
}
class ExecRunner {
    constructor(ctx, output) {
        this.ctx = ctx;
        this.output = output;
    }
    async runActive(editor, width, height) {
        const cfg = vscode.workspace.getConfiguration('u8g2Preview');
        const compiler = (cfg.get('exec.compiler') || 'zig');
        const compilerPath = (cfg.get('exec.compilerPath') || '').trim();
        const entrySymbol = (cfg.get('exec.entrySymbol') || 'preview_entry');
        const storage = this.ctx.globalStorageUri.fsPath;
        await fs_1.promises.mkdir(storage, { recursive: true });
        const work = path.join(storage, 'runner');
        await fs_1.promises.mkdir(work, { recursive: true });
        const userFile = editor.document.fileName;
        const shim = path.join(work, 'shim.hpp');
        const wrapper = path.join(work, 'build.cpp');
        const exe = path.join(work, process.platform === 'win32' ? 'preview.exe' : 'preview');
        await fs_1.promises.writeFile(shim, SHIM_HPP, 'utf8');
        const wrapperSrc = WRAPPER_CPP
            .replace(/__USER_FILE__/g, userFile.replace(/\\/g, '\\\\'))
            .replace(/__ENTRY__/g, entrySymbol)
            .replace(/__WIDTH__/g, String(width))
            .replace(/__HEIGHT__/g, String(height));
        await fs_1.promises.writeFile(wrapper, wrapperSrc, 'utf8');
        if (compiler === 'zig') {
            const zig = compilerPath || 'zig';
            const args = ['c++', '-std=c++17', '-O0', '-I', work, wrapper, '-o', exe];
            this.output.appendLine(`[exec] ${zig} ${args.join(' ')}`);
            const { code, stderr } = await execFile(zig, args);
            if (code !== 0) {
                this.output.appendLine(`[exec] 编译失败: ${stderr}`);
                void vscode.window.showErrorMessage('编译失败（zig）');
                return undefined;
            }
        }
        else if (compiler === 'tcc') {
            const tcc = compilerPath || 'tcc';
            const args = ['-std=c99', '-O0', '-I', work, wrapper, '-o', exe];
            this.output.appendLine(`[exec] ${tcc} ${args.join(' ')}`);
            const { code, stderr } = await execFile(tcc, args);
            if (code !== 0) {
                this.output.appendLine(`[exec] 编译失败: ${stderr}`);
                void vscode.window.showErrorMessage('编译失败（tcc）');
                return undefined;
            }
        }
        const run = await execFile(exe, [], { cwd: work });
        if (run.code !== 0) {
            this.output.appendLine(`[exec] 运行失败: ${run.stderr}`);
            void vscode.window.showErrorMessage('运行失败');
            return undefined;
        }
        try {
            const json = JSON.parse(run.stdout);
            return json;
        }
        catch (e) {
            this.output.appendLine(`[exec] 输出解析失败: ${e?.message ?? e}`);
            return undefined;
        }
    }
}
exports.ExecRunner = ExecRunner;
const SHIM_HPP = String.raw `
#pragma once
#include <vector>
#include <string>
#include <cstdio>

struct Op {
  enum Kind {
    SetDrawColor, Pixel, Line, Box, Frame, Circle, Disc, Str, SetCursor, Print, Println,
    GfxV, GfxH, GfxLine, GfxRect, GfxFillRect
  } kind;
  int a,b,c,d,e; // generic ints
  std::string s;
};

struct Preview {
  int width;
  int height;
  int drawColor = 1;
  int cursorX = 0, cursorY = 0;
  std::vector<Op> ops;
  explicit Preview(int w, int h): width(w), height(h) {}

  void setDrawColor(int c){ drawColor = c; Op o{Op::SetDrawColor}; o.a=c; ops.push_back(o);} 
  void drawPixel(int x,int y){ Op o{Op::Pixel}; o.a=x;o.b=y; ops.push_back(o);} 
  void drawLine(int x0,int y0,int x1,int y1){ Op o{Op::Line}; o.a=x0;o.b=y0;o.c=x1;o.d=y1; ops.push_back(o);} 
  void drawBox(int x,int y,int w,int h){ Op o{Op::Box}; o.a=x;o.b=y;o.c=w;o.d=h; ops.push_back(o);} 
  void drawFrame(int x,int y,int w,int h){ Op o{Op::Frame}; o.a=x;o.b=y;o.c=w;o.d=h; ops.push_back(o);} 
  void drawCircle(int x,int y,int r){ Op o{Op::Circle}; o.a=x;o.b=y;o.c=r; ops.push_back(o);} 
  void drawDisc(int x,int y,int r){ Op o{Op::Disc}; o.a=x;o.b=y;o.c=r; ops.push_back(o);} 
  void drawStr(int x,int y,const char* t){ Op o{Op::Str}; o.a=x;o.b=y;o.s=t; ops.push_back(o);} 
  void setCursor(int x,int y){ cursorX=x; cursorY=y; Op o{Op::SetCursor}; o.a=x;o.b=y; ops.push_back(o);} 
  void print(const char* t){ Op o{Op::Print}; o.s=t; ops.push_back(o);} 
  void println(const char* t){ Op o{Op::Println}; o.s=t; ops.push_back(o);} 
  void drawFastVLine(int x,int y,int h){ Op o{Op::GfxV}; o.a=x;o.b=y;o.c=h; ops.push_back(o);} 
  void drawFastHLine(int x,int y,int w){ Op o{Op::GfxH}; o.a=x;o.b=y;o.c=w; ops.push_back(o);} 
  void drawRect(int x,int y,int w,int h){ Op o{Op::GfxRect}; o.a=x;o.b=y;o.c=w;o.d=h; ops.push_back(o);} 
  void fillRect(int x,int y,int w,int h){ Op o{Op::GfxFillRect}; o.a=x;o.b=y;o.c=w;o.d=h; ops.push_back(o);} 
};

static inline void dump_json(const Preview& p){
  std::printf("{\"width\":%d,\"height\":%d,\"ops\":[", p.width, p.height);
  bool first=true;
  auto emit = [&](const char* name){ if(!first) std::printf(","); first=false; std::printf("{\"op\":\"%s\"", name); };
  for (const auto& o: p.ops){
    switch(o.kind){
      case Op::SetDrawColor: emit("setDrawColor"); std::printf(",\"c\":%d}", o.a); break;
      case Op::Pixel: emit("drawPixel"); std::printf(",\"x\":%d,\"y\":%d}", o.a,o.b); break;
      case Op::Line: emit("drawLine"); std::printf(",\"x0\":%d,\"y0\":%d,\"x1\":%d,\"y1\":%d}", o.a,o.b,o.c,o.d); break;
      case Op::Box: emit("drawBox"); std::printf(",\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", o.a,o.b,o.c,o.d); break;
      case Op::Frame: emit("drawFrame"); std::printf(",\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", o.a,o.b,o.c,o.d); break;
      case Op::Circle: emit("drawCircle"); std::printf(",\"x\":%d,\"y\":%d,\"r\":%d}", o.a,o.b,o.c); break;
      case Op::Disc: emit("drawDisc"); std::printf(",\"x\":%d,\"y\":%d,\"r\":%d}", o.a,o.b,o.c); break;
      case Op::Str: emit("drawStr"); std::printf(",\"x\":%d,\"y\":%d,\"text\":\"", o.a,o.b); for(char c: o.s){ if(c=='"'||c=='\\') std::printf("\\"); std::printf("%c", c);} std::printf("\"}"); break;
      case Op::SetCursor: emit("setCursor"); std::printf(",\"x\":%d,\"y\":%d}", o.a,o.b); break;
      case Op::Print: emit("print"); std::printf(",\"text\":\"", o.a); for(char c: o.s){ if(c=='"'||c=='\\') std::printf("\\"); std::printf("%c", c);} std::printf("\"}"); break;
      case Op::Println: emit("println"); std::printf(",\"text\":\"", o.a); for(char c: o.s){ if(c=='"'||c=='\\') std::printf("\\"); std::printf("%c", c);} std::printf("\"}"); break;
      case Op::GfxV: emit("gfxVLine"); std::printf(",\"x\":%d,\"y\":%d,\"h\":%d}", o.a,o.b,o.c); break;
      case Op::GfxH: emit("gfxHLine"); std::printf(",\"x\":%d,\"y\":%d,\"w\":%d}", o.a,o.b,o.c); break;
      case Op::GfxLine: emit("gfxLine"); std::printf(",\"x0\":%d,\"y0\":%d,\"x1\":%d,\"y1\":%d}", o.a,o.b,o.c,o.d); break;
      case Op::GfxRect: emit("gfxRect"); std::printf(",\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", o.a,o.b,o.c,o.d); break;
      case Op::GfxFillRect: emit("gfxFillRect"); std::printf(",\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", o.a,o.b,o.c,o.d); break;
    }
  }
  std::printf("]}");
}
`;
const WRAPPER_CPP = String.raw `
#include "shim.hpp"
#ifndef U8G2_WIDTH
#define U8G2_WIDTH __WIDTH__
#endif
#ifndef U8G2_HEIGHT
#define U8G2_HEIGHT __HEIGHT__
#endif

#include "__USER_FILE__"

int main(){
  Preview p(U8G2_WIDTH, U8G2_HEIGHT);
  __ENTRY__(p);
  dump_json(p);
  return 0;
}
`;
//# sourceMappingURL=execRunner.js.map