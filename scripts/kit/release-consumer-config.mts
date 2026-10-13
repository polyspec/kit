// The rules of the sections `consumers` and `proof` of config/release.json that the schema cannot express. release.mts
// loadConfig calls it, so every release step rejects an inconsistent section. It reads the configuration only.
//
//   consumers.<npm|composer> = { directory, smoke }   the consumer project of the archives of that kind: `directory` holds
//                                                      its committed manifest and lock; `smoke` maps each package that the
//                                                      project installs to the command that checks it
//   consumers.wheel = { smoke, lock, polyspec }        the wheels, installed into a virtual environment: `smoke` maps each
//                                                      wheel package to the command that checks it in the installed venv;
//                                                      `lock` maps each wheel package to its PEP 751 lock of dependencies;
//                                                      `polyspec` maps each polyspec distribution to its repository URL
//   proof.gitTag = { <manifest>: { kind, name, smoke } }  how the release proof installs a manifest that a tag releases
//                                                      through git (`git-tag` in `manifests`): kind rust, with its Cargo.toml

/** The package kinds that have a consumer project with a committed manifest and lock. */
export const CONSUMER_KINDS: ('npm' | 'composer')[] = ['npm', 'composer'];
/** The package kind of the wheels, whose consumer is a clean virtual environment with no committed lock. */
export const WHEEL_KIND: 'wheel' = 'wheel';
/** The kind of the git-tag manifests with their file names. */
export const GIT_TAG_KINDS: Record<string, string> = { rust: 'Cargo.toml' };

/**
 * A consumer of config/release.json as release.schema.json declares it: `directory` and `smoke` for npm and Composer,
 * `smoke`, `lock` and `polyspec` for the wheels.
 */
export type ConsumerSection = {
  directory?: string;
  smoke: Record<string, unknown>;
  lock?: Record<string, unknown>;
  polyspec?: Record<string, unknown>;
};

/**
 * The sections of config/release.json that consumerConfigProblems reads, in the shape that release.schema.json declares: the
 * manifests are read with `proof` only.
 */
export type ConsumerConfig = {
  packages: { kind: string; name: string }[];
  consumers?: { npm?: ConsumerSection; composer?: ConsumerSection; wheel?: ConsumerSection };
} & ({ proof?: undefined; manifests?: Record<string, unknown> } | { proof: { gitTag: Record<string, unknown> }; manifests: Record<string, unknown> });

const command = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item !== '');

const REPOSITORY = /^https:\/\/github\.com\/polyspec\/[A-Za-z0-9._-]+$/;
const LOCK_FILE = /(?:^|\/)pylock(?:\.[A-Za-z0-9._-]+)?\.toml$/;

/** The problems of the lock and polyspec maps of the wheel consumer: one lock for each wheel package, one repository for each polyspec distribution. */
function wheelProblems(consumer: ConsumerSection, names: string[], problems: string[]): void {
  if (typeof consumer.lock !== 'object' || consumer.lock === null || Array.isArray(consumer.lock)) {
    problems.push('consumers.wheel.lock needs one entry per wheel package, an object from a package name to its lock file');
  } else {
    for (const name of names) {
      const file = consumer.lock[name];
      if (typeof file !== 'string' || !LOCK_FILE.test(file)) problems.push(`consumers.wheel.lock.${name} is ${JSON.stringify(file ?? null)}, the lock of a wheel is pylock.toml or pylock.<name>.toml`);
    }
    for (const name of Object.keys(consumer.lock)) if (!names.includes(name)) problems.push(`consumers.wheel.lock.${name} is not a wheel package of packages [${names.join(', ')}]`);
  }
  if (typeof consumer.polyspec !== 'object' || consumer.polyspec === null || Array.isArray(consumer.polyspec)) {
    problems.push('consumers.wheel.polyspec needs an object from each polyspec distribution name to its repository URL');
  } else {
    for (const [name, url] of Object.entries(consumer.polyspec)) {
      if (names.includes(name)) {
        problems.push(`consumers.wheel.polyspec.${name} names the wheel package ${name} of this repository; a sibling of the release needs no declaration`);
        continue;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) problems.push(`consumers.wheel.polyspec.${name} needs a distribution name`);
      if (typeof url !== 'string' || !REPOSITORY.test(url)) problems.push(`consumers.wheel.polyspec.${name} is ${JSON.stringify(url)}, the repository of a polyspec package is https://github.com/polyspec/<repo>`);
    }
  }
}

