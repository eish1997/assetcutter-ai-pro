export const RESULT_VER_SEP = '__v__';

export const uuid = () => Math.random().toString(36).slice(2, 11);

export const baseActionId = (k: string) => (k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0] : k);

export const makeVersionKey = (baseId: string) => `${baseId}${RESULT_VER_SEP}${Date.now().toString(36)}`;
