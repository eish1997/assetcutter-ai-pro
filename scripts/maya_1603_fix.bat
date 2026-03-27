@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Maya 1603 强力修复工具

:: =========================
:: 初始化
:: =========================
set "MODE=run"
set "FILTER_VERSION="
set "INSTALLER_PATH="
set "AUTO_REBOOT=0"
set "SKIP_UNINSTALL=0"
set "SHOW_HELP=0"

set "LOG_DIR=%~dp0logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "LOG_FILE=%LOG_DIR%\maya1603_deepfix_%TS%.log"

call :parse_args %*
if "%SHOW_HELP%"=="1" goto end

if not defined INSTALLER_PATH call :auto_discover_installer

echo.
echo ============================================
echo   Maya 1603 强力修复工具（按你给的5步）
echo ============================================
echo 日志文件: %LOG_FILE%
if defined FILTER_VERSION echo 版本筛选: %FILTER_VERSION%
if defined INSTALLER_PATH echo 安装包: %INSTALLER_PATH%
if "%AUTO_REBOOT%"=="1" echo 自动重启: 开启
echo.

:: 管理员权限检查
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [错误] 请右键“以管理员身份运行”此脚本。
  pause
  exit /b 1
)

call :log "===== 开始执行 Maya 1603 强力修复 ====="
call :log "MODE=%MODE%, FILTER_VERSION=%FILTER_VERSION%, INSTALLER_PATH=%INSTALLER_PATH%"

if /i "%MODE%"=="dryrun" (
  call :preview_actions
  goto done
)

call :confirm
if errorlevel 1 goto end

call :step1_uninstall
call :step2_delete_folders
call :step3_delete_registry
call :step4_clear_temp
call :step5_reboot_and_install
goto done

:: =========================
:: 步骤 1：先组件后主程序卸载
:: =========================
:step1_uninstall
if "%SKIP_UNINSTALL%"=="1" (
  echo [步骤1] 跳过卸载（你传了 /skip-uninstall）
  call :log "[STEP1] 跳过卸载"
  exit /b 0
)

echo.
echo [步骤1/5] 卸载 Autodesk 相关组件（先组件后 Maya）
call :log "[STEP1] 卸载开始"

if defined FILTER_VERSION (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ver='%FILTER_VERSION%';" ^
    "$paths=@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*');" ^
    "$apps=foreach($p in $paths){Get-ItemProperty $p -ErrorAction SilentlyContinue};" ^
    "$apps=$apps|Where-Object{ $_.DisplayName -match 'Autodesk' -and $_.DisplayName -match [regex]::Escape($ver) };" ^
    "$comp=$apps|Where-Object{ $_.DisplayName -notmatch 'Maya' }|Sort-Object DisplayName;" ^
    "$maya=$apps|Where-Object{ $_.DisplayName -match 'Maya' }|Sort-Object DisplayName;" ^
    "$list=@($comp+$maya);" ^
    "foreach($a in $list){ if([string]::IsNullOrWhiteSpace($a.UninstallString)){ continue }; $n=$a.DisplayName; $u=$a.UninstallString.Trim(); if($u -match 'MsiExec\.exe'){ $u=$u -replace '/I','/X'; if($u -notmatch '/qn'){ $u+=' /qn /norestart' } }; Write-Host ('[UNINSTALL] ' + $n); Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $u -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue }"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$paths=@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*');" ^
    "$apps=foreach($p in $paths){Get-ItemProperty $p -ErrorAction SilentlyContinue};" ^
    "$apps=$apps|Where-Object{ $_.DisplayName -match 'Autodesk' };" ^
    "$comp=$apps|Where-Object{ $_.DisplayName -notmatch 'Maya' }|Sort-Object DisplayName;" ^
    "$maya=$apps|Where-Object{ $_.DisplayName -match 'Maya' }|Sort-Object DisplayName;" ^
    "$list=@($comp+$maya);" ^
    "foreach($a in $list){ if([string]::IsNullOrWhiteSpace($a.UninstallString)){ continue }; $n=$a.DisplayName; $u=$a.UninstallString.Trim(); if($u -match 'MsiExec\.exe'){ $u=$u -replace '/I','/X'; if($u -notmatch '/qn'){ $u+=' /qn /norestart' } }; Write-Host ('[UNINSTALL] ' + $n); Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $u -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue }"
)

