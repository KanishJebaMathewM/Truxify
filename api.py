from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import pandas as pd
from pathlib import Path

app = FastAPI(
    title="Telco Churn Prediction & Customer Segmentation API",
    description="REST API for real-time customer churn risk scoring and cluster profiling.",
    version="1.0"
)

# Define path for model artifacts
ARTIFACT_DIR = Path("models/artifacts")

# Load models safely on startup
try:
    model = joblib.load(ARTIFACT_DIR / "random_forest_model.pkl")
    preprocessor = joblib.load(ARTIFACT_DIR / "preprocessor.pkl")
    kmeans = joblib.load(ARTIFACT_DIR / "kmeans_model.pkl")
except Exception:
    model, preprocessor, kmeans = None, None, None

# Input schema using Pydantic
class CustomerData(BaseModel):
    tenure: int
    MonthlyCharges: float
    TotalCharges: float
    Contract: str
    PaymentMethod: str
    InternetService: str
    TechSupport: str
    OnlineSecurity: str

@app.get("/health", summary="API Health Check")
def health_check():
    """Returns the operational status of the API and model loading state."""
    return {
        "status": "healthy",
        "models_loaded": all([model is not None, preprocessor is not None, kmeans is not None])
    }

@app.post("/predict", summary="Real-time Churn Risk Prediction")
def predict_churn(data: CustomerData):
    """Takes customer attributes and returns churn probability and risk tier."""
    if model is None or preprocessor is None:
        raise HTTPException(status_code=500, detail="Model artifacts are missing from models/artifacts/.")
    
    try:
        df = pd.DataFrame([data.dict()])
        processed = preprocessor.transform(df)
        prob = float(model.predict_proba(processed)[0][1])
        
        # Determine risk tier
        if prob < 0.30:
            risk_tier = "Low"
        elif prob < 0.70:
            risk_tier = "Medium"
        else:
            risk_tier = "High"
            
        return {
            "churn_probability": round(prob, 4),
            "risk_tier": risk_tier
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Prediction error: {str(e)}")

@app.post("/segment", summary="Customer Cluster Lookup")
def segment_customer(data: CustomerData):
    """Assigned K-Means cluster persona for the given customer profile."""
    if kmeans is None or preprocessor is None:
        raise HTTPException(status_code=500, detail="K-Means model artifact is missing.")
    
    try:
        df = pd.DataFrame([data.dict()])
        processed = preprocessor.transform(df)
        cluster = int(kmeans.predict(processed)[0])
        
        return {"cluster_segment": cluster}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Segmentation error: {str(e)}")
