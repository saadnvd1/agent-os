export interface Change {
  path: string;
  // The path before a rename or copy.
  from?: string;
  deleted: boolean;
}

export interface CheckScope {
  // The whole suite runs: shared infrastructure changed, or it was asked for.
  full: boolean;
  reason: string;
  changed: number;
  lint: string[];
  format: string[];
  tests: string[];
}