call :log "[STEP1] 卸载执行结束"
exit /b 0

:: =========================
:: 步骤 2：删除文件夹
:: =========================
:step2_delete_folders
echo.
echo [步骤2/5] 删除 Autodesk 相关目录
call :log "[STEP2] 删除目录开始"

if defined FILTER_VERSION (
  call :remove_children_match "C:\Program Files\Common Files\Autodesk Shared" "%FILTER_VERSION%"
  call :remove_children_match "%APPDATA%\Autodesk" "%FILTER_VERSION%"
  call :remove_children_match "%APPDATA%\Autodesk Installer" "%FILTER_VERSION%"
  call :remove_children_match "%LOCALAPPDATA%\Autodesk" "%FILTER_VERSION%"
  call :remove_packages_match "%LOCALAPPDATA%\Packages" "Autodesk" "%FILTER_VERSION%"
) else (
  call :remove_tree "C:\Program Files\Common Files\Autodesk Shared"
  call :remove_tree "%APPDATA%\Autodesk"
  call :remove_tree "%APPDATA%\Autodesk Installer"
  call :remove_tree "%LOCALAPPDATA%\Autodesk"
  call :remove_packages_match "%LOCALAPPDATA%\Packages" "Autodesk" ""
)

call :log "[STEP2] 删除目录结束"
exit /b 0

:: =========================
:: 步骤 3：删除注册表
:: =========================
:step3_delete_registry
echo.
echo [步骤3/5] 清理 Autodesk 注册表项
call :log "[STEP3] 注册表清理开始"

if defined FILTER_VERSION (
  call :remove_reg_children_match "HKCU\Software\Autodesk" "%FILTER_VERSION%"
  call :remove_reg_children_match "HKLM\Software\Autodesk" "%FILTER_VERSION%"
  call :remove_reg_children_match "HKLM\Software\WOW6432Node\Autodesk" "%FILTER_VERSION%"
) else (
  reg delete "HKCU\Software\Autodesk" /f >nul 2>&1
  reg delete "HKLM\Software\Autodesk" /f >nul 2>&1
  reg delete "HKLM\Software\WOW6432Node\Autodesk" /f >nul 2>&1
  echo [清理] 已删除 Autodesk 主注册表分支（HKCU/HKLM）
  call :log "[STEP3] 已删除 Autodesk 主注册表分支"
)

call :log "[STEP3] 注册表清理结束"
exit /b 0

:: =========================
:: 步骤 4：清空 temp
:: =========================
:step4_clear_temp
echo.
echo [步骤4/5] 清理临时目录 %TEMP%
call :log "[STEP4] 清理 TEMP 开始: %TEMP%"

:: 删除临时目录下文件和子目录（容错，不因单个失败中断）
for /f "delims=" %%f in ('dir /a-d /b "%TEMP%" 2^>nul') do del /f /q "%TEMP%\%%f" >nul 2>&1
for /f "delims=" %%d in ('dir /ad /b "%TEMP%" 2^>nul') do rd /s /q "%TEMP%\%%d" >nul 2>&1

echo [清理] TEMP 清理完成（被占用文件会自动跳过）
call :log "[STEP4] TEMP 清理结束"
exit /b 0

:: =========================
:: 步骤 5：重启并启动安装
:: =========================
:step5_reboot_and_install
echo.
echo [步骤5/5] 准备启动安装程序
call :log "[STEP5] 准备启动安装程序"

