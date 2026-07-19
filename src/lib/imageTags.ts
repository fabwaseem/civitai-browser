/** Civitai image browse category tags (same chips as civitai.com/images). */
export interface ImageCategoryTag {
  id: number;
  name: string;
}

/**
 * Curated Image-entity category tags from Civitai's `tag.getAll`
 * (`categories: true`, sorted by Most Images).
 * Used as `?tags=<id>` on the images API — e.g. photorealistic → 172.
 */
export const IMAGE_CATEGORY_TAGS: ImageCategoryTag[] = [
  { id: 111768, name: "animal" },
  { id: 4, name: "anime" },
  { id: 414, name: "architecture" },
  { id: 111767, name: "astronomy" },
  { id: 111805, name: "car" },
  { id: 5186, name: "cartoon" },
  { id: 5132, name: "cat" },
  { id: 55, name: "city" },
  { id: 5193, name: "clothing" },
  { id: 2397, name: "comics" },
  { id: 2539, name: "dog" },
  { id: 5499, name: "dragon" },
  { id: 5207, name: "fantasy" },
  { id: 3915, name: "food" },
  { id: 5211, name: "game character" },
  { id: 8363, name: "landscape" },
  { id: 617, name: "modern art" },
  { id: 111763, name: "outdoors" },
  { id: 5241, name: "photography" },
  { id: 172, name: "photorealistic" },
  { id: 213, name: "post apocalyptic" },
  { id: 6594, name: "robot" },
  { id: 3060, name: "sci-fi" },
  { id: 111833, name: "sports car" },
  { id: 111757, name: "transportation" },
];

export function tagsParam(ids: number[]): string | undefined {
  if (!ids.length) return undefined;
  return ids.join(",");
}
