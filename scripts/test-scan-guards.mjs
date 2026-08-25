import assert from "node:assert/strict";

function controlText(element) {
  if (!element || typeof element.getAttribute !== "function") return "";
  return String(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.value ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("data-testid") ||
      "",
  ).replace(/\s+/g, " ").trim();
}

assert.equal(controlText(undefined), "");
assert.equal(controlText(null), "");
assert.equal(controlText({}), "");

const selectedButton = undefined;
assert.equal(controlText(selectedButton), "");

console.log("scan guards ok");
