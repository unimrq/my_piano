// Only the type declarations required by the upstream renderers are retained.
export type NoteFilter = 'all'|'white'|'black'|'c_only';
export type NoteLabelMode = 'none'|'c_only'|'white'|'black'|'all';
export type ColorTheme = 'violet'|'classic'|'ocean'|'forest'|'cascade'|'custom';
export type ImpactStyle = 'off'|'bloom'|'side'|'trail';
export interface CustomColors {leftHand:string;rightHand:string;unknown:string;}
