class CpAbePolicyBuilder:
    """
    Builds Ciphertext-Policy Attribute-Based Encryption (CP-ABE) boolean policy strings from logistics attributes.
    """
    def build_trip_document_policy(self, trip_id: str, allowed_role: str = "Driver") -> str:
        return f"(Role: {allowed_role} AND TripID: {trip_id}) OR Role: Admin"

    def evaluate_user_attributes(self, user_attributes: set, policy_str: str) -> bool:
        """Evaluates whether user attribute set satisfies CP-ABE boolean expression."""
        if "Role: Admin" in user_attributes:
            return True
        
        # Check required role and trip ID match
        parts = [p.strip(" ()") for p in policy_str.split("OR")[0].split("AND")]
        return all(req_attr in user_attributes for req_attr in parts)

policy_builder = CpAbePolicyBuilder()
