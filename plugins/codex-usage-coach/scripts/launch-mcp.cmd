@echo off
rem ============================================================
rem  Codex Usage Coach - MCP launcher (Windows)
rem  Finds a Node runtime in the same order Codex bundled plugins
rem  use, then starts the stdio MCP server.
rem  Usage: launch-mcp.cmd [server path relative to plugin root]
rem ============================================================
setlocal enableextensions enabledelayedexpansion

set "PLUGIN_ROOT=%~dp0.."
set "SERVER_REL=%~1"
if "%SERVER_REL%"=="" set "SERVER_REL=.\server\mcp-server.mjs"
set "SERVER=%PLUGIN_ROOT%\%SERVER_REL%"
rem an absolute path (C:\... or \\server\share) is used as-is
if not "%~d1"=="" set "SERVER=%SERVER_REL%"

if not exist "%SERVER%" (
  echo [usage-coach] server file not found: %SERVER% 1>&2
  exit /b 64
)

set "NODE_EXE="

rem 1) Node explicitly provided by Codex
call :try "%CODEX_MCP_NODE_PATH%"
rem 2) Node provided by browser tools
call :try "%CODEX_BROWSER_USE_NODE_PATH%"
rem 3) cua_node inside the Electron resources dir
call :try "%CODEX_ELECTRON_RESOURCES_PATH%\cua_node\bin\node.exe"
rem 4) cua_node next to the CLI path
if defined CODEX_CLI_PATH for %%I in ("%CODEX_CLI_PATH%") do call :try "%%~dpI..\cua_node\bin\node.exe"
rem 5) Codex runtime cache
call :try "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
rem 6) cua_node under LOCALAPPDATA (versioned dirs)
if not defined NODE_EXE if exist "%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node" (
  for /d %%D in ("%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\*") do (
    if not defined NODE_EXE call :try "%%~fD\bin\node.exe"
  )
)
rem 7) whatever is on PATH
if not defined NODE_EXE for /f "delims=" %%N in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%N"
)

if not defined NODE_EXE (
  echo [usage-coach] Node.js not found. Install Node 18+ or set CODEX_MCP_NODE_PATH to node.exe. 1>&2
  exit /b 127
)

"%NODE_EXE%" "%SERVER%" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%

:try
if not defined NODE_EXE if not "%~1"=="" if exist "%~1" set "NODE_EXE=%~1"
goto :eof
