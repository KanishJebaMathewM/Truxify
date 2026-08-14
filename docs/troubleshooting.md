\# 🛠️ Local Development Troubleshooting Guide



This guide helps contributors diagnose and resolve common issues when setting up and running Truxify locally.



It covers both Docker-based and non-Docker development workflows.



\---



\## 📋 Quick Troubleshooting Checklist



Before troubleshooting a specific issue, make sure:



\* Git is installed and the repository is up to date.

\* Flutter SDK is installed for mobile app development.

\* Node.js and npm are installed for backend development.

\* Docker and Docker Compose are installed if using the containerized setup.

\* Required environment variables are configured.

\* Required local services are running.

\* The required ports are not being used by another application.



\---



\## 1. Flutter `flutter pub get` Fails



\### Symptoms



Running:



```bash

flutter pub get

```



fails with dependency resolution or package-related errors.



\### Likely Causes



\* Flutter SDK is not installed or is not available in `PATH`.

\* The Flutter version is incompatible with project dependencies.

\* Package metadata or dependency cache is outdated.

\* Network connectivity prevents packages from being downloaded.



\### Troubleshooting



Check the Flutter installation:



```bash

flutter --version

```



Run Flutter diagnostics:



```bash

flutter doctor

```



Then retry:



```bash

flutter pub get

```



If the dependency cache appears corrupted, run:



```bash

flutter clean

flutter pub get

```



If the problem continues, verify the Flutter version required by the project and check the dependency constraints in `pubspec.yaml`.



\---



\## 2. Backend `npm install` Fails



\### Symptoms



Running:



```bash

cd backend/api

npm install

```



fails while installing dependencies.



\### Likely Causes



\* Node.js or npm is missing.

\* An incompatible Node.js version is being used.

\* Network or registry problems prevent package downloads.

\* The local npm cache contains invalid package data.



\### Troubleshooting



Check the installed versions:



```bash

node --version

npm --version

```



Make sure Node.js is available before installing dependencies.



Retry the installation:



```bash

npm install

```



If npm reports a temporary network or registry error, verify your internet connection and retry.



Avoid committing generated dependency directories or local package-manager files unless they are already tracked by the repository.



\---



\## 3. Backend `npm run dev` Does Not Start



\### Symptoms



The backend fails when running:



```bash

cd backend/api

npm run dev

```



or exits immediately after starting.



\### Likely Causes



\* `backend/api/.env` is missing.

\* Required environment variables are not configured.

\* Dependencies have not been installed.

\* Port `5000` is already in use.

\* A configuration or application error prevents startup.



\### Troubleshooting



Make sure dependencies are installed:



```bash

cd backend/api

npm install

```



Create the local environment file from the repository template:



```bash

cp .env.example .env

```



On Windows PowerShell, you can also use:



```powershell

Copy-Item .env.example .env

```



Check that the required values are configured in:



```text

backend/api/.env

```



Then retry:



```bash

npm run dev

```



Check the terminal output for the specific startup error if the server still fails.



\---



\## 4. Environment Variable or `.env` Problems



\### Symptoms



The application starts but cannot connect to external services, authenticate users, or initialize required integrations.



\### Likely Causes



\* `.env` has not been created.

\* A required variable is missing.

\* A variable contains an invalid value.

\* The `.env` file is located in the wrong directory.

\* A secret or API key is incorrectly configured.



\### Troubleshooting



For backend development, verify that the local environment file exists:



```text

backend/api/.env

```



Use the repository's example configuration as the starting point:



```text

backend/api/.env.example

```



Do not copy real credentials into documentation or commit them to Git.



If a new configuration value is required for onboarding, update `.env.example` with a safe placeholder rather than adding a real secret.



\---



\## 5. PostgreSQL Connection Fails



\### Symptoms



The backend cannot connect to PostgreSQL or reports a database connection error.



\### Likely Causes



\* PostgreSQL is not running.

\* Port `5432` is unavailable.

\* The database connection configuration is incorrect.

\* Docker services have not been started when using Docker Compose.



\### Troubleshooting



If using Docker Compose, check the running services:



```bash

docker compose ps

```



Start the local stack if necessary:



```bash

docker compose up --build

```



The PostgreSQL service is exposed on:



```text

localhost:5432

```



If another application is already using port `5432`, stop the conflicting service or use the repository's supported Docker configuration for the local environment.



Verify that the database connection values match the selected development setup.



\---



\## 6. MongoDB Connection Fails



\### Symptoms



The application cannot connect to MongoDB or GPS/event log operations fail.



\### Likely Causes



\* MongoDB is not running.

\* Port `27017` is already occupied.

\* The MongoDB connection string is incorrect.

\* Docker Compose services are not running.



\### Troubleshooting



Check the Docker services:



```bash

docker compose ps

```



Start the stack:



```bash

docker compose up --build

```



The local MongoDB service is available on:



```text

localhost:27017

```



