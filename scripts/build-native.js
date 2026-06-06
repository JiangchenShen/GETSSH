const { execSync } = require('child_process');
const fs = require('fs');

const modules = [
  'getssh-kv',
  'getssh-sysprobe',
  'getssh-unarchive',
  'getssh-vault',
  'sftp-stream',
  'nexus-core'
];

const target = process.env.RUST_TARGET;
if (!target) {
  console.error("RUST_TARGET environment variable is required.");
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
    
    execSync(`pnpm exec napi build ${isPlatform} --release --target ${target}`, { 
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
