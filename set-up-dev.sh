#!/usr/bin/env bash

###############################################################################
# Truxify Development Setup Script
#
# Supports:
# - Linux
# - macOS
#
# This script prepares a contributor's local development environment.
#
# Safe to run multiple times.
###############################################################################

set -Eeuo pipefail

#######################################
# Colors
#######################################

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
MAGENTA="\033[0;35m"
NC="\033[0m"

#######################################
# Logging Helpers
#######################################

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

section() {
  echo
  echo -e "${MAGENTA}======================================================${NC}"
  echo -e "${CYAN}$1${NC}"
  echo -e "${MAGENTA}======================================================${NC}"
}

#######################################
# Error Handler
#######################################

trap 'error "Script failed at line $LINENO"; exit 1' ERR

#######################################
# Banner
#######################################

clear

echo -e "${CYAN}"
cat <<'EOF'

████████╗██████╗ ██╗   ██╗██╗  ██╗██╗███████╗██╗   ██╗
╚══██╔══╝██╔══██╗██║   ██║╚██╗██╔╝██║██╔════╝╚██╗ ██╔╝
   ██║   ██████╔╝██║   ██║ ╚███╔╝ ██║█████╗   ╚████╔╝
   ██║   ██╔══██╗██║   ██║ ██╔██╗ ██║██╔══╝    ╚██╔╝
   ██║   ██║  ██║╚██████╔╝██╔╝ ██╗██║██║        ██║
   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝

        Development Environment Setup

EOF

echo -e "${NC}"

#######################################
# Detect OS
#######################################

section "Detecting Operating System"

OS="$(uname -s)"

case "$OS" in
  Linux*)
    PLATFORM="Linux"
  ;;
  Darwin*)
    PLATFORM="macOS"
  ;;
  *)
    error "Unsupported operating system: $OS"
    exit 1
  ;;
esac

success "Detected: $PLATFORM"

#######################################
# Verify Project Root
#######################################

section "Verifying Project Structure"

required=(
"apps"
"backend"
"blockchain"
"docker-compose.yml"
"README.md"
)

for item in "${required[@]}"; do
  if [[ ! -e "$item" ]]; then
    error "Missing '$item'."
    error "Run this script from the repository root."
    exit 1
  fi
done

success "Project root verified."

#######################################
# Dependency Check Function
#######################################

missing_tools=()

check_command() {

  local cmd="$1"
  local display="$2"

  if command -v "$cmd" >/dev/null 2>&1; then
    success "$display found"
  else
    warn "$display not installed"
    missing_tools+=("$display")
  fi
}

#######################################
# Check Required Tools
#######################################

section "Checking Required Software"

check_command git "Git"
check_command curl "Curl"
check_command flutter "Flutter"
check_command dart "Dart"
check_command node "Node.js"
check_command npm "npm"
check_command docker "Docker"

if docker compose version >/dev/null 2>&1; then
  success "Docker Compose found"
else
  warn "Docker Compose not found"
  missing_tools+=("Docker Compose")
fi

#######################################
# Stop if missing tools
#######################################