if not defined INSTALLER_PATH (
  echo [警告] 未自动找到安装包，跳过自动启动。
  echo         你可以手动传路径：maya_1603_fix.bat "C:\Autodesk\xxx\setup.exe"
  call :log "[STEP5] 未找到安装包，跳过启动"
) else (
  echo [信息] 已找到安装包: %INSTALLER_PATH%
  call :log "[STEP5] 安装包: %INSTALLER_PATH%"
)

if "%AUTO_REBOOT%"=="1" (
  if defined INSTALLER_PATH call :schedule_installer_after_reboot "%INSTALLER_PATH%"
  echo [执行] 10 秒后自动重启...
  call :log "[STEP5] 自动重启"
  shutdown /r /t 10 /c "Maya 1603 修复完成，准备重启后继续安装"
  exit /b 0
)

if defined INSTALLER_PATH (
  echo [执行] 立即以管理员权限启动安装器...
  call :log "[STEP5] 立即启动安装器"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Start-Process -FilePath '%INSTALLER_PATH%' -Verb RunAs"
) else (
  echo [提示] 未启动安装器（未找到文件）
)
exit /b 0

:: =========================
:: 工具函数
:: =========================
:remove_tree
set "T=%~1"
if exist "%T%" (
  rd /s /q "%T%" >nul 2>&1
  echo [删除] %T%
  call :log "[DEL] %T%"
) else (
  echo [跳过] 不存在: %T%
)
exit /b 0

:remove_children_match
set "BASE=%~1"
set "PAT=%~2"
if not exist "%BASE%" (
  echo [跳过] 不存在: %BASE%
  exit /b 0
)
for /f "delims=" %%d in ('dir /ad /b "%BASE%" 2^>nul') do (
  set "N=%%d"
  echo !N! | findstr /i /c:"%PAT%" >nul
  if !errorlevel! equ 0 (
    rd /s /q "%BASE%\%%d" >nul 2>&1
    echo [删除] %BASE%\%%d
    call :log "[DEL] %BASE%\%%d"
  )
)
exit /b 0

:remove_packages_match
set "BASE=%~1"
set "KW=%~2"
set "VER=%~3"
if not exist "%BASE%" (
  echo [跳过] 不存在: %BASE%
  exit /b 0
)
for /f "delims=" %%d in ('dir /ad /b "%BASE%" 2^>nul') do (
  set "N=%%d"
  echo !N! | findstr /i /c:"%KW%" >nul
  if !errorlevel! equ 0 (
    if "%VER%"=="" (
      rd /s /q "%BASE%\%%d" >nul 2>&1
      echo [删除] %BASE%\%%d
      call :log "[DEL] %BASE%\%%d"
    ) else (
      echo !N! | findstr /i /c:"%VER%" >nul
      if !errorlevel! equ 0 (
        rd /s /q "%BASE%\%%d" >nul 2>&1
        echo [删除] %BASE%\%%d
        call :log "[DEL] %BASE%\%%d"
      )
    )
  )
)
exit /b 0

:remove_reg_children_match
set "REGBASE=%~1"
set "REGPAT=%~2"
reg query "%REGBASE%" >nul 2>&1
if %errorlevel% neq 0 (
  echo [跳过] 注册表不存在: %REGBASE%
  exit /b 0
)
for /f "tokens=*" %%k in ('reg query "%REGBASE%" 2^>nul') do (
  echo %%k | findstr /i /c:"%REGPAT%" >nul
  if !errorlevel! equ 0 (
    reg delete "%%k" /f >nul 2>&1
    echo [删注] %%k
    call :log "[REGDEL] %%k"
  )
)
exit /b 0

:auto_discover_installer
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$root='C:\Autodesk'; if(-not (Test-Path $root)){ exit 0 }; $files=Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.exe','.msi' }; if(-not $files){ exit 0 }; $best=$files | Sort-Object @{Expression={ if($_.Name -match 'maya'){0}else{1} }}, @{Expression={ if($_.Name -match 'setup|install'){0}else{1} }}, @{Expression='LastWriteTime';Descending=$true} | Select-Object -First 1; if($best){ $best.FullName }"` ) do (
  set "INSTALLER_PATH=%%i"
)
exit /b 0

