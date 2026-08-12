# Truxify ML Engine

Machine Learning microservice for Truxify built with **FastAPI** and **PyTorch / TensorFlow / Scikit-Learn**.

---

## 🧠 Overview

The Truxify ML Engine serves as the intelligence layer for the Truxify logistics ecosystem. It powers real-time pricing, demand forecasting, dynamic driver-order matching, automated ETA predictions, 3D cargo bin packing, deadhead mileage reduction, and advanced spatio-temporal research models.

---

## 📐 Project Structure & Module Inventory

```text
backend/ml
├── app/
│   └── models/               # Production Scikit-Learn & Optimization Models
│       ├── base.py           # Model serialization, SHA-256 integrity, preloaders
│       ├── demand_forecast.py# GradientBoosting Demand Regressor
│       ├── price_prediction.py # Freight Price Regressor
│       ├── eta_prediction.py # Route ETA Estimator
│       ├── driver_profit.py  # Driver Earnings Optimizer
│       ├── trust_scorer.py   # Driver & Shipper Trust Score Model
│       ├── collaborative_filter.py # Recommendation Matrix Factorization (SVD)
│       ├── bilateral_matcher.py # Bipartite Matching Solver
│       ├── bin_packing.py    # 3D Cargo Bin Packing (First-Fit Decreasing)
│       ├── deadhead_eliminator.py # Route Chain Optimization (VRP 2-opt)
│       └── mid_trip_reoptimiser.py # Dynamic Route Re-optimizer
├── models_storage/           # Saved binary model pickles (*.pkl) & JSON metadata
├── routes/                   # Modular FastAPI REST Router Handlers
├── services/                 # Infrastructure Services (Traffic, A/B Testing)
│   ├── traffic_pipeline.py  # Live OSM/GPS Telemetry Pipeline & SQLite Store
│   └── ab_testing.py        # Model Variant Routing & Analytics Engine
├── tests/                    # Comprehensive Pytest Suite
├── anomaly/                  # Real-time LSTM Autoencoder Anomaly Detection
├── diffusion/                # DDPM Synthetic Trajectory & Demand Generation
├── federated/                # FedAvg Decentralized Edge Learning
├── foundation/               # Spatio-Temporal Transformer Foundation Model
├── gat/                      # Graph Attention Networks (Traffic Flow)
├── gnn/                      # Graph Neural Networks (GraphSAGE/GCN Route Embeddings)
├── imitation/                # Behavioral Cloning & GAIL Dispatch Policy
├── meta/                     # MAML Few-Shot Regional Adaptation
├── mtl/                      # Multi-Task Learning Joint Network
├── multimodal/               # Computer Vision & Sensor Fusion Safety Monitor
├── nas/                      # DARTS Neural Architecture Search
├── nerf/                     # NeRF 3D Cargo Reconstruction
├── pinns/                    # Physics-Informed Kinematics Networks
├── self_supervised/          # SimCLR Contrastive Telemetry Pre-training
└── transformers/             # Time-Series Informer / PatchTST Forecasting
```

---

## ⚡ Dynamic Route Registration

The ML Engine implements dynamic, fault-tolerant router registration via [`routes/__init__.py`](./routes/__init__.py). 

Heavy optional deep learning frameworks (e.g., PyTorch Geometric, OpenCV, MediaPipe, Librosa) are loaded conditionally. If a library is not installed in the host environment, the engine catches `ImportError` gracefully and continues serving core endpoints without interruption.

---

## 📊 Core Production API Endpoints

| Endpoint | Method | Input Model | Description |
| :--- | :--- | :--- | :--- |
| `/predict/demand` | `POST` | `DemandForecastInput` | Predicts demand volume based on location, hour, weather, and historical traffic. |
| `/predict/price` | `POST` | `PricePredictInput` | Estimates optimal freight rate per kilometer considering vehicle type and market demand. |
| `/predict/eta` | `POST` | `ETAPredictInput` | Calculates route travel duration with live telemetry adjustments. |
| `/match` | `POST` | `BilateralMatchInput` | Solves maximum weight bipartite matching between loads and available drivers. |
| `/pack` | `POST` | `PackingInput` | Calculates 3D cargo arrangement and volume utilization. |
| `/deadhead` | `POST` | `DeadheadInput` | Finds multi-leg chain routes to eliminate empty return trips. |
| `/ab-testing/status` | `GET` | — | Returns active A/B model variant tests and performance degradation metrics. |

All endpoints require the `X-API-Key` header matching the environment `ML_API_KEY`.

---

## 🧪 Running Unit Tests

Execute the complete test suite using `pytest`:

```bash
# Set PYTHONPATH to current directory
export PYTHONPATH=.

# Run unit tests
pytest tests/ -v
```

---

## 🐳 Docker Deployment

Build and start the ML Engine with Docker Compose:

```bash
# Local Development
docker compose up ml-engine -d

# Verify Health
curl http://localhost:8001/health
```