# Network Policy
package network

# Deny if using default namespace
deny[msg] {
    input.review.object.metadata.namespace == "default"
    msg = "Default namespace is not allowed. Use specific namespace."
}

# Deny if hostNetwork enabled
deny[msg] {
    input.review.object.spec.hostNetwork == true
    msg = "Host network is not allowed."
}

# Deny if no network policy
deny[msg] {
    not input.review.object.spec.template.metadata.annotations."networking.kubernetes.io/network-policy"
    msg = "Network policy must be specified."
}

# Deny if allow all ingress
deny[msg] {
    input.review.object.spec.template.metadata.annotations."networking.kubernetes.io/network-policy" == "allow-all"
    msg = "Allow all ingress is not allowed. Use specific policies."
}

# Allow if all network checks pass
allow {
    not deny[_]
}