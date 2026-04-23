// FIX: Changed from generateSW (which overwrites your custom SW completely) to
// injectManifest (which merges Workbox's precache manifest INTO your own SW).
// Also injects the BUILD_ID placeholder so CACHE_NAME is unique per deploy.
const { injectManifest } = require('workbox-build');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

async function build() {
  try {
    // Garantir que `public/config.js` receba um `buildId` novo em cada build.
    try {
      execSync('node scripts/generate-config.js', { stdio: 'inherit' });
    } catch (err) {
      console.warn('generate-config.js falhou, prosseguindo:', err?.message || err);
    }

    const publicDir = path.join(process.cwd(), 'public');

    // Read generated config.js to find the per-build service worker filename and buildId.
    let swDestFilename = 'service-worker.js';
    let buildId = String(Date.now());
    try {
      const cfg = fs.readFileSync(path.join(publicDir, 'config.js'), 'utf8');

      const mFile = cfg.match(/globalThis\.SHOWDO_CONFIG\.serviceWorkerFile\s*=\s*(['"])(.*?)\1/);
      if (mFile && mFile[2]) swDestFilename = mFile[2];

      const mId = cfg.match(/globalThis\.SHOWDO_CONFIG\.buildId\s*=\s*(['"])(.*?)\1/);
      if (mId && mId[2]) buildId = mId[2];
    } catch (err) {
      console.warn('Não foi possível ler config.js, usando defaults:', err?.message);
    }

    const swSrc = path.join(process.cwd(), 'sw-template.js'); // your custom SW template
    const swDest = path.join(publicDir, swDestFilename);

    // FIX: injectManifest reads `swSrc`, injects the precache manifest, and
    // writes the result to `swDest`. Your custom SW code is preserved intact.
    const { count, size, warnings } = await injectManifest({
      swSrc,
      swDest,
      globDirectory: publicDir,
      globPatterns: [
        '**/*.{html,css,js,json}',
        'icons/**/*.*'
      ],
      globIgnores: [
        'service-worker.js',
        'service-worker.*.js',
        'service-worker.*.js.map',
        // Do not precache runtime config so clients always fetch latest
        'config.js',
        'config.json',
        'node_modules/**',
        'scripts/**',
        '.git/**',
        'package-lock.json'
      ],
    });

    if (warnings?.length) {
      console.warn('Workbox warnings:');
      for (const w of warnings) console.warn(w);
    }

    // FIX: Replace the BUILD_ID placeholder in the emitted SW file with the
    // real buildId so CACHE_NAME is unique and old caches are evicted cleanly.
    let swContent = fs.readFileSync(swDest, 'utf8');
    swContent = swContent.replaceAll('__BUILD_ID__', buildId);
    fs.writeFileSync(swDest, swContent, 'utf8');

    console.log(`Generated SW with ${count} precached files (${size} bytes) → ${swDest}`);
    console.log(`CACHE_NAME will be: showdo-miau-${buildId}`);
  } catch (err) {
    console.error('Error generating service worker:', err);
    process.exit(1);
  }
}

build();
