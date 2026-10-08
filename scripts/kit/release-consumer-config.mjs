// The rules of the section `consumers` of config/release.json that the schema cannot express. release.mjs loadConfig calls it,
// so every release step rejects an inconsistent section. It reads the configuration only.
//
//   consumers.<npm|composer> = { directory, smoke }   the consumer project of the archives of that kind: `directory` holds
//                                                      its committed manifest and lock; `smoke` maps each package that the
//                                                      project installs to the command that checks it

/** The package kinds that have a consumer project. */
export const CONSUMER_KINDS = ['npm', 'composer'];

const command = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item !== '');

/** The problems of `consumers` of a configuration that passed the schema, as sentences without the file name. */
export function consumerConfigProblems(config) {
  const problems = [];
  const bad = (where, value) => problems.push(`${where} needs a command, a non-empty array of non-empty strings, found ${JSON.stringify(value)}`);
  if (config.consumers) {
    const directories = new Set();
    for (const kind of CONSUMER_KINDS) {
      const names = config.packages.filter(item => item.kind === kind).map(({ name }) => name);
      const consumer = config.consumers[kind];
      if (!consumer) {
        if (names.length) problems.push(`consumers.${kind} is missing; the ${kind} packages [${names.join(', ')}] need a consumer project that installs them`);
        continue;
      }
      if (!names.length) problems.push(`consumers.${kind} is set but packages lists no ${kind} package`);
      if (directories.has(consumer.directory)) problems.push(`consumers.${kind}.directory ${consumer.directory} is also the directory of another consumer`);
      directories.add(consumer.directory);
      if (typeof consumer.smoke !== 'object' || consumer.smoke === null || Array.isArray(consumer.smoke) || !Object.keys(consumer.smoke).length) {
        problems.push(`consumers.${kind}.smoke needs one entry per installed package, an object from a package name to its command`);
        continue;
      }
      for (const [name, smoke] of Object.entries(consumer.smoke)) {
        if (!names.includes(name)) problems.push(`consumers.${kind}.smoke.${name} is not a ${kind} package of packages [${names.join(', ')}]`);
        if (!command(smoke)) bad(`consumers.${kind}.smoke.${name}`, smoke);
      }
    }
  }
  return problems;
}
