import unittest
import numpy as np

try:
    from causal_inference import CausalImpact as CausalImpactMeasurer
    HAVE_DEPS = True
except Exception:
    HAVE_DEPS = False


@unittest.skipUnless(
    HAVE_DEPS,
    "causal_inference dependencies not available"
)
class TestCausalImpactStepRecovery(unittest.TestCase):

    def test_recovers_injected_step_on_post_period(self):
        measurer = CausalImpactMeasurer()

        # Pre-intervention baseline with mild noise.
        rng = np.random.default_rng(0)
        baseline = 10.0 + rng.normal(0, 0.1, 30)

        # Post-intervention series with a clear +5 step change.
        step = 5.0
        post = (10.0 + step) + rng.normal(0, 0.1, 30)

        pre_data = baseline.astype(float)
        post_data = post.astype(float)

        # Measure the impact using the pre- and post-intervention data.
        result = measurer.measure_impact(pre_data, post_data)

        self.assertIsNotNone(
            result,
            "measure_impact should return a result"
        )

        self.assertIn(
            "absolute_effect",
            result,
            "Result should contain absolute_effect"
        )

        # The injected intervention is positive (+5), so the
        # estimated absolute effect should also be positive.
        absolute_effect = result["absolute_effect"]

        self.assertGreater(
            absolute_effect,
            0,
            "Estimated effect should be positive for a positive step change"
        )


if __name__ == "__main__":
    unittest.main()