/** The problems of the consumer smoke commands of `kind`: one command for each package of that kind. */
function smokeProblems(kind: string, consumer: ConsumerSection, names: string[], problems: string[]): void {
  if (typeof consumer.smoke !== 'object' || consumer.smoke === null || Array.isArray(consumer.smoke) || !Object.keys(consumer.smoke).length) {
    problems.push(`consumers.${kind}.smoke needs one entry per installed package, an object from a package name to its command`);
    return;
  }
  for (const [name, smoke] of Object.entries(consumer.smoke)) {
    if (!names.includes(name)) problems.push(`consumers.${kind}.smoke.${name} is not a ${kind} package of packages [${names.join(', ')}]`);
    if (!command(smoke)) problems.push(`consumers.${kind}.smoke.${name} needs a command, a non-empty array of non-empty strings, found ${JSON.stringify(smoke)}`);
  }
}

/** The problems of `consumers` and `proof` of a configuration that passed the schema, as sentences without the file name. */
export function consumerConfigProblems(config: ConsumerConfig): string[] {
  const problems: string[] = [];
  if (config.consumers) {
    const directories = new Set<string | undefined>();
    for (const kind of [...CONSUMER_KINDS, WHEEL_KIND]) {
      const names = config.packages.filter(item => item.kind === kind).map(({ name }) => name);
      const consumer = config.consumers[kind];
      if (!consumer) {
        if (names.length) problems.push(`consumers.${kind} is missing; the ${kind} packages [${names.join(', ')}] need a consumer project that installs them`);
        continue;
      }
      if (!names.length) problems.push(`consumers.${kind} is set but packages lists no ${kind} package`);
      if (kind !== WHEEL_KIND) {
        if (directories.has(consumer.directory)) problems.push(`consumers.${kind}.directory ${consumer.directory} is also the directory of another consumer`);
        directories.add(consumer.directory);
      }
      smokeProblems(kind, consumer, names, problems);
      if (kind === WHEEL_KIND) wheelProblems(consumer, names, problems);
    }
  }
  if (config.proof) {
    const gitTag = Object.entries(config.manifests).filter(([, mode]) => mode === 'git-tag').map(([file]) => file);
    for (const [file, entry] of Object.entries(config.proof.gitTag)) {
      if (config.manifests[file] !== 'git-tag') problems.push(`proof.gitTag.${file} is not a manifest with the mode "git-tag" in manifests`);
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        problems.push(`proof.gitTag.${file} needs an object { kind, name, smoke }`);
        continue;
      }
      // The check above leaves an object that is neither null nor an array.
      const fields = entry as Record<string, unknown>;
      const base = file.split('/').at(-1);
      // The kind is text that is a key of GIT_TAG_KINDS itself, not of every object (toString).
      const { kind } = fields;
      if (typeof kind !== 'string' || !Object.hasOwn(GIT_TAG_KINDS, kind)) problems.push(`proof.gitTag.${file}.kind is ${JSON.stringify(kind)}, the allowed values are ${Object.keys(GIT_TAG_KINDS).join(', ')}`);
      else if (GIT_TAG_KINDS[kind] !== base) problems.push(`proof.gitTag.${file}.kind ${kind} installs a ${GIT_TAG_KINDS[kind]}, not a ${base}`);
      if (typeof fields.name !== 'string' || !fields.name) problems.push(`proof.gitTag.${file}.name needs the package name, a non-empty string`);
      if (!command(fields.smoke)) problems.push(`proof.gitTag.${file}.smoke needs a command, a non-empty array of non-empty strings, found ${JSON.stringify(fields.smoke)}`);
    }
    for (const file of gitTag) if (!(file in config.proof.gitTag)) problems.push(`proof.gitTag lacks ${file}, which manifests releases by "git-tag"`);
  }
  return problems;
}
