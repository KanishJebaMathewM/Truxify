"""Immutable serial compatibility oracle from main06da794fd generator functions.

Only function names are changed. These intentionally retain the old global
random stream; tests save/restore it around serial oracle execution.
"""
import numpy as np

N_USERS = 100
N_LOADS = 50
N_TRUCKS = 30


def legacy_eta(self, n=1000):
    np.random.seed(42)
    distance = np.random.uniform(5, 1200, n)
    time_of_day = np.random.randint(0, 24, n)
    day_of_week = np.random.randint(0, 7, n)
    route_type = np.random.choice([0, 1], n)
    historical_speed = np.where(route_type == 1, np.random.uniform(55, 85, n), np.random.uniform(20, 45, n))
    traffic_factor = np.where((time_of_day >= 8) & (time_of_day <= 11) | (time_of_day >= 17) & (time_of_day <= 20), 1.35, 1.0)
    weekend_factor = np.where(day_of_week >= 5, 1.1, 1.0)
    eta = distance / historical_speed * 60 * traffic_factor * weekend_factor
    eta += np.random.normal(0, 10, n)
    X = np.column_stack([distance, time_of_day, day_of_week, route_type, historical_speed])
    return (X, eta)


def legacy_demand(n_samples: int=2000) -> tuple:
    np.random.seed(42)
    hour = np.random.randint(0, 24, n_samples)
    day_of_week = np.random.randint(0, 7, n_samples)
    is_weekend = (day_of_week >= 5).astype(int)
    temperature = np.random.normal(25, 10, n_samples)
    precipitation = np.random.exponential(2, n_samples)
    historical_volume = np.random.poisson(50, n_samples)
    nearby_drivers = np.random.poisson(15, n_samples)
    demand = 20 + 10 * np.sin(2 * np.pi * (hour - 6) / 24) + 5 * is_weekend - 0.2 * temperature - 2 * precipitation + 0.3 * historical_volume + 1.5 * nearby_drivers + np.random.normal(0, 5, n_samples)
    demand = np.maximum(demand, 0)
    X = np.column_stack([hour, day_of_week, is_weekend, temperature, precipitation, historical_volume, nearby_drivers])
    y = demand
    return (X, y)


def legacy_profit(n_samples: int=2000) -> tuple:
    """Create synthetic training data based on Indian freight economics.

    Returns
    -------
    X : ndarray of shape (n_samples, 6)
        Features: route_distance, fuel_price, toll_estimate, truck_mileage,
        cargo_weight, trip_duration.
    y : ndarray of shape (n_samples,)
        Target: net profit (₹).
    """
    np.random.seed(42)
    route_distance = np.random.uniform(50, 2000, n_samples)
    fuel_price = np.random.uniform(95, 115, n_samples)
    toll_estimate = route_distance * np.random.uniform(1.5, 4.0, n_samples)
    truck_mileage = np.random.uniform(3, 8, n_samples)
    cargo_weight = np.random.uniform(500, 25000, n_samples)
    avg_speed = np.random.uniform(40, 60, n_samples)
    trip_duration = route_distance / avg_speed
    base_rate = np.random.uniform(1.8, 3.5, n_samples)
    weight_factor = 1 + cargo_weight / 25000 * 0.5
    revenue = base_rate * route_distance * weight_factor
    fuel_cost = route_distance / truck_mileage * fuel_price
    maintenance = route_distance * np.random.uniform(0.8, 2.0, n_samples)
    net_profit = revenue - fuel_cost - toll_estimate - maintenance
    net_profit += np.random.normal(0, 500, n_samples)
    X = np.column_stack([route_distance, fuel_price, toll_estimate, truck_mileage, cargo_weight, trip_duration])
    return (X, net_profit)


def legacy_collaborative() -> dict:
    """Build sparse user-item interaction matrices with random ratings 1-5.

    Returns
    -------
    dict
        ``user_load_matrix``  – shape (N_USERS, N_LOADS)
        ``user_truck_matrix`` – shape (N_USERS, N_TRUCKS)
        ``user_ids``          – list of synthetic user-id strings
        ``load_ids``          – list of synthetic load-id strings
        ``truck_ids``         – list of synthetic truck-id strings
    """
    np.random.seed(42)
    user_ids = [f'user_{i:03d}' for i in range(N_USERS)]
    load_ids = [f'load_{i:03d}' for i in range(N_LOADS)]
    truck_ids = [f'truck_{i:03d}' for i in range(N_TRUCKS)]
    ul = np.zeros((N_USERS, N_LOADS), dtype=np.float64)
    for i in range(N_USERS):
        n_interactions = np.random.randint(1, max(2, int(N_LOADS * 0.3)))
        cols = np.random.choice(N_LOADS, size=n_interactions, replace=False)
        ul[i, cols] = np.random.randint(1, 6, size=n_interactions).astype(np.float64)
    ut = np.zeros((N_USERS, N_TRUCKS), dtype=np.float64)
    for i in range(N_USERS):
        n_interactions = np.random.randint(1, max(2, int(N_TRUCKS * 0.3)))
        cols = np.random.choice(N_TRUCKS, size=n_interactions, replace=False)
        ut[i, cols] = np.random.randint(1, 6, size=n_interactions).astype(np.float64)
    return {'user_load_matrix': ul, 'user_truck_matrix': ut, 'user_ids': user_ids, 'load_ids': load_ids, 'truck_ids': truck_ids}


def legacy_trust(n_samples: int=1500) -> tuple:
    """Generate synthetic driver/customer behavioural profiles.

    Creates correlated behavioural data with realistic distributions:
    cancellation rates follow a beta distribution (skewed low),
    on-time percentages are skewed high, dispute counts follow Poisson.

    Args:
        n_samples: Number of profiles to generate.

    Returns:
        Tuple of (X feature array, y risk label array, trust_scores array).
    """
    np.random.seed(42)
    cancellation_rate = np.random.beta(2, 8, n_samples) * 0.5
    on_time_pct = 50 + np.random.beta(5, 2, n_samples) * 50
    avg_rating = 1.0 + np.random.beta(5, 2, n_samples) * 4.0
    dispute_count = np.minimum(np.random.poisson(2, n_samples), 20)
    is_verified = (np.random.random(n_samples) < 0.8).astype(int)
    risk_labels = np.full(n_samples, 1, dtype=int)
    high_mask = (cancellation_rate > 0.3) | (on_time_pct < 70) | (dispute_count > 10)
    low_mask = (cancellation_rate < 0.1) & (on_time_pct > 90) & (dispute_count < 3)
    risk_labels[high_mask] = 2
    risk_labels[low_mask] = 0
    X = np.column_stack([cancellation_rate, on_time_pct, avg_rating, dispute_count, is_verified])
    return (X, risk_labels)
