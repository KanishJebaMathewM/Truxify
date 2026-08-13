import numpy as np

class MappoFleetBalancer:
    """
    Multi-Agent Proximal Policy Optimization (MAPPO) Fleet Re-Balancing Engine.
    Coordinates load dispatch decisions across decentralized truck agents.
    """
    def __init__(self, num_agents: int = 5, state_dim: int = 10):
        self.num_agents = num_agents
        self.state_dim = state_dim
        # Shared critic weights and actor weights
        self.critic_weights = np.ones((state_dim, 1)) * 0.1
        self.actor_weights = np.ones((state_dim, num_agents)) * 0.2

    def compute_cooperative_actions(self, global_state: np.ndarray) -> dict:
        """
        global_state: Array of shape (state_dim,) representing fleet demands, locations, and speeds.
        """
        if len(global_state) != self.state_dim:
            raise ValueError("Invalid global state dimension.")
            
        value_estimate = float(np.dot(global_state, self.critic_weights))
        action_logits = np.dot(global_state, self.actor_weights)
        
        # Numerically stable softmax for load dispatch selection.
        # Subtracting the max prevents overflow when logits are large and
        # avoids the inf/inf -> NaN -> argmax=0 collapse.
        max_logit = np.max(action_logits)
        z = action_logits - max_logit
        e = np.exp(z)
        sum_e = np.sum(e)
        if not np.isfinite(sum_e) or sum_e <= 0:
            # Degenerate all -inf case: fall back to a uniform distribution
            # so the agent still selects a valid (non-NaN) action.
            probs = np.full_like(action_logits, 1.0 / len(action_logits))
        else:
            probs = e / sum_e
        selected_agent = int(np.argmax(probs))

        return {
            "critic_state_value": round(value_estimate, 4),
            "agent_selection_probabilities": [round(float(p), 4) for p in probs],
            "optimal_dispatch_agent_id": selected_agent,
            "rebalance_action": "ROUTE_DISPATCH_ENFORCED"
        }

mappo_balancer = MappoFleetBalancer()
