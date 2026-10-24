@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\RDViewer.exe" "%~dp0mcp.mjs" %*
exit /b %errorlevel%
