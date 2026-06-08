# Truxify ML Engine

Machine Learning microservice for Truxify built with FastAPI.

## Overview

The ML Engine serves as the foundation for machine learning features in Truxify. It provides a FastAPI-based backend service that can host ML models, prediction APIs, and future AI-powered functionality.

## Features

- FastAPI backend service
- Health monitoring endpoint
- Interactive Swagger API documentation
- OpenAPI schema generation
- Docker support for containerized deployment
- Ready for future ML model integration

## Project Structure

```text
backend/ml
├── app
│   ├── __init__.py
│   └── main.py
├── Dockerfile
├── .dockerignore
├── requirements.txt
└── README.md
```

## Local Development

### 1. Create a Virtual Environment

```bash
python -m venv venv
```

### 2. Activate the Virtual Environment

#### Windows

```bash
venv\Scripts\activate
```

#### Linux/macOS

```bash
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the Application

```bash
uvicorn app.main:app --reload
```

The application will be available at:

```text
http://localhost:8000
```

## Available Endpoints

### Root Endpoint

```http
GET /
```

Returns a welcome message confirming the service is running.

### Health Check Endpoint

```http
GET /health
```

Returns the health status of the service.

Example Response:

```json
{
  "status": "healthy"
}
```

## API Documentation

### Swagger UI

```text
http://localhost:8000/docs
```

### OpenAPI Schema

```text
http://localhost:8000/openapi.json
```

## Docker Setup

### Build the ML Engine Image

From the project root:

```bash
docker compose build ml-engine
```

### Run the ML Engine Service

```bash
docker compose up ml-engine
```

### Verify the Service

Health Check:

```text
http://localhost:8001/health
```

Swagger Documentation:

```text
http://localhost:8001/docs
```

## Notes

- FastAPI is used as the web framework.
- Uvicorn is used as the ASGI server.
- Docker support is included for consistent development and deployment environments.
- This implementation provides the initial foundation for future machine learning model integration within Truxify.