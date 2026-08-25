import test from "node:test";
import assert from "node:assert/strict";
import { localApiFetch } from "../../extension/local-backend.js";

test("health does not need a remote server", async () => {
  const health = await localApiFetch("/health", { anonymous: true });
  assert.equal(health.status, "healthy");
  assert.equal(health.database, "Extension");
});

test("register, profile and analyze work inside the extension", async () => {
  const email = `user-${Date.now()}@fitmemory.test`;
  const session = await localApiFetch("/api/auth/register", {
    method: "POST",
    anonymous: true,
    body: {
      displayName: "Furkan Test",
      email,
      password: "Fitmemory1"
    }
  });
  assert.ok(session.accessToken);
  const token = session.accessToken;
  const userId = session.account.userId;

  const profile = await localApiFetch(`/api/profiles/${userId}`, {
    method: "PUT",
    accessToken: token,
    body: {
      age: 28,
      heightCm: 178,
      weightKg: 75,
      shoulderWidthCm: 45,
      chestCircumferenceCm: 106,
      waistCircumferenceCm: 86,
      fitPreference: "TrueToSize"
    }
  });
  assert.equal(profile.chestCircumferenceCm, 106);

  const recommendation = await localApiFetch("/api/recommendations/analyze", {
    method: "POST",
    accessToken: token,
    body: {
      userId,
      product: {
        url: "http://127.0.0.1:8199/tee.html",
        brand: "Zara",
        name: "Heavyweight cotton tee",
        fitLabel: "Regular fit"
      },
      sizeChart: {
        found: true,
        title: "Beden tablosu",
        unit: "Centimeters",
        headers: ["Beden", "Göğüs eni (cm)", "Omuz (cm)", "Uzunluk (cm)"],
        rows: [
          { cells: ["XS", "48", "40", "68"] },
          { cells: ["S", "50", "42", "70"] },
          { cells: ["M", "53", "44", "72"] },
          { cells: ["L", "56", "46", "74"] },
          { cells: ["XL", "59", "48", "76"] }
        ]
      }
    }
  });
  assert.equal(recommendation.recommendedSize, "L");
  assert.ok(recommendation.confidence > 30);
});

test("expired session restores from userId without a password", async () => {
  const email = `restore-${Date.now()}@fitmemory.test`;
  const session = await localApiFetch("/api/auth/register", {
    method: "POST",
    anonymous: true,
    body: {
      displayName: "Oturum Test",
      email,
      password: "Fitmemory1"
    }
  });
  const userId = session.account.userId;

  const restored = await localApiFetch("/api/auth/restore", {
    method: "POST",
    body: { userId }
  });
  assert.ok(restored.accessToken);
  assert.notEqual(restored.accessToken, session.accessToken);
  assert.equal(restored.account.email.toLowerCase(), email);

  const me = await localApiFetch("/api/auth/me", {
    accessToken: restored.accessToken
  });
  assert.equal(me.userId, userId);
});
