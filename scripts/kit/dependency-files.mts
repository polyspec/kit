// The files that declare or lock the dependencies of a checkout, of every ecosystem (K459): a change to one of them selects the
// dependency gate, whatever the owner declaration of the repository says, since a repository whose rules name only its own
// checks would otherwise land a dependency change with no review entry. owner-check.mts appends the rule to the declaration, so
// `make owner-check` and `make land` select the gate alike.

/** The globs of the dependency manifests and locks of the ecosystems: npm, Composer, Python, Cargo and Go. */
export const DEPENDENCY_FILE_GLOBS = [
  '**/package.json',
  '**/package-lock.json',
  '**/composer.json',
  '**/composer.lock',
  '**/pyproject.toml',
  '**/pylock.toml',
  '**/uv.lock',
  '**/requirements*.txt',
  '**/Cargo.toml',
  '**/Cargo.lock',
  '**/go.mod',
  '**/go.sum',
];

/** The gate of kit-gates that verifies the dependency manifests and locks against the policy and the review record. */
export const DEPENDENCY_GATE = 'dependency-policy-check';
