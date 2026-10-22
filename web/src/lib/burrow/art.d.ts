/* Types for art.js (Burrow's components/index.d.ts, trimmed to the string generators). */

export type Animal = 'hamster' | 'squirrel' | 'molerat' | 'beaver';
export type Character = 'bao' | 'kacang' | 'gali' | 'kayu' | Animal;
export type Mood = 'happy' | 'joy' | 'busy' | 'sleepy' | 'worried' | 'wow';
export type TraceName =
	| 'seed' | 'crumbs' | 'sunflower' | 'berry'
	| 'acorn' | 'leaf' | 'pinecone' | 'mushroom'
	| 'footprint' | 'hole' | 'mound' | 'pebble'
	| 'twig' | 'log' | 'chewed' | 'chips';
export type TrailKind = 'crumbs' | 'seeds' | 'acorns' | 'leaves' | 'footprints' | 'chips';
export type HabitatKind = 'meadow' | 'oak' | 'burrow' | 'river';
export type IconName =
	| 'home' | 'plus' | 'chart' | 'gear' | 'camera' | 'bowl' | 'wallet' | 'search'
	| 'arrow-up' | 'arrow-down' | 'check' | 'calendar';

export interface TrailOptions {
	kind: TrailKind;
	points: [number, number][];
	width: number;
	height: number;
	spacing?: number;
	fade?: number;
	done?: number;
}

export interface Habitat {
	who: Animal;
	props: () => string;
	ground: string;
	far: string;
}

export interface TrailPoint {
	x: number;
	y: number;
	a: number;
}

export const INK: string;
export const C: Record<string, string>;
export const NAMES: Record<Animal, string>;
export const ALIAS: Record<'bao' | 'kacang' | 'gali' | 'kayu', Animal>;
export const MOODS: Mood[];
export const FUR: Record<Animal, string>;
export const TRACE_OWNER: Record<TraceName, Character>;
export const TRAIL: Record<TrailKind, { spacing: number; draw: (p: TrailPoint, i: number, op: number | string) => string }>;
export const HAB: Record<HabitatKind, Habitat>;
export const ICONS: Record<IconName, string>;
export const STEP_MARK: Record<TrailKind, TraceName>;

export function mascotSVG(character: Character, mood?: Mood, label?: string): string;
export function traceSVG(name: TraceName, size?: number): string;
export function trailSVG(opts: TrailOptions): string;
export function worldSVG(): string;
export function pawsSVG(who: Animal, n: 1 | 2, size: number): string;
export function along(points: [number, number][], spacing: number): TrailPoint[];
export function printAt(x: number, y: number, s?: number, rot?: number, fill?: string, op?: string | number): string;
export function acornAt(x: number, y: number, s?: number, rot?: number): string;
export function seedAt(x: number, y: number, s?: number, rot?: number): string;
export function leafAt(x: number, y: number, s?: number, rot?: number, fill?: string): string;
export function crumb(x: number, y: number, s?: number, rot?: number): string;
export function cloud(x: number, y: number, s: number): string;
export function tr(name: TraceName, x: number, y: number, s?: number, rot?: number): string;
