/** User-initiated handoff to Karrot's public search page; no listing data is copied. */
export function karrotSearchFor(request) {
  const keyword = String(request?.modelQuery || '').trim() ||
    (request?.category === 'TABLET' ? '태블릿' : '스마트폰');
  const url = new URL('https://www.daangn.com/kr/search/buy-sell/');
  url.searchParams.set('q', keyword);
  url.searchParams.set('category_id', '1');
  url.searchParams.set('only_on_sale', 'true');
  const maxBudgetKrw = Number(request?.maxBudgetKrw);
  if (Number.isSafeInteger(maxBudgetKrw) && maxBudgetKrw > 0) {
    url.searchParams.set('price', `__${maxBudgetKrw}`);
  }
  return { url: url.href, keyword, maxBudgetKrw: Number.isSafeInteger(maxBudgetKrw) && maxBudgetKrw > 0 ? maxBudgetKrw : null };
}
