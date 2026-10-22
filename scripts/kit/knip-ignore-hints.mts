// A knip reporter (`knip --reporter <this file>`) that prints, as one JSON array, the ignoreDependencies of the configuration that
// matched no issue: knip's own configuration hints of type ignoreDependencies, each as { workspace, name }; a hint
// without its workspace fails the schema of the output (knip-ignore-hints.schema.json). lint-ts.mts runs knip
// with it first, to keep an ignore of the knip.json of kit only where knip needs it (K188).
import type { Reporter } from 'knip';

const reporter: Reporter = ({ configurationHints }) => {
  const unused = configurationHints
    .filter(hint => hint.type === 'ignoreDependencies')
    .map(hint => ({ workspace: hint.workspaceName, name: String(hint.identifier) }));
  process.stdout.write(`${JSON.stringify(unused)}\n`);
};

export default reporter;
