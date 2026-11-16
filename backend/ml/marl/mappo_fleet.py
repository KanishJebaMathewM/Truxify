import numpy as np

if __package__:
    from .policy_scores import dimensions, evaluate_policy, owned
else:  # legacy direct-module test/import entry point
    from policy_scores import dimensions, evaluate_policy, owned

class MappoFleetBalancer:
    """
    Multi-Agent Proximal Policy Optimization (MAPPO) Fleet Re-Balancing Engine.
    Coordinates load dispatch decisions across decentralized truck agents.
    """
    def __init__(self, num_agents: int = 5, state_dim: int = 10):
        dimensions(state_dim, num_agents)
        self.num_agents = num_agents
        self.state_dim = state_dim
        # Shared critic weights and actor weights
        self.critic_weights = np.ones((state_dim, 1)) * 0.1
        self.actor_weights = np.ones((state_dim, num_agents)) * 0.2

    def compute_cooperative_actions(self, global_state: np.ndarray) -> dict:
        """
        global_state: Array of shape (state_dim,) representing fleet demands, locations, and speeds.
        """
        dimensions(self.state_dim, self.num_agents)
        state = owned(global_state, (self.state_dim,))
        actor = owned(self.actor_weights, (self.state_dim, self.num_agents))
        critic = owned(self.critic_weights, (self.state_dim, 1))
        value_estimate, probs, selected_agent = evaluate_policy(state, actor, critic)

        return {
            "critic_state_value": round(value_estimate, 4),
            "agent_selection_probabilities": [round(float(p), 4) for p in probs],
            "optimal_dispatch_agent_id": selected_agent,
            "rebalance_action": "ROUTE_DISPATCH_ENFORCED"
        }

mappo_balancer = MappoFleetBalancer()
