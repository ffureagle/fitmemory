import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("backend/Services/SizeRecommendationService.cs", "utf8");
assert.equal(service.includes("keepLocalSizing"), false, "AI bedeni yerel motora ezilmemeli");
assert.equal(service.includes("PreserveLocalSizing"), false, "PreserveLocalSizing kaldırılmış olmalı");
assert.match(service, /final size controller/i);

assert.equal(service.includes("ApplyProductFamilyEvidence"), false, "Aile eşleşmesi bedeni kilitlememeli");
assert.equal(service.includes("RecommendedSize = strongestSize"), false);
assert.match(service, /wardrobeSizeSupport|Dolap desteği|AttachWardrobeSupportEvidence/);

const gemini = readFileSync("backend/Services/GeminiRecommendationClient.cs", "utf8");
assert.match(gemini, /son denetleyici/);
assert.match(gemini, /final size controller/i);
assert.match(gemini, /wardrobeSizeSupport/);
assert.match(gemini, /bedeni kilitlemez/);
assert.equal(gemini.includes("baseline bedeni değiştirme"), false);
assert.equal(gemini.includes("AI ile daha büyük bedene geçme"), false);
assert.equal(gemini.includes("iyi-uyum bedenini koru"), false);

const openai = readFileSync("backend/Services/OpenAiRecommendationClient.cs", "utf8");
assert.match(openai, /son denetleyici/);
assert.match(openai, /final size controller/i);

const scan = readFileSync("mobile-expo-go/src/screens/ScanScreen.tsx", "utf8");
assert.match(scan, /AI kalıp, dikiş ve etiketleri denetliyor/);
assert.match(scan, /syncPendingProfile/);
assert.match(scan, /local-draft|recommendFromSnapshot/);

console.log("ai controller policy ok");
