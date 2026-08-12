# Root-context image build for the ML service, referenced by k8s/README.md:
#
#   docker build -t truxify/ml:latest -f Dockerfile.ml .
#
# Mirrors backend/ml/Dockerfile, which docker-compose builds with
# ./backend/ml as its context.
FROM python:3.11-slim

# tensorflow, torch and scipy need a toolchain and the OpenGL/glib runtime
# libraries; backend/ml/Dockerfile installs these and this build needs them
# for the same requirements.txt.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        libgl1-mesa-glx \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/sh -d /app appuser

WORKDIR /app

COPY backend/ml/requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appgroup backend/ml/ ./

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
