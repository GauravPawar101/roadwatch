import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixturesByPromptId, isPromptTemplate } from './fixtures';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '../..');
const PROMPTS_ROOT = path.resolve(REPO_ROOT, 'core', 'prompts');
const SNAPSHOT_DIR = path.resolve(REPO_ROOT, 'tools', 'prompt-tests', 'snapshots');

async function listPromptModules(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listPromptModules(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name === 'types.ts' || entry.name === 'index.ts') continue;
    results.push(full);
  }

  return results;
}

function snapshotPathFor(promptId: string): string {
  const safe = promptId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(SNAPSHOT_DIR, `${safe}.txt`);
}

async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

async function main() {
  await ensureDir(SNAPSHOT_DIR);

  const modules = await listPromptModules(PROMPTS_ROOT);
  const discovered: Array<{ file: string; exportName: string; prompt: any }> = [];

  for (const file of modules) {
    const mod = await import(pathToFileURL(file).toString());
    for (const [exportName, value] of Object.entries(mod)) {
      if (isPromptTemplate(value)) {
        discovered.push({ file, exportName, prompt: value });
      }
    }
  }

  if (discovered.length === 0) {
    throw new Error('No PromptTemplate exports discovered under core/prompts/**.');
  }

  const missingFixtures: string[] = [];
  const snapshotChanges: string[] = [];

  for (const item of discovered) {
    const fixture = fixturesByPromptId[item.prompt.id];
    if (!fixture) {
      missingFixtures.push(item.prompt.id);
      continue;
    }

    const built = String(item.prompt.build(fixture.input));
    if (!built.includes('Respond in JSON')) {
      throw new Error(`Prompt ${item.prompt.id} (${item.exportName}) missing 'Respond in JSON' contract line.`);
    }

    const parsed = item.prompt.parse(fixture.validResponseJson);
    if (!parsed.ok) {
      throw new Error(`Prompt ${item.prompt.id} parse() failed on fixture JSON.`);
    }

    const validated = item.prompt.validate(parsed.value);
    if (!validated.valid) {
      throw new Error(`Prompt ${item.prompt.id} validate() failed on fixture output.`);
    }

    const snapPath = snapshotPathFor(item.prompt.id);
    const normalized = built.replace(/\r\n/g, '\n').trimEnd() + '\n';

    try {
      const existing = await readFile(snapPath, 'utf8');
      if (existing !== normalized) {
        snapshotChanges.push(item.prompt.id);
        await writeFile(snapPath, normalized, 'utf8');
      }
    } catch {
      // First run: create snapshot.
      await writeFile(snapPath, normalized, 'utf8');
    }
  }

  if (snapshotChanges.length) {
    // Fail in CI to force review of prompt changes.
    throw new Error(
      `Prompt snapshot changed for: ${snapshotChanges.join(', ')}. ` +
      `Snapshots were updated; review and commit intentionally.`
    );
  }

  console.log(`[prompt-tests] Discovered prompt templates: ${discovered.length}`);
  console.log(`[prompt-tests] Fixtures present for: ${Object.keys(fixturesByPromptId).length}`);
  if (missingFixtures.length) {
    console.log(`[prompt-tests] Missing fixtures (skipped): ${missingFixtures.join(', ')}`);
  }
  console.log('[prompt-tests] OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
