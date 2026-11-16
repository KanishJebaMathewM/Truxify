
"""Unit tests for causal impact step-change recovery."""

import unittest

try:
    import numpy as np
    from causal_inference import CausalImpact as CausalImpactMeasurer
    HAVE_DEPS = True
except ImportError:
    np = None
    CausalImpactMeasurer = None
    HAVE_DEPS = False


@unittest.skipUnless(
    HAVE_DEPS,
    "NumPy or causal_inference dependencies are not available",
)
class TestCausalImpactStepRecovery(unittest.TestCase):

    def setUp(self):
        self.measurer = CausalImpactMeasurer()
        self.rng = np.random.default_rng(0)

    def test_recovers_injected_step_on_post_period(self):
        """Verify that a positive step intervention produces a positive effect."""

        baseline = 10.0 + self.rng.normal(0, 0.1, 30)

        step = 5.0
        post = (10.0 + step) + self.rng.normal(0, 0.1, 30)

        pre_data = baseline.astype(np.float64)
        post_data = post.astype(np.float64)

        result = self.measurer.measure_impact(
            pre_data,
            post_data,
        )

        self.assertIsNotNone(
            result,
            "measure_impact should return a result",
        )

        self.assertIsInstance(
            result,
            dict,
            "Result should be a dictionary",
        )

        self.assertIn(
            "absolute_effect",
            result,
            "Result should contain absolute_effect",
        )

        absolute_effect = result["absolute_effect"]

        self.assertIsInstance(
            absolute_effect,
            (int, float, np.integer, np.floating),
            "absolute_effect should be numeric",
        )

        self.assertTrue(
            np.isfinite(absolute_effect),
            "absolute_effect should be finite",
        )

        self.assertGreater(
            absolute_effect,
            0,
            "Estimated effect should be positive for a positive step change",
        )

        self.assertAlmostEqual(
            float(absolute_effect),
            step,
            delta=0.5,
            msg="Estimated effect should be close to the injected +5 step",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