:schedule_installer_after_reboot
set "S_PATH=%~1"
set "TASK_NAME=MayaInstallAfterReboot"
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
schtasks /create /tn "%TASK_NAME%" /sc onlogon /ru "%USERNAME%" /tr "\"%S_PATH%\"" /f >nul 2>&1
if %errorlevel%==0 (
  echo [计划] 已创建开机后自动启动安装器任务: %TASK_NAME%
  call :log "[TASK] 已创建任务: %TASK_NAME% -> %S_PATH%"
) else (
  echo [警告] 创建开机自动启动任务失败，重启后请手动运行安装器。
  call :log "[WARN] 创建任务失败"
)
exit /b 0

:preview_actions
echo [预览模式] 将执行以下动作：
echo 1) 卸载 Autodesk 相关组件（先非 Maya，后 Maya）
echo 2) 删除 Autodesk 目录（支持版本筛选）
echo 3) 删除 Autodesk 注册表（支持版本筛选）
echo 4) 清空 %%TEMP%%
echo 5) 重启并启动安装器（若找到）
if defined FILTER_VERSION echo [筛选] 仅处理包含版本号 "%FILTER_VERSION%" 的项
if defined INSTALLER_PATH echo [安装包] %INSTALLER_PATH%
call :log "[DRYRUN] 完成预览"
exit /b 0

:confirm
echo.
echo [警告] 即将执行强清理（含卸载、删目录、删注册表）。
echo        若不加版本筛选，可能影响其他 Autodesk 软件。
choice /c YN /n /m "继续执行? [Y/N]: "
if errorlevel 2 (
  call :log "[ABORT] 用户取消"
  exit /b 1
)
call :log "[CONFIRM] 用户确认执行"
exit /b 0

:parse_args
if "%~1"=="" exit /b 0
if /i "%~1"=="/help" (
  set "SHOW_HELP=1"
  shift
  goto parse_args
)
if /i "%~1"=="/dryrun" (
  set "MODE=dryrun"
  shift
  goto parse_args
)
if /i "%~1"=="/run" (
  set "MODE=run"
  shift
  goto parse_args
)
if /i "%~1"=="/reboot" (
  set "AUTO_REBOOT=1"
  shift
  goto parse_args
)
if /i "%~1"=="/skip-uninstall" (
  set "SKIP_UNINSTALL=1"
  shift
  goto parse_args
)

echo %~1 | findstr /i /b /c:"/ver:" >nul
if %errorlevel%==0 (
  set "FILTER_VERSION=%~1"
  set "FILTER_VERSION=!FILTER_VERSION:/ver:=!"
  shift
  goto parse_args
)

if exist "%~1" set "INSTALLER_PATH=%~1"
shift
goto parse_args

:show_help
echo 用法:
echo   maya_1603_fix.bat
echo   maya_1603_fix.bat /dryrun
echo   maya_1603_fix.bat /ver:2020
echo   maya_1603_fix.bat /ver:2020 /reboot
echo   maya_1603_fix.bat /skip-uninstall
echo   maya_1603_fix.bat "C:\Autodesk\...\setup.exe"
echo.
echo 参数说明:
echo   /dryrun          仅预览，不实际改动
echo   /ver:2020        仅清理匹配版本号项（推荐）
echo   /reboot          清理后自动重启，重启后尝试自动启动安装器
echo   /skip-uninstall  跳过步骤1卸载
echo.
pause
exit /b 0

:log
set "MSG=%~1"
echo [%date% %time%] %MSG%>>"%LOG_FILE%"
exit /b 0

:done
echo.
echo 处理完成。
echo 日志文件: %LOG_FILE%
echo.
call :log "===== 处理结束 ====="
pause

