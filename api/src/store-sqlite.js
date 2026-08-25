import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(process.env.FITMEMORY_DATA_DIR || path.join(process.cwd(), "data"));

export function createSqliteStore() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "fitmemory.sqlite"));
  db.exec(`
    create table if not exists profiles (
      user_id text primary key,
      email text not null unique,
      display_name text not null,
      password_hash text not null,
      age integer,
      height_cm real,
      weight_kg real,
      shoulder_width_cm real,
      chest_circumference_cm real,
      waist_circumference_cm real,
      foot_length_cm real,
      usual_shoe_size_eu real,
      fit_preference text not null default 'TrueToSize',
      created_at text not null,
      updated_at text not null
    );
    create table if not exists orders (
      id integer primary key autoincrement,
      user_id text not null,
      brand text not null,
      product_name text not null,
      category text not null,
      purchased_size text not null,
      outcome text not null,
      return_confirmed_by_user integer not null default 0,
      fit_notes text,
      user_fit_notes text,
      chest_width_cm real,
      shoulder_width_cm real,
      waist_width_cm real,
      length_cm real,
      sleeve_length_cm real,
      inseam_cm real,
      product_url text,
      image_url text,
      product_family_key text,
      research_source_url text,
      fit_label text,
      size_evidence text,
      material_summary text,
      material_evidence text,
      research_confidence integer not null default 0,
      fit_score integer,
      fit_assessment text,
      fit_assessment_confidence integer not null default 0,
      import_fingerprint text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists recommendations (
      id integer primary key autoincrement,
      user_id text not null,
      product_url text not null,
      brand text,
      product_name text,
      recommended_size text not null,
      confidence integer not null,
      verdict text not null,
      explanation text not null,
      evidence_summary text,
      data_source text,
      comparisons_json text not null,
      fit_notes_json text not null,
      style_json text not null,
      created_at text not null
    );
    create table if not exists style_board_items (
      id integer primary key autoincrement,
      user_id text not null,
      product_url text not null,
      brand text not null default '',
      product_name text not null default '',
      category text not null default '',
      price text not null default '',
      image_url text not null default '',
      product_reference text not null default '',
      fit_label text not null default '',
      fit_evidence text not null default '',
      description text not null default '',
      material_summary text not null default '',
      material_evidence text not null default '',
      recommended_size text not null default '',
      recommendation_confidence integer not null default 0,
      is_selected integer not null default 0,
      is_in_studio integer not null default 0,
      is_saved integer not null default 0,
      created_at text not null,
      updated_at text not null,
      unique (user_id, product_url)
    );
  `);

  return {
    kind: "sqlite",
    async ping() {
      db.prepare("select 1 as ok").get();
      return { ok: true };
    },
    async getAccountByEmail(email) {
      return mapAccount(db.prepare("select * from profiles where lower(email) = lower(?)").get(email));
    },
    async getAccountById(userId) {
      return mapAccount(db.prepare("select * from profiles where user_id = ?").get(userId));
    },
    async createAccount(account) {
      db.prepare(`
        insert into profiles (user_id, email, display_name, password_hash, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)
      `).run(account.userId, account.email, account.displayName, account.passwordHash, account.createdAt, account.updatedAt);
      return this.getAccountById(account.userId);
    },
    async getProfile(userId) {
      const row = db.prepare("select * from profiles where user_id = ?").get(userId);
      return row?.age ? mapProfile(row) : null;
    },
    async upsertProfile(userId, payload) {
      const now = new Date().toISOString();
      db.prepare(`
        update profiles set
          age = ?, height_cm = ?, weight_kg = ?, shoulder_width_cm = ?,
          chest_circumference_cm = ?, waist_circumference_cm = ?,
          foot_length_cm = ?, usual_shoe_size_eu = ?, fit_preference = ?, updated_at = ?
        where user_id = ?
      `).run(
        payload.age, payload.heightCm, payload.weightKg, payload.shoulderWidthCm,
        payload.chestCircumferenceCm ?? null, payload.waistCircumferenceCm,
        payload.footLengthCm ?? null, payload.usualShoeSizeEu ?? null,
        payload.fitPreference || "TrueToSize", now, userId
      );
      return this.getProfile(userId);
    },
    async listOrders(userId) {
      return db.prepare("select * from orders where user_id = ? order by updated_at desc")
        .all(userId)
        .map(mapOrder);
    },
    async createOrder(userId, order) {
      const info = db.prepare(`
        insert into orders (
          user_id, brand, product_name, category, purchased_size, outcome,
          return_confirmed_by_user, fit_notes, user_fit_notes, chest_width_cm,
          shoulder_width_cm, waist_width_cm, length_cm, sleeve_length_cm, inseam_cm,
          product_url, image_url, product_family_key, research_source_url, fit_label,
          size_evidence, material_summary, material_evidence, research_confidence,
          import_fingerprint, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, order.brand, order.productName, order.category, order.purchasedSize, order.outcome,
        order.returnConfirmedByUser ? 1 : 0, order.fitNotes ?? null, order.userFitNotes ?? null,
        order.chestWidthCm ?? null, order.shoulderWidthCm ?? null, order.waistWidthCm ?? null,
        order.lengthCm ?? null, order.sleeveLengthCm ?? null, order.inseamCm ?? null,
        order.productUrl ?? null, order.imageUrl ?? null, order.productFamilyKey ?? null,
        order.researchSourceUrl ?? null, order.fitLabel ?? null, order.sizeEvidence ?? null,
        order.materialSummary ?? null, order.materialEvidence ?? null, order.researchConfidence || 0,
        order.importFingerprint ?? null, order.createdAt, order.updatedAt
      );
      return mapOrder(db.prepare("select * from orders where id = ?").get(info.lastInsertRowid));
    },
    async updateOrder(userId, id, order) {
      db.prepare(`
        update orders set
          brand=?, product_name=?, category=?, purchased_size=?, outcome=?,
          return_confirmed_by_user=?, fit_notes=?, user_fit_notes=?, chest_width_cm=?,
          shoulder_width_cm=?, waist_width_cm=?, length_cm=?, sleeve_length_cm=?, inseam_cm=?,
          product_url=?, image_url=?, product_family_key=?, research_source_url=?, fit_label=?,
          size_evidence=?, research_confidence=?, updated_at=?
        where id=? and user_id=?
      `).run(
        order.brand, order.productName, order.category, order.purchasedSize, order.outcome,
        order.returnConfirmedByUser ? 1 : 0, order.fitNotes ?? null, order.userFitNotes ?? null,
        order.chestWidthCm ?? null, order.shoulderWidthCm ?? null, order.waistWidthCm ?? null,
        order.lengthCm ?? null, order.sleeveLengthCm ?? null, order.inseamCm ?? null,
        order.productUrl ?? null, order.imageUrl ?? null, order.productFamilyKey ?? null,
        order.researchSourceUrl ?? null, order.fitLabel ?? null, order.sizeEvidence ?? null,
        order.researchConfidence || 0, order.updatedAt, id, userId
      );
      return this.getOrder(userId, id);
    },
    async getOrder(userId, id) {
      const row = db.prepare("select * from orders where id = ? and user_id = ?").get(id, userId);
      return row ? mapOrder(row) : null;
    },
    async deleteOrder(userId, id) {
      return db.prepare("delete from orders where id = ? and user_id = ?").run(id, userId).changes > 0;
    },
    async updateOrderFeedback(userId, id, payload) {
      db.prepare(`
        update orders set outcome=?, user_fit_notes=?, return_confirmed_by_user=?, updated_at=?
        where id=? and user_id=?
      `).run(payload.outcome, payload.userFitNotes ?? null, payload.returnConfirmedByUser ? 1 : 0,
        new Date().toISOString(), id, userId);
      return this.getOrder(userId, id);
    },
    async saveRecommendation(userId, rec) {
      const info = db.prepare(`
        insert into recommendations (
          user_id, product_url, brand, product_name, recommended_size, confidence,
          verdict, explanation, evidence_summary, data_source, comparisons_json,
          fit_notes_json, style_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, rec.productUrl, rec.brand, rec.productName, rec.recommendedSize, rec.confidence,
        rec.verdict, rec.explanation, rec.evidenceSummary, rec.dataSource,
        JSON.stringify(rec.comparisons || []), JSON.stringify(rec.fitNotes || []),
        JSON.stringify(rec.style || {}), rec.createdAt
      );
      return this.getRecommendation(info.lastInsertRowid);
    },
    async getRecommendation(id) {
      const row = db.prepare("select * from recommendations where id = ?").get(id);
      return row ? mapRecommendation(row) : null;
    },
    async latestRecommendation(userId, productUrl) {
      const row = db.prepare(`
        select * from recommendations where user_id = ? and product_url = ?
        order by created_at desc limit 1
      `).get(userId, productUrl);
      return row ? mapRecommendation(row) : null;
    },
    async listStyleBoard(userId) {
      return db.prepare("select * from style_board_items where user_id = ? order by updated_at desc")
        .all(userId)
        .map(mapStyleItem);
    },
    async saveStyleBoardItem(userId, item) {
      const existing = db.prepare("select * from style_board_items where user_id = ? and product_url = ?")
        .get(userId, item.productUrl);
      if (existing) {
        db.prepare(`
          update style_board_items set
            brand=?, product_name=?, category=?, price=?, image_url=?, product_reference=?,
            fit_label=?, fit_evidence=?, description=?, material_summary=?, material_evidence=?,
            recommended_size=?, recommendation_confidence=?, is_in_studio=?, is_saved=?, updated_at=?
          where id=?
        `).run(
          item.brand, item.productName, item.category, item.price, item.imageUrl, item.productReference,
          item.fitLabel, item.fitEvidence, item.description, item.materialSummary, item.materialEvidence,
          item.recommendedSize, item.recommendationConfidence,
          item.isInStudio ? 1 : 0, item.isSaved ? 1 : 0, item.updatedAt, existing.id
        );
        return mapStyleItem(db.prepare("select * from style_board_items where id = ?").get(existing.id));
      }
      const info = db.prepare(`
        insert into style_board_items (
          user_id, product_url, brand, product_name, category, price, image_url,
          product_reference, fit_label, fit_evidence, description, material_summary,
          material_evidence, recommended_size, recommendation_confidence, is_selected,
          is_in_studio, is_saved, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, item.productUrl, item.brand, item.productName, item.category, item.price, item.imageUrl,
        item.productReference, item.fitLabel, item.fitEvidence, item.description, item.materialSummary,
        item.materialEvidence, item.recommendedSize, item.recommendationConfidence,
        item.isSelected ? 1 : 0, item.isInStudio ? 1 : 0, item.isSaved ? 1 : 0,
        item.createdAt, item.updatedAt
      );
      return mapStyleItem(db.prepare("select * from style_board_items where id = ?").get(info.lastInsertRowid));
    },
    async getStyleItem(userId, id) {
      const row = db.prepare("select * from style_board_items where id = ? and user_id = ?").get(id, userId);
      return row ? mapStyleItem(row) : null;
    },
    async deleteStyleItem(userId, id) {
      const item = await this.getStyleItem(userId, id);
      if (!item) return null;
      if (item.isSaved) {
        db.prepare("update style_board_items set is_in_studio=0, is_selected=0, updated_at=? where id=?")
          .run(new Date().toISOString(), id);
      } else {
        db.prepare("delete from style_board_items where id = ?").run(id);
      }
      return item;
    },
    async selectStyleItem(userId, id) {
      const items = await this.listStyleBoard(userId);
      const selected = items.find((item) => item.id === id);
      if (!selected) return null;
      const shouldSelect = !selected.isSelected;
      for (const item of items) {
        const on = shouldSelect && item.id === selected.id;
        db.prepare("update style_board_items set is_selected=?, updated_at=? where id=?")
          .run(on ? 1 : 0, new Date().toISOString(), item.id);
      }
      return this.getStyleItem(userId, id);
    },
    async clearStyleBoard(userId) {
      const items = await this.listStyleBoard(userId);
      const now = new Date().toISOString();
      for (const item of items.filter((entry) => entry.isInStudio)) {
        if (item.isSaved) {
          db.prepare("update style_board_items set is_in_studio=0, is_selected=0, updated_at=? where id=?")
            .run(now, item.id);
        } else {
          db.prepare("delete from style_board_items where id=?").run(item.id);
        }
      }
    },
    async progress(userId) {
      const analyzed = db.prepare("select count(distinct product_url) as n from recommendations where user_id = ?").get(userId).n;
      const wardrobe = db.prepare("select count(*) as n from orders where user_id = ? and return_confirmed_by_user = 0").get(userId).n;
      const signals = db.prepare("select count(*) as n from orders where user_id = ? and outcome != 'PurchasedUnknownFit'").get(userId).n;
      const confident = db.prepare("select count(distinct product_url) as n from recommendations where user_id = ? and confidence >= 55").get(userId).n;
      return { analyzed, wardrobe, signals, confident };
    }
  };
}

function mapAccount(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    hasProfile: Boolean(row.age)
  };
}

function mapProfile(row) {
  return {
    userId: row.user_id,
    age: row.age,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    shoulderWidthCm: row.shoulder_width_cm,
    chestCircumferenceCm: row.chest_circumference_cm,
    waistCircumferenceCm: row.waist_circumference_cm,
    footLengthCm: row.foot_length_cm,
    usualShoeSizeEu: row.usual_shoe_size_eu,
    fitPreference: row.fit_preference,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOrder(row) {
  return {
    id: Number(row.id),
    userId: row.user_id,
    brand: row.brand,
    productName: row.product_name,
    category: row.category,
    purchasedSize: row.purchased_size,
    outcome: row.outcome,
    returnConfirmedByUser: Boolean(row.return_confirmed_by_user),
    fitNotes: row.fit_notes,
    userFitNotes: row.user_fit_notes,
    chestWidthCm: row.chest_width_cm,
    shoulderWidthCm: row.shoulder_width_cm,
    waistWidthCm: row.waist_width_cm,
    lengthCm: row.length_cm,
    sleeveLengthCm: row.sleeve_length_cm,
    inseamCm: row.inseam_cm,
    productUrl: row.product_url,
    imageUrl: row.image_url,
    productFamilyKey: row.product_family_key,
    researchSourceUrl: row.research_source_url,
    fitLabel: row.fit_label,
    sizeEvidence: row.size_evidence,
    materialSummary: row.material_summary,
    materialEvidence: row.material_evidence,
    researchConfidence: row.research_confidence || 0,
    fitScore: row.fit_score,
    fitAssessment: row.fit_assessment,
    fitAssessmentConfidence: row.fit_assessment_confidence || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRecommendation(row) {
  return {
    id: Number(row.id),
    recommendedSize: row.recommended_size,
    confidence: row.confidence,
    verdict: row.verdict,
    explanation: row.explanation,
    fitNotes: JSON.parse(row.fit_notes_json || "[]"),
    comparisons: JSON.parse(row.comparisons_json || "[]"),
    evidenceSummary: row.evidence_summary,
    dataSource: row.data_source,
    style: JSON.parse(row.style_json || "{}"),
    createdAt: row.created_at
  };
}

function mapStyleItem(row) {
  return {
    id: Number(row.id),
    userId: row.user_id,
    productUrl: row.product_url,
    brand: row.brand,
    productName: row.product_name,
    category: row.category,
    price: row.price,
    imageUrl: row.image_url,
    productReference: row.product_reference,
    fitLabel: row.fit_label,
    fitEvidence: row.fit_evidence,
    description: row.description,
    materialSummary: row.material_summary,
    materialEvidence: row.material_evidence,
    recommendedSize: row.recommended_size,
    recommendationConfidence: row.recommendation_confidence,
    isSelected: Boolean(row.is_selected),
    isInStudio: Boolean(row.is_in_studio),
    isSaved: Boolean(row.is_saved),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
