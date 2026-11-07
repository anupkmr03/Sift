/**
 * Appearance settings (View panel): accent colour, background (glow / OLED black),
 * card style (comfortable / compact / poster) and the big Resume banner.
 * Stored per device in localStorage; applied as soon as this script loads, so the
 * app never flashes the default look first. Also marks the desktop app's custom title bar.
 *
 *   Sift.appearance.get('accent' | 'bg' | 'theme' | 'size')
 *   Sift.appearance.set({ accent: 'pink' })   → emits 'appearance:change'
 */
(function () {
  const root = document.documentElement;

  /** Accent colours: main, lighter text tone, dark ink for text on filled buttons, glow. */
  const ACCENTS = {
    cyan:   { label: 'Cyan',   main: '#8be3ff', light: '#c4f1ff', rgb: '139, 227, 255', ink: '#06202b', glow: 'rgba(0, 184, 217, 0.38)' },
    purple: { label: 'Purple', main: '#b8a4ff', light: '#ddd3ff', rgb: '184, 164, 255', ink: '#1b1240', glow: 'rgba(124, 92, 255, 0.38)' },
    pink:   { label: 'Pink',   main: '#ff8fc4', light: '#ffc9e2', rgb: '255, 143, 196', ink: '#3a0a22', glow: 'rgba(255, 77, 141, 0.36)' },
    green:  { label: 'Green',  main: '#7cf0b8', light: '#c3f9dd', rgb: '124, 240, 184', ink: '#062a1a', glow: 'rgba(0, 200, 120, 0.32)' },
    amber:  { label: 'Amber',  main: '#ffcf70', light: '#ffe6b3', rgb: '255, 207, 112', ink: '#2e1d00', glow: 'rgba(255, 170, 0, 0.32)' },
    blue:   { label: 'Blue',   main: '#7cb4ff', light: '#c2dbff', rgb: '124, 180, 255', ink: '#071a3a', glow: 'rgba(40, 110, 255, 0.36)' },
    indigo: { label: 'Indigo', main: '#949bff', light: '#cdd0ff', rgb: '148, 155, 255', ink: '#11143d', glow: 'rgba(90, 96, 255, 0.36)' },
    teal:   { label: 'Teal',   main: '#5ee6d0', light: '#b5f5ea', rgb: '94, 230, 208', ink: '#032b25', glow: 'rgba(0, 190, 160, 0.32)' },
    lime:   { label: 'Lime',   main: '#c4f06a', light: '#e4f9bb', rgb: '196, 240, 106', ink: '#1e2c00', glow: 'rgba(150, 210, 0, 0.30)' },
    coral:  { label: 'Coral',  main: '#ff9e80', light: '#ffd0c2', rgb: '255, 158, 128', ink: '#3a1206', glow: 'rgba(255, 110, 70, 0.34)' },
    red:    { label: 'Red',    main: '#ff7a8a', light: '#ffc2ca', rgb: '255, 122, 138', ink: '#3d0710', glow: 'rgba(240, 40, 70, 0.34)' },
    silver: { label: 'Silver', main: '#d4d9e8', light: '#eef0f7', rgb: '212, 217, 232', ink: '#161a26', glow: 'rgba(180, 190, 220, 0.26)' },
  };
  const BACKGROUNDS = { glow: 'Glow', accent: 'Accent glow', oled: 'OLED black' };
  const DENSITIES = { comfortable: 'Comfortable', compact: 'Compact', poster: 'Poster' };
  const THEMES = { dark: 'Dark', light: 'Light', system: 'Match Windows' };
  const SIZES = { 90: '90%', 100: '100%', 110: '110%', 125: '125%' };
  const DEFAULTS = {
    accent: 'coral', customAccent: '#ff6ec7', bg: 'glow', density: 'comfortable',
    theme: 'dark', size: '100',
  };
  const BOOL_KEYS = [];

  const store = Sift.store;
  const values = {};
  Object.keys(DEFAULTS).forEach((k) => { values[k] = store.get('look.' + k, DEFAULTS[k]); });
  if (!ACCENTS[values.accent] && values.accent !== 'custom') values.accent = DEFAULTS.accent;
  if (!BACKGROUNDS[values.bg]) values.bg = DEFAULTS.bg;
  if (!DENSITIES[values.density]) values.density = DEFAULTS.density;
  if (!THEMES[values.theme]) values.theme = DEFAULTS.theme;
  if (!SIZES[values.size]) values.size = DEFAULTS.size;
  if (!/^#[0-9a-f]{6}$/i.test(values.customAccent)) values.customAccent = DEFAULTS.customAccent;

  // ---------- Colour helpers ----------
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return [f(0), f(8), f(4)];
  }
  const rgbHex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Full accent palette from any colour: bright enough on dark, dark enough as text on light. */
  function paletteFrom(hex) {
    const { h, s, l } = hexToHsl(hex);
    const sat = clamp(s, 35, 100);
    const main = hslToRgb(h, sat, clamp(l, 62, 80));
    return {
      main: rgbHex(main), rgb: main.join(', '),
      light: rgbHex(hslToRgb(h, sat, 87)),
      ink: rgbHex(hslToRgb(h, clamp(sat, 30, 70), 12)),
      glow: `rgba(${hslToRgb(h, sat, 48).join(', ')}, 0.36)`,
      dark: rgbHex(hslToRgb(h, clamp(sat, 40, 85), 36)),     // accent text on the light theme
      darker: rgbHex(hslToRgb(h, clamp(sat, 40, 85), 28)),
      hue: h, sat,
    };
  }

  /** The accent in use (a preset or the custom colour). */
  function currentPalette() {
    if (values.accent === 'custom') return paletteFrom(values.customAccent);
    const a = ACCENTS[values.accent];
    return { ...paletteFrom(a.main), main: a.main, light: a.light, rgb: a.rgb, ink: a.ink, glow: a.glow };
  }

  const systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const themeNow = () => (values.theme === 'system' ? (systemLight && systemLight.matches ? 'light' : 'dark') : values.theme);

  function apply() {
    const p = currentPalette();
    const light = themeNow() === 'light';
    const set = (k, v) => root.style.setProperty(k, v);
    // The on-dark values are kept separately so dark areas (the player) can use them on the light theme too.
    set('--accent-on-dark', p.main);
    set('--accent-light-on-dark', p.light);
    set('--accent', light ? p.dark : p.main);
    set('--accent-light', light ? p.darker : p.light);
    set('--accent-fill', `rgba(${p.rgb}, 0.85)`);
    set('--accent-tint', `rgba(${p.rgb}, ${light ? 0.22 : 0.16})`);
    set('--accent-line', light ? `rgba(${hslToRgb(p.hue, p.sat, 40).join(', ')}, 0.45)` : `rgba(${p.rgb}, 0.45)`);
    set('--accent-ink', p.ink);
    set('--accent-glow', p.glow);
    // Accent glow background: the three soft glows take the accent's hue (and its neighbours).
    if (values.bg === 'accent') {
      set('--orb-1', rgbHex(hslToRgb((p.hue + 325) % 360, 80, light ? 72 : 52)));
      set('--orb-2', rgbHex(hslToRgb(p.hue, 85, light ? 70 : 50)));
      set('--orb-3', rgbHex(hslToRgb((p.hue + 35) % 360, 80, light ? 74 : 58)));
    } else {
      ['--orb-1', '--orb-2', '--orb-3'].forEach((k) => root.style.removeProperty(k));
    }
    root.dataset.accent = values.accent;
    root.dataset.bg = values.bg;
    root.dataset.density = values.density;
    root.dataset.theme = light ? 'light' : 'dark';
    applySize();
    if (window.siftDesktop && window.siftDesktop.setTitleBarSymbols) window.siftDesktop.setTitleBarSymbols(light ? '#1b2036' : '#e9edff');
  }

  /** Text & UI size: the desktop app zooms the whole window; the browser version uses CSS zoom. */
  function applySize() {
    const f = Number(values.size) / 100;
    const D = window.siftDesktop;
    if (D && D.setZoom) {
      D.setZoom(f);
      root.style.setProperty('--titlebar-h', ((D.titleBarHeight || 36) / f) + 'px'); // stays level with Windows' buttons
    } else {
      root.style.zoom = f === 1 ? '' : String(f);
    }
  }

  function get(key) { return BOOL_KEYS.includes(key) ? values[key] === '1' : values[key]; }

  function set(patch) {
    Object.entries(patch).forEach(([k, v]) => {
      if (!(k in DEFAULTS)) return;
      values[k] = BOOL_KEYS.includes(k) ? (v ? '1' : '0') : String(v);
      store.set('look.' + k, values[k]);
    });
    apply();
    Sift.bus.emit('appearance:change', patch);
    if ('theme' in patch) Sift.bus.emit('theme:change');
    if ('size' in patch) Sift.bus.emit('tiles:resize');
  }

  // "Match Windows": follow the system's light / dark choice. The change event isn't always
  // delivered, so it's also re-checked every few seconds (cheap) while this option is on.
  let lastSystem = systemLight ? systemLight.matches : false;
  function checkSystem() {
    if (!systemLight || values.theme !== 'system' || systemLight.matches === lastSystem) return;
    lastSystem = systemLight.matches;
    apply();
    Sift.bus.emit('appearance:change', { theme: 'system' });
    Sift.bus.emit('theme:change');
  }
  if (systemLight && systemLight.addEventListener) systemLight.addEventListener('change', checkSystem);
  setInterval(checkSystem, 4000);
  window.addEventListener('focus', checkSystem);

  // Desktop app: show the custom title bar strip (Windows draws its buttons on the right).
  if (window.siftDesktop) {
    root.classList.add('has-titlebar');
    root.style.setProperty('--titlebar-h', (window.siftDesktop.titleBarHeight || 36) + 'px');
    const t = document.getElementById('titlebar');
    if (t) t.hidden = false;
  }

  apply();
  Sift.appearance = { get, set, paletteFrom, hexToHsl, ACCENTS, BACKGROUNDS, DENSITIES, THEMES, SIZES };
})();
