import { api, currentDemoAccount, isDemo, switchDemoAccount } from './api.js';
import { categories, conditions, formatPrice, labelFor } from './data.js';
import { listingMissing, requestMissing, unresolvedFields } from './matching.js';

const root = document.querySelector('#app');
const state = { page: 'home', listings: [], myListings: [], drafts: [], purchaseRequests: [], results: [], selected: null,
  listingDraft: null, purchaseDraft: null, publicDemands: [], connections: [], notifications: [],
  selectedDemand: null, sellerMatches: [], matchingListing: null,
  tokens: [], issuedToken: null, demoAuth: false,
  searchTerm: '', category: 'ALL', notice: '', error: '' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, size = 20) => {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>',
    filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
    bag: '<path d="M4 8h16l-1 13H5L4 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
    heart: '<path d="M20.8 8.6c0 4.8-8.8 10.2-8.8 10.2S3.2 13.4 3.2 8.6a4.5 4.5 0 0 1 8.8-1.3 4.5 4.5 0 0 1 8.8 1.3Z"/>',
    upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 17v4h16v-4"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const phoneArt = item => `<div class="device-art ${item.category === 'TABLET' ? 'tablet-art' : ''}"><div class="device-screen"><div class="screen-glow"></div><div class="screen-orb"></div></div></div>`;
const productArt = item => item.images?.[0]
  ? `<img class="product-photo" src="${esc(item.images[0])}" alt="${esc(item.model)} 사진" />`
  : phoneArt(item);

function navigate(page, extra = {}) {
  if (page !== 'agent') state.issuedToken = null;
  Object.assign(state, extra, { page, error: '', notice: '' });
  history.replaceState(null, '', `#${page}`);
  render(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
const navButton = (page, label) => `<button class="nav-link ${state.page === page ? 'active' : ''}" data-nav="${page}">${label}</button>`;

function header() {
  return `<header class="site-header"><div class="container header-inner">
    <button class="brand" data-nav="home" aria-label="Agent Market 홈"><span class="brand-mark">a<span>.</span></span><span>agent market</span></button>
    <nav class="desktop-nav" aria-label="주요 메뉴">${navButton('browse', '매물 둘러보기')}${navButton('buy', '맞춤 검색')}${navButton('demand', '구해요·알림')}${navButton('mine', '내 판매글')}${navButton('agent', 'Agent 연결')}</nav>
    <button class="header-sell" data-new-listing>${icon('plus', 16)} 판매하기</button>
  </div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container footer-inner"><div><span class="footer-brand">agent market<span>.</span></span><p>좋은 기기와 좋은 선택이 만나는 곳.</p></div><div class="footer-note">사람의 확인으로 완성되는 마켓</div></div></footer><nav class="mobile-nav" aria-label="모바일 주요 메뉴"><button data-nav="home">홈</button><button data-nav="browse">둘러보기</button><button data-nav="buy">맞춤 검색</button><button data-nav="demand">구해요</button><button data-nav="mine">내 판매글</button><button data-nav="agent">Agent</button></nav>`;
}
function demoAccountBar() {
  if (!state.demoAuth) return '';
  const account = currentDemoAccount();
  return `<div class="demo-account-bar"><div class="container"><span>시연 계정</span><button data-switch-account="buyer" ${account === 'buyer' ? 'aria-current="true"' : ''}>구매자</button><button data-switch-account="seller" ${account === 'seller' ? 'aria-current="true"' : ''}>판매자</button><small>판매자 계정에는 샘플 매물 12개가 있습니다.</small></div></div>`;
}

function card(item, result) {
  const match = result?.matchStatus;
  return `<button class="product-card" data-detail="${esc(item.id)}" aria-label="${esc(item.title)} 상세 보기">
    <div class="card-visual visual-${item.category.toLowerCase()}">${productArt(item)}<span class="card-category">${categories[item.category] || '기기'}</span></div>
    <div class="card-body"><div class="card-topline"><span>${esc(item.brand || '')}</span>${match ? `<span class="match-badge ${match === 'MATCH' ? 'match' : 'needs'}">${match === 'MATCH' ? '조건 충족' : '확인 필요'}</span>` : ''}</div>
    <h3>${esc(item.title)}</h3><p class="card-meta">${esc(item.model || '모델 확인 필요')} <span>·</span> ${item.storageGb ? `${esc(item.storageGb)}GB` : '용량 확인 필요'} <span>·</span> ${conditions[item.condition] || '상태 확인 필요'}</p>
    ${result ? `<p class="card-reason">${result.matchedFields?.length ? `충족: ${result.matchedFields.map(labelFor).map(esc).join(', ')}` : ''}${result.missingFields?.length ? `<br>확인 필요: ${result.missingFields.map(labelFor).map(esc).join(', ')}` : ''}</p>` : item.missingFields?.length ? `<p class="card-reason">확인 필요: ${item.missingFields.map(labelFor).map(esc).join(', ')}</p>` : ''}
    <div class="card-bottom"><strong>${formatPrice(item.priceKrw)}</strong><span>${icon('arrow', 18)}</span></div></div></button>`;
}

function home() {
  return `<section class="hero"><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow"><span class="eyebrow-dot"></span> 더 똑똑한 중고 기기 거래</span>
    <h1>내게 딱 맞는 기기,<br/><em>쉽게 찾고</em> 안심하고.</h1><p>핸드폰과 태블릿, 이제 조건에 맞게 찾아보세요.<br/>Agent가 정리한 정보는 내가 직접 확인하고 결정합니다.</p>
    <div class="hero-actions"><button class="btn btn-dark" data-nav="buy">내 조건으로 찾기 ${icon('arrow', 18)}</button><button class="btn btn-light" data-nav="browse">매물 둘러보기</button></div>
    <div class="hero-stats"><div><strong>12<span>+</span></strong><small>살펴볼 기기</small></div><i></i><div><strong>2</strong><small>지원 카테고리</small></div><i></i><div><strong>100<span>%</span></strong><small>사람이 최종 결정</small></div></div>
  </div><div class="hero-visual"><div class="hero-circle circle-one"></div><div class="hero-circle circle-two"></div><div class="hero-device tablet-art"><div class="device-screen"><div class="screen-glow"></div><div class="screen-orb"></div></div></div><div class="hero-device phone-front"><div class="device-screen"><div class="screen-glow"></div><div class="screen-orb"></div></div></div><div class="float-card float-top">${icon('spark', 18)} <span>나에게 맞는 매물 발견</span></div><div class="float-card float-bottom">${icon('shield', 18)} <span>확인하고 직접 결정</span></div></div></div></section>
  <section class="value-strip"><div class="container value-grid"><div><span class="value-icon">${icon('search', 22)}</span><div><strong>조건으로 빠르게</strong><p>예산과 원하는 모델에 맞게 찾기</p></div></div><div><span class="value-icon">${icon('spark', 22)}</span><div><strong>Agent 초안도 내 손으로</strong><p>정리된 정보를 직접 검토하고 수정</p></div></div><div><span class="value-icon">${icon('shield', 22)}</span><div><strong>모르는 정보는 그대로</strong><p>확인되지 않은 부분은 명확하게 표시</p></div></div></div></section>
  <section class="section container"><div class="section-heading"><div><span class="section-kicker">FRESH FINDS</span><h2>새로 올라온 기기</h2><p>새로운 시작을 기다리는 기기를 만나보세요.</p></div><button class="text-link" data-nav="browse">전체 보기 ${icon('arrow', 18)}</button></div><div class="product-grid">${state.listings.filter(x => x.status === 'ACTIVE').slice(0, 4).map(item => card(item)).join('')}</div></section>
  <section class="cta-band"><div class="container cta-inner"><div><span class="section-kicker">READY TO SELL?</span><h2>사용하지 않는 기기,<br/>다음 사람에게 이어주세요.</h2><p>판매 정보를 입력하고 초안을 확인한 뒤 직접 게시할 수 있어요.</p></div><button class="btn btn-white" data-nav="sell">판매글 작성하기 ${icon('arrow', 18)}</button></div></section>`;
}

function browse() {
  const visible = state.listings.filter(item => item.status === 'ACTIVE' && (state.category === 'ALL' || item.category === state.category) &&
    `${item.title} ${item.brand} ${item.model}`.toLowerCase().includes(state.searchTerm.toLowerCase()));
  return `<main class="container page-main"><div class="page-intro"><span class="section-kicker">DISCOVER</span><h1>좋은 기기를 발견하는 즐거움</h1><p>직접 등록된 핸드폰과 태블릿을 살펴보세요.</p></div>
    <div class="browse-toolbar"><div class="search-box">${icon('search', 20)}<input id="browse-search" type="search" placeholder="모델명이나 브랜드 검색" value="${esc(state.searchTerm)}" aria-label="모델명이나 브랜드 검색" /></div><div class="filter-tabs"><button data-category="ALL" class="${state.category === 'ALL' ? 'selected' : ''}">전체</button><button data-category="PHONE" class="${state.category === 'PHONE' ? 'selected' : ''}">핸드폰</button><button data-category="TABLET" class="${state.category === 'TABLET' ? 'selected' : ''}">태블릿</button></div></div>
    <div class="list-count">총 <strong>${visible.length}</strong>개의 매물</div>${visible.length ? `<div class="product-grid">${visible.map(item => card(item)).join('')}</div>` : `<div class="empty-state">${icon('search', 28)}<h3>조건에 맞는 매물이 없어요</h3><p>검색어나 카테고리를 바꿔 보세요.</p></div>`}</main>`;
}

const field = (label, name, content, hint = '') => `<label class="field"><span class="field-label">${label}</span>${content}${hint ? `<small>${hint}</small>` : ''}</label>`;
const input = (name, placeholder, value = '', type = 'text', required = false) => `<input name="${name}" type="${type}" placeholder="${placeholder}" value="${esc(value)}" ${required ? 'required' : ''} />`;
const categorySelect = value => `<select name="category" required><option value="">기기를 선택해 주세요</option>${Object.entries(categories).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
const conditionSelect = value => `<select name="condition"><option value="">상태를 선택해 주세요</option>${Object.entries(conditions).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
const missingBox = fields => fields?.length ? `<div class="missing-box">${icon('alert', 19)}<div><strong>확인할 정보가 있어요</strong><p>${fields.map(labelFor).map(esc).join(', ')} 항목을 확인해 주세요. 알 수 없는 정보는 추정하지 않습니다.</p></div></div>` : '';
const questionsBox = questions => questions?.length ? `<div class="question-box"><strong>추가로 확인할 질문</strong><ul>${questions.map(question => `<li>${esc(question)}</li>`).join('')}</ul></div>` : '';

function sell() {
  const draft = state.listingDraft || {};
  const missing = listingMissing(draft);
  return `<main class="container form-layout"><div class="form-head"><span class="section-kicker">SELL YOUR DEVICE</span><h1>기기를 판매해 볼까요?</h1><p>정보를 입력하고 검토한 뒤, 게시 여부는 직접 결정해 주세요.</p></div>
    <div class="form-columns"><div class="form-panel"><div class="panel-heading"><div class="step-number">01</div><div><h2>판매 정보 입력</h2><p>알고 있는 정보만 정확하게 적어 주세요.</p></div></div>
    ${isDemo ? `<button class="sample-link" id="load-agent-listing">${icon('spark', 18)} Agent 초안 예시 불러오기 ${icon('arrow', 16)}</button>` : ''}
    ${missingBox(unresolvedFields(draft, listingMissing))}${questionsBox(draft.nextQuestions)}
    <form id="sell-form"><div class="form-grid">${field('기기 종류 *', 'category', categorySelect(draft.category))}${field('브랜드', 'brand', input('brand', '예: Apple', draft.brand))}</div>
    <div class="form-grid">${field('모델명 *', 'model', input('model', '예: iPhone 15 Pro', draft.model, 'text', true))}${field('저장 용량', 'storageGb', input('storageGb', '예: 256', draft.storageGb, 'number'))}</div>
    ${field('제목', 'title', input('title', '제목을 입력해 주세요', draft.title))}
    <div class="form-grid">${field('가격 *', 'priceKrw', input('priceKrw', '예: 800000', draft.priceKrw, 'number', true))}${field('제품 상태', 'condition', conditionSelect(draft.condition))}</div>
    ${field('구성품', 'accessories', input('accessories', '예: 박스, 충전 케이블', draft.accessories))}
    ${field('상세 설명', 'description', `<textarea name="description" rows="5" placeholder="기기의 상태와 특징을 알려주세요">${esc(draft.description)}</textarea>`)}
    ${field('사진 (선택)', 'photo', `<div class="upload-box">${icon('upload', 21)}<span>사진을 선택해 주세요</span><small>사진은 표시만 하며 AI 분석에는 사용하지 않습니다.</small><input name="photo" type="file" accept="image/*" aria-label="사진 업로드" /></div>`)}
    <div class="form-actions"><button type="submit" class="btn btn-outline" name="action" value="save">임시저장</button><button type="submit" class="btn btn-dark" name="action" value="review">검토하기 ${icon('arrow', 18)}</button></div></form></div>
    <aside class="side-panel"><div class="side-icon">${icon('shield', 24)}</div><h3>게시 전, 한 번 더 확인해요</h3><p>Agent가 만든 내용도 틀릴 수 있어요. 모델과 가격, 상태를 직접 확인한 뒤 게시해 주세요.</p><div class="side-rule"></div><ul><li>${icon('check', 16)} 초안은 자동 게시되지 않아요</li><li>${icon('check', 16)} 필수 정보가 있어야 게시할 수 있어요</li><li>${icon('check', 16)} 사진에서 상태를 추정하지 않아요</li></ul></aside></div></main>`;
}

function reviewListing() {
  const d = state.listingDraft;
  if (!d) return sell();
  const missing = unresolvedFields(d, listingMissing);
  return `<main class="container review-page"><button class="back-link" data-nav="sell">← 정보 수정하기</button><div class="review-title"><span class="section-kicker">FINAL REVIEW</span><h1>판매글을 확인해 주세요</h1><p>아래 내용을 검토한 뒤 직접 게시할 수 있어요.</p></div>
    <div class="review-grid"><div class="review-card"><div class="review-visual visual-${(d.category || 'PHONE').toLowerCase()}">${productArt(d)}</div><div class="review-content"><div class="agent-label">${icon('spark', 16)} ${d.source === 'AGENT' ? 'Agent 초안' : '직접 작성한 초안'}</div><h2>${esc(d.title || `${d.model || '모델 미입력'} 판매글`)}</h2><strong class="review-price">${formatPrice(d.priceKrw)}</strong><div class="detail-table"><div><span>기기 종류</span><strong>${categories[d.category] || '확인 필요'}</strong></div><div><span>모델</span><strong>${esc(d.model || '확인 필요')}</strong></div><div><span>용량</span><strong>${d.storageGb ? `${esc(d.storageGb)}GB` : '확인 필요'}</strong></div><div><span>상태</span><strong>${conditions[d.condition] || '확인 필요'}</strong></div><div><span>구성품</span><strong>${esc(d.accessories || '확인 필요')}</strong></div></div><h3>설명</h3><p class="description">${esc(d.description || '설명이 없습니다.')}</p></div></div>
    <div class="approval-panel"><div class="approval-icon">${icon('shield', 27)}</div><h2>게시 승인은 직접</h2><p>게시하면 다른 사용자가 이 매물을 검색할 수 있습니다. 모든 정보가 정확한지 확인해 주세요.</p>${missingBox(missing)}${questionsBox(d.nextQuestions)}
    <button class="btn btn-dark full" id="publish-button" ${listingMissing(d).length ? 'disabled' : ''}>확인하고 게시하기 ${icon('arrow', 18)}</button><button class="btn btn-plain full" data-nav="sell">계속 수정하기</button></div></div></main>`;
}

function buy() {
  const d = state.purchaseDraft || {};
  return `<main class="container form-layout"><div class="form-head"><span class="section-kicker">FIND YOUR MATCH</span><h1>어떤 기기를 찾고 있나요?</h1><p>원하는 조건을 정리하고, 확인한 뒤 직접 검색을 시작하세요.</p></div>
    <div class="form-columns"><div class="form-panel"><div class="panel-heading"><div class="step-number">01</div><div><h2>구매 조건 입력</h2><p>기기 종류와 예산만 있어도 시작할 수 있어요.</p></div></div>
    ${isDemo ? `<button class="sample-link" id="load-agent-request">${icon('spark', 18)} Agent 조건 초안 예시 불러오기 ${icon('arrow', 16)}</button>` : ''}
    ${missingBox(unresolvedFields(d, requestMissing))}${questionsBox(d.nextQuestions)}
    <form id="buy-form"><div class="form-grid">${field('기기 종류 *', 'category', categorySelect(d.category))}${field('최대 예산 *', 'maxBudgetKrw', input('maxBudgetKrw', '예: 1000000', d.maxBudgetKrw, 'number', true))}</div>
    <div class="form-grid">${field('원하는 모델', 'modelQuery', input('modelQuery', '예: iPad, Galaxy Tab', d.modelQuery), '비워 두면 모든 모델을 검색해요.')}${field('최소 저장 용량', 'storageGb', input('storageGb', '예: 128', d.storageGb, 'number'))}</div>
    <fieldset class="condition-field"><legend>원하는 제품 상태</legend><div class="choice-row">${Object.entries(conditions).map(([key, label]) => `<label class="choice"><input type="checkbox" name="conditionPreferences" value="${key}" ${(d.conditionPreferences || []).includes(key) ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div><small>선택하지 않으면 모든 상태를 포함해요.</small></fieldset>
    <div class="form-actions"><button type="submit" class="btn btn-outline" name="action" value="save">조건 저장</button><button type="submit" class="btn btn-dark" name="action" value="review">조건 확인하기 ${icon('arrow', 18)}</button></div></form></div>
    <aside class="side-panel side-buy"><div class="side-icon">${icon('spark', 24)}</div><h3>내 조건에 집중해서 찾아요</h3><p>기기 종류와 예산을 우선 적용하고, 모델·용량·상태를 추가하면 후보를 더 좁힐 수 있어요.</p><div class="side-rule"></div><ul><li>${icon('check', 16)} 검색은 내가 확인한 뒤 실행돼요</li><li>${icon('check', 16)} 구매 조건은 공개되지 않아요</li><li>${icon('check', 16)} 정보가 부족한 매물은 따로 표시해요</li></ul></aside></div>
    <div class="mine-head draft-head"><h2>저장한 구매 조건 <span>${state.purchaseRequests.length}</span></h2></div>${state.purchaseRequests.length ? `<div class="draft-list">${state.purchaseRequests.map(request => `<button data-edit-request="${esc(request.id)}"><div><span class="status-pill draft">${request.status === 'CONFIRMED' ? '검색 가능' : '조건 보완 필요'}</span><h3>${categories[request.category] || '기기 미정'} · ${request.maxBudgetKrw ? formatPrice(request.maxBudgetKrw) : '예산 미정'}</h3><p>${request.source === 'AGENT' ? 'Agent 조건 초안' : '직접 작성한 조건'}</p></div>${icon('chevron', 20)}</button>`).join('')}</div>` : ''}</main>`;
}

function reviewRequest() {
  const d = state.purchaseDraft;
  if (!d) return buy();
  const missing = unresolvedFields(d, requestMissing);
  return `<main class="container review-page"><button class="back-link" data-nav="buy">← 조건 수정하기</button><div class="review-title"><span class="section-kicker">YOUR SEARCH</span><h1>검색 조건을 확인해 주세요</h1><p>조건을 확정하면 등록된 매물에서 후보를 찾아요.</p></div>
    <div class="review-grid"><div class="review-card request-review"><div class="review-content"><div class="agent-label">${icon('spark', 16)} ${d.source === 'AGENT' ? 'Agent 조건 초안' : '직접 작성한 조건'}</div><h2>내가 찾는 기기</h2><div class="detail-table"><div><span>기기 종류</span><strong>${categories[d.category] || '확인 필요'}</strong></div><div><span>최대 예산</span><strong>${d.maxBudgetKrw ? formatPrice(d.maxBudgetKrw) : '확인 필요'}</strong></div><div><span>모델</span><strong>${esc(d.modelQuery || (missing.includes('modelQuery') ? '미확정' : '상관없음'))}</strong></div><div><span>최소 용량</span><strong>${d.storageGb ? `${esc(d.storageGb)}GB` : '상관없음'}</strong></div><div><span>제품 상태</span><strong>${d.conditionPreferences?.length ? d.conditionPreferences.map(x => conditions[x]).join(', ') : '상관없음'}</strong></div></div></div></div>
    <div class="approval-panel"><div class="approval-icon">${icon('search', 27)}</div><h2>직접 검색 승인</h2><p>이 조건으로 검색을 실행합니다. Agent는 승인 전 검색을 확정할 수 없습니다.</p>${missingBox(missing)}${questionsBox(d.nextQuestions)}<button class="btn btn-dark full" id="search-button" ${requestMissing(d).length ? 'disabled' : ''}>조건 확인하고 검색하기 ${icon('arrow', 18)}</button><button class="btn btn-plain full" data-nav="buy">조건 수정하기</button></div></div></main>`;
}

function results() {
  const matches = state.results.filter(x => x.matchStatus === 'MATCH');
  const needs = state.results.filter(x => x.matchStatus === 'NEEDS_CONFIRMATION');
  return `<main class="container page-main"><button class="back-link" data-nav="buy">← 조건 다시 설정하기</button><div class="page-intro"><span class="section-kicker">YOUR RESULTS</span><h1>찾으시는 기기, 여기 있어요</h1><p>조건에 맞는 후보 ${matches.length}개${needs.length ? `와 확인이 필요한 후보 ${needs.length}개` : ''}를 찾았습니다.</p></div>
    <div class="result-summary">${icon('shield', 21)} <span>확인되지 않은 정보는 조건 충족으로 판단하지 않아요.</span></div>
    <div class="section-heading compact"><div><h2>조건에 맞는 매물 <span>${matches.length}</span></h2></div></div>
    ${matches.length ? `<div class="product-grid">${matches.map(x => card(x.listing, x)).join('')}</div>` : `<div class="empty-state">${icon('search', 28)}<h3>조건에 딱 맞는 매물이 없어요</h3><p>예산이나 모델 조건을 조정해 보세요.</p></div>`}
    ${needs.length ? `<div class="section-heading compact needs-heading"><div><h2>확인이 필요한 매물 <span>${needs.length}</span></h2><p>정보가 부족해 판매자에게 확인이 필요한 후보예요.</p></div></div><div class="product-grid">${needs.map(x => card(x.listing, x)).join('')}</div>` : ''}</main>`;
}

function detail() {
  const item = state.selected;
  if (!item) return browse();
  const result = state.results.find(x => x.listingId === item.id);
  return `<main class="container detail-page"><button class="back-link" data-nav="${state.results.length ? 'results' : 'browse'}">← 목록으로 돌아가기</button><div class="detail-grid"><div class="detail-visual visual-${item.category.toLowerCase()}">${productArt(item)}</div>
    <div class="detail-copy"><div class="detail-kicker">${categories[item.category]} <span>·</span> ${esc(item.brand || '')}</div><h1>${esc(item.title)}</h1><div class="detail-price">${formatPrice(item.priceKrw)}</div><div class="detail-divider"></div>
    ${result ? `<div class="result-detail ${result.matchStatus === 'MATCH' ? 'matched' : 'needs'}"><strong>${result.matchStatus === 'MATCH' ? `${icon('check', 18)} 조건에 맞는 매물` : `${icon('alert', 18)} 확인이 필요한 매물`}</strong><p>${result.matchedFields?.length ? `충족: ${result.matchedFields.map(labelFor).map(esc).join(', ')}` : ''}</p>${result.missingFields?.length ? `<p>확인 필요: ${result.missingFields.map(labelFor).map(esc).join(', ')}</p>` : ''}</div>` : missingBox(item.missingFields)}
    <div class="detail-table"><div><span>모델</span><strong>${esc(item.model || '확인 필요')}</strong></div><div><span>저장 용량</span><strong>${item.storageGb ? `${esc(item.storageGb)}GB` : '확인 필요'}</strong></div><div><span>제품 상태</span><strong>${conditions[item.condition] || '확인 필요'}</strong></div><div><span>구성품</span><strong>${esc(item.accessories || '확인 필요')}</strong></div></div><div class="detail-note">${icon('shield', 19)} 확인되지 않은 정보는 판매자에게 직접 확인해 주세요.</div></div></div>
    <section class="description-section"><h2>판매자의 설명</h2><p>${esc(item.description || '설명이 없습니다.')}</p></section></main>`;
}

function mine() {
  return `<main class="container page-main"><div class="page-intro"><span class="section-kicker">MY LISTINGS</span><h1>내 판매글</h1><p>내가 올린 매물과 저장한 초안을 확인하세요.</p></div>
    <div class="mine-head"><h2>게시된 매물 <span>${state.myListings.length}</span></h2><button class="btn btn-dark" data-new-listing>${icon('plus', 17)} 새 판매글</button></div>
    ${state.myListings.length ? `<div class="my-list">${state.myListings.map(item => `<div class="my-row"><div class="my-art visual-${item.category.toLowerCase()}">${productArt(item)}</div><div><span class="status-pill ${item.status.toLowerCase()}">${item.status === 'ACTIVE' ? '검색 가능' : '비활성'}</span><h3>${esc(item.title)}</h3><p>${formatPrice(item.priceKrw)}</p></div><div class="my-actions"><button class="btn btn-outline" data-detail="${esc(item.id)}">상세 보기</button><button class="btn btn-outline" data-revise="${esc(item.id)}">수정 시작</button>${item.status === 'ACTIVE' ? `<button class="btn btn-outline" data-find-demand="${esc(item.id)}">맞는 구해요</button><button class="btn btn-plain" data-deactivate="${esc(item.id)}">비활성화</button>` : ''}</div></div>`).join('')}</div>` : `<div class="empty-state">${icon('bag', 28)}<h3>아직 게시된 판매글이 없어요</h3><p>기기를 등록해 첫 판매글을 만들어 보세요.</p></div>`}
    <div class="mine-head draft-head"><h2>저장한 초안 <span>${state.drafts.length}</span></h2></div>${state.drafts.length ? `<div class="draft-list">${state.drafts.map(d => `<button data-edit-draft="${esc(d.id)}"><div><span class="status-pill draft">${d.status === 'READY_FOR_REVIEW' ? 'Agent 초안 검토 필요' : '작성 중 · 보완 필요'}</span><h3>${esc(d.title || d.model || '제목 없는 초안')}</h3><p>${d.source === 'AGENT' ? 'Agent 초안' : '직접 작성'} · ${categories[d.category] || '종류 미정'}</p></div>${icon('chevron', 20)}</button>`).join('')}</div>` : `<p class="no-drafts">저장한 초안이 없습니다.</p>`}</main>`;
}

const demandStatusLabel = { DRAFT: '비공개 초안', ACTIVE: '공개 중', PAUSED: '일시정지', CLOSED: '종료', EXPIRED: '만료' };
const connectionStatusLabel = { PENDING: '응답 대기', ACCEPTED: '수락', DECLINED: '거절' };
const notificationLabel = { NEW_MATCH: '새 매칭 후보가 생겼어요', CONNECTION_REQUEST: '판매자가 연결을 요청했어요',
  CONNECTION_ACCEPTED: '연결 요청이 수락됐어요', CONNECTION_DECLINED: '연결 요청이 거절됐어요' };

function demandPage() {
  if (isDemo) return `<main class="container page-main"><div class="page-intro"><span class="section-kicker">PUBLIC DEMAND</span><h1>구해요·알림</h1><p>공개 수요와 연결 요청은 백엔드를 실행한 뒤 이용할 수 있어요.</p></div></main>`;
  const selected = state.selectedDemand && state.publicDemands.find(item => item.id === state.selectedDemand.id);
  const available = state.purchaseRequests.filter(item => item.status === 'CONFIRMED' && !state.publicDemands.some(d => d.purchaseRequestId === item.id));
  const connections = state.connections;
  return `<main class="container page-main"><div class="page-intro"><span class="section-kicker">PUBLIC DEMAND</span><h1>구해요·알림</h1><p>구매 조건은 기본적으로 비공개예요. 공개할 내용은 내가 검토하고 직접 승인합니다.</p></div>
    <div class="result-summary">${icon('shield', 20)} <span>연락처와 정확한 주소는 공개 내용에 적지 마세요. 판매자의 연결 요청도 직접 수락해야 합니다.</span></div>
    <div class="mine-head"><h2>공개 수요로 만들기</h2></div>
    ${available.length ? `<div class="draft-list">${available.map(item => `<button data-create-demand="${esc(item.id)}"><div><h3>${categories[item.category]} · ${item.modelQuery ? esc(item.modelQuery) : '모델 무관'}</h3><p>최대 ${formatPrice(item.maxBudgetKrw)} · 클릭하면 비공개 초안을 만듭니다</p></div>${icon('plus', 20)}</button>`).join('')}</div>` : `<p class="no-drafts">새로 공개할 확정 구매 조건이 없습니다. 맞춤 검색에서 조건을 확정해 주세요.</p>`}
    <div class="mine-head draft-head"><h2>내 구해요 <span>${state.publicDemands.length}</span></h2></div>
    ${state.publicDemands.length ? `<div class="draft-list">${state.publicDemands.map(d => `<div class="demand-row"><div><span class="status-pill ${d.status === 'ACTIVE' ? 'active' : 'draft'}">${demandStatusLabel[d.status]}</span><h3>${esc(d.title)}</h3><p>${categories[d.category]} · ${d.modelQuery ? esc(d.modelQuery) : '모델 무관'} · 최대 ${formatPrice(d.maxBudgetKrw)}</p></div><div class="demand-actions"><button class="btn btn-outline" data-select-demand="${esc(d.id)}">내용 확인·수정</button>${d.status === 'ACTIVE' ? `<button class="btn btn-plain" data-demand-action="pause" data-demand-id="${esc(d.id)}">일시정지</button>` : ''}${d.status === 'PAUSED' ? `<button class="btn btn-outline" data-demand-action="resume" data-demand-id="${esc(d.id)}">다시 공개</button>` : ''}${['ACTIVE', 'PAUSED'].includes(d.status) ? `<button class="btn btn-plain" data-demand-action="close" data-demand-id="${esc(d.id)}">종료</button>` : ''}</div></div>`).join('')}</div>` : `<p class="no-drafts">아직 공개 수요 초안이 없습니다.</p>`}
    ${selected ? `<section class="demand-editor"><div class="mine-head"><h2>공개 내용 확인</h2></div><form id="demand-form"><div class="form-grid">${field('공개 제목 *', 'title', input('title', '예: iPad Air 구해요', selected.title, 'text', true))}${field('최대 예산 *', 'maxBudgetKrw', input('maxBudgetKrw', '예: 600000', selected.maxBudgetKrw, 'number', true))}</div><div class="form-grid">${field('최소 예산', 'minBudgetKrw', input('minBudgetKrw', '선택', selected.minBudgetKrw, 'number'))}${field('원하는 모델', 'modelQuery', input('modelQuery', '선택', selected.modelQuery))}</div><div class="form-grid">${field('최소 용량', 'storageGb', input('storageGb', '선택', selected.storageGb, 'number'))}${field('공개 종료일', 'expiresAt', input('expiresAt', '', selected.expiresAt?.slice(0, 10), 'date'))}</div>${field('공개 설명', 'description', `<textarea name="description" rows="3" placeholder="공개해도 되는 내용만 적어 주세요">${esc(selected.description)}</textarea>`)}<fieldset class="condition-field"><legend>허용하는 제품 상태</legend><div class="choice-row">${Object.entries(conditions).map(([key, label]) => `<label class="choice"><input type="checkbox" name="conditionPreferences" value="${key}" ${(selected.conditionPreferences || []).includes(key) ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div></fieldset><div class="form-actions"><button class="btn btn-outline" type="submit" value="save">내용 저장</button>${selected.status === 'DRAFT' ? `<button class="btn btn-dark" type="submit" value="publish">검토하고 공개하기</button>` : ''}</div></form></section>` : ''}
    <div class="mine-head draft-head"><h2>연결 요청·내역 <span>${connections.length}</span></h2></div>${connections.length ? `<div class="draft-list">${connections.map(item => `<div class="demand-row"><div><span class="status-pill ${item.status === 'ACCEPTED' ? 'active' : 'draft'}">${connectionStatusLabel[item.status]}</span><h3>${esc(state.publicDemands.find(d => d.id === item.publicDemandId)?.title || '공개 수요')}</h3><p>매물: ${esc(state.listings.find(listing => listing.id === item.listingId)?.title || item.listingId.slice(-12))}</p></div>${item.buyerId && item.status === 'PENDING' ? `<div class="demand-actions"><button class="btn btn-dark" data-connection-action="accept" data-connection-id="${esc(item.id)}">수락</button><button class="btn btn-outline" data-connection-action="decline" data-connection-id="${esc(item.id)}">거절</button></div>` : ''}</div>`).join('')}</div>` : `<p class="no-drafts">연결 내역이 없습니다.</p>`}
    <div class="mine-head draft-head"><h2>알림 <span>${state.notifications.filter(item => !item.readAt).length}</span></h2></div>${state.notifications.length ? `<div class="draft-list">${state.notifications.map(item => `<div class="demand-row"><div><h3>${notificationLabel[item.type] || '새 알림'}</h3><p>${new Date(item.createdAt).toLocaleString('ko-KR')}</p></div>${item.readAt ? '<span class="status-pill draft">읽음</span>' : `<button class="btn btn-outline" data-read-notification="${esc(item.id)}">확인</button>`}</div>`).join('')}</div>` : `<p class="no-drafts">아직 알림이 없습니다.</p>`}</main>`;
}

function sellerDemandPage() {
  const listing = state.matchingListing;
  if (!listing) return mine();
  return `<main class="container page-main"><button class="back-link" data-nav="mine">← 내 판매글</button><div class="page-intro"><span class="section-kicker">REVERSE MATCH</span><h1>내 매물과 맞는 구해요</h1><p>${esc(listing.title)}에 맞는 공개 구매 수요입니다.</p></div>
    ${state.sellerMatches.length ? `<div class="demand-grid">${state.sellerMatches.map(item => {
      const d = item.demand;
      const requested = state.connections.find(c => c.publicDemandId === d.id && c.listingId === listing.id);
      return `<article class="demand-card"><span class="match-badge ${item.matchStatus === 'MATCH' ? 'match' : 'needs'}">${item.matchStatus === 'MATCH' ? '조건 충족' : '확인 필요'}</span><h2>${esc(d.title)}</h2><p>${categories[d.category]} · ${esc(d.modelQuery || '모델 무관')} · ${d.storageGb ? `${esc(d.storageGb)}GB 이상` : '용량 무관'}</p><strong>${d.minBudgetKrw ? `${formatPrice(d.minBudgetKrw)} ~ ` : '최대 '}${formatPrice(d.maxBudgetKrw)}</strong>${d.description ? `<p>${esc(d.description)}</p>` : ''}<p>충족: ${item.matchedFields.map(labelFor).map(esc).join(', ') || '추가 확인 필요'}</p>${item.missingFields.length ? `<p>확인 필요: ${item.missingFields.map(labelFor).map(esc).join(', ')}</p>` : ''}${requested ? `<span class="status-pill draft">연결 요청 ${connectionStatusLabel[requested.status]}</span>` : item.matchStatus === 'MATCH' ? `<button class="btn btn-dark" data-connect="${esc(d.id)}">판매자가 연결 요청하기</button>` : `<span class="status-pill draft">정보 확인 후 연결 가능</span>`}</article>`;
    }).join('')}</div>` : `<div class="empty-state"><h3>아직 맞는 공개 수요가 없어요</h3><p>새 수요가 등록되면 알림에서 확인할 수 있어요.</p></div>`}</main>`;
}

function agentPage() {
  if (isDemo) return `<main class="container page-main"><div class="page-intro"><h1>Agent 연결</h1><p>외부 Agent 연결은 백엔드를 실행한 뒤 이용할 수 있어요.</p></div></main>`;
  return `<main class="container page-main"><div class="page-intro"><span class="section-kicker">CONNECT YOUR AGENT</span><h1>외부 Agent 연결</h1><p>내 Agent가 초안을 만들고 매물을 찾을 수 있도록 필요한 권한만 선택하세요. 게시·공개·연결 결정은 Web에서 직접 합니다.</p></div>
    <div class="result-summary">${icon('shield', 20)} <span>토큰은 발급 직후 한 번만 표시됩니다. 믿을 수 있는 개인 Agent 설정에만 입력하고, 필요 없으면 아래에서 폐기하세요.</span></div>
    <section class="demand-editor"><div class="mine-head"><h2>새 Agent 토큰</h2></div><form id="token-form"><div class="form-grid">${field('토큰 이름 *', 'name', input('name', '예: 내 개인 Agent', '', 'text', true))}${field('유효 기간', 'expiresInDays', `<select name="expiresInDays"><option value="7">7일</option><option value="30" selected>30일</option><option value="90">90일</option></select>`)}</div><fieldset class="condition-field"><legend>사용 권한</legend><div class="choice-row"><label class="choice"><input type="checkbox" value="read" checked disabled /><span>매물·내 데이터 조회</span></label><label class="choice"><input type="checkbox" name="scopes" value="listing:write" /><span>판매 초안 작성</span></label><label class="choice"><input type="checkbox" name="scopes" value="purchase:write" /><span>구매 초안 작성</span></label><label class="choice"><input type="checkbox" name="scopes" value="search" /><span>확정 조건 검색</span></label></div></fieldset><div class="form-actions"><button class="btn btn-dark" type="submit">토큰 발급하기</button></div></form>
    ${state.issuedToken ? `<div class="token-reveal" role="status"><strong>지금 한 번만 복사해 주세요</strong><code>${esc(state.issuedToken)}</code><button class="btn btn-outline" id="copy-token">토큰 복사</button></div>` : ''}</section>
    <div class="mine-head draft-head"><h2>내 Agent 토큰 <span>${state.tokens.length}</span></h2></div>${state.tokens.length ? `<div class="draft-list">${state.tokens.map(token => `<div class="demand-row"><div><span class="status-pill ${token.revokedAt ? 'draft' : 'active'}">${token.revokedAt ? '폐기됨' : '사용 중'}</span><h3>${esc(token.name)}</h3><p>${esc(token.tokenPrefix)}… · ${token.scopes.map(esc).join(', ')} · 만료 ${token.expiresAt ? new Date(token.expiresAt).toLocaleDateString('ko-KR') : '없음'}</p></div>${token.revokedAt ? '' : `<button class="btn btn-outline" data-revoke-token="${esc(token.id)}">폐기</button>`}</div>`).join('')}</div>` : `<p class="no-drafts">발급한 토큰이 없습니다.</p>`}
    <div class="agent-guide"><h2>연결 방법</h2><p>로컬 Agent 앱에서 MCP 서버를 실행할 때 발급한 토큰을 <code>AGENT_MARKET_TOKEN</code> 환경 변수로 설정하세요. 원격 MCP 주소와 설정 예시는 저장소의 MCP 연결 가이드에 있습니다.</p></div></main>`;
}

function render() {
  const pages = { home, browse, sell, 'review-listing': reviewListing, buy, 'review-request': reviewRequest, results, detail, mine,
    demand: demandPage, 'seller-demand': sellerDemandPage, agent: agentPage };
  root.innerHTML = `${header()}${demoAccountBar()}${state.notice ? `<div class="toast success" role="status">${esc(state.notice)}</div>` : ''}${state.error ? `<div class="toast error" role="alert">${esc(state.error)}</div>` : ''}${(pages[state.page] || home)()}${footer()}`;
  attach();
}

function showError(error) { state.error = error.message || String(error); state.notice = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function getForm(form) {
  const raw = new FormData(form);
  return Object.fromEntries(raw.entries());
}
function attach() {
  root.querySelectorAll('[data-switch-account]').forEach(button => button.addEventListener('click', async () => {
    if (button.dataset.switchAccount === currentDemoAccount()) return;
    try { switchDemoAccount(button.dataset.switchAccount); state.listingDraft = null; state.purchaseDraft = null; state.selectedDemand = null; state.issuedToken = null;
      state.sellerMatches = []; state.matchingListing = null; state.results = []; await refresh(); navigate('home');
      state.notice = `${button.dataset.switchAccount === 'seller' ? '판매자' : '구매자'} 계정으로 전환했습니다.`; render(); }
    catch (error) { showError(error); }
  }));
  root.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));
  root.querySelectorAll('[data-new-listing]').forEach(button => button.addEventListener('click', () => navigate('sell', { listingDraft: null })));
  root.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { state.category = button.dataset.category; render(); }));
  root.querySelector('#browse-search')?.addEventListener('input', event => { const start = event.target.selectionStart; state.searchTerm = event.target.value; render(); const next = root.querySelector('#browse-search'); next.focus(); next.setSelectionRange(start, start); });
  root.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', async () => { try { const selected = await api.getListing(button.dataset.detail); navigate('detail', { selected }); } catch (error) { showError(error); } }));
  root.querySelector('#load-agent-listing')?.addEventListener('click', () => navigate('sell', { listingDraft: { source: 'AGENT', category: 'PHONE', brand: 'Apple', model: 'iPhone 15 Pro', storageGb: 256, condition: 'GOOD', title: 'iPhone 15 Pro 256GB 내추럴 티타늄', description: '사용감이 적고 정상 작동합니다. 정확한 배터리 상태는 확인이 필요합니다.', accessories: '박스, 충전 케이블', priceKrw: 890000, missingFields: ['batteryHealth'], nextQuestions: ['배터리 성능 수치를 확인할 수 있나요?'] } }));
  root.querySelector('#load-agent-request')?.addEventListener('click', () => navigate('buy', { purchaseDraft: { source: 'AGENT', category: 'TABLET', maxBudgetKrw: 1000000, modelQuery: '', storageGb: 128, conditionPreferences: [], missingFields: ['modelQuery'], nextQuestions: ['원하는 모델이나 모델군이 있나요?'] } }));
  root.querySelector('#sell-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const action = event.submitter?.value || 'review';
    const form = event.currentTarget;
    const data = getForm(form);
    const photo = form.elements.photo.files?.[0];
    const images = state.listingDraft?.images || [];
    if (photo) {
      if (photo.size > 1_000_000) return showError(new Error('사진은 1MB 이하로 선택해 주세요.'));
      images[0] = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(photo); });
    }
    const draft = { ...state.listingDraft, ...data, storageGb: data.storageGb ? Number(data.storageGb) : null,
      priceKrw: data.priceKrw ? Number(data.priceKrw) : null, images };
    delete draft.photo; delete draft.action;
    try { const saved = await api.saveListingDraft(draft); state.listingDraft = saved; await refresh(); navigate(action === 'save' ? 'mine' : 'review-listing', { listingDraft: saved }); if (action === 'save') { state.notice = '판매 초안을 저장했습니다.'; render(); } }
    catch (error) { showError(error); }
  });
  root.querySelector('#publish-button')?.addEventListener('click', async () => { try { await api.publishListing(state.listingDraft.id); state.listingDraft = null; await refresh(); navigate('mine'); state.notice = '판매글이 게시되었습니다.'; render(); } catch (error) { showError(error); } });
  root.querySelector('#buy-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const action = event.submitter?.value || 'review'; const data = getForm(event.currentTarget);
    const draft = { ...state.purchaseDraft, ...data, maxBudgetKrw: data.maxBudgetKrw ? Number(data.maxBudgetKrw) : null,
      storageGb: data.storageGb ? Number(data.storageGb) : null,
      conditionPreferences: [...event.currentTarget.querySelectorAll('[name="conditionPreferences"]:checked')].map(x => x.value) };
    delete draft.action;
    try { const saved = await api.savePurchaseRequest(draft); state.purchaseDraft = saved; await refresh(); navigate(action === 'save' ? 'buy' : 'review-request', { purchaseDraft: saved }); if (action === 'save') { state.notice = '구매 조건을 저장했습니다.'; render(); } }
    catch (error) { showError(error); }
  });
  root.querySelector('#search-button')?.addEventListener('click', async () => { try { const confirmed = await api.confirmPurchaseRequest(state.purchaseDraft.id); const results = await api.search(confirmed.id); await refresh(); navigate('results', { purchaseDraft: confirmed, results }); } catch (error) { showError(error); } });
  root.querySelectorAll('[data-edit-draft]').forEach(button => button.addEventListener('click', () => { const draft = state.drafts.find(item => item.id === button.dataset.editDraft); navigate('sell', { listingDraft: draft }); }));
  root.querySelectorAll('[data-edit-request]').forEach(button => button.addEventListener('click', () => { const draft = state.purchaseRequests.find(item => item.id === button.dataset.editRequest); navigate('buy', { purchaseDraft: draft }); }));
  root.querySelectorAll('[data-revise]').forEach(button => button.addEventListener('click', async () => { try { const draft = await api.startListingRevision(button.dataset.revise); await refresh(); navigate('sell', { listingDraft: draft }); } catch (error) { showError(error); } }));
  root.querySelectorAll('[data-deactivate]').forEach(button => button.addEventListener('click', async () => { if (!confirm('이 매물을 검색에서 제외할까요?')) return; try { await api.deactivateListing(button.dataset.deactivate); await refresh(); state.notice = '매물을 비활성화했습니다.'; render(); } catch (error) { showError(error); } }));
  root.querySelectorAll('[data-create-demand]').forEach(button => button.addEventListener('click', async () => { try { const demand = await api.createPublicDemandDraft(button.dataset.createDemand); await refresh(); navigate('demand', { selectedDemand: demand }); } catch (error) { showError(error); } }));
  root.querySelectorAll('[data-select-demand]').forEach(button => button.addEventListener('click', () => { state.selectedDemand = state.publicDemands.find(item => item.id === button.dataset.selectDemand); render(); root.querySelector('.demand-editor')?.scrollIntoView({ behavior: 'smooth' }); }));
  root.querySelector('#demand-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = getForm(event.currentTarget);
    const changes = { title: data.title, description: data.description || null, modelQuery: data.modelQuery || null,
      minBudgetKrw: data.minBudgetKrw ? Number(data.minBudgetKrw) : null,
      maxBudgetKrw: data.maxBudgetKrw ? Number(data.maxBudgetKrw) : null,
      storageGb: data.storageGb ? Number(data.storageGb) : null,
      expiresAt: data.expiresAt ? new Date(`${data.expiresAt}T23:59:59`).toISOString() : null,
      conditionPreferences: [...event.currentTarget.querySelectorAll('[name="conditionPreferences"]:checked')].map(x => x.value) };
    try {
      let selectedDemand = await api.updatePublicDemand(state.selectedDemand.id, changes);
      if (event.submitter?.value === 'publish') selectedDemand = await api.changePublicDemandStatus(selectedDemand.id, 'publish');
      await refresh(); state.selectedDemand = selectedDemand;
      state.notice = event.submitter?.value === 'publish' ? '구매 수요를 공개했습니다.' : '공개 내용을 저장했습니다.'; render();
    }
    catch (error) { showError(error); }
  });
  root.querySelectorAll('[data-demand-action]').forEach(button => button.addEventListener('click', async () => {
    try { await api.changePublicDemandStatus(button.dataset.demandId, button.dataset.demandAction); await refresh(); state.notice = '공개 상태를 변경했습니다.'; render(); }
    catch (error) { showError(error); }
  }));
  root.querySelectorAll('[data-find-demand]').forEach(button => button.addEventListener('click', async () => {
    try { const listing = state.myListings.find(item => item.id === button.dataset.findDemand); const sellerMatches = await api.matchingPublicDemands(listing.id); navigate('seller-demand', { matchingListing: listing, sellerMatches }); }
    catch (error) { showError(error); }
  }));
  root.querySelectorAll('[data-connect]').forEach(button => button.addEventListener('click', async () => {
    try { await api.createConnectionRequest(button.dataset.connect, state.matchingListing.id); await refresh(); state.notice = '구매자에게 연결을 요청했습니다.'; render(); }
    catch (error) { showError(error); }
  }));
  root.querySelectorAll('[data-connection-action]').forEach(button => button.addEventListener('click', async () => {
    try { await api.respondConnectionRequest(button.dataset.connectionId, button.dataset.connectionAction); await refresh(); state.notice = '연결 요청을 처리했습니다.'; render(); }
    catch (error) { showError(error); }
  }));
  root.querySelectorAll('[data-read-notification]').forEach(button => button.addEventListener('click', async () => {
    try { await api.markNotificationRead(button.dataset.readNotification); await refresh(); render(); }
    catch (error) { showError(error); }
  }));
  root.querySelector('#token-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const details = { name: form.elements.name.value,
      expiresInDays: Number(form.elements.expiresInDays.value),
      scopes: ['read', ...[...form.querySelectorAll('[name="scopes"]:checked')].map(item => item.value)] };
    try { const issued = await api.issueAgentToken(details); state.issuedToken = issued.token; await refresh(); state.notice = '토큰을 발급했습니다. 지금 복사해 주세요.'; render(); }
    catch (error) { showError(error); }
  });
  root.querySelector('#copy-token')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.issuedToken); state.notice = '토큰을 복사했습니다.'; render(); }
    catch { showError(new Error('복사할 수 없습니다. 토큰을 직접 선택해 복사해 주세요.')); }
  });
  root.querySelectorAll('[data-revoke-token]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('이 토큰을 폐기할까요? 연결된 Agent는 즉시 사용할 수 없게 됩니다.')) return;
    try { await api.revokeAgentToken(button.dataset.revokeToken); state.issuedToken = null; await refresh(); state.notice = '토큰을 폐기했습니다.'; render(); }
    catch (error) { showError(error); }
  }));
}

async function refresh() {
  [state.listings, state.myListings, state.drafts, state.purchaseRequests, state.publicDemands, state.connections, state.notifications, state.tokens] = await Promise.all([
    api.listListings(), api.listMyListings(), api.listMyDrafts(), api.listMyPurchaseRequests(),
    api.listMyPublicDemands(), api.listConnections(), api.listNotifications(), api.listAgentTokens(),
  ]);
}

try { state.demoAuth = (await api.authMode()) === 'demo'; await refresh(); state.page = ({ '#browse': 'browse', '#sell': 'sell', '#buy': 'buy', '#mine': 'mine', '#demand': 'demand', '#agent': 'agent' })[location.hash] || 'home'; render(); }
catch (error) { state.error = `매물을 불러오지 못했습니다. ${error.message}`; render(); }
