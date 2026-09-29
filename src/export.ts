import type { jsPDF } from 'jspdf';
import { formatItem } from './generator';
import { chickSvg, logoTileSvg, svgDataUrl } from './logo';
import { FOCUS_LABEL, type Menu, type Zone } from './types';

// メニューを Canvas に描画して、画像 (X 投稿用) と PDF の両方に使う。
// 画像として PDF に貼るので、日本語フォントを PDF に埋め込む必要がない。

const W = 1080;
const PAD = 64;
export const FONT_FAMILY = 'Zen Kaku Gothic New';
const FONT = `"${FONT_FAMILY}", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;

export type Tone = 'color' | 'mono';

interface Palette {
  bg: string;
  headerBg: [string, string] | null;
  headerText: string;
  headerSub: string;
  headerRule: string | null;
  headerAccent: string | null;
  /** tile: 背景つき角丸アイコン / chick: 背景なし */
  logo: 'tile' | 'chick';
  sectionText: string;
  sectionTotal: string;
  sectionRule: string;
  text: string;
  note: string;
  cycle: string;
  footerBg: string;
  footerText: string;
  zone: Record<Zone, string>;
  /** 白黒のときはチップを枠線だけにしてインクを節約 */
  chipOutline: boolean;
}

export const ZONE_COLOR: Record<Zone, string> = {
  EN1: '#2fa58b',
  EN2: '#2f7fd0',
  EN3: '#e09a1a',
  AN: '#e5652e',
  SP: '#d63b5c',
};

const PALETTES: Record<Tone, Palette> = {
  color: {
    bg: '#ffffff',
    headerBg: ['#0f2433', '#0f2433'],
    headerText: '#ffffff',
    headerSub: '#9fc3d3',
    headerRule: null,
    headerAccent: '#35b6d6',
    logo: 'tile',
    sectionText: '#0f2433',
    sectionTotal: '#7a8a94',
    sectionRule: '#e3e8ec',
    text: '#16232d',
    note: '#5b6b76',
    cycle: '#0f2433',
    footerBg: '#f3f6f8',
    footerText: '#5b6b76',
    zone: ZONE_COLOR,
    chipOutline: false,
  },
  mono: {
    bg: '#ffffff',
    headerBg: null,
    headerText: '#000000',
    headerSub: '#333333',
    headerRule: '#000000',
    headerAccent: null,
    logo: 'chick',
    sectionText: '#000000',
    sectionTotal: '#444444',
    sectionRule: '#999999',
    text: '#000000',
    note: '#444444',
    cycle: '#000000',
    footerBg: '#ffffff',
    footerText: '#333333',
    // 濃さでゾーンの強さがわかるように
    zone: { EN1: '#c8c8c8', EN2: '#9a9a9a', EN3: '#6a6a6a', AN: '#3a3a3a', SP: '#000000' },
    chipOutline: true,
  },
};

interface Row {
  kind: 'section' | 'item';
  text: string;
  cycle?: string;
  zone?: Zone;
  note?: string;
  total?: number;
}

function rowsOf(menu: Menu): Row[] {
  const rows: Row[] = [];
  for (const s of menu.sections) {
    const total = s.items.reduce((a, i) => a + (i.sets ?? 1) * i.reps * i.dist, 0);
    rows.push({ kind: 'section', text: s.title, total });
    for (const i of s.items) {
      const f = formatItem(i);
      rows.push({ kind: 'item', text: f.main, cycle: f.cycle, zone: i.zone, note: i.note });
    }
  }
  return rows;
}

const ROW_H = { section: 84, item: 68, note: 40 };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** 描画に使う文字のフォントを読み込んでおく（Canvas はフォント読み込みを待たないため） */
async function ensureFonts(text: string) {
  if (!document.fonts?.load) return;
  const sample = `${text}0123456789@:×·—…/()（）`;
  await Promise.all(
    [400, 500, 700].map((w) => document.fonts.load(`${w} 32px "${FONT_FAMILY}"`, sample).catch(() => [])),
  );
}

function loadLogo(kind: 'tile' | 'chick'): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = svgDataUrl(kind === 'tile' ? logoTileSvg('cv-tile') : chickSvg('#ffffff', 'cv-chick'));
  });
}

/** 字間（対応ブラウザのみ） */
function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** 白黒化（印刷用）。輝度に変換 */
function toGrayscale(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')!;
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

export async function renderMenuCanvas(menu: Menu, title = '今日の練習メニュー', tone: Tone = 'color'): Promise<HTMLCanvasElement> {
  const pal = PALETTES[tone];
  const rows = rowsOf(menu);
  await ensureFonts(title + rows.map((r) => r.text + (r.note ?? '')).join('') + FOCUS_LABEL[menu.params.focus] + '強度プール約分練習楽に有酸素きつめ対乳酸全力');
  const logo = await loadLogo(pal.logo);

  const headerH = 270;
  const bodyH = rows.reduce((a, r) => a + (r.kind === 'section' ? ROW_H.section : ROW_H.item + (r.note ? ROW_H.note : 0)), 0);
  const footerH = 110;
  const H = headerH + bodyH + footerH + 30;

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // ── ヘッダー ──
  if (pal.headerBg) {
    const g = ctx.createLinearGradient(0, 0, 0, headerH);
    g.addColorStop(0, pal.headerBg[0]);
    g.addColorStop(1, pal.headerBg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, headerH);
  }
  if (pal.headerAccent) {
    ctx.fillStyle = pal.headerAccent;
    ctx.fillRect(0, headerH - 8, W, 8);
  }
  if (pal.headerRule) {
    ctx.fillStyle = pal.headerRule;
    ctx.fillRect(PAD, headerH - 12, W - PAD * 2, 4);
  }
  if (logo) {
    const lh = pal.logo === 'tile' ? 140 : 170;
    ctx.drawImage(logo, W - PAD - lh + (pal.logo === 'tile' ? 0 : 14), (headerH - lh) / 2 - 4, lh, lh);
  }

  const textMax = W - PAD * 2 - 170;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = pal.headerText;
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(ellipsize(ctx, title, textMax), PAD, 102);

  const p = menu.params;
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const meta = `${FOCUS_LABEL[p.focus]} · 強度 ${p.intensity} · EN2 ${fmt(p.baseCycle)} · ${p.pool}m プール${p.minutes ? ` · 練習 ${p.minutes} 分` : ''}`;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillStyle = pal.headerSub;
  ctx.fillText(ellipsize(ctx, meta, textMax), PAD, 154);

  ctx.font = `700 44px ${FONT}`;
  ctx.fillStyle = pal.headerText;
  const totalText = `Total ${menu.total.toLocaleString()}m`;
  ctx.fillText(totalText, PAD, 214);
  const tw = ctx.measureText(totalText).width;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = pal.headerSub;
  ctx.fillText(`約 ${menu.minutes} 分`, PAD + tw + 36, 214);

  // ── 本文 ──
  let y = headerH + 16;
  for (const r of rows) {
    if (r.kind === 'section') {
      y += 22;
      ctx.fillStyle = pal.sectionText;
      ctx.font = `700 28px ${FONT}`;
      setSpacing(ctx, 3);
      ctx.fillText(r.text.toUpperCase(), PAD, y + 40);
      setSpacing(ctx, 0);
      ctx.font = `500 26px ${FONT}`;
      ctx.fillStyle = pal.sectionTotal;
      const t = `${r.total}m`;
      ctx.fillText(t, W - PAD - ctx.measureText(t).width, y + 40);
      ctx.fillStyle = pal.sectionRule;
      ctx.fillRect(PAD, y + 55, W - PAD * 2, 2);
      y += ROW_H.section - 22;
      continue;
    }
    const h = ROW_H.item + (r.note ? ROW_H.note : 0);
    const zc = pal.zone[r.zone!];
    ctx.fillStyle = zc;
    ctx.fillRect(PAD, y + 14, 6, h - 24);

    ctx.fillStyle = pal.text;
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText(r.text, PAD + 30, y + 56);

    ctx.font = `700 36px ${FONT}`;
    const cw = r.cycle ? ctx.measureText(r.cycle).width : 0;
    if (r.cycle) {
      ctx.fillStyle = pal.cycle;
      ctx.fillText(r.cycle, W - PAD - cw, y + 56);
    }
    ctx.font = `700 22px ${FONT}`;
    const zt = r.zone!;
    const zw = ctx.measureText(zt).width + 24;
    const zx = W - PAD - cw - (cw ? 22 : 0) - zw;
    roundRect(ctx, zx, y + 26, zw, 38, 6);
    if (pal.chipOutline) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#000';
    } else {
      ctx.fillStyle = zc;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillText(zt, zx + 12, y + 53);

    if (r.note) {
      ctx.fillStyle = pal.note;
      ctx.font = `500 27px ${FONT}`;
      ctx.fillText(ellipsize(ctx, r.note, W - PAD * 2 - 30), PAD + 30, y + 99);
    }
    y += h;
  }

  // ── フッター ──
  ctx.fillStyle = pal.footerBg;
  ctx.fillRect(0, H - footerH, W, footerH);
  if (tone === 'mono') {
    ctx.fillStyle = '#999';
    ctx.fillRect(PAD, H - footerH, W - PAD * 2, 2);
  }
  ctx.fillStyle = pal.footerText;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText('SwimMenu', PAD, H - footerH + 64);
  ctx.font = `500 24px ${FONT}`;
  const legend = 'EN1 楽に / EN2 有酸素 / EN3 きつめ / AN 対乳酸 / SP 全力';
  ctx.fillText(legend, W - PAD - ctx.measureText(legend).width, H - footerH + 62);

  if (tone === 'mono') toGrayscale(cv);
  return cv;
}

export const canvasToBlob = (cv: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('画像の生成に失敗しました'))), type, q));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function fileBaseName(menu: Menu) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `swim-menu-${ymd}-${menu.params.focus}-${menu.total}m`;
}

/** A4 縦の PDF を作る。長いメニューは複数ページに分割 */
export async function buildPdf(menu: Menu, title?: string, tone: Tone = 'color'): Promise<jsPDF> {
  // jsPDF は大きいので使うときだけ読み込む
  const { jsPDF } = await import('jspdf');
  const cv = await renderMenuCanvas(menu, title, tone);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const imgW = pageW - margin * 2;
  const pxPerMm = cv.width / imgW;
  const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);

  for (let y = 0, page = 0; y < cv.height; y += sliceH, page++) {
    const h = Math.min(sliceH, cv.height - y);
    const part = document.createElement('canvas');
    part.width = cv.width;
    part.height = h;
    part.getContext('2d')!.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerMm);
  }
  pdf.setProperties({ title: title ?? 'SwimMenu', creator: 'SwimMenu' });
  return pdf;
}

const isMobile = () =>
  // @ts-expect-error userAgentData は一部ブラウザのみ
  navigator.userAgentData?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent);

export function postText(menu: Menu): string {
  return `今日の水泳メニュー🏊 ${FOCUS_LABEL[menu.params.focus]} ${menu.total.toLocaleString()}m（約${menu.minutes}分）`;
}

/**
 * X に投稿。
 * - スマホ: 共有シートで画像つき投稿（X アプリを選ぶ）
 * - PC など: 画像をダウンロード → X の投稿画面を開く（画像は手動で添付）
 */
export async function shareToX(menu: Menu, shareUrl: string, title?: string): Promise<'shared' | 'intent' | 'cancel'> {
  const blob = await canvasToBlob(await renderMenuCanvas(menu, title));
  const file = new File([blob], `${fileBaseName(menu)}.png`, { type: 'image/png' });
  const text = `${postText(menu)}\n#水泳 #スイムメニュー`;

  if (isMobile() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${text}\n${shareUrl}` });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancel';
      // 共有に失敗したら intent にフォールバック
    }
  }
  downloadBlob(blob, file.name);
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
  window.open(intent, '_blank', 'noopener');
  return 'intent';
}
