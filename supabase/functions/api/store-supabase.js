import { createClient } from "@supabase/supabase-js";

export function createSupabaseStore(url, key, { canAdmin = false } = {}) {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return {
    kind: "supabase",
    async ping() {
      const { error } = await supabase.from("profiles").select("user_id").limit(1);
      if (!error) {
        return { ok: true };
      }
      const detail = error.message || "Supabase sorgusu başarısız";
      if (/schema cache|does not exist|relation|could not find/i.test(detail)) {
        return {
          ok: false,
          detail: "Tablolar henüz yok. Supabase SQL Editor’da supabase/setup.sql dosyasını çalıştırın."
        };
      }
      if (/jwt|api key|invalid/i.test(detail)) {
        return { ok: false, detail: "Supabase API anahtarı geçersiz. api/.env içindeki service_role değerini kontrol edin." };
      }
      return { ok: false, detail };
    },
    async getAccountByEmail(email) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .ilike("email", email)
        .maybeSingle();
      if (error) throw wrapSchemaError(error);
      return mapAccount(data);
    },
    async getAccountById(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return mapAccount(data);
    },
    async createAccount(account) {
      let userId = account.userId;
      if (canAdmin) {
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true,
          user_metadata: { displayName: account.displayName }
        });
        if (authError) {
          if (/already/i.test(authError.message)) {
            const existing = new Error("duplicate");
            existing.code = "23505";
            throw existing;
          }
          throw authError;
        }
        userId = authData.user.id;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: account.email,
          password: account.password,
          options: { data: { displayName: account.displayName } }
        });
        if (error) {
          if (/already|registered/i.test(error.message)) {
            const existing = new Error("duplicate");
            existing.code = "23505";
            throw existing;
          }
          throw error;
        }
        userId = data.user?.id || userId;
        if (!userId) {
          throw new Error(
            "Supabase e-posta doğrulaması açık. Authentication → Providers → Email içinde Confirm email'i kapatın veya service_role anahtarını kullanın."
          );
        }
      }
      const now = new Date().toISOString();
      const { error } = await supabase.from("profiles").upsert({
        user_id: userId,
        email: account.email,
        display_name: account.displayName,
        password_hash: account.passwordHash || "",
        created_at: now,
        updated_at: now
      }, { onConflict: "user_id" });
      if (error) throw error;
      return this.getAccountById(userId);
    },
    async resolveToken(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return null;
      }
      return await this.getAccountById(data.user.id) ||
        this.getAccountByEmail(data.user.email || "");
    },
    async authenticate(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        return null;
      }
      const account = await this.getAccountById(data.user.id) ||
        await this.getAccountByEmail(email);
      if (!account) {
        return null;
      }
      return {
        account,
        accessToken: data.session.access_token,
        expiresAt: new Date(data.session.expires_at * 1000).toISOString(),
        supabaseSession: true
      };
    },
    async getProfile(userId) {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data?.age ? mapProfile(data) : null;
    },
    async upsertProfile(userId, payload) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("profiles").update({
        age: payload.age,
        height_cm: payload.heightCm,
        weight_kg: payload.weightKg,
        shoulder_width_cm: payload.shoulderWidthCm,
        chest_circumference_cm: payload.chestCircumferenceCm ?? null,
        waist_circumference_cm: payload.waistCircumferenceCm,
        foot_length_cm: payload.footLengthCm ?? null,
        usual_shoe_size_eu: payload.usualShoeSizeEu ?? null,
        fit_preference: payload.fitPreference || "TrueToSize",
        updated_at: now
      }).eq("user_id", userId);
      if (error) throw error;
      return this.getProfile(userId);
    },
    async listOrders(userId) {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapOrder);
    },
    async createOrder(userId, order) {
      const { data, error } = await supabase.from("orders").insert(toOrderRow(userId, order)).select("*").single();
      if (error) throw error;
      return mapOrder(data);
    },
    async updateOrder(userId, id, order) {
      const { data, error } = await supabase
        .from("orders")
        .update(toOrderRow(userId, order))
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data ? mapOrder(data) : null;
    },
    async getOrder(userId, id) {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapOrder(data) : null;
    },
    async deleteOrder(userId, id) {
      const { error, count } = await supabase
        .from("orders")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
      return (count || 0) > 0;
    },
    async updateOrderFeedback(userId, id, payload) {
      const { data, error } = await supabase
        .from("orders")
        .update({
          outcome: payload.outcome,
          user_fit_notes: payload.userFitNotes ?? null,
          return_confirmed_by_user: payload.returnConfirmedByUser === true,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data ? mapOrder(data) : null;
    },
    async saveRecommendation(userId, rec) {
      const { data, error } = await supabase.from("recommendations").insert({
        user_id: userId,
        product_url: rec.productUrl,
        brand: rec.brand,
        product_name: rec.productName,
        recommended_size: rec.recommendedSize,
        confidence: rec.confidence,
        verdict: rec.verdict,
        explanation: rec.explanation,
        evidence_summary: rec.evidenceSummary,
        data_source: rec.dataSource,
        comparisons_json: rec.comparisons || [],
        fit_notes_json: rec.fitNotes || [],
        style_json: rec.style || {},
        created_at: rec.createdAt
      }).select("*").single();
      if (error) throw error;
      return mapRecommendation(data);
    },
    async getRecommendation(id) {
      const { data, error } = await supabase.from("recommendations").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapRecommendation(data) : null;
    },
    async latestRecommendation(userId, productUrl) {
      const { data, error } = await supabase
        .from("recommendations")
        .select("*")
        .eq("user_id", userId)
        .eq("product_url", productUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRecommendation(data) : null;
    },
    async listStyleBoard(userId) {
      const { data, error } = await supabase
        .from("style_board_items")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapStyleItem);
    },
    async saveStyleBoardItem(userId, item) {
      const row = {
        user_id: userId,
        product_url: item.productUrl,
        brand: item.brand,
        product_name: item.productName,
        category: item.category,
        price: item.price,
        image_url: item.imageUrl,
        product_reference: item.productReference,
        fit_label: item.fitLabel,
        fit_evidence: item.fitEvidence,
        description: item.description,
        material_summary: item.materialSummary,
        material_evidence: item.materialEvidence,
        recommended_size: item.recommendedSize,
        recommendation_confidence: item.recommendationConfidence,
        is_selected: item.isSelected,
        is_in_studio: item.isInStudio,
        is_saved: item.isSaved,
        created_at: item.createdAt,
        updated_at: item.updatedAt
      };
      const { data, error } = await supabase
        .from("style_board_items")
        .upsert(row, { onConflict: "user_id,product_url" })
        .select("*")
        .single();
      if (error) throw error;
      return mapStyleItem(data);
    },
    async getStyleItem(userId, id) {
      const { data, error } = await supabase
        .from("style_board_items")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapStyleItem(data) : null;
    },
    async deleteStyleItem(userId, id) {
      const item = await this.getStyleItem(userId, id);
      if (!item) return null;
      if (item.isSaved) {
        await supabase.from("style_board_items").update({
          is_in_studio: false,
          is_selected: false,
          updated_at: new Date().toISOString()
        }).eq("id", id);
      } else {
        await supabase.from("style_board_items").delete().eq("id", id);
      }
      return item;
    },
    async selectStyleItem(userId, id) {
      const items = await this.listStyleBoard(userId);
      const selected = items.find((item) => item.id === Number(id));
      if (!selected) return null;
      const shouldSelect = !selected.isSelected;
      for (const item of items) {
        await supabase.from("style_board_items").update({
          is_selected: shouldSelect && item.id === selected.id,
          updated_at: new Date().toISOString()
        }).eq("id", item.id);
      }
      return this.getStyleItem(userId, id);
    },
    async clearStyleBoard(userId) {
      const items = await this.listStyleBoard(userId);
      const now = new Date().toISOString();
      for (const item of items.filter((entry) => entry.isInStudio)) {
        if (item.isSaved) {
          await supabase.from("style_board_items").update({
            is_in_studio: false,
            is_selected: false,
            updated_at: now
          }).eq("id", item.id);
        } else {
          await supabase.from("style_board_items").delete().eq("id", item.id);
        }
      }
    },
    async progress(userId) {
      const [{ count: analyzed }, { count: wardrobe }, { count: signals }, { count: confident }] = await Promise.all([
        supabase.from("recommendations").select("product_url", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("return_confirmed_by_user", false),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", userId).neq("outcome", "PurchasedUnknownFit"),
        supabase.from("recommendations").select("product_url", { count: "exact", head: true }).eq("user_id", userId).gte("confidence", 55)
      ]);
      return {
        analyzed: analyzed || 0,
        wardrobe: wardrobe || 0,
        signals: signals || 0,
        confident: confident || 0
      };
    }
  };
}

function toOrderRow(userId, order) {
  return {
    user_id: userId,
    brand: order.brand,
    product_name: order.productName,
    category: order.category,
    purchased_size: order.purchasedSize,
    outcome: order.outcome,
    return_confirmed_by_user: order.returnConfirmedByUser === true,
    fit_notes: order.fitNotes ?? null,
    user_fit_notes: order.userFitNotes ?? null,
    chest_width_cm: order.chestWidthCm ?? null,
    shoulder_width_cm: order.shoulderWidthCm ?? null,
    waist_width_cm: order.waistWidthCm ?? null,
    length_cm: order.lengthCm ?? null,
    sleeve_length_cm: order.sleeveLengthCm ?? null,
    inseam_cm: order.inseamCm ?? null,
    product_url: order.productUrl ?? null,
    image_url: order.imageUrl ?? null,
    product_family_key: order.productFamilyKey ?? null,
    research_source_url: order.researchSourceUrl ?? null,
    fit_label: order.fitLabel ?? null,
    size_evidence: order.sizeEvidence ?? null,
    material_summary: order.materialSummary ?? null,
    material_evidence: order.materialEvidence ?? null,
    research_confidence: order.researchConfidence || 0,
    import_fingerprint: order.importFingerprint ?? null,
    created_at: order.createdAt,
    updated_at: order.updatedAt
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
    fitNotes: row.fit_notes_json || [],
    comparisons: row.comparisons_json || [],
    evidenceSummary: row.evidence_summary,
    dataSource: row.data_source,
    style: row.style_json || {},
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

function wrapSchemaError(error) {
  const message = error?.message || String(error);
  if (/schema cache|does not exist|relation|could not find the table/i.test(message)) {
    const wrapped = new Error("Supabase tabloları yok. SQL Editor’da supabase/setup.sql dosyasını çalıştırın.");
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

