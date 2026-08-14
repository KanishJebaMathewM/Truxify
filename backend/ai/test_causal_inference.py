import unittest
import numpy as np

try:
    from causalimpact import CausalImpact  # noqa: F401
    from causal_inference import CausalImpact as CausalImpactMeasurer
    HAVE_DEPS = True
except Exception:
    HAVE_DEPS = False


@unittest.skipUnless(HAVE_DEPS, "causalimpact / causal_inference dependencies not available")
class TestCausalImpactStepRecovery(unittest.TestCase):
    def test_recovers_injected_step_on_post_period(self):
        measurer = CausalImpactMeasurer()

        # Pre-intervention baseline with mild noise.
        rng = np.random.default_rng(0)
        baseline = 10.0 + rng.normal(0, 0.1, 30)
        # Post-intervention series: a clear +5 step change.
        step = 5.0
        post = (10.0 + step) + rng.normal(0, 0.1, 30)

        pre_data = baseline.astype(float)
        post_data = post.astype(float)
        intervention_point = len(pre_data)

        result = measurer.measure_impact(pre_data, post_data, intervention_point)

        self.assertIsNotNone(result, "measure_impact should fit on the pre-period baseline")
        self.assertIn("absolute_effect", result)

        # The estimator must recover a positive effect with the same sign as
        # the injected step, never the ~0 / inverted result produced when the
        # model is fit on the post-intervention window.
        absolute_effect = result["absolute_effect"]
        self.assertGreater(absolute_effect, 0)


if __name__ == '__main__':
    unittest.main()
