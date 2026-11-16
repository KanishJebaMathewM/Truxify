"""Native fitted trust-generation admission and finite classification."""
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.utils.validation import check_is_fitted

FEATURES = (
    "cancellation_rate", "on_time_pct", "avg_rating", "dispute_count", "is_verified",
)
PROFILES = np.array([[.1, 80., 4., 1., 1.], [.5, 55., 1., 20., 0.], [0., 100., 5., 0., 1.]])


def _classes(model):
    labels = np.asarray(model.classes_)
    if labels.ndim != 1 or not 1 <= len(labels) <= 3:
        raise ValueError("Trust classifier classes must be a nonempty risk subset")
    if labels.dtype.kind not in "iuf" or not np.isfinite(labels).all():
        raise ValueError("Trust classifier classes must be finite numeric risk labels")
    if not np.isin(labels, [0, 1, 2]).all() or len(np.unique(labels)) != len(labels):
        raise ValueError("Trust classifier has unsupported risk labels")
    return labels


def native_labels(model, values):
    """Use the forest's native probabilities and reject invalid classification."""
    classes = _classes(model)
    if getattr(model, "feature_names_in_", None) is not None:
        import pandas as pd
        values = pd.DataFrame(values, columns=FEATURES)
    probabilities = np.asarray(model.predict_proba(values))
    if (probabilities.shape != (len(values), len(classes))
            or not np.isfinite(probabilities).all()
            or (probabilities < 0).any() or (probabilities > 1).any()
            or not np.allclose(probabilities.sum(axis=1), 1., rtol=1e-10, atol=1e-10)):
        raise ValueError("Trust classifier returned invalid native probabilities")
    return classes[np.argmax(probabilities, axis=1)]


def validate_candidate(model, scaler):
    """Validate supported fitted native state and behavior before publication."""
    if not isinstance(model, RandomForestClassifier) or not isinstance(scaler, StandardScaler):
        raise TypeError("Trust artifacts require native RandomForestClassifier/StandardScaler")
    check_is_fitted(model)
    check_is_fitted(scaler)
    for component in (model, scaler):
        if component.n_features_in_ != len(FEATURES):
            raise ValueError("Trust candidate must have five behavioral features")
        names = getattr(component, "feature_names_in_", None)
        if names is not None and tuple(names) != FEATURES:
            raise ValueError("Trust candidate feature ordering is incompatible")
    if model.n_outputs_ != 1 or not model.estimators_:
        raise ValueError("Trust classifier must have one fitted risk output")
    labels = _classes(model)
    for name in ("mean_", "var_", "scale_"):
        values = np.asarray(getattr(scaler, name))
        if values.shape != (5,) or not np.isfinite(values).all():
            raise ValueError("Trust scaler state is incomplete or nonfinite")
    if (scaler.var_ < 0).any() or (scaler.scale_ <= 0).any():
        raise ValueError("Trust scaler must retain nonnegative variance and positive scales")
    for estimator in model.estimators_:
        check_is_fitted(estimator)
        tree = estimator.tree_
        values = tree.value
        if (estimator.n_features_in_ != 5
                or values.shape != (tree.node_count, 1, len(labels))
                or not np.isfinite(values).all() or (values < 0).any()
                or (values.sum(axis=2) <= 0).any()
                or not np.isfinite(tree.threshold).all()):
            raise ValueError("Trust classifier contains incompatible native tree state")
    # Preserve supported named-column artifacts without emitting input-name warnings.
    profiles = PROFILES.copy()
    if getattr(scaler, "feature_names_in_", None) is not None:
        import pandas as pd
        profiles = pd.DataFrame(profiles, columns=FEATURES)
    transformed = scaler.transform(profiles)
    if transformed.shape != (3, 5) or not np.isfinite(transformed).all():
        raise ValueError("Trust scaler returned invalid native probe features")
    native_labels(model, transformed)
