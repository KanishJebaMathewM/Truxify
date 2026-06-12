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

### Predict Demand Endpoint

```http
POST /predict/demand
```

Predicts ride/truck demand based on time, weather, and traffic features. If the model hasn't been trained yet, this endpoint triggers the training pipeline automatically.

**Request Body Schema**:
```json
{
  "hour": 14.5,
  "day_of_week": 3,
  "temperature": 25.0,
  "precipitation": 0.0,
  "historical_volume": 50.0,
  "nearby_drivers": 15.0
}
```

**Response Schema**:
```json
{
  "predicted_demand": 54.93,
  "model_version": "1.0.0",
  "feature_names": [
    "hour",
    "day_of_week",
    "is_weekend",
    "temperature",
    "precipitation",
    "historical_volume",
    "nearby_drivers"
  ]
}
```

### Train Demand Model Endpoint

```http
POST /train/demand
```

Triggers model training using synthetic dataset and saves the model pickle and metadata metrics to `models_storage/`.

**Response Schema**:
```json
{
  "status": "success",
  "metrics": {
    "mae": 4.304729891391666,
    "rmse": 5.299083712860529,
    "r2": 0.7975017721221801,
    "n_samples": 2000,
    "feature_names": [
      "hour",
      "day_of_week",
      "is_weekend",
      "temperature",
      "precipitation",
      "historical_volume",
      "nearby_drivers"
    ]
  }
}
```

### List Models Endpoint

```http
GET /models
```

Lists all trained models with their saved timestamps and performance metrics.

**Response Schema**:
```json
{
  "models": [
    {
      "model_name": "demand_forecast",
      "saved_at": "2026-06-11T17:44:09.780044",
      "metrics": {
        "mae": 4.304729891391666,
        "rmse": 5.299083712860529,
        "r2": 0.7975017721221801,
        "n_samples": 2000,
        "feature_names": [
          "hour",
          "day_of_week",
          "is_weekend",
          "temperature",
          "precipitation",
          "historical_volume",
          "nearby_drivers"
        ]
      }
    }
  ]
}
```

## Model Training & Evaluation Metrics

The demand forecasting model is built using a **Gradient Boosting Regressor** (`scikit-learn`). 

- **Target Metric**: R² score, Mean Absolute Error (MAE), Root Mean Squared Error (RMSE).
- **Features Used**: Hour of day, Day of week, Weekend flag, Temperature, Precipitation, Historical booking volume, Nearby available drivers.
- **Baseline Performance Metrics**:
  - **R² Score**: ~0.80 (80% variance explained)
  - **MAE**: ~4.30 units of demand
  - **RMSE**: ~5.30 units of demand
  - **Dataset size**: 2,000 synthetic logs

## Running Tests

FastAPI microservice endpoints are verified via a test suite built with `pytest` and `httpx`.

### 1. Activate the Virtual Environment
Activate your Python virtual environment.

### 2. Run Pytest
From the project root directory, run:
```bash
pytest backend/ml/tests
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