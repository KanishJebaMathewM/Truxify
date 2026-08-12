import os
import joblib
import pandas as pd
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.compose import ColumnTransformer

# Define features
numeric_features = [
    'distance_km', 
    'avg_fuel_cost_per_km', 
    'toll_estimate', 
    'vehicle_maintenance_coeff'
]

def create_pipeline():
    """
    Creates a scikit-learn pipeline for the Driver Profit Predictor.
    """
    # Preprocessing step: scale numeric features
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numeric_features)
        ])

    # The full pipeline: preprocessing -> regressor
    pipeline = Pipeline(steps=[
        ('preprocessor', preprocessor),
        ('regressor', RandomForestRegressor(n_estimators=100, random_state=42))
    ])
    
    return pipeline

def generate_dummy_data(n_samples=1000):
    """
    Generates synthetic data to train the dummy model.
    """
    np.random.seed(42)
    
    distance_km = np.random.uniform(50, 2000, n_samples)
    avg_fuel_cost_per_km = np.random.uniform(15, 30, n_samples)
    toll_estimate = distance_km * np.random.uniform(1, 3, n_samples)
    vehicle_maintenance_coeff = np.random.uniform(0.8, 1.2, n_samples)
    
    # Calculate synthetic profit target
    gross_revenue = distance_km * np.random.uniform(40, 60, n_samples)
    fuel_cost = distance_km * avg_fuel_cost_per_km
    
    net_profit = (gross_revenue - fuel_cost - toll_estimate) * vehicle_maintenance_coeff
    # Add some noise
    net_profit += np.random.normal(0, 500, n_samples)
    
    X = pd.DataFrame({
        'distance_km': distance_km,
        'avg_fuel_cost_per_km': avg_fuel_cost_per_km,
        'toll_estimate': toll_estimate,
        'vehicle_maintenance_coeff': vehicle_maintenance_coeff
    })
    
    y = net_profit
    
    return X, y

def train_and_save_model():
    """
    Trains the dummy model and saves it using joblib.
    """
    print("Generating synthetic data...")
    X, y = generate_dummy_data()
    
    print("Creating pipeline...")
    pipeline = create_pipeline()
    
    print("Training model...")
    pipeline.fit(X, y)
    
    # Ensure models_storage directory exists
    storage_dir = os.path.join(os.path.dirname(__file__), 'models_storage')
    os.makedirs(storage_dir, exist_ok=True)
    
    model_path = os.path.join(storage_dir, 'profit_predictor.joblib')
    print(f"Saving model to {model_path}...")
    joblib.dump(pipeline, model_path)
    
    print("Training complete! Model saved successfully.")

if __name__ == "__main__":
    train_and_save_model()
