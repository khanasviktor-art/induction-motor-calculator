/* ============================================================
   Лёгкий графический движок на canvas (без внешних библиотек)
   ============================================================ */
(function (root) {
  'use strict';

  const FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const FONT_UI = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  const THEMES = {
    dark: {
      grid: 'rgba(255,255,255,0.055)', gridStrong: 'rgba(255,255,255,0.10)',
      axis: 'rgba(255,255,255,0.16)', text: '#8fa0b8', textBright: '#c8d4e4',
      tooltipBg: 'rgba(12,17,25,0.94)', tooltipBorder: 'rgba(255,255,255,0.14)',
      refLine: 'rgba(255,180,84,0.5)', refText: 'rgba(255,180,84,0.8)',
      panel: '#0f1620'
    },
    light: {
      grid: 'rgba(15,25,40,0.07)', gridStrong: 'rgba(15,25,40,0.13)',
      axis: 'rgba(15,25,40,0.22)', text: '#5b6b7f', textBright: '#1b2735',
      tooltipBg: 'rgba(255,255,255,0.97)', tooltipBorder: 'rgba(15,25,40,0.14)',
      refLine: 'rgba(181,115,15,0.55)', refText: 'rgba(150,95,10,0.9)',
      panel: '#ffffff'
    }
  };
  let THEME = THEMES.dark;
  function setChartTheme(t) { THEME = THEMES[t] || THEMES.dark; }

  function niceStep(span, target) {
    if (!(span > 0)) span = 1;
    const raw = span / Math.max(target, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let mult;
    if (norm <= 1) mult = 1;
    else if (norm <= 2) mult = 2;
    else if (norm <= 2.5) mult = 2.5;
    else if (norm <= 5) mult = 5;
    else mult = 10;
    return mult * mag;
  }

  function fmtNum(v, step) {
    if (Math.abs(v) < 1e-9) return '0';
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    const out = v.toFixed(dec);
    return out === '-0' || out === '-0.0' ? '0' : out;
  }

  class Chart {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({
        xLabel: '', yLabel: '', y2Label: '', legend: true,
        xTicks: 6, yTicks: 5, pad: { l: 56, r: 54, t: 36, b: 36 },
        xFmt: null, yFmt: null, y2Fmt: null,
        hLines: [], markerX: null, xRange: null, minY: null, maxY: null,
        minY2: null, maxY2: null, emptyText: 'нет данных', yZero: true
      }, opts || {});
      this.series = [];
      this.hidden = new Set();
      this.hover = null;
      this.view = null;
      this._map = null;
      this._drag = null;
      this._pointers = new Map();
      this._pinch = null;
      this._legendHits = [];
      this._raf = 0;
      this.w = 0; this.h = 0;
      this._onMove = this._onMove.bind(this);
      this._onLeave = this._onLeave.bind(this);
      this._onClick = this._onClick.bind(this);
      this._onDown = this._onDown.bind(this);
      this._onUp = this._onUp.bind(this);
      this._onWheel = this._onWheel.bind(this);
      this._onDbl = this._onDbl.bind(this);
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'crosshair';
      canvas.addEventListener('pointerdown', this._onDown);
      canvas.addEventListener('pointermove', this._onMove);
      canvas.addEventListener('pointerup', this._onUp);
      canvas.addEventListener('pointercancel', this._onUp);
      canvas.addEventListener('pointerleave', this._onLeave);
      canvas.addEventListener('wheel', this._onWheel, { passive: false });
      canvas.addEventListener('dblclick', this._onDbl);
      canvas.addEventListener('click', this._onClick);
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(canvas);
      } else {
        window.addEventListener('resize', () => this.resize());
      }
      this.resize();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      // скрытая вкладка не имеет размеров — используем резервные, чтобы график
      // можно было отрисовать и выгрузить в отчёт
      const w = this.canvas.clientWidth || 640;
      const h = this.canvas.clientHeight || 260;
      this.w = w; this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    setData(series) {
      this.series = series.filter(Boolean);
      const names = new Set(this.series.map(s => s.name));
      this.hidden.forEach(n => { if (!names.has(n)) this.hidden.delete(n); });
      this.draw();
    }

    setOptions(o) {
      Object.assign(this.opts, o || {});
      this.draw();
    }

    refresh() { this.resize(); }

    _visible() { return this.series.filter(s => !s.hidden && !this.hidden.has(s.name) && s.data && s.data.length); }

    _bounds(axis) {
      let lo = Infinity, hi = -Infinity;
      this._visible().forEach(s => {
        if ((s.axis || 0) !== axis) return;
        for (let i = 0; i < s.data.length; i++) {
          const y = s.data[i][1];
          if (!isFinite(y)) continue;
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      });
      if (!isFinite(lo)) return null;
      return [lo, hi];
    }

    _xBounds() {
      if (this.opts.xRange) return this.opts.xRange.slice();
      let lo = Infinity, hi = -Infinity;
      this._visible().forEach(s => {
        if (!s.data.length) return;
        const a = s.data[0][0], b = s.data[s.data.length - 1][0];
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      });
      if (!isFinite(lo)) return [0, 1];
      if (lo === hi) { lo -= 1; hi += 1; }
      return [lo, hi];
    }

    draw() {
      if (!this.w) return;
      const ctx = this.ctx, w = this.w, h = this.h, o = this.opts;
      const pad = o.pad;
      const x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
      ctx.clearRect(0, 0, w, h);
      if (x1 <= x0 || y1 <= y0) return;

      const vis = this._visible();
      const xb = this._xBounds();
      const yb = this._bounds(0);
      const y2b = this._bounds(1);

      if (!vis.length || !yb) {
        ctx.fillStyle = THEME.text;
        ctx.font = FONT_UI;
        ctx.textAlign = 'center';
        ctx.fillText(root.MC_I18N ? root.MC_I18N.t(o.emptyText) : o.emptyText, (x0 + x1) / 2, (y0 + y1) / 2);
        return;
      }

      let [xmin, xmax] = xb;
      if (!(xmax > xmin)) xmax = xmin + 1;

      let ymin = o.minY != null ? o.minY : yb[0];
      let ymax = o.maxY != null ? o.maxY : yb[1];
      if (o.yZero && ymin > 0) ymin = 0;
      if (ymax === ymin) ymax = ymin + 1;
      const padY = (ymax - ymin) * 0.02;
      if (o.minY == null && !(o.yZero && ymin === 0)) ymin -= padY;
      if (o.maxY == null) ymax += padY;

      const manualX = this.view && isFinite(this.view.x0) && this.view.x1 > this.view.x0;
      const manualY = this.view && isFinite(this.view.y0) && this.view.y1 > this.view.y0;
      if (manualX) { xmin = this.view.x0; xmax = this.view.x1; }
      if (manualY) { ymin = this.view.y0; ymax = this.view.y1; }

      const xs = niceStep(xmax - xmin, o.xTicks);
      const ys = niceStep(ymax - ymin, o.yTicks);
      let xlo, xhi, ylo, yhi;
      if (manualX) { xlo = xmin; xhi = xmax; }
      else { xlo = Math.floor(xmin / xs) * xs; xhi = Math.ceil(xmax / xs) * xs; }
      if (manualY) { ylo = ymin; yhi = ymax; }
      else { ylo = Math.floor(ymin / ys) * ys; yhi = Math.ceil(ymax / ys) * ys; }
      const xTick0 = Math.ceil(xlo / xs - 1e-9) * xs;
      const yTick0 = Math.ceil(ylo / ys - 1e-9) * ys;

      const X = v => x0 + (v - xlo) / (xhi - xlo) * (x1 - x0);
      const Y = v => y1 - (v - ylo) / (yhi - ylo) * (y1 - y0);

      let y2lo = 0, y2hi = 1, ys2 = 1;
      if (y2b) {
        let a = o.minY2 != null ? o.minY2 : y2b[0];
        let b = o.maxY2 != null ? o.maxY2 : y2b[1];
        const zero2 = o.yZero2 !== undefined ? o.yZero2 : o.yZero;
        if (zero2 && a > 0) a = 0;
        if (a === b) b = a + 1;
        const pad2 = (b - a) * 0.02;
        if (o.minY2 == null && !(zero2 && a === 0)) a -= pad2;
        if (o.maxY2 == null) b += pad2;
        ys2 = niceStep(b - a, o.yTicks);
        const m2 = this.view && isFinite(this.view.y20) && this.view.y21 > this.view.y20;
        if (m2) { y2lo = this.view.y20; y2hi = this.view.y21; }
        else { y2lo = Math.floor(a / ys2) * ys2; y2hi = Math.ceil(b / ys2) * ys2; }
        var y2Tick0 = Math.ceil(y2lo / ys2 - 1e-9) * ys2;
      }
      if (typeof y2Tick0 === 'undefined') var y2Tick0 = y2lo;
      const Y2 = v => y1 - (v - y2lo) / (y2hi - y2lo) * (y1 - y0);
      this._map = { px0: x0, px1: x1, py0: y0, py1: y1, xlo: xlo, xhi: xhi, ylo: ylo, yhi: yhi, y2lo: y2lo, y2hi: y2hi };

      // сетка
      ctx.lineWidth = 1;
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      for (let v = xTick0; v <= xhi + xs * 0.01; v += xs) {
        const px = Math.round(X(v)) + 0.5;
        ctx.moveTo(px, y0); ctx.lineTo(px, y1);
      }
      for (let v = yTick0; v <= yhi + ys * 0.01; v += ys) {
        const py = Math.round(Y(v)) + 0.5;
        ctx.moveTo(x0, py); ctx.lineTo(x1, py);
      }
      ctx.stroke();

      // нулевая линия
      if (ylo < 0 && yhi > 0) {
        ctx.strokeStyle = THEME.gridStrong;
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(Y(0)) + 0.5);
        ctx.lineTo(x1, Math.round(Y(0)) + 0.5);
        ctx.stroke();
      }

      // рамка
      ctx.strokeStyle = THEME.axis;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1);
      ctx.stroke();
      if (y2b) {
        ctx.beginPath();
        ctx.moveTo(x1, y0); ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // подписи осей
      ctx.font = FONT;
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = yTick0; v <= yhi + ys * 0.01; v += ys) {
        const py = Y(v);
        if (py < y0 - 1 || py > y1 + 1) continue;
        ctx.fillText(o.yFmt ? o.yFmt(v) : fmtNum(v, ys), x0 - 8, py);
      }
      if (y2b) {
        ctx.textAlign = 'left';
        for (let v = y2Tick0; v <= y2hi + ys2 * 0.01; v += ys2) {
          const py = Y2(v);
          if (py < y0 - 1 || py > y1 + 1) continue;
          ctx.fillText(o.y2Fmt ? o.y2Fmt(v) : fmtNum(v, ys2), x1 + 8, py);
        }
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let v = xTick0; v <= xhi + xs * 0.01; v += xs) {
        const px = X(v);
        if (px < x0 - 1 || px > x1 + 1) continue;
        ctx.fillText(o.xFmt ? o.xFmt(v) : fmtNum(v, xs), px, y1 + 8);
      }

      // заголовки осей
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = THEME.text;
      ctx.font = FONT_UI;
      if (o.yLabel) ctx.fillText(o.yLabel, x0, y0 - 10);
      if (o.y2Label && y2b) {
        ctx.textAlign = 'right';
        ctx.fillText(o.y2Label, x1, y0 - 10);
      }
      if (o.xLabel) {
        ctx.textAlign = 'center';
        ctx.fillText(o.xLabel, (x0 + x1) / 2, h - 6);
      }

      // горизонтальные референсные линии
      (o.hLines || []).forEach(hl => {
        const py = Y(hl.y);
        if (py < y0 || py > y1) return;
        ctx.save();
        ctx.strokeStyle = hl.color || THEME.refLine;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
        ctx.restore();
        if (hl.label) {
          ctx.fillStyle = hl.color || THEME.refText;
          ctx.font = FONT_UI;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(hl.label, x1 - 4, py - 2);
        }
      });

      // кривые
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      vis.forEach(s => {
        const axis = s.axis || 0;
        const mapY = axis === 1 ? Y2 : Y;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width || 1.8;
        ctx.setLineDash(s.dash || []);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < s.data.length; i++) {
          const p = s.data[i];
          if (!isFinite(p[1])) continue;
          const px = X(p[0]), py = mapY(p[1]);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.restore();

      // маркер рабочей точки
      if (o.markerX != null) {
        const px = X(o.markerX);
        if (px >= x0 && px <= x1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(70,224,165,0.55)';
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
          ctx.restore();
          vis.forEach(s => {
            if ((s.axis || 0) !== 0 || !s.data.length) return;
            const yv = this._interp(s.data, o.markerX);
            if (yv == null) return;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(px, Y(yv), 3.2, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }

      // легенда
      this._drawLegend(vis, x0, 6, x1);

      // подсказка
      if (this.hover != null) this._drawHover(vis, X, Y, Y2, x0, x1, y0, y1, xlo, xhi);
    }

    _interp(data, x) {
      if (!data.length) return null;
      let best = null, bd = Infinity;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i][0] - x);
        if (d < bd) { bd = d; best = data[i]; }
      }
      return best ? best[1] : null;
    }

    _drawLegend(vis, startX, y, maxX) {
      this._legendHits = [];
      if (!this.opts.legend) return;
      const ctx = this.ctx;
      ctx.font = FONT_UI;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let x = startX;
      vis.forEach(s => {
        const label = s.name;
        const wText = ctx.measureText(label).width;
        const wItem = wText + 24;
        if (x + wItem > maxX) return;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x + 12, y + 4);
        ctx.stroke();
        ctx.fillStyle = THEME.textBright;
        ctx.fillText(label, x + 17, y + 4);
        this._legendHits.push({ x0: x, x1: x + wItem, name: s.name });
        x += wItem + 12;
      });
    }

    _drawHover(vis, X, Y, Y2, x0, x1, y0, y1, xlo, xhi) {
      const ctx = this.ctx;
      const hx = this.hover.x;
      if (hx < x0 || hx > x1) return;
      ctx.save();
      ctx.strokeStyle = THEME.gridStrong;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, y0);
      ctx.lineTo(Math.round(hx) + 0.5, y1);
      ctx.stroke();
      ctx.restore();

      // значение x
      const vx = xlo + (hx - x0) / (x1 - x0) * (xhi - xlo);
      const rows = [{ label: this.opts.xLabel || 'x', val: this.opts.xFmt ? this.opts.xFmt(vx) : fmtNum(vx, 0.01), color: THEME.textBright }];
      vis.forEach(s => {
        if ((s.axis || 0) !== 0 && !this.opts.y2Label) return;
        const yv = this._interp(s.data, vx);
        if (yv == null) return;
        const mapY = (s.axis || 0) === 1 ? Y2 : Y;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(X(s.data.reduce((a, p) => Math.abs(p[0] - vx) < Math.abs(a - vx) ? p[0] : a, s.data[0][0])), mapY(yv), 2.5, 0, Math.PI * 2);
        ctx.fill();
        rows.push({ label: s.name, val: s.fmt ? s.fmt(yv) : fmtNum(yv, 0.01), color: s.color });
      });
      if (rows.length <= 1) return;
      ctx.font = FONT;
      let wBox = 96;
      rows.forEach(r => { wBox = Math.max(wBox, ctx.measureText(r.label + '  ' + r.val).width + 22); });
      const hBox = rows.length * 16 + 10;
      let bx = hx + 12;
      if (bx + wBox > this.w - 6) bx = hx - wBox - 12;
      let by = y0 + 8;
      if (by + hBox > y1) by = y1 - hBox;
      ctx.fillStyle = THEME.tooltipBg;
      ctx.strokeStyle = THEME.tooltipBorder;
      ctx.lineWidth = 1;
      this._roundRect(bx, by, wBox, hBox, 6);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const yy = by + 13 + i * 16;
        ctx.fillStyle = r.color;
        if (i > 0) {
          ctx.fillRect(bx + 8, yy - 1, 6, 2);
        }
        ctx.fillStyle = i === 0 ? THEME.textBright : THEME.text;
        ctx.fillText(r.label, bx + 18, yy);
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.textBright;
        ctx.fillText(r.val, bx + wBox - 8, yy);
        ctx.textAlign = 'left';
      });
    }

    _roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    _eventPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _inside(x, y) {
      const p = this.opts.pad;
      return this._map && x >= p.l && x <= this.w - p.r && y >= p.t && y <= this.h - p.b;
    }

    _viewSnapshot() {
      if (this.view) return Object.assign({}, this.view);
      const m = this._map;
      if (!m) return null;
      return { x0: m.xlo, x1: m.xhi, y0: m.ylo, y1: m.yhi, y20: m.y2lo, y21: m.y2hi };
    }

    _dataXBounds() {
      let lo = Infinity, hi = -Infinity;
      this._visible().forEach(s => {
        if (!s.data.length) return;
        const a = s.data[0][0], b = s.data[s.data.length - 1][0];
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      });
      return isFinite(lo) ? [lo, hi] : [0, 1];
    }

    _zoomX(px, factor) {
      if (!this._map) return;
      const m = this._map;
      const v = this._viewSnapshot();
      const vx = v.x0 + (px - m.px0) / (m.px1 - m.px0) * (v.x1 - v.x0);
      let x0 = vx - (vx - v.x0) * factor;
      let x1 = vx + (v.x1 - vx) * factor;
      const db = this._dataXBounds();
      const full = Math.max(db[1] - db[0], 1e-6);
      if (!(x1 - x0 > full / 400) || !(x1 - x0 < full * 4)) return;
      this.view = { x0: x0, x1: x1, y0: v.y0, y1: v.y1, y20: v.y20, y21: v.y21 };
      this.draw();
    }

    _zoomY(py, factor) {
      if (!this._map) return;
      const m = this._map;
      const v = this._viewSnapshot();
      const vy = v.y0 + (m.py1 - py) / (m.py1 - m.py0) * (v.y1 - v.y0);
      let y0 = vy - (vy - v.y0) * factor;
      let y1 = vy + (v.y1 - vy) * factor;
      const yb = this._bounds(0) || [0, 1];
      const full = Math.max(yb[1] - yb[0], 1e-6);
      if (!(y1 - y0 > full / 400) || !(y1 - y0 < full * 4)) return;
      this.view = { x0: v.x0, x1: v.x1, y0: y0, y1: y1, y20: v.y20, y21: v.y21 };
      this.draw();
    }

    resetView() {
      this.view = null;
      this.hover = null;
      this.draw();
    }

    toPNGData(bg) {
      const c = this.canvas;
      if (!c.width || !c.height) return '';
      const tmp = document.createElement('canvas');
      tmp.width = c.width; tmp.height = c.height;
      const t = tmp.getContext('2d');
      t.fillStyle = bg || '#ffffff';
      t.fillRect(0, 0, tmp.width, tmp.height);
      t.drawImage(c, 0, 0);
      return tmp.toDataURL('image/png');
    }

    exportPNG(name) {
      const file = (name || 'chart') + '.png';
      const dataUrl = this.toPNGData(THEME.panel || '#0f1620');
      /* через мост: в браузере — скачивание, в оболочке — диалог сохранения */
      if (window.MC_BRIDGE && window.MC_BRIDGE.saveDataUrl) window.MC_BRIDGE.saveDataUrl(file, dataUrl);
      else {
        const a = document.createElement('a');
        a.download = file;
        a.href = dataUrl;
        a.click();
      }
    }

    _onDown(e) {
      if (!this._map) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = this._eventPos(e);
      if (!this._inside(p.x, p.y)) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { }
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 1) {
        this._drag = { start: p, map: Object.assign({}, this._map), view: this._viewSnapshot(), moved: false };
        this.canvas.style.cursor = 'grabbing';
      } else if (this._pointers.size === 2) {
        const pts = Array.from(this._pointers.values());
        this._pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
        this._drag = null;
      }
      e.preventDefault();
    }

    _onMove(e) {
      const p = this._eventPos(e);
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 2 && this._pinch) {
        const pts = Array.from(this._pointers.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (d > 0 && this._pinch.dist > 0) this._zoomX((pts[0].x + pts[1].x) / 2, this._pinch.dist / d);
        this._pinch.dist = d;
        return;
      }
      if (this._drag) {
        const dx = p.x - this._drag.start.x, dy = p.y - this._drag.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this._drag.moved = true;
        const m = this._drag.map, v = this._drag.view;
        if (!m || !v) return;
        const sx = (m.xhi - m.xlo) / (m.px1 - m.px0);
        const sy = (m.yhi - m.ylo) / (m.py1 - m.py0);
        this.view = {
          x0: v.x0 - dx * sx, x1: v.x1 - dx * sx,
          y0: v.y0 + dy * sy, y1: v.y1 + dy * sy,
          y20: v.y20, y21: v.y21
        };
        this.draw();
        return;
      }
      this.hover = { x: p.x, y: p.y };
      this.draw();
    }

    _onUp(e) {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size === 0) {
        this._drag = null;
        this._pinch = null;
        this.canvas.style.cursor = 'crosshair';
      } else if (this._pointers.size === 1) {
        const p = Array.from(this._pointers.values())[0];
        this._drag = { start: p, map: Object.assign({}, this._map), view: this._viewSnapshot(), moved: true };
        this._pinch = null;
      } else {
        this._pinch = null;
      }
    }

    _onWheel(e) {
      if (!this._map) return;
      const p = this._eventPos(e);
      if (!this._inside(p.x, p.y)) return;
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.2 : 0.83;
      if (e.shiftKey) this._zoomY(p.y, f);
      else this._zoomX(p.x, f);
    }

    _onDbl() { this.resetView(); }

    _onLeave() {
      if (this._pointers.size) return;
      this.hover = null;
      this.draw();
    }

    _onClick(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (my > 26) return;
      for (const hit of this._legendHits) {
        if (mx >= hit.x0 && mx <= hit.x1) {
          if (this.hidden.has(hit.name)) this.hidden.delete(hit.name);
          else this.hidden.add(hit.name);
          this.draw();
          if (this.onToggle) this.onToggle(hit.name);
          return;
        }
      }
    }
  }

  root.MC.Chart = Chart;
  root.MC.setChartTheme = setChartTheme;
  root.MC.getChartTheme = function () { return THEME; };
  root.MC.CHART_THEMES = THEMES;
  root.MC.PALETTES = {
    dark: { mint: '#46e0a5', blue: '#5aa9ff', amber: '#ffb454', pink: '#ff6b8b', violet: '#b98bff', cyan: '#4fd8e8', gray: '#8fa0b8', lime: '#c6e75a', overlay: '#ff9f5a' },
    light: { mint: '#0f9d72', blue: '#2f7fd1', amber: '#b5730f', pink: '#d64564', violet: '#7a55c9', cyan: '#0e8fa8', gray: '#6b7a8e', lime: '#6f8f0f', overlay: '#c06a1e' }
  };
  root.MC.CHART_COLORS = Object.assign({}, root.MC.PALETTES.dark);
})(typeof globalThis !== 'undefined' ? globalThis : this);
