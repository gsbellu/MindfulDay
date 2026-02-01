@echo off
echo ===========================================
echo      MindfulDay Deployment Script
echo ===========================================

REM 1. Update Version
echo.
echo [1/4] Updating Version...
call node update_version.js
if %errorlevel% neq 0 (
    echo Error updating version.
    pause
    exit /b %errorlevel%
)

REM 2. Git Commit
echo.
echo [2/4] Git Check-in...
set /p commitMsg="Enter commit message: "

if "%commitMsg%"=="" set commitMsg="Auto-update version"

git add .
git commit -m "%commitMsg%"

REM 3. Git Push
echo.
echo [3/4] Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo Error pushing to git.
    pause
    exit /b %errorlevel%
)

REM 4. Monitor Deployment
echo.
echo [4/4] Verifying Deployment...
call node monitor_deployment.js

echo.
echo ===========================================
echo      Deployment Complete!
echo ===========================================
pause
