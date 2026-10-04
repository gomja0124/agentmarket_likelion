// Token boundaries prevent iPhone 1 matching iPhone 15 or S9 matching S90.
// No fuzzy spelling or inferred product specifications are used.
export function modelTokens(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/아이폰/g, ' iphone ').replace(/아이패드/g, ' ipad ')
    .replace(/갤럭시/g, ' galaxy ').replace(/태블릿|타블렛/g, ' tablet ')
    .replace(/울트라/g, ' ultra ').replace(/플러스|\+/g, ' plus ')
    .replace(/프로/g, ' pro ').replace(/맥스/g, ' max ')
    .replace(/에어/g, ' air ').replace(/미니/g, ' mini ')
    .replace(/폴드/g, ' fold ').replace(/플립/g, ' flip ').replace(/탭/g, ' tab ')
    .replace(/세대|인치|\binch(?:es)?\b|\bgen(?:eration)?\b/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

const variants = new Set(['pro', 'max', 'plus', 'mini', 'air', 'ultra', 'fe']);
export function matchesModel(model, query) {
  const actual = modelTokens(model);
  const wanted = modelTokens(query);
  if (!actual.length || !wanted.length) return false;
  const start = actual.findIndex((_, index) => wanted.every((token, offset) => actual[index + offset] === token));
  if (start < 0) return false;
  // A named generation denotes its exact variant. A family query without a
  // number is broad (iPad, iPad Pro, Galaxy Tab, Galaxy S, etc.).
  if (wanted.some(token => /^\d/.test(token))) {
    const actualVariants = actual.filter(token => variants.has(token));
    const wantedVariants = wanted.filter(token => variants.has(token));
    return actualVariants.join(' ') === wantedVariants.join(' ');
  }
  return true;
}