if (( ${#missing_tools[@]} > 0 )); then

  echo
  error "The following required tools are missing:"
  echo

  for tool in "${missing_tools[@]}"; do
    echo "  • $tool"
  done

  echo
  warn "Install the missing software and run the script again."

  exit 1
fi

#######################################
# Version Checks
#######################################

section "Checking Versions"

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)

if (( NODE_MAJOR < 20 )); then
  warn "Node.js 20+ is recommended."
else
  success "Node.js version OK"
fi

FLUTTER_VERSION=$(flutter --version | head -n1)

echo "$FLUTTER_VERSION"

success "Flutter detected"

#######################################
# Flutter Doctor
#######################################

section "Running Flutter Doctor"

flutter doctor || true

success "Flutter check completed"

#######################################
# Continue Confirmation
#######################################

echo
read -rp "Continue with project setup? (Y/n): " CONTINUE

CONTINUE=${CONTINUE:-Y}

if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
  warn "Setup cancelled."
  exit 0
fi

#######################################
# Environment File Setup
#######################################

section "Preparing Configuration Files"

copy_if_missing() {

  local src="$1"
  local dest="$2"

  if [[ -f "$dest" ]]; then
    success "$dest already exists"
  elif [[ -f "$src" ]]; then
    cp "$src" "$dest"
    success "Created $dest"
  else
    warn "Template not found: $src"
  fi
}

copy_if_missing ".env.example" ".env"
copy_if_missing "docker-compose.override.yml.example" "docker-compose.override.yml"
copy_if_missing "dart_defines/dev.env.example" "dart_defines/dev.env"

#######################################
# Configure Environment
#######################################

section "Environment Configuration"

echo
echo "Some configuration values may require your local credentials."
echo

read -rp "Would you like to edit the .env file now? (y/N): " EDIT_ENV

if [[ "$EDIT_ENV" =~ ^[Yy]$ ]]; then

  if command -v nano >/dev/null 2>&1; then
    nano .env

  elif command -v vim >/dev/null 2>&1; then
    vim .env

  else
    warn "No terminal editor found."
    warn "Please edit .env manually before running the backend."
  fi
fi

#######################################
# Enable BYPASS_AUTH
#######################################

echo
read -rp "Enable BYPASS_AUTH for local development? (y/N): " ENABLE_AUTH

if [[ "$ENABLE_AUTH" =~ ^[Yy]$ ]]; then

  update_env_var() {
    local key="$1"
    local value="$2"

    if grep -q "^${key}=" .env 2>/dev/null; then
      sed -i.bak "s/^${key}=.*/${key}=${value}/" .env 2>/dev/null || \
        sed -i '' "s/^${key}=.*/${key}=${value}/" .env
      rm -f .env.bak
    else
      echo "${key}=${value}" >> .env
    fi
  }

  update_env_var "BYPASS_AUTH" "true"
  update_env_var "NODE_ENV" "development"

  success "BYPASS_AUTH enabled"
  success "NODE_ENV set to development"
fi

#######################################
# Backend Dependencies
#######################################

section "Installing Backend Dependencies"

pushd backend/api >/dev/null

info "Running npm install..."

if [[ -f package-lock.json ]]; then
    npm ci
else
    npm install
fi

success "Backend dependencies installed."

popd >/dev/null

#######################################
# Customer Flutter App
#######################################

section "Customer App"

pushd apps/customer >/dev/null

info "Fetching Flutter packages..."

flutter pub get

if [[ -f dart_define.json.example && ! -f dart_define.json ]]; then

  cp dart_define.json.example dart_define.json

  success "Created apps/customer/dart_define.json"
fi

popd >/dev/null

#######################################
# Driver Flutter App
#######################################

section "Driver App"

pushd apps/driver >/dev/null

info "Fetching Flutter packages..."

flutter pub get

if [[ -f dart_define.json.example && ! -f dart_define.json ]]; then

  cp dart_define.json.example dart_define.json

  success "Created apps/driver/dart_define.json"
fi

popd >/dev/null

#######################################
# Shared Package
#######################################

if [[ -d packages/truxify_shared ]]; then

  section "Shared Package"

  pushd packages/truxify_shared >/dev/null

  flutter pub get

  popd >/dev/null

  success "Shared package ready."
fi

#######################################
# Root Dependencies
#######################################

if [[ -f package.json ]]; then

  section "Installing Root Node Packages"

  if [[ -f package-lock.json ]]; then
    npm ci
else
    npm install
fi

  success "Root dependencies installed."
fi

#######################################
# Blockchain Dependencies
#######################################

if [[ -f blockchain/package.json ]]; then

  section "Blockchain"

  pushd blockchain >/dev/null

  if [[ -f package-lock.json ]]; then
    npm ci
else
    npm install
fi

  popd >/dev/null

  success "Blockchain dependencies installed."
fi
#######################################
# Run Repository Utility Scripts
#######################################

section "Running Repository Utility Scripts"

run_script() {

  local script="$1"

  if [[ -f "$script" ]]; then
    info "Executing $script"
    chmod +x "$script"
    bash "$script"
    success "$(basename "$script") completed"
  else
    warn "$script not found. Skipping."
  fi
}

run_script "scripts/generate_dart_defines.sh"
run_script "scripts/check-no-client-credentials.sh"

#######################################
# Docker
#######################################

section "Docker Setup"

if ! docker info >/dev/null 2>&1; then
  error "Docker daemon is not running."
  echo
  echo "Start Docker Desktop or the Docker service and rerun the script."
  exit 1
fi

success "Docker daemon is running."

#######################################
# Docker Compose
#######################################

echo
read -rp "Start the Docker development stack? (Y/n): " START_DOCKER
START_DOCKER=${START_DOCKER:-Y}

if [[ "$START_DOCKER" =~ ^[Yy]$ ]]; then

  section "Starting Docker Compose"

  docker compose up --build -d

  success "Docker services started."

else
  warn "Docker startup skipped."
fi

#######################################
# Wait For API
#######################################

if [[ "$START_DOCKER" =~ ^[Yy]$ ]]; then

  section "Waiting For Backend"

  MAX_RETRIES=30
  RETRY=1

  while [[ $RETRY -le $MAX_RETRIES ]]; do

    if curl -fs http://localhost:5000/health >/dev/null 2>&1; then
      success "Backend is healthy."
      break
    fi

    info "Waiting for backend... ($RETRY/$MAX_RETRIES)"
    sleep 2
    ((RETRY++))
  done

  if [[ $RETRY -gt $MAX_RETRIES ]]; then
    warn "Backend health endpoint did not respond."
    warn "You may inspect the logs using:"
    echo
    echo "docker compose logs api"
  fi

fi
#######################################
# Database Check
#######################################

if [[ -n "$(docker compose ps -q --status running db 2>/dev/null)" ]]; then
    success "PostgreSQL service detected."
else
    warn "Database container not detected."
fi

#######################################
# MongoDB Check
#######################################

if [[ -n "$(docker compose ps -q --status running mongo 2>/dev/null)" ]]; then
    success "MongoDB service detected."
else
    warn "MongoDB container not detected."
fi

#######################################
# Redis Check
#######################################

if [[ -n "$(docker compose ps -q --status running redis 2>/dev/null)" ]]; then
    success "Redis service detected."
else
    warn "Redis container not detected."
fi
#######################################
# Optional Database Seed
#######################################

echo
read -rp "Run database seed if available? (y/N): " RUN_SEED

if [[ "$RUN_SEED" =~ ^[Yy]$ ]]; then

  pushd backend/api >/dev/null

  if npm run 2>/dev/null | grep -q "seed"; then

    section "Running Seed"

    npm run seed

    success "Database seeded."

  else
    warn "No seed command found."
  fi

  popd >/dev/null
fi
#######################################
# Git Hooks
#######################################

section "Git Hooks"

if [[ -f .husky/pre-commit ]]; then

  success "Husky hooks detected."

elif [[ -f package.json ]]; then

  if npm run | grep -q "prepare"; then
    npm run prepare || true
    success "Git hooks prepared."
  fi

fi
#######################################
# Flutter Analyze
#######################################

section "Flutter Static Analysis"

analyze_flutter_project() {

  local dir="$1"

  if [[ -d "$dir" ]]; then
    pushd "$dir" >/dev/null

    info "Analyzing $dir..."

    if flutter analyze; then
      success "$dir passed analysis."
    else
      warn "$dir contains analyzer warnings/errors."
    fi

    popd >/dev/null
  fi
}

analyze_flutter_project "apps/customer"
analyze_flutter_project "apps/driver"

#######################################
# Backend Tests
#######################################

section "Backend Tests"

if [[ -d backend/api ]]; then

  pushd backend/api >/dev/null

  if npm run | grep -q "test"; then

    read -rp "Run backend tests? (y/N): " RUN_TESTS

    if [[ "$RUN_TESTS" =~ ^[Yy]$ ]]; then

      if npm test; then
        success "Backend tests passed."
      else
        warn "Some backend tests failed."
      fi

    else
      warn "Backend tests skipped."
    fi

  else
    warn "No backend test script found."
  fi

  popd >/dev/null
fi

#######################################
# Verify Environment Files
#######################################

section "Verifying Configuration"

FILES=(
".env"
"docker-compose.yml"
)

for file in "${FILES[@]}"; do

  if [[ -f "$file" ]]; then
    success "$file found."
  else
    warn "$file missing."
  fi

done

#######################################
# Flutter Configuration
#######################################

if [[ -f dart_defines/dev.env ]]; then
  success "dart_defines/dev.env found."
else
  warn "dart_defines/dev.env missing."
fi

#######################################
# Check Required Directories
#######################################

section "Checking Repository Structure"

DIRS=(
"apps/customer"
"apps/driver"
"backend/api"
"blockchain"
)

for dir in "${DIRS[@]}"; do

  if [[ -d "$dir" ]]; then
    success "$dir"
  else
    warn "$dir missing"
  fi

done

#######################################
# Git Status
#######################################

section "Git Repository"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then

  success "Git repository detected."

  CURRENT_BRANCH=$(git branch --show-current)

  echo "Current branch : $CURRENT_BRANCH"

else

  warn "Not inside a Git repository."

fi

#######################################
# Optional Dependency Updates
#######################################

echo
read -rp "Check for outdated npm packages? (y/N): " CHECK_NPM

if [[ "$CHECK_NPM" =~ ^[Yy]$ ]]; then

  pushd backend/api >/dev/null

  npm outdated || true

  popd >/dev/null

fi

echo
read -rp "Check for outdated Flutter packages? (y/N): " CHECK_FLUTTER

if [[ "$CHECK_FLUTTER" =~ ^[Yy]$ ]]; then

  pushd apps/customer >/dev/null
  flutter pub outdated || true
  popd >/dev/null

  pushd apps/driver >/dev/null
  flutter pub outdated || true
  popd >/dev/null

fi

#######################################
# Final Sanity Checks
#######################################

section "Final Validation"

PASSED=true

[[ -f .env ]] || PASSED=false
[[ -d backend/api/node_modules ]] || PASSED=false
[[ -d apps/customer/.dart_tool ]] || PASSED=false
[[ -d apps/driver/.dart_tool ]] || PASSED=false

if [[ "$PASSED" == true ]]; then
  success "All essential setup steps completed successfully."
else
  warn "Some setup steps may be incomplete. Review the messages above."
fi
#######################################
# Development URLs
#######################################

section "Local Development Services"

cat <<EOF

API
  http://localhost:5000

PostgreSQL
  localhost:5432

MongoDB
  localhost:27017

Redis
  localhost:6379

EOF

#######################################
# Useful Commands
#######################################

section "Useful Development Commands"

cat <<'EOF'

Backend
--------

cd backend/api
npm run dev

Customer App
------------

cd apps/customer
flutter run

Driver App
----------

cd apps/driver
flutter run

Docker
------

docker compose up --build

docker compose down

docker compose logs -f api

Flutter

flutter doctor
flutter analyze

EOF

#######################################
# Final Summary
#######################################

section "Setup Summary"

echo

success "Project root verified"
success "Operating system detected"
success "Required tools validated"
success "Flutter environment checked"
success "Dependencies installed"
success "Environment files prepared"

if [[ "$START_DOCKER" =~ ^[Yy]$ ]]; then
  success "Docker services started"
else
  warn "Docker services were not started"
fi

echo

#######################################
# Success Banner
#######################################

echo -e "${GREEN}"

cat <<'EOF'

████████╗██████╗ ██╗   ██╗██╗  ██╗██╗███████╗██╗███████╗██╗   ██╗
╚══██╔══╝██╔══██╗██║   ██║╚██╗██╔╝██║██╔════╝██║██╔════╝╚██╗ ██╔╝
   ██║   ██████╔╝██║   ██║ ╚███╔╝ ██║█████╗  ██║█████╗   ╚████╔╝
   ██║   ██╔══██╗██║   ██║ ██╔██╗ ██║██╔══╝  ██║██╔══╝    ╚██╔╝
   ██║   ██║  ██║╚██████╔╝██╔╝ ██╗██║██║     ██║██║        ██║
   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚═╝        ╚═╝

          Development Environment Ready

EOF

echo -e "${NC}"

echo
success "Truxify has been configured successfully."
echo

#######################################
# Contributor Tips
#######################################

section "Contributor Tips"

cat <<'EOF'

Before opening a Pull Request:

✓ Run flutter analyze
✓ Run backend tests
✓ Verify Docker services are healthy
✓ Do not commit .env files
✓ Keep commits small and descriptive
✓ Follow CONTRIBUTING.md

EOF

#######################################
# Reminder
#######################################

if grep -q "YOUR_" .env 2>/dev/null; then

  echo
  warn "Your .env still contains placeholder values."
  warn "Update it before running the application."
fi

#######################################
# Exit
#######################################

echo
success "Happy Coding! 🚛"

exit 0
