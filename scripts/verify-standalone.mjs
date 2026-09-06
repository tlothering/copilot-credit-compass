/**
 * Verifies the standalone build artefact is complete and clean.
 *
 * `next start` and `npm run dev` both run with the full node_modules tree on
 * disk, so they cannot tell you whether the *container* will work. Everything
 * checked here has failed, or could fail, only inside the image:
 *
 *   - pdfkit resolves its standard-font metrics through a require() whose path
 *     is assembled at run time. Next's static tracer cannot follow it, so the
 *     directory was silently omitted and the PDF export returned 500 in the
 *     container while passing every local test.
 *   - The file-store fallback writes to .data/. Next traces that file at build
 *     time, and the runtime stage copies .next/standalone wholesale, so local
 *     rows would ship inside the image and be served as public benchmark
 *     statistics on first boot.
 *
 * Run after `npm run build`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const failures = [];
const notes = [];

function ok(label, detail = '') {
  console.log(`PASS  ${label}${detail ? ` - ${detail}` : ''}`);
}
function fail(label, detail) {
  failures.push(`${label}${detail ? ` - ${detail}` : ''}`);
  console.log(`FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}

if (!existsSync(standalone)) {
  console.error('No .next/standalone directory. Run `npm run build` first.');
  process.exit(1);
}

// The server entrypoint the Dockerfile invokes.
if (existsSync(join(standalone, 'server.js'))) {
  ok('server.js present');
} else {
  fail('server.js present', 'the Dockerfile CMD would not resolve');
}

// Prices must never be compiled in; the rate card is read from disk at runtime.
if (existsSync(join(standalone, 'data', 'rate-card.v1.json'))) {
  ok('rate card traced into artefact');
} else {
  fail('rate card traced into artefact', 'data/rate-card.v1.json missing');
}

// The regression this script exists for.
const fontDir = join(standalone, 'node_modules', 'pdfkit', 'js', 'standard-fonts');
if (!existsSync(fontDir)) {
  fail('pdfkit standard fonts traced', `${fontDir} missing - PDF export will 500 in the container`);
} else {
  const n = readdirSync(fontDir).length;
  if (n > 0) {
    ok('pdfkit standard fonts traced', `${n} files`);
  } else {
    fail('pdfkit standard fonts traced', 'directory is empty');
  }
}

// Server-only packages that must be present for exports and Cosmos to work.
for (const mod of ['exceljs', 'pptxgenjs', '@react-pdf', '@azure/cosmos', '@azure/identity']) {
  if (existsSync(join(standalone, 'node_modules', mod))) {
    ok(`${mod} traced`);
  } else {
    fail(`${mod} traced`, 'server dependency missing from artefact');
  }
}

// .dockerignore is what actually keeps local state out of the image, so assert
// on it directly. This is deterministic; the .data check below is not, because
// a developer who has run the app locally will legitimately have the file.
const dockerignorePath = join(root, '.dockerignore');
if (!existsSync(dockerignorePath)) {
  fail('.dockerignore present', 'COPY . . would copy node_modules, .git and .data into the image');
} else {
  const entries = readFileSync(dockerignorePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  for (const required of ['.data', 'node_modules', '.env.*', '.git']) {
    if (entries.includes(required)) {
      ok(`.dockerignore excludes ${required}`);
    } else {
      fail(`.dockerignore excludes ${required}`, 'missing entry');
    }
  }
}

// On a clean checkout (CI) there is no .data, so the artefact must not contain
// one. Locally it is expected, and .dockerignore is what removes it.
if (existsSync(join(standalone, '.data'))) {
  if (process.env.CI) {
    fail('no local benchmark data in artefact', '.next/standalone/.data was traced in');
  } else {
    notes.push(
      'NOTE  .next/standalone/.data exists because you have local benchmark data. ' +
        'Docker excludes it via .dockerignore, so the image is unaffected.',
    );
  }
} else {
  ok('no local benchmark data in artefact');
}

for (const n of notes) console.log(n);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
