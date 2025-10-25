"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseToOps = parseToOps;
exports.evalExpr = evalExpr;
function parseToOps(code, opts) {
    const errors = [];
    const ops = [];
    const stats = { lines: 0, defines: 0, consts: 0 };
    const sym = new Map();
    sym.set('WIDTH', opts.width);
    sym.set('HEIGHT', opts.height);
    const lines = code.split(/\r?\n/);
    stats.lines = lines.length;
    for (const ln of lines) {
        const m = ln.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\s+([-+*/()%\w\. ]+)/);
        if (m) {
            const key = m[1];
            const val = evalExpr(m[2], sym, opts, errors);
            if (val !== undefined) {
                sym.set(key, val);
                stats.defines++;
            }
        }
    }
    for (const ln of lines) {
        const m = ln.match(/\b(?:const|constexpr)?\s*(?:int|long|float|double|auto)?\s*([A-Za-z_]\w*)\s*=\s*([^;]+);/);
        if (m) {
            const key = m[1];
            const val = evalExpr(m[2], sym, opts, errors);
            if (val !== undefined) {
                sym.set(key, val);
                stats.consts++;
            }
        }
    }
    const reCall = /([A-Za-z_]\w*(?:\.|::|_)?)*(drawPixel|drawLine|drawBox|drawFrame|drawCircle|drawDisc|drawStr|setDrawColor|setCursor|setFont|print|println|drawFastVLine|drawFastHLine|drawRect|fillRect)\s*\(([^)]*)\)/g;
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        let m;
        reCall.lastIndex = 0;
        while ((m = reCall.exec(ln))) {
            const fn = m[2];
            const args = splitArgs(m[3]).map(s => s.trim());
            try {
                switch (fn) {
                    case 'setDrawColor': {
                        const c = num(args[0]);
                        ops.push({ op: 'setDrawColor', c });
                        break;
                    }
                    case 'drawPixel': {
                        const [x, y] = [num(args[0]), num(args[1])];
                        ops.push({ op: 'drawPixel', x, y });
                        break;
                    }
                    case 'drawLine': {
                        const [x0, y0, x1, y1] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
                        ops.push({ op: 'drawLine', x0, y0, x1, y1 });
                        break;
                    }
                    case 'drawBox': {
                        const [x, y, w, h] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
                        ops.push({ op: 'drawBox', x, y, w, h });
                        break;
                    }
                    case 'drawFrame': {
                        const [x, y, w, h] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
                        ops.push({ op: 'drawFrame', x, y, w, h });
                        break;
                    }
                    case 'drawCircle': {
                        const [x, y, r] = [num(args[0]), num(args[1]), num(args[2])];
                        ops.push({ op: 'drawCircle', x, y, r });
                        break;
                    }
                    case 'drawDisc': {
                        const [x, y, r] = [num(args[0]), num(args[1]), num(args[2])];
                        ops.push({ op: 'drawDisc', x, y, r });
                        break;
                    }
                    case 'drawStr': {
                        const [x, y] = [num(args[0]), num(args[1])];
                        const text = str(args.slice(2).join(','));
                        ops.push({ op: 'drawStr', x, y, text });
                        break;
                    }
                    case 'setCursor': {
                        const [x, y] = [num(args[0]), num(args[1])];
                        ops.push({ op: 'setCursor', x, y });
                        break;
                    }
                    case 'setFont': {
                        const name = str(args[0]);
                        ops.push({ op: 'setFont', name });
                        break;
                    }
                    case 'print': {
                        const text = str(args.join(','));
                        ops.push({ op: 'print', text });
                        break;
                    }
                    case 'println': {
                        const text = str(args.join(','));
                        ops.push({ op: 'println', text });
                        break;
                    }
                    case 'drawFastVLine': {
                        const [x, y, h] = [num(args[0]), num(args[1]), num(args[2])];
                        ops.push({ op: 'gfxVLine', x, y, h });
                        break;
                    }
                    case 'drawFastHLine': {
                        const [x, y, w] = [num(args[0]), num(args[1]), num(args[2])];
                        ops.push({ op: 'gfxHLine', x, y, w });
                        break;
                    }
                    case 'drawRect': {
                        const [x, y, w, h] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
                        ops.push({ op: 'gfxRect', x, y, w, h });
                        break;
                    }
                    case 'fillRect': {
                        const [x, y, w, h] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
                        ops.push({ op: 'gfxFillRect', x, y, w, h });
                        break;
                    }
                }
            }
            catch (e) {
                errors.push(`绗?{i + 1}琛岃В鏋愬け璐? ${e?.message ?? e}`);
            }
        }
    }
    return { ops, stats, errors };
    function num(expr) {
        const v = evalExpr(expr, sym, opts, errors);
        if (v === undefined || Number.isNaN(v))
            throw new Error(`鏃犳硶姹傚€? ${expr}`);
        return v;
    }
    function str(expr) {
        const s = expr.trim();
        const m = s.match(/^\s*([\"'])(.*)\1\s*$/);
        if (m)
            return m[2];
        if (/^\w+$/.test(s)) {
            if (s === 'PvTime')
                return fmtTime();
            if (s === 'PvDate')
                return fmtDate();
        }
        const v = evalExpr(s, sym, opts, errors);
        if (v === undefined || Number.isNaN(v))
            return s;
        return String(v);
    }
    function fmtTime() {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    function fmtDate() {
        const d = new Date();
        const yyyy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
}
function evalExpr(expr, sym, opts, errors) {
    try {
        const replaced = expr
            .replace(/display\s*\.\s*width\s*\(\s*\)/g, String(opts.width))
            .replace(/display\s*\.\s*height\s*\(\s*\)/g, String(opts.height));
        const tokens = tokenize(replaced);
        const rpn = toRPN(tokens, sym);
        return evalRPN(rpn, sym);
    }
    catch (e) {
        errors.push(`姹傚€煎け璐? ${expr} -> ${e?.message ?? e}`);
        return undefined;
    }
}
function tokenize(s) {
    const toks = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (/[0-9]/.test(c)) {
            let j = i + 1;
            while (j < s.length && /[0-9\.]/.test(s[j]))
                j++;
            toks.push({ t: 'num', v: Number(s.slice(i, j)) });
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            let j = i + 1;
            while (j < s.length && /[A-Za-z0-9_]/.test(s[j]))
                j++;
            toks.push({ t: 'id', v: s.slice(i, j) });
            i = j;
            continue;
        }
        if (c === '+' || c === '-' || c === '*' || c === '/') {
            toks.push({ t: 'op', v: c });
            i++;
            continue;
        }
        if (c === '(') {
            toks.push({ t: 'lp' });
            i++;
            continue;
        }
        if (c === ')') {
            toks.push({ t: 'rp' });
            i++;
            continue;
        }
        i++;
    }
    return toks;
}
function toRPN(toks, sym) {
    const out = [];
    const st = [];
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
    for (const tk of toks) {
        if (tk.t === 'num' || tk.t === 'id')
            out.push(tk);
        else if (tk.t === 'op') {
            while (st.length && st[st.length - 1].t === 'op' && prec[st[st.length - 1].v] >= prec[tk.v]) {
                out.push(st.pop());
            }
            st.push(tk);
        }
        else if (tk.t === 'lp')
            st.push(tk);
        else if (tk.t === 'rp') {
            while (st.length && st[st.length - 1].t !== 'lp')
                out.push(st.pop());
            if (st.length && st[st.length - 1].t === 'lp')
                st.pop();
        }
    }
    while (st.length)
        out.push(st.pop());
    return out;
}
function evalRPN(rpn, sym) {
    const st = [];
    for (const tk of rpn) {
        if (tk.t === 'num')
            st.push(tk.v);
        else if (tk.t === 'id') {
            st.push(sym.get(tk.v) ?? NaN);
        }
        else if (tk.t === 'op') {
            const b = st.pop() ?? NaN;
            const a = st.pop() ?? NaN;
            switch (tk.v) {
                case '+':
                    st.push(a + b);
                    break;
                case '-':
                    st.push(a - b);
                    break;
                case '*':
                    st.push(a * b);
                    break;
                case '/':
                    st.push(b === 0 ? NaN : a / b);
                    break;
            }
        }
    }
    return st.pop() ?? NaN;
}
function splitArgs(argstr) {
    const res = [];
    let cur = '';
    let depth = 0;
    let inStr = null;
    for (let i = 0; i < argstr.length; i++) {
        const c = argstr[i];
        if (inStr) {
            cur += c;
            if (c === inStr && argstr[i - 1] !== '\\')
                inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            cur += c;
            continue;
        }
        if (c === '(') {
            depth++;
            cur += c;
            continue;
        }
        if (c === ')') {
            depth--;
            cur += c;
            continue;
        }
        if (c === ',' && depth === 0) {
            res.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim().length)
        res.push(cur);
    return res;
}
//# sourceMappingURL=parser.js.map