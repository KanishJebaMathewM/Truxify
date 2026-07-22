# Security Policy
package security

# Deny if image tag is latest
deny[msg] {
    input.review.object.spec.containers[_].image == "latest"
    msg = "Image tag 'latest' is not allowed. Use specific version tags."
}

# Deny if privileged container
deny[msg] {
    input.review.object.spec.containers[_].securityContext.privileged == true
    msg = "Privileged containers are not allowed."
}

# Deny if root user
deny[msg] {
    input.review.object.spec.containers[_].securityContext.runAsUser == 0
    msg = "Running as root is not allowed."
}

# Deny if no resource limits
deny[msg] {
    container := input.review.object.spec.containers[_]
    not container.resources
    msg = "Resource limits must be specified."
}

# Deny if memory limit > 2GB
deny[msg] {
    container := input.review.object.spec.containers[_]
    container.resources.limits.memory == "2Gi"
    msg = "Memory limit exceeded. Max allowed: 2Gi"
}

# Allow if all checks pass
allow {
    not deny[_]
}