@echo off
chcp 65001 >nul
echo === Laboratoire dentaire : installation des dependances ===
where node >nul 2>nul || (echo Node.js n'est pas installe. Telechargez-le sur https://nodejs.org ^(version 18 ou plus^). & pause & exit /b 1)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" || (echo Node.js 18 ou plus est requis. Version actuelle : & node -v & pause & exit /b 1)
echo.
echo [1/2] Serveur...
pushd "%~dp0server" && call npm install || (popd & echo ECHEC de l'installation du serveur. & pause & exit /b 1)
popd
echo.
echo [2/2] Interface...
pushd "%~dp0client" && call npm install || (popd & echo ECHEC de l'installation de l'interface. & pause & exit /b 1)
popd
if not exist "%~dp0server\.env" (copy "%~dp0server\.env.example" "%~dp0server\.env" >nul & echo server\.env cree a partir du modele : pensez a renseigner JWT_SECRET.)
echo.
echo Verification de MongoDB...
pushd "%~dp0server" && call npm run -s check:db
popd
echo.
echo Installation terminee. Lancez :  npm run dev:server   puis, dans un autre terminal :  npm run dev:client
pause