:end
if "%SHOW_HELP%"=="1" call :show_help
endlocal
exit /b 0
@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Maya 1603 自动检查修复工具

:: =========================
:: 初始化
:: =========================
set "LOG_DIR=%~dp0logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "LOG_FILE=%LOG_DIR%\maya1603_fix_%TS%.log"
set "SUMMARY_FILE=%LOG_DIR%\maya1603_summary_%TS%.txt"
set "MODE=fix"
set "INSTALLER_PATH="
set "INSTALLER_AUTO_FOUND=0"
set "SHOW_HELP=0"

call :parse_args %*
if "%SHOW_HELP%"=="1" goto end
if /i "%MODE%"=="fix" if not defined INSTALLER_PATH call :auto_discover_installer

call :log "===== Maya 1603 检查与修复开始 ====="
call :log "脚本路径: %~f0"
call :log "日志文件: %LOG_FILE%"
call :log "摘要文件: %SUMMARY_FILE%"
call :log "模式: %MODE%"
if defined INSTALLER_PATH (
  call :log "安装包路径: %INSTALLER_PATH%"
  if "%INSTALLER_AUTO_FOUND%"=="1" call :log "安装包来源: 自动发现(C:\Autodesk)"
)

echo.
echo ==============================================
echo   Maya 1603 自动检查修复工具（Windows）
echo ==============================================
echo 运行模式: %MODE%
if defined INSTALLER_PATH echo 安装包: %INSTALLER_PATH%
if "%INSTALLER_AUTO_FOUND%"=="1" echo 安装包来源: 自动发现（C:\Autodesk 子目录）
echo 日志: %LOG_FILE%
echo 摘要: %SUMMARY_FILE%
echo.

:: =========================
:: 管理员权限检查
:: =========================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [错误] 请右键“以管理员身份运行”此脚本。
  call :log "[ERROR] 未以管理员运行，退出。"
  echo.
  pause
  exit /b 1
)
call :log "[OK] 管理员权限检查通过。"

if /i "%MODE%"=="check" (
  call :do_checks
  call :collect_logs
  goto done
)

call :do_checks
call :do_fixes
call :collect_logs
if defined INSTALLER_PATH call :retry_install "%INSTALLER_PATH%"
goto done

:: =========================
:: 检查项
:: =========================
:do_checks
echo.
echo === 开始环境检查 ===
call :log "--- 环境检查开始 ---"

:: 系统版本
for /f "tokens=4-5 delims=. " %%a in ('ver') do (
  set "WIN_VER=%%a.%%b"
)
echo [检查] Windows 版本: %WIN_VER%
call :log "[CHECK] Windows 版本: %WIN_VER%"

:: 磁盘空间（C盘）
for /f "tokens=3" %%a in ('dir /-c c:\ ^| findstr /i "bytes free"') do set "FREE_BYTES=%%a"
set "FREE_GB=未知"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f=(Get-PSDrive C).Free/1GB; '{0:N2}' -f $f" > "%temp%\maya_free.tmp" 2>nul
set /p FREE_GB=<"%temp%\maya_free.tmp"
del "%temp%\maya_free.tmp" >nul 2>&1
echo [检查] C盘可用空间: %FREE_GB% GB
call :log "[CHECK] C盘可用空间: %FREE_GB% GB"

:: 是否存在挂起重启
set "PENDING_REBOOT=0"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending" >nul 2>&1 && set "PENDING_REBOOT=1"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" >nul 2>&1 && set "PENDING_REBOOT=1"
if "%PENDING_REBOOT%"=="1" (
  echo [警告] 检测到系统挂起重启，建议先重启后再安装 Maya。
  call :log "[WARN] 检测到挂起重启。"
) else (
  echo [通过] 未检测到挂起重启。
  call :log "[OK] 未检测到挂起重启。"
)

