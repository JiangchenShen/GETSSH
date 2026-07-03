import subprocess
import sys
import os
import json

with open('/tmp/prs_new.json') as f:
    prs_data = json.load(f)

to_merge = [pr for pr in prs_data if 180 <= pr['number'] <= 185]
to_merge.sort(key=lambda x: x['number'])

def run_cmd(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False, result.stdout, result.stderr
    return True, result.stdout, result.stderr

for pr in to_merge:
    pr_num = pr['number']
    branch = pr['head']['ref']
    print(f"--- Merging PR {pr_num} (branch: {branch}) ---")
    
    success, stdout, stderr = run_cmd(f"git fetch origin {branch}")
    if not success:
        print(f"Failed to fetch {branch}!")
        sys.exit(1)
        
    success, stdout, stderr = run_cmd(f"git merge origin/{branch} --no-edit -m \"Merge PR {pr_num}\"")
    if not success:
        print(f"Conflict in {branch}!")
        print(stdout)
        print(stderr)
        sys.exit(1)

print("Running: git push origin main")
success, _, _ = run_cmd("git push origin main")
if not success:
    sys.exit(1)

print("All PRs merged into main and pushed successfully!")
