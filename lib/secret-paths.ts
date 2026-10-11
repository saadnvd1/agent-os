// Files that hold or guard secrets: env files, keys, credential stores and
// the folders keys live in (.ssh, .aws, .gnupg, .kube, .docker, gh, gcloud,
// tokenvault). Tested against a repo-relative or absolute path. A merge that
// touches one goes to Saad (lib/orchestrator/diff), and an orchestrator may
// never write one (lib/orchestrator/write-guard).
export const SECRET_PATH =
  /(^|\/)\.env(\.[^/]*)?$|(^|\/)[^/]*(secret|credential|tokenvault|keychain)[^/]*(\/|$)|\.(pem|key|p12|pfx)$|(^|\/)(id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pgpass)$|(^|\/)\.(ssh|aws|azure|gnupg|kube|docker)(\/|$)|(^|\/)\.config\/(gh|gcloud|op)(\/|$)/i;

export const isSecretPath = (p: string): boolean => SECRET_PATH.test(p);
