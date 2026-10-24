@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\RDViewer.exe" "%~dp0cli.mjs" %*
exit /b %errorlevel%