:: Windows Installer 服务
sc query msiserver | findstr /i "RUNNING" >nul
if %errorlevel%==0 (
  echo [通过] Windows Installer(msiserver) 正在运行。
  call :log "[OK] msiserver RUNNING"
) else (
  echo [警告] Windows Installer(msiserver) 未运行。
  call :log "[WARN] msiserver not running"
)

:: Autodesk 常见安装目录权限可写性检测
call :check_write "C:\Autodesk"
call :check_write "%ProgramData%\Autodesk"
call :check_write "%TEMP%"

echo === 环境检查完成 ===
call :log "--- 环境检查结束 ---"
exit /b 0

:: =========================
:: 修复项
:: =========================
:do_fixes
echo.
echo === 开始自动修复 ===
call :log "--- 自动修复开始 ---"

:: 1) 结束 Autodesk 相关进程（可能锁文件导致 1603）
for %%p in (AdskAccessServiceHost.exe AdAppMgr.exe AutodeskDesktopApp.exe AutodeskInstaller.exe ODISInstaller.exe setup.exe msiexec.exe) do (
  taskkill /f /im %%p >nul 2>&1
)
echo [修复] 已尝试结束 Autodesk / 安装相关进程。
call :log "[FIX] 已尝试结束相关进程。"

:: 2) 重启 Windows Installer 服务
net stop msiserver >nul 2>&1
net start msiserver >nul 2>&1
if %errorlevel%==0 (
  echo [修复] 已重启 Windows Installer(msiserver)。
  call :log "[FIX] 已重启 msiserver。"
) else (
  echo [警告] 重启 msiserver 失败，请手动检查服务状态。
  call :log "[WARN] 重启 msiserver 失败。"
)

:: 3) 清理临时安装缓存（避免删除 C:\Autodesk 下安装包）
if exist "C:\Autodesk" (
  if exist "C:\Autodesk\Web Installer\*" rd /s /q "C:\Autodesk\Web Installer" >nul 2>&1
  if exist "C:\Autodesk\ODIS\*" rd /s /q "C:\Autodesk\ODIS" >nul 2>&1
  if exist "C:\Autodesk\Logs\*" rd /s /q "C:\Autodesk\Logs" >nul 2>&1
  echo [修复] 已清理 C:\Autodesk 下常见缓存子目录（保留安装包）。
  call :log "[FIX] 已清理 C:\Autodesk 常见缓存子目录（保留安装包）。"
) else (
  echo [信息] C:\Autodesk 不存在，跳过该项清理。
  call :log "[INFO] C:\Autodesk 不存在。"
)

if exist "%TEMP%\Autodesk\*" (
  rd /s /q "%TEMP%\Autodesk" >nul 2>&1
  echo [修复] 已清理 %TEMP%\Autodesk
  call :log "[FIX] 已清理 %TEMP%\Autodesk"
) else (
  echo [信息] %TEMP%\Autodesk 不存在，跳过清理。
  call :log "[INFO] %TEMP%\Autodesk 不存在。"
)

:: 4) 目录权限修复（仅对 Autodesk 目录授予 Administrators / SYSTEM 完全控制）
if not exist "C:\Autodesk" mkdir "C:\Autodesk" >nul 2>&1
if not exist "%ProgramData%\Autodesk" mkdir "%ProgramData%\Autodesk" >nul 2>&1
icacls "C:\Autodesk" /grant Administrators:(OI)(CI)F /grant SYSTEM:(OI)(CI)F /t >nul 2>&1
if %errorlevel%==0 (
  echo [修复] 已修复 C:\Autodesk 目录权限。
  call :log "[FIX] 已修复 C:\Autodesk 权限。"
) else (
  echo [警告] C:\Autodesk 权限修复失败。
  call :log "[WARN] C:\Autodesk 权限修复失败。"
)
icacls "%ProgramData%\Autodesk" /grant Administrators:(OI)(CI)F /grant SYSTEM:(OI)(CI)F /t >nul 2>&1
if %errorlevel%==0 (
  echo [修复] 已修复 %ProgramData%\Autodesk 目录权限。
  call :log "[FIX] 已修复 %ProgramData%\Autodesk 权限。"
) else (
  echo [警告] %ProgramData%\Autodesk 权限修复失败。
  call :log "[WARN] %ProgramData%\Autodesk 权限修复失败。"
)

