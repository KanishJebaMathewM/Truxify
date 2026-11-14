
# syntax=docker/dockerfile:1.7

# Root-context image build for the ML service.
# docker build -t truxify/ml:latest -f Dockerfile.ml .

FROM python:3.11-slim

# Build configuration
ARG APP_UID=1001
ARG APP_GID=1001

# Python runtime configuration
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

# Install system dependencies required by ML libraries.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create a dedicated non-root application user.
RUN groupadd --gid ${APP_GID} appgroup && \
    useradd \
        --uid ${APP_UID} \
        --gid ${APP_GID} \
        --create-home \
        --home-dir /app \
        --shell /usr/sbin/nologin \
        appuser

WORKDIR /app

# Copy dependency definitions separately for better layer caching.
COPY backend/ml/requirements.txt ./requirements.txt

# Install Python dependencies using BuildKit cache when available.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Copy application source with appropriate ownership.
COPY --chown=appuser:appgroup backend/ml/ ./

# Ensure the application runs without root privileges.
USER appuser

EXPOSE 8000

# Container health monitoring.
HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --start-period=45s \
    --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]

# Graceful container shutdown.
STOPSIGNAL SIGTERM

# Start the ML API service.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
