#!/bin/bash
set -e

# Extract branch names for PRs 170-179 from the json
branches=$(node -e '
  const prs = JSON.parse(require("fs").readFileSync("/tmp/prs.json"));
  prs.forEach(pr => {
    if (pr.number >= 170 && pr.number <= 179) {
      console.log(pr.head.ref);
    }
  });
')

git checkout main
git pull origin main

for branch in $branches; do
  echo "Merging branch: $branch"
  git fetch origin $branch
  # Try to merge automatically
  if git merge origin/$branch -m "Merge branch '$branch' (#PR)"; then
    echo "Successfully merged $branch"
  else
    echo "Conflict detected in $branch!"
    exit 1
  fi
done
