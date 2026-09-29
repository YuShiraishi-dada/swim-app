import '@fontsource/zen-kaku-gothic-new/400.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';
import './style.css';
import { fmtTime, generateMenu, menuToText, sectionTotal, swimPace } from './generator';
import { buildPdf, canvasToBlob, downloadBlob, fileBaseName, renderMenuCanvas, shareToX } from './export';
import { chickSvg, logoTileSvg } from './logo';
import { randomSeed } from './rng';
import {
  addFavorite,
  findFavorite,
  importFavorites,
  loadFavorites,
  loadParams,
  removeFavorite,
  renameFavorite,
  saveParams,
} from './storage';
import { FOCUS_LABEL, type Focus, type Menu, type Params } from './types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const DEFAULT_PARAMS: Params = {
  intensity: 3,
  distance: 3000,
  focus: 'endurance',
  pool: 25,
  /** 0 = 未入力（必須項目なので作成前に選んでもらう） */
  baseCycle: 0,
  minutes: 0,
  strokeMode: 'fr',
};

const CYCLE_MIN = 60;
const CYCLE_MAX = 210;
const MINUTE_OPTIONS = [30, 45, 60, 75, 90, 105, 120, 150, 180];

const INTENSITY_LABEL = ['', 'とても軽め', '軽め', 'ふつう', 'きつめ', 'ハード'];

let params: Params = { ...DEFAULT_PARAMS, ...loadParams() };
let current: { menu: Menu; title?: string } | null = null;

// ───────────── HTML エスケープ ─────────────
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ───────────── トースト ─────────────
let toastTimer = 0;
function toast(msg: string) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

// ───────────── URL (シード + パラメータ) ─────────────
function menuHash(m: Menu): string {
  const p = m.params;
  const q = new URLSearchParams({
    seed: m.seed,
    f: p.focus,
    i: String(p.intensity),
    d: String(p.distance),
    p: String(p.pool),
    b: String(p.baseCycle),
    s: p.strokeMode,
  });
  if (p.minutes) q.set('t', String(p.minutes));
  return `#/m?${q}`;
}

function shareUrl(m: Menu): string {
  return `${location.origin}${location.pathname}${menuHash(m)}`;
}

function parseHash(): { params: Params; seed: string } | null {
  const h = location.hash;
  if (!h.startsWith('#/m?')) return null;
  const q = new URLSearchParams(h.slice(4));
  const seed = q.get('seed');
  if (!seed) return null;
  const focus = q.get('f') as Focus;
  if (!(focus in FOCUS_LABEL)) return null;
  const num = (k: string, lo: number, hi: number, def: number) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  };
  return {
    seed,
    params: {
      focus,
      intensity: num('i', 1, 5, 3) as Params['intensity'],
      distance: num('d', 500, 10000, 3000),
      pool: q.get('p') === '50' ? 50 : 25,
      baseCycle: num('b', 40, 240, 100),
      minutes: num('t', 10, 300, 0),
      strokeMode: q.get('s') === 'mixed' ? 'mixed' : 'fr',
    },
  };
}

// ───────────── フォーム ─────────────
function syncForm() {
  document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const name = seg.dataset.name as keyof Params;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(String(params[name]) === b.dataset.value));
    });
  });
  $('#intensity-label').textContent = INTENSITY_LABEL[params.intensity];
  $<HTMLInputElement>('#distance').value = String(params.distance);
  $('#distance-out').textContent = `${params.distance.toLocaleString()}m`;
  $<HTMLSelectElement>('#pool').value = String(params.pool);
  $<HTMLSelectElement>('#strokeMode').value = params.strokeMode;
  $<HTMLSelectElement>('#baseCycle').value = params.baseCycle ? String(params.baseCycle) : '';
  $<HTMLSelectElement>('#baseCycle').classList.toggle('empty', !params.baseCycle);
  $<HTMLSelectElement>('#minutes').value = String(params.minutes ?? 0);
  $('#cycle-pace').textContent = params.baseCycle
    ? `→ EN2 の泳速 約 ${fmtTime(swimPace(params.baseCycle))}/100m として計算`
    : '';
}

function setCycleError(show: boolean) {
  $('#field-cycle').classList.toggle('invalid', show);
  $('#cycle-error').hidden = !show;
}

