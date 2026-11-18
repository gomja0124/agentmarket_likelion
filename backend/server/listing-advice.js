import { matchesModel } from './model-matching.js';
import { CATEGORIES, CONDITIONS } from './validation.js';
import { validationError } from './errors.js';

const asInteger = (value, field) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw validationError(`${field} 값이 올바르지 않습니다.`, { field });
  return number;
};
const percentile = (sorted, fraction) => {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return Math.round(sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower));
};

export function listingAdvice(listings, input = {}) {
  const category = input.category || null;
  const model = String(input.model || '').trim().slice(0, 200);
  const condition = input.condition || null;
  const storageGb = asInteger(input.storageGb, 'storageGb');
  const priceKrw = asInteger(input.priceKrw, 'priceKrw');
  if (category && !CATEGORIES.includes(category)) throw validationError('지원하지 않는 기기 종류입니다.', { field: 'category' });
  if (condition && !CONDITIONS.includes(condition)) throw validationError('지원하지 않는 제품 상태입니다.', { field: 'condition' });
  const questions = [];
  if (!category) questions.push('판매할 기기가 핸드폰인가요, 태블릿인가요?');
  if (!model) questions.push('정확한 모델명과 세대·변형 모델을 확인했나요?');
  if (!storageGb) questions.push('설정 화면에서 저장 용량을 확인했나요?');
  if (!condition) questions.push('화면·외관 흠집, 기능 고장, 수리 이력을 확인했나요?');
  if (category === 'PHONE' && !input.hasBatteryDetails) questions.push('배터리 성능 또는 교체 이력을 확인할 수 있나요?');
  if (!input.hasPhoto) questions.push('판매할 바로 그 기기를 직접 촬영한 사진을 올릴 수 있나요?');
  if (!input.hasDescription) questions.push('상태와 흠집·고장 여부를 설명에 적었나요?');
  if (!priceKrw) questions.push('판매 희망 가격을 얼마로 정했나요?');

  const comparable = model ? listings.filter(listing => listing.status === 'ACTIVE' &&
    (!category || listing.category === category) &&
    matchesModel(listing.model, model) && matchesModel(model, listing.model) &&
    (!storageGb || listing.storageGb === storageGb) &&
    (!condition || listing.condition === condition) &&
    Number.isSafeInteger(listing.priceKrw) && listing.priceKrw > 0) : [];
  const prices = comparable.map(listing => listing.priceKrw).sort((a, b) => a - b);
  const realCount = comparable.filter(listing => !listing.isSample).length;
  const sampleCount = comparable.length - realCount;
  const enough = prices.length >= 3;
  const range = enough ? { lowerKrw: percentile(prices, 0.25), medianKrw: percentile(prices, 0.5),
    upperKrw: percentile(prices, 0.75) } : null;
  const realOnly = enough && sampleCount === 0;
  return {
    questions, comparableCount: comparable.length, realCount, sampleCount,
    recommendedRange: realOnly ? range : null,
    demonstrationRange: enough && !realOnly ? range : null,
    priceAssessment: !enough ? '비교 가능한 판매글이 3건 미만이어서 가격 범위를 제안하지 않음.'
      : realOnly ? '최근 등록된 동일 모델·용량·상태의 판매 희망가 분포임. 실제 거래 가격이나 보증 시세가 아님.'
        : '시연용 데이터를 포함한 계산 예시임. 실제 시세나 판매 권장 가격으로 사용하지 말 것.',
    method: '동일 모델·용량·상태의 등록 희망가 25~75백분위. 외부 거래 데이터 또는 사진 AI 분석은 사용하지 않음.',
  };
}