For the Docker Compose setup, the API container uses the local MongoDB service:



```env

MONGODB\_URI=mongodb://mongo:27017

MONGODB\_DB\_NAME=truxify\_telemetry

```



Make sure these values are used only for the appropriate local Docker configuration and do not replace production credentials with local values accidentally.



\---



\## 7. Redis Connection Fails



\### Symptoms



The backend reports that it cannot connect to Redis or cache-related functionality fails.



\### Likely Causes



\* Redis is not running.

\* Port `6379` is already in use.

\* The Redis connection URL is incorrect.

\* The Docker Compose stack is not running.



\### Troubleshooting



Check the services:



```bash

docker compose ps

```



Start Redis with the local stack:



```bash

docker compose up --build

```



The local Redis service is exposed on:



```text

localhost:6379

```



Inside the Docker Compose network, the API uses:



```env

REDIS\_URL=redis://redis:6379

```



Verify that the connection configuration matches whether the backend is running inside or outside Docker.



\---



\## 8. Docker Compose Fails to Start



\### Symptoms



Running:



```bash

docker compose up --build

```



fails or one or more containers immediately stop.



\### Likely Causes



\* Docker Desktop or the Docker daemon is not running.

\* A required port is already occupied.

\* An environment variable is missing.

\* A previous container is using the same resources.

\* An image build or dependency installation failed.



\### Troubleshooting



First verify Docker is available:



```bash

docker --version

docker compose version

```



Check the current containers:



```bash

docker compose ps

```



View service logs:



```bash

docker compose logs

```



For a specific service:



```bash

docker compose logs api

```



Make sure the local environment configuration is available before starting the stack.



If containers from a previous attempt are causing conflicts, stop the current Compose stack:



```bash

docker compose down

```



Then retry:



```bash

docker compose up --build

```



\---



\## 9. Port Already in Use



\### Symptoms



The application or Docker Compose reports that a port cannot be bound because it is already in use.



\### Truxify Development Ports



| Service    |    Port |

| ---------- | ------: |

| API        |  `5000` |

| PostgreSQL |  `5432` |

| MongoDB    | `27017` |

| Redis      |  `6379` |



\### Troubleshooting on Windows



Find the process using a port:



```powershell

Get-NetTCPConnection -LocalPort 5000

```



Replace `5000` with the affected port when necessary.



You can also identify the process ID and inspect it with:



```powershell

Get-Process -Id <PID>

```



Stop the unrelated application using the port, if appropriate, and retry the Truxify service.



Do not terminate processes blindly. Confirm that the process belongs to the service causing the conflict before stopping it.



\---



\## 10. Common Build or Runtime Errors



\### Symptoms



A service starts but crashes during runtime, or a build fails after dependencies have been installed.



\### Likely Causes



\* Invalid environment configuration.

\* Missing dependencies.

\* Incompatible dependency versions.

\* A service required by the application is unavailable.

\* Recent source changes introduced a runtime error.



\### Troubleshooting



Start by checking the terminal output for the first meaningful error.



For the backend:



```bash

cd backend/api

npm install

npm test

npm run dev

```



For Flutter:



```bash

flutter clean

flutter pub get

flutter run

```



For Docker:



```bash

docker compose ps

docker compose logs

```



Fix the first underlying error before addressing subsequent errors, as later failures may be consequences of the initial problem.



\---



\## 🐳 Docker vs Non-Docker Development



\### Docker-based Setup



Use Docker Compose when you want the API, PostgreSQL/PostGIS, MongoDB, and Redis services running together:



```bash

docker compose up --build

```



Check service status with:



```bash

docker compose ps

```



View logs with:



```bash

docker compose logs

```



\### Non-Docker Backend Setup



The backend is located at:



```text

backend/api

```



Install dependencies:



```bash

cd backend/api

npm install

```



Create the environment file:



```bash

cp .env.example .env

```



Then start development mode:



```bash

npm run dev

```



On Windows PowerShell:



```powershell

Copy-Item .env.example .env

```



When running services outside Docker, make sure PostgreSQL, MongoDB, and Redis are available using the appropriate local connection configuration.



\---



\## 🔐 Security Reminder



Never add real credentials, API keys, private keys, passwords, or service-account files to this troubleshooting guide.



Use placeholders in documentation and keep sensitive configuration in local environment files.



If a secret is accidentally committed, do not simply remove it from the latest file. Follow the repository's security guidance for handling exposed credentials.



\---



\## 🆘 Still Having Problems?



If the troubleshooting steps above do not resolve the issue:



1\. Check the relevant service logs.

2\. Confirm that your local environment matches the repository documentation.

3\. Verify that required services and ports are available.

4\. Reproduce the problem with the smallest possible setup.

5\. Search existing GitHub issues before opening a new one.

6\. When reporting a new issue, include the relevant error message, environment details, and steps to reproduce.



Do not include passwords, API keys, private keys, or other sensitive information in an issue report.



