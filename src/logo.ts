// ロゴ: コウテイペンギンのヒナ（2 色）。
// 黒い頭巾 + 白い顔（背景色の抜き）+ シルバーグレーのふわふわの体。
// scripts/make-icons.py と同じ形を保つこと。

export const LOGO_COLORS = {
  dark: '#0f2433',
  down: '#9fb3c0',
  bg: '#eef3f6',
};

const HOOD = 'M50 9C65 9 75 20 75 34C75 44 72 51 67 56C60 61 40 61 33 56C28 51 25 44 25 34C25 20 35 9 50 9Z';
const FACE = 'M50 32.5C46.5 25.5 38.5 23.5 33.5 28.5C29.5 33 29.5 41 32.5 47.5C35.5 54 42 58.5 50 58.5C58 58.5 64.5 54 67.5 47.5C70.5 41 70.5 33 66.5 28.5C61.5 23.5 53.5 25.5 50 32.5Z';
const BODY = 'M31 48C21 56 16.5 69 17.5 80.5C18.5 90.5 32 96 50 96C68 96 81.5 90.5 82.5 80.5C83.5 69 79 56 69 48C62 56 38 56 31 48Z';
const FL = 'M24.5 62Q14 71 13.5 83Q21 79.5 25.5 71Z';
const FR = 'M75.5 62Q86 71 86.5 83Q79 79.5 74.5 71Z';
const FLUFF: [number, number][] = [
  [19.5, 74], [19, 82], [22.5, 89], [29.5, 94], [39, 96.3], [50, 97], [61, 96.3], [70.5, 94], [77.5, 89], [81, 82], [80.5, 74],
];

interface ChickColors {
  dark: string;
  down: string;
  face: string;
}

/** 100x100 座標のヒナ本体 */
export function chickInner(c: ChickColors, id = 'chk'): string {
  const fluff = FLUFF.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2"/>`).join('');
  return (
    `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>` +
    `<path d="${FL}" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/><path d="${FR}" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/></mask></defs>` +
    `<g fill="${c.down}"><g mask="url(#${id})"><path d="${BODY}"/>${fluff}</g><path d="${FL}"/><path d="${FR}"/></g>` +
    `<g fill="${c.dark}"><ellipse cx="42" cy="96.5" rx="5.5" ry="2.2"/><ellipse cx="58" cy="96.5" rx="5.5" ry="2.2"/><path d="${HOOD}"/></g>` +
    `<path d="${FACE}" fill="${c.face}"/>` +
    `<g fill="${c.dark}"><circle cx="41" cy="38" r="2.9"/><circle cx="59" cy="38" r="2.9"/><path d="M47.6 40.5Q50 39.3 52.4 40.5L50 46Z"/></g>`
  );
}

/** 背景つきのアイコン（角丸タイル） */
export function logoTileSvg(id = 'tile', radius = 22): string {
  const { dark, down, bg } = LOGO_COLORS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${radius}" fill="${bg}"/>` +
    `<svg x="12" y="9" width="76" height="76" viewBox="0 0 100 100">${chickInner({ dark, down, face: bg }, id)}</svg></svg>`
  );
}

/** 背景なしのヒナ（白い紙の上など） */
export function chickSvg(face = '#ffffff', id = 'chick'): string {
  const { dark, down } = LOGO_COLORS;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${chickInner({ dark, down, face }, id)}</svg>`;
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