function initForm() {
  const sel = $<HTMLSelectElement>('#baseCycle');
  sel.append(new Option('選択してください', ''));
  for (let s = CYCLE_MIN; s <= CYCLE_MAX; s += 5) sel.append(new Option(fmtTime(s), String(s)));

  const min = $<HTMLSelectElement>('#minutes');
  min.append(new Option('指定しない', '0'));
  for (const m of MINUTE_OPTIONS) min.append(new Option(`${m} 分`, String(m)));

  document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const name = seg.dataset.name!;
      const v = b.dataset.value!;
      params = { ...params, [name]: name === 'intensity' ? Number(v) : v };
      syncForm();
    });
  });
  $<HTMLInputElement>('#distance').addEventListener('input', (e) => {
    params.distance = Number((e.target as HTMLInputElement).value);
    syncForm();
  });
  $<HTMLSelectElement>('#pool').addEventListener('change', (e) => (params.pool = Number((e.target as HTMLSelectElement).value) as 25 | 50));
  $<HTMLSelectElement>('#strokeMode').addEventListener('change', (e) => (params.strokeMode = (e.target as HTMLSelectElement).value as Params['strokeMode']));
  $<HTMLSelectElement>('#baseCycle').addEventListener('change', (e) => {
    params.baseCycle = Number((e.target as HTMLSelectElement).value) || 0;
    if (params.baseCycle) setCycleError(false);
    syncForm();
  });
  $<HTMLSelectElement>('#minutes').addEventListener('change', (e) => (params.minutes = Number((e.target as HTMLSelectElement).value) || 0));

  $<HTMLFormElement>('#params').addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });
  syncForm();
}

function generate() {
  // 必須項目のチェック
  if (!params.baseCycle) {
    setCycleError(true);
    $('#field-cycle').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $<HTMLSelectElement>('#baseCycle').focus({ preventScroll: true });
    return;
  }
  saveParams(params);
  const menu = generateMenu({ ...params }, randomSeed());
  show(menu);
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function show(menu: Menu, title?: string) {
  current = { menu, title };
  history.replaceState(null, '', menuHash(menu));
  renderResult();
}

// ───────────── 結果表示 ─────────────
function renderResult() {
  const el = $('#result');
  if (!current) {
    el.innerHTML = `
      <div class="empty-state">
        <span class="empty-logo">${chickSvg('#ffffff', 'lg-empty')}</span>
        <p>条件を選んで「メニューを作成」を押してください</p>
      </div>`;
    return;
  }
  const { menu, title } = current;
  const p = menu.params;
  const saved = !!findFavorite(menu);
  el.innerHTML = `
    <article class="card result">
      <div class="result-head">
        <div>
          <h2>${esc(title ?? '今日の練習メニュー')}</h2>
          <div class="chips">
            <span class="chip focus-${p.focus}">${FOCUS_LABEL[p.focus]}</span>
            <span class="chip">強度 ${p.intensity}</span>
            <span class="chip">EN2 ${fmtTime(p.baseCycle)}</span>
            ${p.minutes ? `<span class="chip">練習 ${p.minutes} 分</span>` : ''}
            <span class="chip">${p.pool}m</span>
          </div>
        </div>
        <div class="total"><strong>${menu.total.toLocaleString()}<small>m</small></strong><span>約 ${menu.minutes} 分</span></div>
      </div>
      ${menu.notice ? `<p class="notice">${esc(menu.notice)}</p>` : ''}
      ${menu.sections
        .map(
          (s) => `
        <section class="sec">
          <div class="sec-head"><h3>${esc(s.title)}</h3><span>${sectionTotal(s)}m</span></div>
          <ul>
            ${s.items
              .map((i) => {
                const head = `${i.sets ? `${i.sets} セット × ` : ''}${i.reps > 1 || i.sets ? `${i.reps} × ` : ''}${i.dist}`;
                const kind = i.kind === 'swim' ? '' : ` <em>${i.kind[0].toUpperCase()}${i.kind.slice(1)}</em>`;
                const cyc = i.cycle ? `@${fmtTime(i.cycle)}` : i.rest ? `R${i.rest}s` : '';
                return `<li class="row z-${i.zone}">
                  <div class="row-main">
                    <span class="txt"><b>${head}</b> ${i.stroke}${kind}</span>
                    <span class="zone">${i.zone}</span>
                    <span class="cyc">${cyc}</span>
                  </div>
                  ${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}
                </li>`;
              })
              .join('')}
          </ul>
        </section>`,
        )
        .join('')}
      <p class="legend">EN1 楽に · EN2 有酸素 · EN3 きつめ · AN 対乳酸 · SP 全力 ／ @ = サークル, R = レスト</p>
      <div class="actions">
        <button class="btn primary wide" data-act="reroll">↻ 別のメニューを作成</button>
        <button class="btn ${saved ? 'saved' : ''}" data-act="fav">${saved ? '★ 保存済み' : '☆ お気に入り'}</button>
        <button class="btn x" data-act="x">𝕏 に投稿</button>
        <button class="btn" data-act="pdf">カラーPDF</button>
        <button class="btn" data-act="pdf-mono" title="印刷向けの白黒PDF">白黒PDF</button>
        <button class="btn" data-act="png">画像を保存</button>
        <button class="btn" data-act="copy">テキストコピー</button>
      </div>
    </article>`;
}

async function onResultAction(act: string) {
  if (!current) return;
  const { menu, title } = current;
  try {
    switch (act) {
      case 'reroll':
        show(generateMenu({ ...menu.params }, randomSeed()));
        break;
      case 'fav': {
        const exist = findFavorite(menu);
        if (exist) {
          toast('保存済みです（お気に入りタブで確認できます）');
          break;
        }
        const d = new Date();
        const name = title ?? `${FOCUS_LABEL[menu.params.focus]} ${menu.total}m（${d.getMonth() + 1}/${d.getDate()}）`;
        addFavorite(menu, name);
        renderResult();
        renderFavorites();
        toast('お気に入りに保存しました');
        break;
      }
      case 'pdf':
        toast('PDF を作成しています…');
        (await buildPdf(menu, title)).save(`${fileBaseName(menu)}.pdf`);
        break;
      case 'pdf-mono':
        toast('白黒 PDF を作成しています…');
        (await buildPdf(menu, title, 'mono')).save(`${fileBaseName(menu)}-mono.pdf`);
        break;
      case 'png':
        downloadBlob(await canvasToBlob(await renderMenuCanvas(menu, title)), `${fileBaseName(menu)}.png`);
        break;
      case 'x': {
        const r = await shareToX(menu, shareUrl(menu), title);
        if (r === 'intent') toast('画像を保存しました。X の投稿画面で画像を添付してください');
        break;
      }
      case 'copy':
        await navigator.clipboard.writeText(`${menuToText(menu)}\n${shareUrl(menu)}`);
        toast('コピーしました');
        break;
    }
  } catch (e) {
    console.error(e);
    toast(`エラー: ${(e as Error).message}`);
  }
}

// ───────────── お気に入り ─────────────
function renderFavorites() {
  const list = loadFavorites();
  $('#fav-count').textContent = list.length ? String(list.length) : '';
  const ul = $('#fav-list');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">まだありません。メニューを作成して「☆ お気に入り」を押すとここに保存されます。</li>`;
    return;
  }
  ul.innerHTML = list
    .map(
      (f) => `
    <li data-id="${f.id}">
      <div class="fav-info">
        <input class="fav-name" value="${esc(f.name)}" aria-label="名前" />
        <span class="muted">${FOCUS_LABEL[f.menu.params.focus]} · 強度 ${f.menu.params.intensity} · ${f.menu.total.toLocaleString()}m · 約${f.menu.minutes}分 · ${new Date(f.savedAt).toLocaleDateString()}</span>
      </div>
      <div class="fav-actions">
        <button class="btn small primary" data-act="open">開く</button>
        <button class="btn small" data-act="pdf">PDF</button>
        <button class="btn small" data-act="pdf-mono" title="印刷向けの白黒PDF">白黒PDF</button>
        <button class="btn small danger" data-act="del" aria-label="削除">削除</button>
      </div>
    </li>`,
    )
    .join('');
}

