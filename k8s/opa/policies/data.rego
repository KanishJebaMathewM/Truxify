# Data Policy (External Data)
package data

# Deny if service from untrusted registry
deny[msg] {
    container := input.review.object.spec.containers[_]
    not startswith(container.image, "truxify/")
    not startswith(container.image, "docker.io/truxify/")
    msg = sprintf("Image '%s' is from untrusted registry.", [container.image])
}

# Deny if service not listed in allowed services
deny[msg] {
    service_name := input.review.object.metadata.name
    not data.services[service_name]
    msg = sprintf("Service '%s' is not allowed.", [service_name])
}

# Deny if port not allowed
deny[msg] {
    container := input.review.object.spec.containers[_]
    port := container.ports[_].containerPort
    not data.allowed_ports[port]
    msg = sprintf("Port '%d' is not allowed.", [port])
}

# Data - allowed services
services = {
    "api-service": true,
    "ml-service": true,
    "db-service": true,
    "redis-service": true
}

# Data - allowed ports
allowed_ports = {
    80: true,
    443: true,
    5000: true,
    8000: true,
    5432: true,
    6379: true
}

# Allow if all checks pass
allow {
    not deny[_]
}