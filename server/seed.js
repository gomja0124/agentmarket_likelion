export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_SELLER_ID = '00000000-0000-4000-8000-000000000002';

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

export function seedListings() {
  return products.map((product, index) => {
    const [category, brand, model, storageGb, condition, priceKrw, color, accessories] = product;
    const timestamp = new Date(Date.now() - index * 86400000).toISOString();
    return {
      id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`,
      sellerId: SEED_SELLER_ID,
      category,
      brand,
      model,
      storageGb,
      condition,
      accessories,
      priceKrw,
      title: `${model} ${storageGb}GB · ${color}`,
      description: `${model} ${storageGb}GB 모델입니다. 구성품: ${accessories}. 제품 상태와 세부 사항은 판매자에게 확인해 주세요.`,
      images: [],
      missingFields: index === 3 ? ['batteryHealth'] : [],
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: timestamp,
    };
  });
}
