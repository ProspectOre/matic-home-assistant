/** A spatial retry owns only the catalog request that revalidates its frame. */
export interface CatalogRecoveryLease {
  readonly isCurrent: () => boolean;
  readonly bind: (controller: AbortController) => void;
  readonly release: (controller: AbortController) => void;
  readonly finish: () => void;
}
