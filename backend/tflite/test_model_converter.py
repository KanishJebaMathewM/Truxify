"""TFLite converter/inference suite — builds a real tiny model, converts, loads, predicts."""
import os

import numpy as np
import pytest

tf = pytest.importorskip('tensorflow')

from model_converter import TFLiteConverter, TFLiteInference


@pytest.fixture(scope='module')
def model_dir(tmp_path_factory):
    return str(tmp_path_factory.mktemp('tflite_models'))


@pytest.fixture(scope='module')
def converted(model_dir):
    """Build a tiny keras model (4 features → 2 classes) and convert it."""
    tf.random.set_seed(7)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(4,)),
        tf.keras.layers.Dense(8, activation='relu'),
        tf.keras.layers.Dense(2, activation='softmax'),
    ])
    conv = TFLiteConverter(model_dir=model_dir)
    result = conv.convert_to_tflite(model, input_shape=(1, 4), quantization='float16', name='eta_classifier')
    assert result.get('success') is True, result
    return model_dir


class TestConversion:
    def test_model_file_written_with_metadata(self, converted):
        path = os.path.join(converted, 'eta_classifier.tflite')
        assert os.path.exists(path)
        assert os.path.getsize(path) > 200

    def test_missing_model_load_returns_false(self, converted):
        inf = TFLiteInference(model_dir=converted)
        assert inf.load_model('does_not_exist') is False


class TestInference:
    def test_load_and_predict_round_trip(self, converted):
        inf = TFLiteInference(model_dir=converted)
        assert inf.load_model('eta_classifier') is True
        res = inf.predict('eta_classifier', np.zeros((1, 4), dtype=np.float32))
        assert res['success'] is True
        assert len(res['output'][0]) == 2
        assert res['inference_time_ms'] >= 0

    def test_shape_mismatch_rejected_not_resized(self, converted):
        inf = TFLiteInference(model_dir=converted)
        res = inf.predict('eta_classifier', np.zeros((1, 7), dtype=np.float32))
        assert res['success'] is False
        assert 'does not match expected shape' in res['error']

    def test_predict_before_explicit_load_auto_loads(self, converted):
        inf = TFLiteInference(model_dir=converted)
        res = inf.predict('eta_classifier', np.ones((1, 4), dtype=np.float32))
        assert res['success'] is True

    def test_predict_unknown_model_fails_cleanly(self, converted):
        inf = TFLiteInference(model_dir=converted)
        res = inf.predict('nope', np.zeros((1, 4), dtype=np.float32))
        assert res['success'] is False

    def test_get_model_info_reports_io_shapes(self, converted):
        inf = TFLiteInference(model_dir=converted)
        inf.load_model('eta_classifier')
        info = inf.get_model_info('eta_classifier')
        assert info['success'] is True
        assert info['input_details'][0]['shape'].tolist() == [1, 4]
        assert info['output_details'][0]['shape'].tolist() == [1, 2]

    def test_get_model_info_unknown_model(self, converted):
        inf = TFLiteInference(model_dir=converted)
        assert inf.get_model_info('ghost')['success'] is False
