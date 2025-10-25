(() => {
  const vscode = acquireVsCodeApi?.();
  const canvas = document.getElementById('screen');
  const info = document.getElementById('info');
  const stage = document.querySelector('.stage');
  const ctx = canvas.getContext('2d');
  let viewZoom = 1;
  let fit = false;
  let currentFont = null; // { lineHeight, ascent, glyphs }
  let currentFontName = null;
  let currentFontPx = 7; // 回退系统字体像素高度估计
  let fonts = {}; // token -> BdfFont

  window.addEventListener('message', (evt) => {
    const msg = evt.data;
    if (msg?.type === 'render') {
      render(msg.payload);
    }
  });

  vscode?.postMessage({ type: 'ready' });

  function render(payload) {
    const { width, height, scale, invert, grid, ops, fonts: payloadFonts, font, textUseDrawColor } = payload;
    fonts = payloadFonts || {};
    if (font && !payloadFonts) { fonts['__explicit__'] = font; }

    const firstKey = Object.keys(fonts)[0];
    currentFont = firstKey ? fonts[firstKey] : (font || null);
    currentFontName = firstKey || (font ? '__explicit__' : null);
    if (!currentFont && currentFontName) currentFontPx = guessPx(currentFontName) || currentFontPx;
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.imageSmoothingEnabled = false;
    const bg = invert ? '#000' : '#fff';
    const fg = invert ? '#fff' : '#000';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;

    let curX = 0, curY = 8; // for print/println: top baseline fallback

    if (grid && scale >= 2) {
      ctx.save();
      ctx.strokeStyle = invert ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * scale + 0.5, 0);
        ctx.lineTo(x * scale + 0.5, height * scale);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * scale + 0.5);
        ctx.lineTo(width * scale, y * scale + 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    ctx.font = `${(currentFontPx||7)*scale}px monospace`;
    ctx.textBaseline = 'top';

    for (const op of ops) {
      switch (op.op) {
        case 'setDrawColor': {
          ctx.fillStyle = ctx.strokeStyle = (op.c ? fg : bg);
          break;
        }
        case 'drawPixel': {
          fillPx(op.x, op.y);
          break;
        }
        case 'drawLine':
        case 'gfxLine': {
          line(op.x0, op.y0, op.x1, op.y1);
          break;
        }
        case 'drawBox':
        case 'gfxFillRect': {
          rect(op.x, op.y, op.w, op.h, true);
          break;
        }
        case 'drawFrame':
        case 'gfxRect': {
          rect(op.x, op.y, op.w, op.h, false);
          break;
        }
        case 'drawCircle':
        case 'drawDisc': {
          circle(op.x, op.y, op.r, op.op === 'drawDisc');
          break;
        }
        case 'drawStr': {
          drawText(op.x, op.y, op.text);
          break;
        }
        case 'setFont': {
          const f = fonts?.[op.name] || fonts?.['__explicit__'];
          if (f) {
            currentFont = f; currentFontName = op.name;
          } else {
            currentFont = null; currentFontName = op.name; currentFontPx = guessPx(op.name) || currentFontPx;
            ctx.font = `${(currentFontPx||7)*scale}px monospace`;
          }
          break;
        }
        case 'setCursor': {
          curX = op.x; curY = op.y; break;
        }
        case 'print': {
          const adv = drawText(curX, curY, op.text);
          curX += (typeof adv === 'number' ? adv : ((op.text?.length ?? 0) * 6));
          break;
        }
        case 'println': {
          const adv = drawText(curX, curY, op.text);
          curX = 0; curY += (currentFont?.lineHeight || 8); // next line
          break;
        }
        case 'gfxVLine': {
          rect(op.x, op.y, 1, op.h, true); break;
        }
        case 'gfxHLine': {
          rect(op.x, op.y, op.w, 1, true); break;
        }
      }
    }

    applyZoom();
    const fontInfo = currentFontName ? ` font:${currentFontName}${currentFont? '' : `(${currentFontPx}px)`}` : '';
    info.textContent = `${width}x${height} @x${scale} ops:${ops.length} zoom:${Math.round(viewZoom*100)}%${fit? ' (适配)':''}${fontInfo}`;

    function fillPx(x, y) {
      ctx.fillRect(Math.round(x*scale), Math.round(y*scale), scale, scale);
    }
    function rect(x, y, w, h, fill) {
      if (fill) ctx.fillRect(Math.round(x*scale), Math.round(y*scale), Math.round(w*scale), Math.round(h*scale));
      else ctx.strokeRect(Math.round(x*scale)+0.5, Math.round(y*scale)+0.5, Math.round(w*scale), Math.round(h*scale));
    }
    function line(x0, y0, x1, y1) {
      ctx.beginPath();
      ctx.moveTo(x0*scale+0.5, y0*scale+0.5);
      ctx.lineTo(x1*scale+0.5, y1*scale+0.5);
      ctx.stroke();
    }
    function circle(x, y, r, fill) {
      ctx.beginPath();
      ctx.arc(x*scale, y*scale, r*scale, 0, Math.PI*2);
      if (fill) ctx.fill(); else ctx.stroke();
    }
    function drawText(x, y, text) {
      text = String(text ?? '');
      if (currentFont && currentFont.glyphs) {
        const prev = ctx.fillStyle;
        if (textUseDrawColor === false) ctx.fillStyle = fg; // 强制前景色
        const adv = drawTextBitmap(x, y, text);
        ctx.fillStyle = prev;
        return adv;
      }

      const prev = ctx.fillStyle;
      if (textUseDrawColor === false) ctx.fillStyle = fg;
      ctx.fillText(text, Math.round(x*scale), Math.round(y*scale));
      ctx.fillStyle = prev;

      const m = ctx.measureText(text);
      return Math.round(m.width / scale);
    }

    function drawTextBitmap(x, y, text) {
      const useDrawColor = true; // color handled by caller; drawColor 已应用到 fillStyle

      const font = currentFont;
      const lh = font.lineHeight || 8; // 行高
      const ascent = font.ascent || 7;
      let penX = x;
      for (const ch of text) {
        const code = ch.codePointAt(0);
        const g = font.glyphs[code];
        if (!g) { penX += 6; continue; }
        const gx = Math.round((penX + g.xoff) * scale);
        const gy = Math.round((y - ascent - g.yoff) * scale); // 近似：基线到像素起点
        for (let row = 0; row < g.h; row++) {
          const bits = g.rows[row];
          for (let col = 0; col < g.w; col++) {
            if (bits[col]) ctx.fillRect(gx + col*scale, gy + row*scale, scale, scale);
          }
        }
        penX += (g.dwidth || g.w);
      }
      return penX - x;
    }

    function guessPx(name) {

      if (!name) return 7;
      const nums = Array.from(String(name).matchAll(/(\d+)/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
      if (nums.length === 0) return 7;

      const xPair = String(name).match(/(\d+)x(\d+)/i);
      if (xPair) {
        const a = parseInt(xPair[1], 10), b = parseInt(xPair[2], 10);
        return Math.max(a, b) || (nums[0] || 7);
      }
      return Math.max(...nums) || nums[0] || 7;
    }
  }

  const btnOut = document.getElementById('zoom-out');
  const btnIn = document.getElementById('zoom-in');
  const btnReset = document.getElementById('zoom-reset');
  const btnFit = document.getElementById('zoom-fit');
  btnOut?.addEventListener('click', () => { fit = false; setZoom(viewZoom/1.1); });
  btnIn?.addEventListener('click', () => { fit = false; setZoom(viewZoom*1.1); });
  btnReset?.addEventListener('click', () => { fit = false; setZoom(1); });
  btnFit?.addEventListener('click', () => { fit = !fit; applyZoom(); });

  stage?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault(); fit = false;
    const delta = Math.sign(e.deltaY);
    setZoom(viewZoom * (delta > 0 ? 1/1.1 : 1.1));
  }, { passive: false });

  window.addEventListener('resize', () => { if (fit) applyZoom(); });

  function setZoom(z) {
    viewZoom = Math.min(8, Math.max(0.25, z));
    applyZoom();
  }
  function applyZoom() {
    if (!canvas) return;
    if (fit && stage) {
      const pad = 24; // 边距
      const zw = (stage.clientWidth - pad) / canvas.width;
      const zh = (stage.clientHeight - pad) / canvas.height;
      viewZoom = Math.max(0.1, Math.min(8, Math.min(zw, zh)));
    }
    canvas.style.transform = `scale(${viewZoom})`;
  }
})();

