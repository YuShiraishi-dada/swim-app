export type Focus = 'sprint' | 'lactate' | 'endurance' | 'recovery';
export type Zone = 'EN1' | 'EN2' | 'EN3' | 'AN' | 'SP';
export type Kind = 'swim' | 'kick' | 'pull' | 'drill';
export type Stroke = 'Fr' | 'Ba' | 'Br' | 'Fly' | 'IM' | 'Choice';
export type StrokeMode = 'fr' | 'mixed';
export type Pool = 25 | 50;

export interface Params {
  /** 強度 1(軽め)〜5(ハード) */
  intensity: 1 | 2 | 3 | 4 | 5;
  /** 総距離の目安 (m) */
  distance: number;
  /** メインの狙い */
  focus: Focus;
  /** プール長 */
  pool: Pool;
  /** 普段エンデュランス (EN2) で回している 100m フリーのサイクル (秒) */
  baseCycle: number;
  /** 練習時間 (分)。未指定 (0/undefined) なら時間の制約なし */
  minutes?: number;
  /** 泳法 */
  strokeMode: StrokeMode;
}

export interface SetItem {
  /** セット数（"2 セット × 4 × 50" の 2） */
  sets?: number;
  reps: number;
  dist: number;
  kind: Kind;
  stroke: Stroke;
  zone: Zone;
  /** サークル (秒)。無い場合はレスト指定 or 自由 */
  cycle?: number;
  /** レスト (秒) */
  rest?: number;
  note?: string;
}

export type SectionKey = 'wu' | 'kdp' | 'pre' | 'main' | 'sub' | 'down';

export interface Section {
  key: SectionKey;
  title: string;
  items: SetItem[];
}

export interface Menu {
  version: number;
  seed: string;
  params: Params;
  sections: Section[];
  total: number;
  /** 所要時間の目安 (分) */
  minutes: number;
  /** 練習時間に合わせて距離を調整したときなどのお知らせ */
  notice?: string;
}

export const FOCUS_LABEL: Record<Focus, string> = {
  sprint: 'スプリント',
  lactate: '対乳酸',
  endurance: 'エンデュランス',
  recovery: 'アクティブレスト',
};

export const ZONE_LABEL: Record<Zone, string> = {
  EN1: 'EN1 楽に',
  EN2: 'EN2 有酸素',
  EN3: 'EN3 きつめ',
  AN: 'AN 対乳酸',
  SP: 'SP 全力',
};

export const KIND_LABEL: Record<Kind, string> = {
  swim: 'Swim',
  kick: 'Kick',
  pull: 'Pull',
  drill: 'Drill',
};

export const STROKE_LABEL: Record<Stroke, string> = {
  Fr: 'Fr',
  Ba: 'Ba',
  Br: 'Br',
  Fly: 'Fly',
  IM: 'IM',
  Choice: 'Choice',
};
