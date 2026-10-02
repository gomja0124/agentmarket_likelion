export const categories = { PHONE: '핸드폰', TABLET: '태블릿' };
export const conditions = { LIKE_NEW: '거의 새것', GOOD: '좋음', FAIR: '사용감 있음' };

const products = [
  ['PHONE', 'Apple', 'iPhone 15 Pro', 256, 'LIKE_NEW', 920000, '내추럴 티타늄', '충전 케이블, 박스'],
  ['PHONE', 'Samsung', 'Galaxy S24 Ultra', 256, 'GOOD', 890000, '티타늄 그레이', 'S펜, 박스'],
  ['PHONE', 'Apple', 'iPhone 14', 128, 'GOOD', 520000, '미드나이트', '충전 케이블'],
  ['PHONE', 'Samsung', 'Galaxy Z Flip5', 256, 'FAIR', 490000, '민트', '박스'],
  ['PHONE', 'Apple', 'iPhone 13 mini', 128, 'GOOD', 390000, '스타라이트', '케이스'],
  ['PHONE', 'Samsung', 'Galaxy S23', 256, 'LIKE_NEW', 590000, '크림', '충전 케이블, 박스'],
  ['TABLET', 'Apple', 'iPad Air 5', 256, 'GOOD', 570000, '스페이스 그레이', '박스'],
  ['TABLET', 'Apple', 'iPad Pro 11', 128, 'LIKE_NEW', 850000, '실버', 'Apple Pencil'],
  ['TABLET', 'Samsung', 'Galaxy Tab S9', 256, 'GOOD', 640000, '그라파이트', 'S펜, 북커버'],
  ['TABLET', 'Samsung', 'Galaxy Tab S9 FE', 128, 'LIKE_NEW', 420000, '민트', 'S펜, 박스'],
  ['TABLET', 'Apple', 'iPad 10', 64, 'FAIR', 380000, '블루', '충전 케이블'],
  ['TABLET', 'Samsung', 'Galaxy Tab A9+', 128, 'GOOD', 240000, '네이비', '북커버'],
];

export const seedListings = products.map((p, index) => ({
  id: `seed-${index + 1}`,
  sellerId: 'demo-seller',
  category: p[0], brand: p[1], model: p[2], storageGb: p[3],
  condition: p[4], priceKrw: p[5], color: p[6], accessories: p[7],
  title: `${p[2]} ${p[3]}GB · ${p[6]}`,
  description: `${p[2]} ${p[3]}GB 모델입니다. 구성품: ${p[7]}. 제품 상태와 세부 사항은 판매자에게 확인해 주세요.`,
  images: [], status: 'ACTIVE', publishedAt: new Date(Date.now() - index * 86400000).toISOString(),
  missingFields: index === 3 ? ['batteryHealth'] : [],
}));

export function formatPrice(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

export function labelFor(field) {
  return ({ category: '기기 종류', model: '모델', priceKrw: '가격', maxBudgetKrw: '최대 예산',
    storageGb: '저장 용량', condition: '상태', accessories: '구성품', batteryHealth: '배터리 상태' })[field] || field;
}
