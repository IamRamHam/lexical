@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title Lexical
pushd "%~dp0"
if errorlevel 1 goto :folder_error

set "LEXICAL_NODE=node.exe"
"%SystemRoot%\System32\where.exe" node.exe >nul 2>nul
if not errorlevel 1 goto :check_node
if not exist "%ProgramFiles%\nodejs\node.exe" goto :missing_node
set "LEXICAL_NODE=%ProgramFiles%\nodejs\node.exe"

:check_node
"%LEXICAL_NODE%" -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)" >nul 2>nul
if errorlevel 1 goto :missing_node

"%LEXICAL_NODE%" "%~dp0scripts\launch-windows.mjs"
set "LEXICAL_EXIT=%ERRORLEVEL%"
if not "%LEXICAL_EXIT%"=="0" pause
popd
exit /b %LEXICAL_EXIT%

:missing_node
echo(
echo Lexical の起動には、Node.js 22.13 以降が必要です。
echo 公式サイトで Windows Installer ^(.msi^) を入手してインストールしてください。
echo https://nodejs.org/en/download
echo インストール後、新しいウィンドウで「Lexicalを起動.cmd」を開き直してください。
pause
popd
exit /b 1

:folder_error
echo このファイルがあるフォルダーを開けませんでした。
pause
exit /b 1
