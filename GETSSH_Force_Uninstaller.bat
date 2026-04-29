@echo off
chcp 65001 >nul
color 0c
echo =======================================================
echo          GETSSH 强制卸载 / 幽灵注册表清理工具
echo =======================================================
echo.
echo 检测到旧版静默安装导致的幽灵残留，即将开始强力清理...
echo.
pause

echo.
echo [1/4] 强制终止可能正在运行的 GETSSH 进程...
taskkill /F /IM "GETSSH.exe" /T >nul 2>&1
taskkill /F /IM "GETSSH Setup 1.0.0.exe" /T >nul 2>&1

echo.
echo [2/4] 清除幽灵 AppData 目录 (包含旧版静默安装文件)...
if exist "%LocalAppData%\Programs\getssh" (
    rmdir /s /q "%LocalAppData%\Programs\getssh"
    echo - 已清除 LocalAppData 安装目录
)
if exist "%LocalAppData%\getssh-updater" (
    rmdir /s /q "%LocalAppData%\getssh-updater"
    echo - 已清除自动更新缓存
)

echo.
echo [3/4] 清除 Program Files 全局安装目录...
if exist "%ProgramFiles%\GETSSH" (
    rmdir /s /q "%ProgramFiles%\GETSSH"
    echo - 已清除 Program Files 安装目录
)
if exist "%ProgramFiles(x86)%\GETSSH" (
    rmdir /s /q "%ProgramFiles(x86)%\GETSSH"
    echo - 已清除 Program Files (x86) 安装目录
)

echo.
echo [4/4] 抹除控制面板及开始菜单残留...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\GETSSH" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\GETSSH" /f >nul 2>&1
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\GETSSH" (
    rmdir /s /q "%AppData%\Microsoft\Windows\Start Menu\Programs\GETSSH"
)
if exist "%ProgramData%\Microsoft\Windows\Start Menu\Programs\GETSSH" (
    rmdir /s /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\GETSSH"
)

echo.
echo =======================================================
echo 清理完毕！您的电脑中已不再含有任何 GETSSH 的执行文件残留。
echo （注意：为保护数据，您的加密密钥 profiles.enc 被保留在系统中）
echo =======================================================
echo.
pause
