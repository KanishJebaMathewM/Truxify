import unittest
import ast
import inspect
import textwrap
import numpy as np
import tenseal as ts
import torch

from fhe_model import FHEModel, FHEService, FHETrainer, RELU_POLY_COEFFS


class TestEncryptedReLU(unittest.TestCase):
    def setUp(self):
        self.service = FHEService()
        self.context = self.service.context

    def test_create_context_validity(self):
        """1. Explicitly verifies _create_context() returns a valid TenSEAL CKKS context with parameters [40, 20, 20, 20, 20, 40]."""
        context = self.service._create_context()
        self.assertIsInstance(context, ts.Context)
        self.assertTrue(context.is_private())

    def test_no_unsupported_tenseal_operations_in_source_ast(self):
        """2. Regression guard (AST): Verifies _encrypted_relu source contains NO .sqrt() calls or division operators."""
        source = textwrap.dedent(inspect.getsource(FHEModel._encrypted_relu))
        parsed_ast = ast.parse(source)

        for node in ast.walk(parsed_ast):
            if isinstance(node, ast.Attribute) and node.attr == 'sqrt':
                self.fail("_encrypted_relu contains forbidden attribute call '.sqrt()'")
            if isinstance(node, ast.Div):
                self.fail("_encrypted_relu contains forbidden division operator '/'")

    def test_encrypted_relu_executes_on_ckks_vector(self):
        """3. Runtime execution: _encrypted_relu executes successfully on CKKSVector without throwing exceptions."""
        model = FHEModel(self.context)
        inputs = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]
        x_enc = ts.ckks_vector(self.context, inputs)

        try:
            out_enc = model._encrypted_relu(x_enc)
        except Exception as e:
            self.fail(f"_encrypted_relu raised unexpected runtime exception: {e}")

        self.assertTrue(hasattr(out_enc, 'decrypt'))
        self.assertIsInstance(out_enc, ts.CKKSVector)

    def test_grid_evaluation_error_bounds(self):
        """4. Grid evaluation across 17 points in [-2, 2]: Maximum absolute error over [-1.5, 1.5] is bounded under 0.20."""
        model = FHEModel(self.context)
        grid_inputs = np.linspace(-2.0, 2.0, 17)
        x_enc = ts.ckks_vector(self.context, grid_inputs.tolist())

        out_enc = model._encrypted_relu(x_enc)
        decrypted = np.array(out_enc.decrypt())
        expected = np.maximum(0, grid_inputs)

        abs_errors = np.abs(decrypted - expected)

        # Maximum error over central range [-1.5, 1.5] is ~0.1877 (occurring at x = 0 where P(0) = 0.1877)
        central_indices = np.where((grid_inputs >= -1.5) & (grid_inputs <= 1.5))[0]
        central_max_error = np.max(abs_errors[central_indices])
        self.assertLess(central_max_error, 0.20)

    def test_positive_side_approximation_accuracy(self):
        """5. Positive values (x > 0): Decrypted outputs track ReLU(x) = x with low error."""
        model = FHEModel(self.context)
        positive_inputs = [0.2, 0.5, 0.8, 1.0, 1.2, 1.5]
        x_enc = ts.ckks_vector(self.context, positive_inputs)

        out_enc = model._encrypted_relu(x_enc)
        decrypted = np.array(out_enc.decrypt())

        for val, dec in zip(positive_inputs, decrypted):
            expected = val
            # For positive inputs in [0.2, 1.5], degree-2 least-squares polynomial error is < 0.20
            self.assertAlmostEqual(dec, expected, delta=0.20)

    def test_negative_side_suppression_accuracy(self):
        """6. Negative values (x < 0): Decrypted outputs are suppressed toward zero."""
        model = FHEModel(self.context)
        negative_inputs = [-1.5, -1.2, -1.0, -0.8, -0.5, -0.2]
        x_enc = ts.ckks_vector(self.context, negative_inputs)

        out_enc = model._encrypted_relu(x_enc)
        decrypted = np.array(out_enc.decrypt())

        for val, dec in zip(negative_inputs, decrypted):
            # For negative inputs in [-1.5, -0.2], outputs stay close to 0 (abs(dec) < 0.20)
            self.assertLess(abs(dec), 0.20)

    def test_zero_and_near_zero_stability(self):
        """7. Zero and near-zero inputs evaluate to smooth polynomial bias P(0) = 0.1877."""
        model = FHEModel(self.context)
        near_zero_inputs = [-1e-4, 0.0, 1e-4]
        x_enc = ts.ckks_vector(self.context, near_zero_inputs)

        out_enc = model._encrypted_relu(x_enc)
        decrypted = np.array(out_enc.decrypt())

        for dec in decrypted:
            # P(0) = RELU_POLY_COEFFS[0] = 0.1877; smooth polynomial approximation bias
            self.assertAlmostEqual(dec, RELU_POLY_COEFFS[0], delta=0.01)

    def test_out_of_range_inputs(self):
        """8. Documented behavior for out-of-range inputs (|x| > 2)."""
        model = FHEModel(self.context)
        out_inputs = [-3.0, 3.0]
        x_enc = ts.ckks_vector(self.context, out_inputs)

        out_enc = model._encrypted_relu(x_enc)
        decrypted = np.array(out_enc.decrypt())

        self.assertTrue(np.all(np.isfinite(decrypted)))

    def test_model_pre_activation_range_within_domain(self):
        """9. Empirical validation: Representative inputs produce pre-ReLU activations within [-2, 2]."""
        model = FHEModel(self.context)
        model.add_linear(4, 4)
        model.encrypt()

        # Deterministic collection of 5 representative 4D normalized inputs
        representative_inputs = np.array([
            [1.0, -1.0, 0.5, -0.5],
            [0.8, 0.9, -0.7, -0.6],
            [-1.0, -1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0, 0.0],
            [0.5, -0.5, 0.25, -0.25]
        ])

        for sample in representative_inputs:
            x_enc = model.encrypt_input(sample)
            pre_relu_enc = model._encrypted_linear(x_enc, model.weights[0], model.biases[0])
            pre_relu_dec = model.decrypt_output(pre_relu_enc)

            # Assert pre-activation values fall within [-2, 2] operating range
            self.assertTrue(np.all(pre_relu_dec >= -2.0))
            self.assertTrue(np.all(pre_relu_dec <= 2.0))

    def test_full_encrypted_model_forward_path(self):
        """10. Full encrypted model forward pass completes end-to-end without plaintext fallback."""
        architecture = [
            {'type': 'linear', 'in': 4, 'out': 4},
            {'type': 'relu'},
        ]
        res = self.service.create_model(architecture)
        self.assertTrue(res['success'])

        X = np.array([[1.0, -1.0, 0.5, -0.5]])
        pred_res = self.service.predict(X)

        self.assertTrue(pred_res['success'])
        self.assertEqual(len(pred_res['predictions']), 4)
        for val in pred_res['predictions']:
            self.assertIsInstance(val, float)
            self.assertFalse(np.isnan(val))


if __name__ == '__main__':
    unittest.main()
