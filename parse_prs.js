const fs = require('fs');
const prs = JSON.parse(fs.readFileSync('/tmp/prs.json'));
if (!Array.isArray(prs)) { console.log(prs); process.exit(1); }
prs.forEach(pr => {
  console.log(`PR ${pr.number}: ${pr.title} (branch: ${pr.head.ref})`);
});
