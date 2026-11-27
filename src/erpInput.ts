/** Strict editor conversion. Keep partially typed decimals in the form. */
export function parseErpNumber(value: unknown, label: string): number {
 const raw=String(value??'').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٫/g,'.').replace(/[٬,]/g,'');
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!Number.isFinite(Number(raw)))throw new Error(`أدخل رقمًا صالحًا في «${label}».`);
 return Number(raw);
}
