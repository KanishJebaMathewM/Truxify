# Compliance Policy
package compliance

# Deny if no labels
deny[msg] {
    not input.review.object.metadata.labels
    msg = "Missing required labels: 'app' and 'environment'"
}

# Deny if missing required labels
deny[msg] {
    labels := input.review.object.metadata.labels
    not labels.app
    msg = "Missing label: 'app'"
}

deny[msg] {
    labels := input.review.object.metadata.labels
    not labels.environment
    msg = "Missing label: 'environment'"
}

# Deny if invalid environment
deny[msg] {
    labels := input.review.object.metadata.labels
    labels.environment not in ["dev", "staging", "production"]
    msg = "Invalid environment. Must be: dev, staging, or production"
}

# Deny if missing namespace
deny[msg] {
    not input.review.object.metadata.namespace
    msg = "Namespace must be specified."
}

# Deny if no annotations
deny[msg] {
    not input.review.object.metadata.annotations
    msg = "Missing required annotations: 'description' and 'owner'"
}

# Deny if missing annotation
deny[msg] {
    annotations := input.review.object.metadata.annotations
    not annotations.description
    msg = "Missing annotation: 'description'"
}

deny[msg] {
    annotations := input.review.object.metadata.annotations
    not annotations.owner
    msg = "Missing annotation: 'owner'"
}

# Allow if all compliance checks pass
allow {
    not deny[_]
}