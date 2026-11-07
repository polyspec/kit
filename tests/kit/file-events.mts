// Observe a declared fixture file through filesystem events, including an already published file.
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';

export function filePublished(t: Pick<TestContext, 'after'>, file: string): Promise<void> {
  return new Promise(resolve => {
    const observer = watch(path.dirname(file), inspect);
    function inspect(): void {
      if (!existsSync(file)) return;
      observer.close();
      resolve();
    }
    t.after(() => observer.close());
    inspect();
  });
}
