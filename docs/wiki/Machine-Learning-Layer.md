# 🧠 Machine Learning Layer

Truxify relies on a dedicated **FastAPI Python microservice** to execute complex routing, combinatorial packaging, dynamic pricing, and match-ranking computations. 

---

## 🎛️ The 10-Model Pipeline

The intelligence layer is driven by 10 independent models running in memory:

| # | Model | Category | Mathematical / Algorithmic Core | Operational Purpose |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Two-Sided Bilateral Matcher** | Optimization | Gale-Shapley Stable Marriage Variant | Matches loads and trucks, prioritizing driver route preferences and customer timeline expectations. |
| 2 | **Driver Profit Predictor** | Regression | Gradient Boosting (XGBoost/LightGBM) | Calculates expected net profit (freight revenue minus fuel, toll, and maintenance costs) before a driver accepts a load. |
| 3 | **3D Bin Packer + VRP** | Combinatorial | Heuristic Packing + Genetic Algorithms | Packs diverse boxes into truck dimensions (3D) and sequences multi-stop delivery routes (Vehicle Routing Problem). |
| 4 | **Collaborative Filter** | Recommendation | Matrix Factorization (ALS / Neural CF) | Personalizes truck recommendations for manufacturers based on historical booking selections. |
| 5 | **Dynamic Price Forecaster** | Time-Series | Prophet / LSTM | Computes suggested freight prices per route based on seasonal demand, weather, and current diesel rates. |
| 6 | **ETA Predictor** | Regression | Random Forest Regressor | Predicts arrival times using active GPS speeds, route bottlenecks, historical congestion, and driver rest stop intervals. |
| 7 | **Trust & Risk Scorer** | Classification | Logistic Regression / Random Forest | Analyzes driver cancellation rates and customer dispute frequencies to assign a risk score. |
| 8 | **Deadhead Eliminator** | Search/Matching | Dijkstra’s Variant + Spatial Hashing | Searches for return loads along the driver's route before they complete their current trip to avoid empty mileage. |
| 9 | **Demand Heatmap** | Forecasting | ConvLSTM / Spatial Time-Series | Forecasts freight booking volumes across geographic regions 24–48 hours in advance. |
| 10 | **Mid-Trip Reoptimiser** | Optimization | Dynamic Programming | Automatically scans for and inserts new en-route loads when cargo space opens up during a trip. |

---

## 🚀 FastAPI Microservice & Endpoints

The ML service (`backend/ml`) loads model configurations and weights into memory at startup to support sub-second API requests.

### Core API Endpoints

* **`GET /`**: Root verification. Returns status and microservice welcome information.
* **`GET /health`**: Microservice health check (used by Docker healthchecks and Render pingers).
* **`GET /models`**: Lists all active models, their compilation timestamps, and baseline performance scores.
* **`POST /predict/demand`**: Evaluates future local load volumes.
  * **Payload**:
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
  * **Response**:
    ```json
    {
      "predicted_demand": 54.93,
      "model_version": "1.0.0",
      "feature_names": ["hour", "day_of_week", "is_weekend", "temperature", "precipitation", "historical_volume", "nearby_drivers"]
    }
    ```
* **`POST /train/demand`**: Force-triggers the training script using synthetic datasets.
  * **Response**:
    ```json
    {
      "status": "success",
      "metrics": {
        "mae": 4.30,
        "rmse": 5.30,
        "r2": 0.80,
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

---

## 💾 Telemetry & Feature Store (MongoDB)

Features are built from data compiled across MongoDB and Supabase:
* **MongoDB Event Streams**: Tracks raw WebSocket location reports (`tracker.js`), driver online/offline switches, speed calculations, and route deviations.
* **Supabase Transactions**: Tracks completed bookings, payment escrow delays, rating stars, and bid adjustments.
* **Aggregator**: A background batch worker processes these records to generate feature rows (e.g., historical route volumes, driver reliability rates) and writes them to MongoDB's `ml_training_sets` collection.

---

## 🔄 Automated Retraining & Deployment Lifecycle

Truxify ensures models do not suffer from data drift by automating the training lifecycle using **n8n workflows**:

```
[n8n Weekly Trigger]
        │
        ▼
[Count MongoDB Logs] ── (Below Threshold?) ──► [Abort & Alert Team]
        │ (Threshold Met)
        ▼
[Call POST /train/demand] ──► [Train Model & Evaluate R² / MAE]
                                      │
                                      ▼
                      [Validation Benchmark Comparison]
                                      │
                ┌─────────────────────┴─────────────────────┐
         (R² Score Improved)                        (R² Score Worsened)
                │                                           │
                ▼                                           ▼
   [Overwrite Pickle & Save]                    [Discard New Weights]
   [Auto-deploy API Server]                     [Auto-rollback to Previous]
   [Notify Slack / Email]                       [Alert Dev Team of Degradation]
```

1. **Trigger**: Every Sunday, an n8n cron job counts the volume of new booking entries inside MongoDB.
2. **Threshold check**: If the volume is too low, training is bypassed to prevent model overfitting.
3. **Training**: The n8n node sends a POST request to `/train/demand`. The Python service runs scikit-learn training routines.
4. **Evaluation**: The new model performance is compared against the active version stored in `models_storage/`.
5. **Deployment**: If the new model's $R^2$ score is higher (or MAE is lower), it overwrites the model pickle and metadata files. If the score is worse, it is discarded, maintaining the previous version.
6. **Notification**: The dev team receives an email/Slack report with training graphs and metric comparisons.
