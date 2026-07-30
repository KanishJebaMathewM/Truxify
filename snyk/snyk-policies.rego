# Snyk Security Policies
package snyk.policies

# Deny if any critical vulnerability
deny[msg] {
    vuln := input.vulnerabilities[_]
    vuln.severity == "critical"
    msg = sprintf("Critical vulnerability found: %s in %s", [vuln.id, vuln.package])
}

# Deny if any high vulnerability
deny[msg] {
    vuln := input.vulnerabilities[_]
    vuln.severity == "high"
    msg = sprintf("High vulnerability found: %s in %s", [vuln.id, vuln.package])
}

# Deny if license issue
deny[msg] {
    license := input.licenses[_]
    license.type in ["GPL", "AGPL", "LGPL"]
    msg = sprintf("License issue: %s in %s", [license.type, license.package])
}

# Deny if outdated package > 1 year
deny[msg] {
    pkg := input.dependencies[_]
    pkg.age > 365
    msg = sprintf("Package %s is outdated (age: %d days)", [pkg.name, pkg.age])
}

# Allow if all checks pass
allow {
    not deny[_]
}