:: 5) 重新注册 Windows Installer 组件
msiexec /unregister >nul 2>&1
msiexec /regserver >nul 2>&1
echo [修复] 已执行 msiexec 重新注册。
call :log "[FIX] 已执行 msiexec unregister/regserver。"

echo === 自动修复完成 ===
call :log "--- 自动修复结束 ---"
exit /b 0

:: =========================
:: 日志采集与摘要
:: =========================
:collect_logs
echo.
echo === 开始采集安装日志 ===
call :log "--- 日志采集开始 ---"

(
  echo Maya 1603 诊断摘要
  echo 时间: %date% %time%
  echo.
  echo [关键路径]
  echo - %TEMP%
  echo - C:\Autodesk
  echo - %ProgramData%\Autodesk
  echo - %LocalAppData%\Autodesk\ODIS
  echo.
)>"%SUMMARY_FILE%"

for %%f in ("%TEMP%\*.log" "%TEMP%\*.txt" "C:\Autodesk\*.log" "%LocalAppData%\Autodesk\ODIS\logs\*.log") do (
  if exist "%%~f" call :scan_log "%%~f"
)

:: 补充最近日志文件列表（Top 20）
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$paths=@($env:TEMP,'C:\Autodesk',Join-Path $env:LOCALAPPDATA 'Autodesk\ODIS\logs');" ^
  "$files=foreach($p in $paths){ if(Test-Path $p){ Get-ChildItem -Path $p -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.log','.txt' } } };" ^
  "$files | Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName,LastWriteTime | Format-Table -AutoSize | Out-File -FilePath '%SUMMARY_FILE%' -Append -Encoding utf8" >nul 2>&1

echo [完成] 已生成日志摘要: %SUMMARY_FILE%
call :log "[OK] 已生成摘要: %SUMMARY_FILE%"
call :log "--- 日志采集结束 ---"
exit /b 0

:scan_log
set "SCAN_FILE=%~1"
if not exist "%SCAN_FILE%" exit /b 0
call :log "[SCAN] %SCAN_FILE%"
findstr /i /c:"1603" /c:"Return value 3" /c:"fatal error" /c:"failed" "%SCAN_FILE%" >nul 2>&1
if %errorlevel%==0 (
  (
    echo.
    echo [命中] %SCAN_FILE%
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "Select-String -Path '%SCAN_FILE%' -Pattern '1603','Return value 3','fatal error','failed' -SimpleMatch -CaseSensitive:$false | Select-Object -First 12 | ForEach-Object { $_.Line }"
  )>>"%SUMMARY_FILE%"
)
exit /b 0

:: =========================
:: 自动重试安装
:: =========================
:retry_install
set "PKG=%~1"
if not exist "%PKG%" (
  echo [警告] 安装包不存在，跳过自动重试: %PKG%
  call :log "[WARN] 安装包不存在: %PKG%"
  exit /b 0
)

echo.
echo === 自动重试安装 ===
echo 安装包: %PKG%
call :log "--- 自动重试安装开始 ---"
call :log "[INFO] 安装包: %PKG%"

set "EXT=%~x1"
set "INSTALL_LOG=%LOG_DIR%\maya_install_%TS%.log"

if /i "%EXT%"==".msi" (
  echo [执行] msiexec /i + 详细日志
  call :log "[RUN] msiexec /i %PKG% /L*V %INSTALL_LOG%"
  msiexec /i "%PKG%" /L*V "%INSTALL_LOG%"
  set "RC=%errorlevel%"
) else (
  echo [执行] 启动安装器 EXE（等待结束）
  call :log "[RUN] start /wait %PKG%"
  start "" /wait "%PKG%"
  set "RC=%errorlevel%"
)

