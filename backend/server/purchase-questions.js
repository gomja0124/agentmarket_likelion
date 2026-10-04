export const OPTIONAL_QUESTION_FIELDS = ['modelQuery', 'storageGb', 'conditionPreferences'];
const order = ['category', 'maxBudgetKrw', ...OPTIONAL_QUESTION_FIELDS];
export const PURCHASE_QUESTIONS = {
  category: '찾는 기기는 핸드폰인가요, 태블릿인가요?',
  maxBudgetKrw: '최대 예산은 얼마인가요? 원 단위로 알려 주세요.',
  modelQuery: '원하는 모델 또는 모델군을 하나로 지정해 주세요.',
  storageGb: '최소 저장 용량은 몇 GB인가요?',
  conditionPreferences: '허용할 제품 상태를 LIKE_NEW, GOOD, FAIR 중 선택해 주세요.',
};
const optionalQuestions = {
  modelQuery: '원하는 모델 또는 모델군이 있나요? 제한이 없으면 건너뛰어도 됩니다.',
  storageGb: '최소 저장 용량은 몇 GB인가요? 제한이 없으면 건너뛰어도 됩니다.',
  conditionPreferences: '허용할 제품 상태가 있나요? 제한이 없으면 건너뛰어도 됩니다.',
};
const generated = new Set([...Object.values(PURCHASE_QUESTIONS), ...Object.values(optionalQuestions)]);
export function purchaseQuestions(request, custom = []) {
  const answered = field => field === 'conditionPreferences' ? request[field].length > 0
    : field === 'maxBudgetKrw' ? request[field] > 0 : request[field] != null;
  const missing = new Set(request.missingFields);
  const questions = order.filter(field => !answered(field) &&
    (!request.skippedQuestionFields.includes(field) || missing.has(field)))
    .map(field => missing.has(field) || !OPTIONAL_QUESTION_FIELDS.includes(field)
      ? PURCHASE_QUESTIONS[field] : optionalQuestions[field]);
  // Caller-provided questions are retained while unresolved fields remain.
  // Generated questions are rebuilt so resolved prompts cannot linger.
  const unresolvedCustom = missing.size ? custom.filter(question => !generated.has(question)) : [];
  return [...new Set([...questions, ...unresolvedCustom])];
}