function initFavorites() {
  const ul = $('#fav-list');
  ul.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const id = b.closest('li')!.dataset.id!;
    const fav = loadFavorites().find((f) => f.id === id);
    if (!fav) return;
    if (b.dataset.act === 'open') {
      switchTab('gen');
      show(fav.menu, fav.name);
      $('#result').scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.act === 'pdf') {
      (await buildPdf(fav.menu, fav.name)).save(`${fileBaseName(fav.menu)}.pdf`);
    } else if (b.dataset.act === 'pdf-mono') {
      (await buildPdf(fav.menu, fav.name, 'mono')).save(`${fileBaseName(fav.menu)}-mono.pdf`);
    } else if (b.dataset.act === 'del') {
      if (!confirm(`「${fav.name}」を削除しますか？`)) return;
      removeFavorite(id);
      renderFavorites();
      if (current) renderResult();
    }
  });
  ul.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('fav-name')) return;
    const id = input.closest('li')!.dataset.id!;
    renameFavorite(id, input.value.trim() || '無題のメニュー');
    toast('名前を変更しました');
  });

  $('#fav-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(loadFavorites(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, `swimmenu-favorites-${new Date().toISOString().slice(0, 10)}.json`);
  });
  $<HTMLInputElement>('#fav-import').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const n = importFavorites(await file.text());
      renderFavorites();
      toast(`${n} 件読み込みました`);
    } catch (err) {
      toast(`読み込めませんでした: ${(err as Error).message}`);
    }
    input.value = '';
  });
  renderFavorites();
}

// ───────────── タブ ─────────────
function switchTab(tab: 'gen' | 'fav') {
  document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#tab-gen').hidden = tab !== 'gen';
  $('#tab-fav').hidden = tab !== 'fav';
  if (tab === 'fav') renderFavorites();
}

// ───────────── 起動 ─────────────
function init() {
  $('.brand-mark').innerHTML = logoTileSvg('lg-head');
  initForm();
  initFavorites();
  document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab as 'gen' | 'fav')),
  );
  $('#result').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (b) onResultAction(b.dataset.act!);
  });

  renderResult();

  // 共有 URL から開いた場合は同じメニューを再現
  const fromUrl = parseHash();
  if (fromUrl) {
    params = fromUrl.params;
    syncForm();
    show(generateMenu(fromUrl.params, fromUrl.seed));
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
