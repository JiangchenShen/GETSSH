import json
import subprocess
import sys

def run(cmd):
    print(f"Running: {cmd}")
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Failed: {res.stderr}")
        sys.exit(1)
    return res.stdout

with open('/tmp/prs.json') as f:
    prs = json.load(f)

# Iterate in reverse to merge older PRs first (170 -> 178)
prs_to_merge = [pr for pr in prs if 170 <= pr['number'] <= 178]
prs_to_merge.sort(key=lambda x: x['number'])

for pr in prs_to_merge:
    num = pr['number']
    branch = pr['head']['ref']
    print(f"--- Merging PR {num} (branch: {branch}) ---")
    run(f"git fetch origin {branch}")
    try:
        res = subprocess.run(f"git merge origin/{branch} -m 'Merge PR {num}'", shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Conflict in {branch}!")
            print(res.stdout)
            print(res.stderr)
            sys.exit(1)
    except Exception as e:
        print("Error:", e)
        sys.exit(1)

run("git push origin main")
print("All PRs merged into main and pushed successfully!")
