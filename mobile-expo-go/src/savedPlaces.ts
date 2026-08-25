import type { FavoriteOutfit, StyleBoardItem } from "./types";

export function isClosetSavedOutfit(item: FavoriteOutfit) {
  if (item.source === "wardrobe") return true;
  if (item.source === "studio") return false;
  if (item.title.startsWith("Dolap · ")) return true;
  return item.items.length > 0 && item.items.every((piece) => piece.id < 0);
}

export function closetSavedOutfits(items: FavoriteOutfit[]) {
  return items.filter(isClosetSavedOutfit);
}

export function studioFavoriteOutfits(items: FavoriteOutfit[]) {
  return items.filter((item) => !isClosetSavedOutfit(item));
}

export function studioSavedProducts(items: StyleBoardItem[]) {
  return items.filter((item) => item.isSaved);
}
