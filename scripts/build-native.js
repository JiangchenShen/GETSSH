const { execSync } = require('child_process');
const fs = require('fs');

const modules = [
  'getssh-kv',
  'getssh-sysprobe',
  'getssh-unarchive',
  'getssh-vault',
  'sftp-stream',
  'tidal-engine',
  'audit-stream',
  'ocean-sentinel',
  'getssh-keystore',
  'getssh-store'
];

// Extra cargo features per module. getssh-keystore is also a plain Rust library inside
// getssh-store; only its standalone .node carries the N-API exports.
const features = {
  'getssh-keystore': 'napi'
};

const target = process.env.RUST_TARGET;
if (!target) {
  console.error("RUST_TARGET environment variable is required.");
  process.exit(1);
}

const supportedTargets = new Set([
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'aarch64-pc-windows-msvc',
  'x86_64-pc-windows-msvc'
]);
if (!supportedTargets.has(target)) {
  console.error(`Unsupported GETSSH desktop build target: ${target}`);
  process.exit(1);
}

// Rust's debug-info stripping can misalign Mach-O LINKEDIT on macOS 27 (rust-lang/rust#157750).
const buildEnv = { ...process.env };
if (target.endsWith('apple-darwin')) {
  buildEnv.RUSTFLAGS = `${buildEnv.RUSTFLAGS || ''} -C strip=none`.trim();
}
const crossCompile = target.endsWith('pc-windows-msvc') && process.platform !== 'win32'
  ? '--cross-compile'
  : '';

for (const mod of modules) {
  console.log(`\n==================================================`);
  console.log(`Building ${mod} for target ${target}...`);
  console.log(`==================================================\n`);
  
  const cwd = `rust-core/${mod}`;
  
  // Build N-API module
  console.log(`> Building N-API module in ${cwd}...`);
  try {
    const pkg = JSON.parse(fs.readFileSync(`${cwd}/package.json`, 'utf8'));
    const isPlatform = pkg.napi ? '--platform' : '';
    
    const featureArgs = features[mod] ? `--features ${features[mod]}` : '';
    execSync(`pnpm exec napi build ${isPlatform} ${crossCompile} --release --target ${target} --no-js ${featureArgs}`, {
      cwd, 
      stdio: 'inherit',
      shell: true,
      env: buildEnv
    });
  } catch (err) {
    console.error(`Failed to build ${mod}.`);
    process.exit(1);
  }
}

console.log("\nAll native modules built successfully.");
