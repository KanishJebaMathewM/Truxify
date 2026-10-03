# Time Series Forecasting Transformers

This module implements custom Transformer architectures for multivariate time series forecasting in the Truxify ML engine.

## Available Models

### 1. DemandForecastTransformer
- **Purpose**: Predicts regional freight demand volume.
- **Input Dim**: 8 (weather, seasonality, historical volume, fuel prices, etc.)
- **Sequence Length**: 72 hours
- **Prediction Horizon**: 24 hours

### 2. TrafficForecastTransformer
- **Purpose**: Predicts highway congestion and transit delays.
- **Input Dim**: 5 (historical speed, accident reports, weather, road work)
- **Sequence Length**: 48 hours
- **Prediction Horizon**: 12 hours

### 3. PriceForecastTransformer
- **Purpose**: Forecasts spot market pricing for dynamic load bidding.
- **Input Dim**: 6 (historical rates, capacity ratios, fuel index)
- **Sequence Length**: 96 hours
- **Prediction Horizon**: 24 hours

## Architecture Details
All models inherit from `nn.Module` and wrap a shared `TimeSeriesTransformer` core. 
The `forward()` method simply delegates to the underlying transformer:

```python
def forward(self, x: torch.Tensor) -> torch.Tensor:
    return self.transformer(x)
```
