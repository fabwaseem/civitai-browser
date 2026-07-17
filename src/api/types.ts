export type SortOption =
  | "Newest"
  | "Most Reactions"
  | "Most Comments"
  | "Most Collected";

export type PeriodOption = "AllTime" | "Year" | "Month" | "Week" | "Day";

export type NsfwOption = "None" | "Soft" | "Mature" | "X";

export type WorkflowMode = "workflow" | "meta" | "all";

export interface CivitaiStats {
  cryCount?: number;
  laughCount?: number;
  likeCount?: number;
  dislikeCount?: number;
  heartCount?: number;
  commentCount?: number;
  collectedCount?: number;
}

export interface CivitaiImage {
  id: number;
  url: string;
  hash?: string | null;
  width: number;
  height: number;
  nsfwLevel?: string | number;
  createdAt?: string;
  postId?: number;
  username?: string;
  meta?: Record<string, unknown> | null;
  stats?: CivitaiStats;
  modelVersionIds?: number[];
}

export interface ImagesMetadata {
  nextCursor?: string | null;
  nextPage?: string | null;
  currentPage?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
}

export interface ImagesResponse {
  items: CivitaiImage[];
  metadata?: ImagesMetadata | null;
}

export interface FetchImagesParams {
  limit?: number;
  cursor?: string | null;
  sort?: SortOption;
  period?: PeriodOption;
  nsfw?: NsfwOption;
  username?: string;
  modelId?: number | null;
  modelVersionId?: number | null;
  baseModels?: string;
  tags?: string;
  apiToken?: string;
}

export interface CachedImage {
  path: string;
  fromCache: boolean;
  format: string;
}

export type MetaKind = "workflow" | "meta" | "none";
