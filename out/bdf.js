"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBdf = parseBdf;
function parseBdf(text) {
    const lines = text.split(/\r?\n/);
    let name = 'BDF';
    let ascent = 8, descent = 0, lineHeight = 8;
    const glyphs = {};
    let i = 0;
    const next = () => lines[i++];
    while (i < lines.length) {
        const line = next();
        if (!line)
            continue;
        if (line.startsWith('FONT '))
            name = line.slice(5).trim();
        if (line.startsWith('FONT_ASCENT'))
            ascent = parseInt(line.split(/\s+/)[1] || '8', 10);
        if (line.startsWith('FONT_DESCENT'))
            descent = parseInt(line.split(/\s+/)[1] || '0', 10);
        if (line.startsWith('CHARS ')) {
        }
        if (line.startsWith('STARTCHAR')) {
            let code = -1;
            let bbxW = 0, bbxH = 0, bbxX = 0, bbxY = 0;
            let dwidth = 0;
            while (i < lines.length) {
                const l = next();
                if (l.startsWith('ENCODING'))
                    code = parseInt(l.split(/\s+/)[1], 10);
                else if (l.startsWith('DWIDTH'))
                    dwidth = parseInt(l.split(/\s+/)[1], 10);
                else if (l.startsWith('BBX')) {
                    const parts = l.split(/\s+/);
                    bbxW = parseInt(parts[1], 10);
                    bbxH = parseInt(parts[2], 10);
                    bbxX = parseInt(parts[3], 10);
                    bbxY = parseInt(parts[4], 10);
                }
                else if (l.startsWith('BITMAP'))
                    break;
            }
            const rows = [];
            for (let r = 0; r < bbxH && i < lines.length; r++) {
                const hex = next().trim();
                const bits = hexToBits(hex, bbxW);
                rows.push(bits);
            }
            while (i < lines.length) {
                if (next().startsWith('ENDCHAR'))
                    break;
            }
            if (code >= 0) {
                glyphs[code] = { code, w: bbxW, h: bbxH, xoff: bbxX, yoff: bbxY, dwidth: dwidth || bbxW, rows };
            }
        }
    }
    lineHeight = ascent + descent || lineHeight;
    return { name, ascent, descent, lineHeight, glyphs };
}
function hexToBits(hex, width) {
    const n = parseInt(hex, 16);
    const bits = [];
    const totalBits = Math.max(width, Math.ceil(hex.length * 4));
    for (let i = totalBits - 1; i >= 0; i--) {
        bits.push((n >> i) & 1);
    }
    if (bits.length > width) {
        return bits.slice(0, width);
    }
    while (bits.length < width)
        bits.push(0);
    return bits;
}
//# sourceMappingURL=bdf.js.map