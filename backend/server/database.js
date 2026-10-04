import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_USER_ID, SEED_SELLER_ID, seedListings } from './seed.js';

const migrationPath = fileURLToPath(new URL('./migrations/001_step1.sql', import.meta.url));
const json = value => JSON.stringify(value ?? []);
const parseJson = value => JSON.parse(value || '[]');
let savepointCounter = 0;
const transaction = (db, work) => {
  const nested = db.isTransaction;
  const savepoint = `agent_market_${++savepointCounter}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    if (nested) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } else {
      db.exec('ROLLBACK');
    }
    throw error;
  }
};

function listingFromRow(row) {
  if (!row) return undefined;
  return {
    id: row.id, sellerId: row.seller_id, draftId: row.draft_id, title: row.title,
    description: row.description, category: row.category, brand: row.brand, model: row.model,
    storageGb: row.storage_gb, condition: row.condition, accessories: row.accessories,
    priceKrw: row.price_krw, images: parseJson(row.images_json), missingFields: parseJson(row.missing_fields_json),
    status: row.status, publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function draftFromRow(row) {
  if (!row) return undefined;
  return {
    id: row.id, sellerId: row.seller_id, source: row.source, title: row.title,
    description: row.description, category: row.category, brand: row.brand, model: row.model,
    storageGb: row.storage_gb, condition: row.condition, accessories: row.accessories,
    priceKrw: row.price_krw, images: parseJson(row.images_json), missingFields: parseJson(row.missing_fields_json),
    nextQuestions: parseJson(row.next_questions_json), status: row.status,
    sourceListingId: row.source_listing_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function requestFromRow(row) {
  if (!row) return undefined;
  return {
    id: row.id, buyerId: row.buyer_id, source: row.source, category: row.category,
    modelQuery: row.model_query, maxBudgetKrw: row.max_budget_krw, storageGb: row.storage_gb,
    conditionPreferences: parseJson(row.condition_preferences_json), missingFields: parseJson(row.missing_fields_json),
    nextQuestions: parseJson(row.next_questions_json), status: row.status,
    skippedQuestionFields: parseJson(row.skipped_question_fields_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class Store {
  constructor({ dbPath = process.env.AGENT_MARKET_DB_PATH || '.local/agent-market.sqlite', seed = true } = {}) {
    const absolutePath = dbPath === ':memory:' ? dbPath : resolve(dbPath);
    if (absolutePath !== ':memory:') mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(migrationPath, 'utf8'));
    if (!this.db.prepare('PRAGMA table_info(purchase_requests)').all().some(column => column.name === 'skipped_question_fields_json')) {
      this.db.exec("ALTER TABLE purchase_requests ADD COLUMN skipped_question_fields_json TEXT NOT NULL DEFAULT '[]'");
    }
    this.ensureUsers();
    if (seed) this.ensureSeedListings();
  }

  ensureUsers() {
    const insert = this.db.prepare('INSERT OR IGNORE INTO users (id, nickname, created_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    insert.run(DEMO_USER_ID, '데모 사용자', now);
    insert.run(SEED_SELLER_ID, '샘플 판매자', now);
  }

  ensureUser(userId) {
    this.db.prepare('INSERT OR IGNORE INTO users (id, nickname, created_at) VALUES (?, ?, ?)')
      .run(userId, '데모 사용자', new Date().toISOString());
  }

  transaction(work) { return transaction(this.db, work); }

  ensureSeedListings() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM listings').get().count;
    if (count > 0) return;
    const insertDraft = this.db.prepare(`INSERT INTO listing_drafts
      (id, seller_id, source, title, description, category, brand, model, storage_gb, condition, accessories,
       price_krw, images_json, missing_fields_json, next_questions_json, status, created_at, updated_at)
      VALUES (?, ?, 'HUMAN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'PUBLISHED', ?, ?)`);
    const insertListing = this.db.prepare(`INSERT INTO listings
      (id, seller_id, draft_id, title, description, category, brand, model, storage_gb, condition, accessories,
       price_krw, images_json, missing_fields_json, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`);
    transaction(this.db, () => {
      for (const listing of seedListings()) {
        const draftId = `10000000-0000-4000-8000-${listing.id.slice(-12)}`;
        insertDraft.run(draftId, listing.sellerId, listing.title, listing.description, listing.category,
          listing.brand, listing.model, listing.storageGb, listing.condition, listing.accessories,
          listing.priceKrw, json(listing.images), json(listing.missingFields), listing.createdAt, listing.updatedAt);
        insertListing.run(listing.id, listing.sellerId, draftId, listing.title, listing.description,
          listing.category, listing.brand, listing.model, listing.storageGb, listing.condition,
          listing.accessories, listing.priceKrw, json(listing.images), json(listing.missingFields),
          listing.publishedAt, listing.createdAt, listing.updatedAt);
      }
    });
  }

  listListings({ status = 'ACTIVE', query = '' } = {}) {
    const search = `%${query.trim().toLowerCase()}%`;
    return this.db.prepare(`SELECT * FROM listings WHERE status = ?
      AND (? = '' OR lower(coalesce(title, '') || ' ' || coalesce(model, '') || ' ' || coalesce(brand, '')) LIKE ?)
      ORDER BY created_at DESC, id`).all(status, query.trim(), search).map(listingFromRow);
  }

  getListing(id) { return listingFromRow(this.db.prepare('SELECT * FROM listings WHERE id = ?').get(id)); }
  listListingsBySeller(sellerId) {
    return this.db.prepare('SELECT * FROM listings WHERE seller_id = ? ORDER BY updated_at DESC, id')
      .all(sellerId).map(listingFromRow);
  }
  listDraftsBySeller(sellerId) {
    return this.db.prepare("SELECT * FROM listing_drafts WHERE seller_id = ? AND status <> 'PUBLISHED' ORDER BY updated_at DESC, id")
      .all(sellerId).map(draftFromRow);
  }
  getDraft(id) { return draftFromRow(this.db.prepare('SELECT * FROM listing_drafts WHERE id = ?').get(id)); }
  listRequestsByBuyer(buyerId) {
    return this.db.prepare('SELECT * FROM purchase_requests WHERE buyer_id = ? ORDER BY updated_at DESC, id')
      .all(buyerId).map(requestFromRow);
  }
  getPurchaseRequest(id) { return requestFromRow(this.db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id)); }

  saveDraft(draft) {
    const values = [draft.id, draft.sellerId, draft.source, draft.title, draft.description, draft.category,
      draft.brand, draft.model, draft.storageGb, draft.condition, draft.accessories, draft.priceKrw,
      json(draft.images), json(draft.missingFields), json(draft.nextQuestions), draft.status,
      draft.sourceListingId ?? null, draft.createdAt, draft.updatedAt];
    this.db.prepare(`INSERT INTO listing_drafts
      (id, seller_id, source, title, description, category, brand, model, storage_gb, condition, accessories,
       price_krw, images_json, missing_fields_json, next_questions_json, status, source_listing_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category,
       brand=excluded.brand, model=excluded.model, storage_gb=excluded.storage_gb, condition=excluded.condition,
       accessories=excluded.accessories, price_krw=excluded.price_krw, images_json=excluded.images_json,
       missing_fields_json=excluded.missing_fields_json, next_questions_json=excluded.next_questions_json,
       status=excluded.status, updated_at=excluded.updated_at`).run(...values);
    return this.getDraft(draft.id);
  }

  publishDraft(draft, listingId, now) {
    transaction(this.db, () => {
      if (draft.sourceListingId) {
        this.db.prepare(`UPDATE listings SET draft_id=?, title=?, description=?, category=?, brand=?, model=?,
          storage_gb=?, condition=?, accessories=?, price_krw=?, images_json=?, missing_fields_json=?,
          status='ACTIVE', published_at=?, updated_at=? WHERE id=? AND seller_id=? AND status='ACTIVE'`)
          .run(draft.id, draft.title, draft.description, draft.category, draft.brand, draft.model,
            draft.storageGb, draft.condition, draft.accessories, draft.priceKrw, json(draft.images),
            json(draft.missingFields), now, now, draft.sourceListingId, draft.sellerId);
        const revised = this.getListing(draft.sourceListingId);
        if (!revised || revised.draftId !== draft.id) throw new Error('Revision source listing was no longer active.');
        listingId = revised.id;
        this.db.prepare("UPDATE listing_drafts SET status='PUBLISHED', updated_at=? WHERE id=?").run(now, draft.id);
        return;
      }
      this.db.prepare(`INSERT INTO listings
        (id, seller_id, draft_id, title, description, category, brand, model, storage_gb, condition, accessories,
         price_krw, images_json, missing_fields_json, status, published_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
        .run(listingId, draft.sellerId, draft.id, draft.title, draft.description, draft.category, draft.brand,
          draft.model, draft.storageGb, draft.condition, draft.accessories, draft.priceKrw, json(draft.images),
          json(draft.missingFields), now, now, now);
      this.db.prepare("UPDATE listing_drafts SET status='PUBLISHED', updated_at=? WHERE id=?").run(now, draft.id);
    });
    return this.getListing(draft.sourceListingId || listingId);
  }

  deactivateListing(listingId, now) {
    this.db.prepare("UPDATE listings SET status='INACTIVE', updated_at=? WHERE id=?").run(now, listingId);
    return this.getListing(listingId);
  }

  savePurchaseRequest(request) {
    const values = [request.id, request.buyerId, request.source, request.category, request.modelQuery,
      request.maxBudgetKrw, request.storageGb, json(request.conditionPreferences), json(request.missingFields),
      json(request.nextQuestions), request.status, request.createdAt, request.updatedAt, json(request.skippedQuestionFields)];
    this.db.prepare(`INSERT INTO purchase_requests
      (id, buyer_id, source, category, model_query, max_budget_krw, storage_gb, condition_preferences_json,
       missing_fields_json, next_questions_json, status, created_at, updated_at, skipped_question_fields_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET category=excluded.category, model_query=excluded.model_query,
       max_budget_krw=excluded.max_budget_krw, storage_gb=excluded.storage_gb,
       condition_preferences_json=excluded.condition_preferences_json, missing_fields_json=excluded.missing_fields_json,
       next_questions_json=excluded.next_questions_json, skipped_question_fields_json=excluded.skipped_question_fields_json, status=excluded.status, updated_at=excluded.updated_at`).run(...values);
    return this.getPurchaseRequest(request.id);
  }

  confirmPurchaseRequest(id, now) {
    this.db.prepare("UPDATE purchase_requests SET status='CONFIRMED', updated_at=? WHERE id=?").run(now, id);
    return this.getPurchaseRequest(id);
  }

  activeListingsForSearch() {
    return this.db.prepare("SELECT * FROM listings WHERE status='ACTIVE' ORDER BY id").all().map(listingFromRow);
  }

  insertSearchResults(results) {
    const insert = this.db.prepare(`INSERT INTO search_results
      (id, purchase_request_id, listing_id, match_status, matched_fields_json, unmet_fields_json,
       missing_fields_json, rule_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    transaction(this.db, () => {
      for (const result of results) insert.run(result.id, result.purchaseRequestId, result.listingId,
        result.matchStatus, json(result.matchedFields), json(result.unmetFields), json(result.missingFields),
        result.ruleVersion, result.createdAt);
    });
  }

  recordAgentAction({ id, userId, actionType, targetType, targetId = null, status = 'SUCCEEDED', requestId = null, createdAt }) {
    this.db.prepare(`INSERT INTO agent_action_logs (id, user_id, action_type, target_type, target_id, status, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, actionType, targetType, targetId, status, requestId, createdAt);
  }

  getIdempotentResponse(userId, requestId, operation) {
    const row = this.db.prepare('SELECT response_json FROM idempotency_keys WHERE user_id=? AND request_id=? AND operation=?')
      .get(userId, requestId, operation);
    return row ? JSON.parse(row.response_json) : undefined;
  }

  saveIdempotentResponse(userId, requestId, operation, response, createdAt) {
    this.db.prepare(`INSERT INTO idempotency_keys (user_id, request_id, operation, response_json, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(userId, requestId, operation, JSON.stringify(response), createdAt);
  }

  close() { this.db.close(); }
}