echo [结果] 安装器退出码: %RC%
call :log "[RESULT] 安装器退出码: %RC%"

if exist "%INSTALL_LOG%" (
  echo [信息] 安装日志: %INSTALL_LOG%
  call :scan_log "%INSTALL_LOG%"
)

call :log "--- 自动重试安装结束 ---"
exit /b 0

:: =========================
:: 子函数
:: =========================
:check_write
set "TARGET=%~1"
if not exist "%TARGET%" (
  echo [信息] 路径不存在: %TARGET%
  call :log "[INFO] 路径不存在: %TARGET%"
  exit /b 0
)
set "TEST_FILE=%TARGET%\.__maya1603_write_test__.tmp"
echo test>"%TEST_FILE%" 2>nul
if exist "%TEST_FILE%" (
  del "%TEST_FILE%" >nul 2>&1
  echo [通过] 可写: %TARGET%
  call :log "[OK] 可写: %TARGET%"
) else (
  echo [警告] 不可写: %TARGET%
  call :log "[WARN] 不可写: %TARGET%"
)
exit /b 0

:parse_args
if "%~1"=="" exit /b 0

if /i "%~1"=="/check" (
  set "MODE=check"
  shift
  goto parse_args
)
if /i "%~1"=="/fix" (
  set "MODE=fix"
  shift
  goto parse_args
)
if /i "%~1"=="/help" (
  set "SHOW_HELP=1"
  shift
  goto parse_args
)

if exist "%~1" (
  set "INSTALLER_PATH=%~1"
)
shift
goto parse_args

:auto_discover_installer
set "INSTALLER_PATH="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$root='C:\Autodesk'; if(-not (Test-Path $root)){ exit 0 }; $files=Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.exe','.msi' }; if(-not $files){ exit 0 }; $best=$files | Sort-Object @{Expression={ if($_.Name -match 'maya'){0}else{1} }}, @{Expression={ if($_.Name -match 'setup|install|autodesk'){0}else{1} }}, @{Expression='LastWriteTime';Descending=$true} | Select-Object -First 1; if($best){ $best.FullName }"` ) do (
  set "INSTALLER_PATH=%%i"
)
if defined INSTALLER_PATH (
  set "INSTALLER_AUTO_FOUND=1"
  call :log "[AUTO] 在 C:\Autodesk 自动发现安装包: %INSTALLER_PATH%"
) else (
  call :log "[AUTO] 未在 C:\Autodesk 发现可执行安装包(.exe/.msi)"
)
exit /b 0

:show_help
echo 用法:
echo   maya_1603_fix.bat                ^<默认：检查+自动修复^>
echo   maya_1603_fix.bat /check         ^<仅检查并采集日志^>
echo   maya_1603_fix.bat /fix           ^<检查+修复并采集日志^>
echo   maya_1603_fix.bat "D:\xxx.msi"   ^<修复后自动重试安装^>
echo   maya_1603_fix.bat /fix "D:\xxx.exe"
pause
exit /b 0

:log
set "MSG=%~1"
echo [%date% %time%] %MSG%>>"%LOG_FILE%"
exit /b 0

:done
echo.
echo 处理完成。已自动执行：
echo 1) 环境检查
echo 2) 常见 1603 自动修复
echo 3) 关键日志采集+摘要
if defined INSTALLER_PATH echo 4) 自动重试安装器
if not defined INSTALLER_PATH echo 4) 未发现安装包，已跳过自动启动
echo.
echo 日志已保存到: %LOG_FILE%
echo 摘要已保存到: %SUMMARY_FILE%
call :log "===== Maya 1603 检查与修复结束 ====="
pause

:end
endlocal
exit /b 0
