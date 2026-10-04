import { validationError } from './errors.js';

const fields = ['category', 'modelQuery', 'maxBudgetKrw', 'storageGb', 'conditionPreferences'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Conservative extraction for the Step 1 contract. External Agents can supply
// structured values for expressions outside this supported vocabulary.
export function structurePurchaseConditions(payload, existing = {}) {
  if (!object(payload)) throw validationError('요청 본문은 JSON 객체여야 합니다.');
  const hasLanguage = Object.hasOwn(payload, 'naturalLanguageRequest');
  if (hasLanguage && (typeof payload.naturalLanguageRequest !== 'string' || payload.naturalLanguageRequest.length > 10000)) {
    throw validationError('naturalLanguageRequest는 10000자 이하 문자열이어야 합니다.', { field: 'naturalLanguageRequest' });
  }
  if (Object.hasOwn(payload, 'knownConstraints') && !object(payload.knownConstraints)) {
    throw validationError('knownConstraints는 JSON 객체여야 합니다.', { field: 'knownConstraints' });
  }
  const known = payload.knownConstraints || {};
  for (const key of Object.keys(known)) {
    if (!fields.includes(key)) throw validationError('지원하지 않는 구매 조건입니다.', { field: key });
  }
  if (!hasLanguage && !Object.hasOwn(payload, 'knownConstraints')) return payload;

  const input = (payload.naturalLanguageRequest || '').trim();
  const extracted = {};
  const ambiguous = new Set();
  const candidates = (field, values) => {
    const unique = [...new Set(values)];
    if (unique.length === 1) extracted[field] = unique[0];
    else if (unique.length > 1) ambiguous.add(field);
  };
  const phone = /핸드폰|휴대폰|스마트폰|아이폰|갤럭시\s*(?:s\d|z\s*(?:폴드|플립))|\b(?:phone|iphone)\b/i.test(input);
  const tablet = /태블릿|타블렛|아이패드|갤럭시\s*(?:탭|tab)|\b(?:tablet|ipad)\b/i.test(input);
  candidates('category', [phone && 'PHONE', tablet && 'TABLET'].filter(Boolean));

  const models = [];
  const modelPattern = /(?:아이패드|ipad)(?:\s*(?:프로|pro|에어|air|미니|mini))?(?:\s*\d+(?:\.\d+)?)?|(?:아이폰|iphone)(?:\s*\d+)?(?:\s*(?:프로\s*맥스|pro\s*max|프로|pro|플러스|plus|미니|mini))?|(?:갤럭시|galaxy)\s*(?:탭|tab)(?:\s*s\d+)?(?:\s*(?:fe|울트라|ultra|플러스|plus))?|(?:갤럭시|galaxy)\s*s\d+(?:\s*(?:fe|울트라|ultra|플러스|plus))?/gi;
  const modelInput = input.replace(/\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|원|krw|gb|기가|tb|테라)(?:바이트)?/gi, ' ');
  for (const match of modelInput.matchAll(modelPattern)) {
    models.push(match[0].replace(/아이패드/gi, 'iPad').replace(/아이폰/gi, 'iPhone')
      .replace(/갤럭시/gi, 'Galaxy').replace(/탭/g, 'Tab').replace(/프로/g, 'Pro')
      .replace(/에어/g, 'Air').replace(/미니/g, 'mini').replace(/맥스/g, 'Max')
      .replace(/울트라/g, 'Ultra').replace(/플러스/g, 'Plus').replace(/\s+/g, ' ').trim());
  }
  candidates('modelQuery', models);
  if (!models.length && /모델|model/i.test(input)) ambiguous.add('modelQuery');

  const budgets = [];
  const money = /(\d[\d,]*(?:\.\d+)?)\s*(만\s*원|만원|원|krw)\s*(이하|이내|까지|미만|이상|초과)?/gi;
  for (const match of input.matchAll(money)) {
    const amount = Number(match[1].replaceAll(',', '')) * (/만/.test(match[2]) ? 10000 : 1);
    const upper = match[3];
    const prefix = input.slice(Math.max(0, match.index - 12), match.index);
    if (['이상', '초과'].includes(upper)) ambiguous.add('maxBudgetKrw');
    else if (['이하', '이내', '까지'].includes(upper) || /최대\s*(?:예산\s*)?$|예산\s*(?:은|이|:)?\s*$/.test(prefix)) budgets.push(amount);
    else if (upper === '미만' && Number.isInteger(amount)) budgets.push(amount - 1);
    else ambiguous.add('maxBudgetKrw');
  }
  candidates('maxBudgetKrw', budgets);
  if (/저렴|가성비|예산|가격|원|krw/i.test(input) && !budgets.length) ambiguous.add('maxBudgetKrw');

  const storage = [];
  for (const match of input.matchAll(/(\d+(?:\.\d+)?)\s*(gb|기가|tb|테라)(?:바이트)?\s*(이상|이하|미만|초과)?/gi)) {
    const value = Number(match[1]) * (/tb|테라/i.test(match[2]) ? 1024 : 1);
    if (['이하', '미만', '초과'].includes(match[3])) ambiguous.add('storageGb');
    else storage.push(value);
  }
  candidates('storageGb', storage);
  if (/용량|저장\s*공간/.test(input) && !storage.length) ambiguous.add('storageGb');

  const states = [];
  if (/새것\s*같|새\s*것\s*같|거의\s*새|like_new/i.test(input)) states.push('LIKE_NEW');
  if (/양호|good/i.test(input)) states.push('GOOD');
  if (/사용감|fair/i.test(input)) states.push('FAIR');
  if (states.length === 1) extracted.conditionPreferences = states;
  else if (states.length > 1 || /상태|깨끗|미개봉/.test(input)) ambiguous.add('conditionPreferences');

  // Negated constraints require an explicit structured answer rather than
  // interpreting a mentioned product or state as a requested one.
  if (/말고|제외|아닌|아니고|않|싫|빼고|\bnot\b|\bwithout\b/i.test(input)) {
    for (const field of Object.keys(extracted)) ambiguous.add(field);
  }
  const result = { ...payload };
  delete result.naturalLanguageRequest;
  delete result.knownConstraints;
  for (const field of fields) {
    const supplied = Object.hasOwn(payload, field) ? payload[field] : known[field];
    const explicit = Object.hasOwn(payload, field) || Object.hasOwn(known, field);
    if (Object.hasOwn(payload, field) && Object.hasOwn(known, field) && !same(payload[field], known[field])) {
      throw validationError('구조화 조건이 서로 충돌합니다.', { field });
    }
    // Explicit null/empty means the user cleared this constraint. A concrete
    // value conflicting with the same message must be clarified.
    if (explicit) {
      const empty = supplied == null || supplied === '' || (Array.isArray(supplied) && !supplied.length);
      if (!empty && Object.hasOwn(extracted, field) && !same(supplied, extracted[field])) ambiguous.add(field);
      else if (empty || !Object.hasOwn(extracted, field)) ambiguous.delete(field);
      result[field] = supplied;
    } else if (Object.hasOwn(extracted, field)) result[field] = extracted[field];
    if (ambiguous.has(field)) result[field] = field === 'conditionPreferences' ? [] : null;
  }
  if (payload.missingFields != null && !Array.isArray(payload.missingFields)) throw validationError('missingFields는 배열이어야 합니다.');
  if (payload.nextQuestions != null && !Array.isArray(payload.nextQuestions)) throw validationError('nextQuestions는 배열이어야 합니다.');
  result.missingFields = [...new Set([...(payload.missingFields || existing.missingFields || []), ...ambiguous])];
  if (Object.hasOwn(payload, 'nextQuestions')) result.nextQuestions = payload.nextQuestions;
  return result;
}
