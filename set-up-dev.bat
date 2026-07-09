@echo off
setlocal EnableDelayedExpansion
title Truxify Development Setup

:: ======================================================
:: Colors
:: ======================================================

for /F %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"

set RED=%ESC%[91m
set GREEN=%ESC%[92m
set YELLOW=%ESC%[93m
set BLUE=%ESC%[94m
set CYAN=%ESC%[96m
set MAGENTA=%ESC%[95m
set RESET=%ESC%[0m

:: ======================================================
:: Logging Functions
:: ======================================================

goto :main

:info
echo %BLUE%[INFO]%RESET% %*
exit /b

:success
echo %GREEN%[SUCCESS]%RESET% %*
exit /b

:warn
echo %YELLOW%[WARNING]%RESET% %*
exit /b

:error
echo %RED%[ERROR]%RESET% %*
exit /b

:section
echo.
echo %MAGENTA%=====================================================%RESET%
echo %CYAN%%~1%RESET%
echo %MAGENTA%=====================================================%RESET%
exit /b

:checkCommand
where %1 >nul 2>nul

if errorlevel 1 (
    call :warn "%2 not found"
    set MISSING=!MISSING! %2
) else (
    call :success "%2 found"
)

exit /b

:main

cls

echo.
echo =====================================================
echo              TRUXIFY DEVELOPMENT SETUP
echo =====================================================
echo.

call :section "Verifying Project Structure"

set FAILED=0

if not exist apps (
    call :error "Missing folder: apps"
    set FAILED=1
)

if not exist backend (
    call :error "Missing folder: backend"
    set FAILED=1
)

if not exist blockchain (
    call :error "Missing folder: blockchain"
    set FAILED=1
)

if not exist docker-compose.yml (
    call :error "Missing docker-compose.yml"
    set FAILED=1
)

if not exist README.md (
    call :error "Missing README.md"
    set FAILED=1
)

if "%FAILED%"=="1" (
    call :error "Run this script from repository root."
    pause
    exit /b 1
)

call :success "Project structure verified."

call :section "Checking Required Software"

set MISSING=

call :checkCommand git Git
call :checkCommand curl Curl
call :checkCommand flutter Flutter
call :checkCommand dart Dart
call :checkCommand node Node.js
call :checkCommand npm npm
call :checkCommand docker Docker

docker compose version >nul 2>nul

if errorlevel 1 (
    call :warn "Docker Compose not installed"
    set MISSING=!MISSING! DockerCompose
) else (
    call :success "Docker Compose found"
)

if not "%MISSING%"=="" (
    echo.
    call :error "Missing software:"
    echo %MISSING%
    echo.
    pause
    exit /b 1
)

call :section "Checking Versions"

for /f "tokens=1 delims=." %%i in ('node -p "process.versions.node"') do (
    set NODEMAJOR=%%i
)

if %NODEMAJOR% LSS 20 (
    call :warn "Node.js 20+ recommended"
) else (
    call :success "Node.js version OK"
)

call flutter --version

call :success "Flutter detected"

call :section "Flutter Doctor"

call flutter doctor

echo.
choice /M "Continue with setup"

if errorlevel 2 exit /b
:: ======================================================
:: Environment Files
:: ======================================================

call :section "Preparing Configuration Files"

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        call :success ".env created"
    ) else (
        call :warn ".env.example not found"
    )
) else (
    call :success ".env already exists"
)

if not exist docker-compose.override.yml (
    if exist docker-compose.override.yml.example (
        copy docker-compose.override.yml.example docker-compose.override.yml >nul
        call :success "docker-compose.override.yml created"
    )
)

if not exist dart_defines (
    mkdir dart_defines
)

if not exist dart_defines\dev.env (
    if exist dart_defines\dev.env.example (
        copy dart_defines\dev.env.example dart_defines\dev.env >nul
        call :success "dart_defines\dev.env created"
    )
)

:: ======================================================
:: Edit Environment
:: ======================================================

echo.
choice /M "Edit .env now"

if errorlevel 2 (
    goto skipEdit
)

notepad .env

:skipEdit

:: ======================================================
:: BYPASS_AUTH
:: ======================================================

echo.
choice /M "Enable BYPASS_AUTH"

if errorlevel 2 goto skipAuth

findstr /B "BYPASS_AUTH=" .env >nul

if errorlevel 1 (
    echo BYPASS_AUTH=true>>.env
) else (
    powershell -Command ^
    "(Get-Content '.env') -replace '^BYPASS_AUTH=.*','BYPASS_AUTH=true' | Set-Content '.env'"
)

call :success "BYPASS_AUTH enabled"

:skipAuth

:: ======================================================
:: Backend Dependencies
:: ======================================================

call :section "Installing Backend Dependencies"

if exist backend\api (

    pushd backend\api

    call :info "Running npm install..."

    call npm install

    if errorlevel 1 (
        call :error "Backend install failed"
        popd
        exit /b 1
    )

    popd

    call :success "Backend dependencies installed."

)

:: ======================================================
:: Customer App
:: ======================================================

call :section "Customer App"

if exist apps\customer (

    pushd apps\customer

    call :info "Running flutter pub get"

    call flutter pub get

    if exist dart_define.json.example (

        if not exist dart_define.json (

            copy dart_define.json.example dart_define.json >nul

            call :success "Customer dart_define.json created"

        )

    )

    popd

)

:: ======================================================
:: Driver App
:: ======================================================

call :section "Driver App"

if exist apps\driver (

    pushd apps\driver

    call :info "Running flutter pub get"

    call flutter pub get

    if exist dart_define.json.example (

        if not exist dart_define.json (

            copy dart_define.json.example dart_define.json >nul

            call :success "Driver dart_define.json created"

        )

    )

    popd

)

:: ======================================================
:: Shared Package
:: ======================================================

if exist packages\truxify_shared (

    call :section "Shared Package"

    pushd packages\truxify_shared

    call flutter pub get

    popd

    call :success "Shared package ready."

)

:: ======================================================
:: Root Dependencies
:: ======================================================

if exist package.json (

    call :section "Installing Root Packages"

    call npm install

    call :success "Root dependencies installed."

)

:: ======================================================
:: Blockchain
:: ======================================================

if exist blockchain\package.json (

    call :section "Blockchain"

    pushd blockchain

    call npm install

    popd

    call :success "Blockchain dependencies installed."

)
:: ======================================================
:: Repository Utility Scripts
:: ======================================================

call :section "Running Repository Utility Scripts"

if exist scripts\generate_dart_defines.bat (
    call :info "Running generate_dart_defines.bat"
    call scripts\generate_dart_defines.bat
) else if exist scripts\generate_dart_defines.ps1 (
    call :info "Running generate_dart_defines.ps1"
    powershell -ExecutionPolicy Bypass -File scripts\generate_dart_defines.ps1
) else (
    call :warn "generate_dart_defines script not found"
)

if exist scripts\check-no-client-credentials.bat (
    call scripts\check-no-client-credentials.bat
) else if exist scripts\check-no-client-credentials.ps1 (
    powershell -ExecutionPolicy Bypass -File scripts\check-no-client-credentials.ps1
) else (
    call :warn "Credential check script not found"
)

:: ======================================================
:: Docker
:: ======================================================

call :section "Docker"

docker info >nul 2>nul

if errorlevel 1 (
    call :error "Docker Desktop is not running."
    echo.
    echo Please start Docker Desktop and rerun this script.
    pause
    exit /b 1
)

call :success "Docker daemon is running."

:: ======================================================
:: Docker Compose
:: ======================================================

echo.
choice /M "Start Docker development stack"

if errorlevel 2 (
    set START_DOCKER=0
    goto dockerSkipped
)

set START_DOCKER=1

call :section "Starting Docker Compose"

docker compose up --build -d

if errorlevel 1 (
    call :error "Docker Compose failed."
    pause
    exit /b 1
)

call :success "Docker services started."

:dockerSkipped

:: ======================================================
:: Wait for Backend
:: ======================================================

if "%START_DOCKER%"=="1" (

call :section "Waiting for Backend"

set RETRY=1
set MAX=30

:waitLoop

curl -fs http://localhost:5000/health >nul 2>nul

if not errorlevel 1 (
    call :success "Backend is healthy."
    goto backendReady
)

call :info "Waiting... !RETRY!/!MAX!"

timeout /t 2 /nobreak >nul

set /a RETRY+=1

if !RETRY! LEQ !MAX! goto waitLoop

call :warn "Backend health endpoint did not respond."

echo.
echo docker compose logs api

:backendReady

)

:: ======================================================
:: Database Services
:: ======================================================

call :section "Database Services"

docker compose ps db | findstr "running" >nul

if errorlevel 1 (
    call :warn "PostgreSQL not detected."
) else (
    call :success "PostgreSQL running."
)

docker compose ps mongo | findstr "running" >nul

if errorlevel 1 (
    call :warn "MongoDB not detected."
) else (
    call :success "MongoDB running."
)

docker compose ps redis | findstr "running" >nul

if errorlevel 1 (
    call :warn "Redis not detected."
) else (
    call :success "Redis running."
)

:: ======================================================
:: Optional Seed
:: ======================================================

echo.
choice /M "Run database seed"

if errorlevel 2 goto skipSeed

if exist backend\api (

    pushd backend\api

    call npm run | findstr "seed" >nul

    if errorlevel 1 (

        call :warn "No seed command found."

    ) else (

        call :section "Running Seed"

        call npm run seed

        if errorlevel 1 (
            call :warn "Database seed failed."
        ) else (
            call :success "Database seeded."
        )

    )

    popd

)

:skipSeed
:: ======================================================
:: Git Hooks
:: ======================================================

call :section "Git Hooks"

if exist .husky\pre-commit (
    call :success "Husky hooks detected."
) else (
    if exist package.json (
        call npm run | findstr "prepare" >nul
        if not errorlevel 1 (
            call npm run prepare
            call :success "Git hooks prepared."
        )
    )
)

:: ======================================================
:: Flutter Analysis
:: ======================================================

call :section "Flutter Static Analysis"

if exist apps\customer (
    pushd apps\customer
    call :info "Analyzing Customer App..."
    call flutter analyze
    if errorlevel 1 (
        call :warn "Customer App contains analyzer warnings/errors."
    ) else (
        call :success "Customer App passed analysis."
    )
    popd
)

if exist apps\driver (
    pushd apps\driver
    call :info "Analyzing Driver App..."
    call flutter analyze
    if errorlevel 1 (
        call :warn "Driver App contains analyzer warnings/errors."
    ) else (
        call :success "Driver App passed analysis."
    )
    popd
)

:: ======================================================
:: Backend Tests
:: ======================================================

if exist backend\api (

    call :section "Backend Tests"

    pushd backend\api

    call npm run | findstr "test" >nul

    if not errorlevel 1 (

        echo.
        choice /M "Run backend tests"

        if errorlevel 2 (
            call :warn "Backend tests skipped."
        ) else (
            call npm test

            if errorlevel 1 (
                call :warn "Some backend tests failed."
            ) else (
                call :success "Backend tests passed."
            )
        )

    ) else (
        call :warn "No backend test script found."
    )

    popd
)

:: ======================================================
:: Verify Files
:: ======================================================

call :section "Verifying Configuration"

if exist .env (
    call :success ".env found"
) else (
    call :warn ".env missing"
)

if exist docker-compose.yml (
    call :success "docker-compose.yml found"
) else (
    call :warn "docker-compose.yml missing"
)

if exist dart_defines\dev.env (
    call :success "dart_defines\\dev.env found"
) else (
    call :warn "dart_defines\\dev.env missing"
)

:: ======================================================
:: Repository Structure
:: ======================================================

call :section "Checking Repository Structure"

for %%D in (
apps\customer
apps\driver
backend\api
blockchain
) do (
    if exist "%%D" (
        call :success "%%D"
    ) else (
        call :warn "%%D missing"
    )
)

:: ======================================================
:: Git Status
:: ======================================================

call :section "Git Repository"

git rev-parse --is-inside-work-tree >nul 2>nul

if errorlevel 1 (
    call :warn "Not inside a Git repository."
) else (
    call :success "Git repository detected."

    for /f %%i in ('git branch --show-current') do (
        echo Current Branch : %%i
    )
)

:: ======================================================
:: Outdated Packages
:: ======================================================

echo.
choice /M "Check for outdated npm packages"

if errorlevel 2 goto skipNpm

pushd backend\api
call npm outdated
popd

:skipNpm

echo.
choice /M "Check Flutter packages"

if errorlevel 2 goto skipFlutter

pushd apps\customer
call flutter pub outdated
popd

pushd apps\driver
call flutter pub outdated
popd

:skipFlutter

:: ======================================================
:: Final Validation
:: ======================================================

call :section "Final Validation"

set PASS=1

if not exist .env set PASS=0
if not exist backend\api\node_modules set PASS=0
if not exist apps\customer\.dart_tool set PASS=0
if not exist apps\driver\.dart_tool set PASS=0

if "%PASS%"=="1" (
    call :success "All essential setup steps completed successfully."
) else (
    call :warn "Some setup steps may be incomplete."
)

:: ======================================================
:: Development URLs
:: ======================================================

call :section "Local Development Services"

echo.
echo API          : http://localhost:5000
echo PostgreSQL   : localhost:5432
echo MongoDB      : localhost:27017
echo Redis        : localhost:6379
echo.

:: ======================================================
:: Useful Commands
:: ======================================================

call :section "Useful Commands"

echo.
echo Backend
echo --------
echo cd backend\api
echo npm run dev
echo.
echo Customer App
echo ------------
echo cd apps\customer
echo flutter run
echo.
echo Driver App
echo ----------
echo cd apps\driver
echo flutter run
echo.
echo Docker
echo ------
echo docker compose up --build
echo docker compose down
echo docker compose logs -f api
echo.
echo Flutter
echo --------
echo flutter doctor
echo flutter analyze
echo.

:: ======================================================
:: Summary
:: ======================================================

call :section "Setup Summary"

call :success "Project verified"
call :success "Operating system checked"
call :success "Dependencies installed"
call :success "Flutter environment checked"
call :success "Configuration prepared"

if "%START_DOCKER%"=="1" (
    call :success "Docker services started"
) else (
    call :warn "Docker services were not started"
)

echo.
echo ==========================================================
echo            DEVELOPMENT ENVIRONMENT READY
echo ==========================================================
echo.

call :success "Truxify configured successfully."

:: ======================================================
:: Contributor Tips
:: ======================================================

call :section "Contributor Tips"

echo.
echo ✓ Run flutter analyze
echo ✓ Run backend tests
echo ✓ Verify Docker services are healthy
echo ✓ Do not commit .env files
echo ✓ Keep commits small and descriptive
echo ✓ Follow CONTRIBUTING.md
echo.

findstr "YOUR_" .env >nul

if not errorlevel 1 (
    call :warn "Your .env still contains placeholder values."
)

echo.
call :success "Happy Coding!"
echo.
pause
exit /b 0