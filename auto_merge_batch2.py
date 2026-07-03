
import subprocess
import sys
import os

prs = {
  "180": "jules-10834888526321717247-76353824",
  "181": "test/chaos-monkey-undefined-listen-4282848139241782657",
  "182": "testing/getssh-kv-unit-tests-10341120081842927931",
  "183": "security-fix/os-probe-injection-8390321989614721711",
  "184": "refactor/sftp-manager-error-handling-7280811096439610421",
  "185": "performance/pty-env-sanitization-13552472372960722049",
}

def run_cmd(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False, result.stdout, result.stderr
    return True, result.stdout, result.stderr

for pr_num, branch in prs.items():
    print(f"--- Merging PR {pr_num} (branch: {branch}) ---")
    success, stdout, stderr = run_cmd(f"git fetch origin {branch}")
    if not success:
        print(f"Failed to fetch {branch}!")
        sys.exit(1)
        
    success, stdout, stderr = run_cmd(f"git merge origin/{branch} --no-edit -m "Merge PR {pr_num}"")
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
