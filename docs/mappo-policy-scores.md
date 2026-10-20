# Standalone fleet linear policy scores

The existing library accepts finite binary64 state and actor/critic matrices with
complete exact shapes. Configuration axes are positive Python integers <=256;
state_dim*num_agents <=16384 bounds copies and exact accumulation work. Converted
non-real, nonfinite or unrepresentable inputs are rejected, not made uniform.

Each binary64 coordinate has an exact integer representation in units of 2^-1074.
Products accumulate as integers in units of 2^-2148. Actor differences are formed
before floating conversion, so huge common offsets, dot-product overflow and
cancellation do not collapse the policy. Only bounded nonpositive differences
reach exponentiation; differences above746 underflow safely to zero. Critic
conversion rounds once and refuses genuinely unrepresentable results.

Output keys and four-decimal presentation remain unchanged. The selected agent
is the lowest index at the exact maximal linear score, even if rounded displayed
probabilities tie. This is a linear placeholder policy, not a trained MAPPO or
production dispatch guarantee. No mounted caller was found, and no vehicles,
dispatch controls or external providers are exercised.

55 tests cover complete admission, cancellation, overflowing products/common
scores, invalid critic refusal, ownership, mutated configuration,20 seeded cases
against an independent2500-digit Decimal oracle, and the two legacy native cases.
Exact accumulation adds integer-arithmetic cost compared with BLAS; no throughput
benchmark is claimed. Public arrays are copied for this call, but concurrent
external mutation during a copy is not atomic across arrays. The unrelated legacy
soft_update helper is preserved unchanged.
