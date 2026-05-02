# ============================================
# GETSSH - Fix Email Privacy & Push to GitHub
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Fix Email Privacy & Push to GitHub" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location "c:\Users\OtakuX\.gemini\antigravity\scratch\GETSSH"

# Step 1: Update email to GitHub noreply address
Write-Host "[1/4] Updating git email to GitHub noreply address..." -ForegroundColor Yellow
git config user.email "JiangchenShen@users.noreply.github.com"
Write-Host "  Email set to: JiangchenShen@users.noreply.github.com" -ForegroundColor Green
Write-Host ""

# Step 2: Stage all files
Write-Host "[2/4] Staging all files..." -ForegroundColor Yellow
git add -A
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# Step 3: Amend the commit with the new email
Write-Host "[3/4] Amending commit with new email..." -ForegroundColor Yellow
git commit --amend --reset-author --no-edit
Write-Host "  Commit updated." -ForegroundColor Green
Write-Host ""

# Step 4: Force push
Write-Host "[4/4] Pushing to GitHub..." -ForegroundColor Yellow
git push -u origin main --force

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Upload successful!" -ForegroundColor Green
    Write-Host "  https://github.com/JiangchenShen/GETSSH" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Push still failed. Try these steps:" -ForegroundColor Red
    Write-Host "  1. Go to GitHub Settings -> Emails" -ForegroundColor Yellow
    Write-Host "  2. Uncheck 'Block command line pushes'" -ForegroundColor Yellow
    Write-Host "     that expose my email" -ForegroundColor Yellow
    Write-Host "  3. Or find your numeric noreply email" -ForegroundColor Yellow
    Write-Host "     (format: ID+user@users.noreply.github.com)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Red
}

Write-Host ""
