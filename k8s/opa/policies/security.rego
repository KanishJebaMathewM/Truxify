# Security Policy
package security

# Deny if image tag is latest
deny[msg] {
    image := input.review.object.spec.containers[_].image
    image_uses_latest_tag(image)
    msg = "Image tag 'latest' is not allowed. Use specific version tags."
}

image_uses_latest_tag(image) {
    image == "latest"
}

image_uses_latest_tag(image) {
    endswith(image, ":latest")
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

# Deny if memory limit > 2Gi
deny[msg] {
    container := input.review.object.spec.containers[_]
    mem := container.resources.limits.memory
    bytes := parse_memory(mem)
    bytes > 2147483648
    msg = sprintf("Memory limit %v exceeds max allowed 2Gi", [mem])
}

parse_memory(qty) = bytes {
    endswith(qty, "Gi")
    num := to_number(replace(qty, "Gi", ""))
    bytes := num * 1073741824
}

parse_memory(qty) = bytes {
    endswith(qty, "Mi")
    num := to_number(replace(qty, "Mi", ""))
    bytes := num * 1048576
}

parse_memory(qty) = bytes {
    endswith(qty, "Ki")
    num := to_number(replace(qty, "Ki", ""))
    bytes := num * 1024
}

parse_memory(qty) = bytes {
    not endswith(qty, "Gi")
    not endswith(qty, "Mi")
    not endswith(qty, "Ki")
    bytes := to_number(qty)
}

# Allow if all checks pass
allow {
    not deny[_]
}
