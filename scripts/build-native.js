const { execSync } = require('child_process');
const fs = require('fs');

const modules = [
  'getssh-kv',
  'getssh-sysprobe',
  'getssh-unarchive',
  'getssh-vault',
  'sftp-stream',
  'nexus-core',
  'audit-stream',
  'getssh-sentinel'
];

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
    
    execSync(`pnpm exec napi build ${isPlatform} --release --target ${target} --js false`, {
      cwd, 
      stdio: 'inherit',
      shell: true 
    });
  } catch (err) {
    console.error(`Failed to build ${mod}.`);
    process.exit(1);
  }
}

console.log("\nAll native modules built successfully.");
