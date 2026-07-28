# 🔍 Security Vulnerability Scanning & OPA Policy Enforcement (Snyk)

This directory contains the **Snyk Security Integration** and **Open Policy Agent (OPA) Rego Policies** for automated vulnerability scanning, container image inspection, and infrastructure-as-code (IaC) compliance in Truxify.

---

## 📐 Directory Structure

```text
snyk/
├── .snyk                     # Snyk CLI policy configuration file
├── snyk.service.js           # Node.js Snyk REST API client wrapper & parser
├── routes.js                 # Express endpoints for security scanning triggers
├── snyk-policies.rego        # OPA (Open Policy Agent) Rego security rules
├── snyk-integration.sh       # CI/CD security audit script
└── snyk-github-actions.yaml  # GitHub Actions security workflow template
```

---

## 🛡️ OPA Security Policies (`snyk-policies.rego`)

- **Dependency Vulnerability Gate**: Blocks PR merges if high or critical CVE vulnerabilities exist.
- **Container Base Image Audit**: Verifies base image signature, non-root user execution, and digest pinned tags.
- **License Compliance**: Flags incompatible or restrictive open-source licenses (e.g. GPLv3 in proprietary modules).

---

## 🔌 API Endpoints (`routes.js`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/snyk/scan/dependencies` | `POST` | Scans Node.js/Python project dependencies for known CVE vulnerabilities. |
| `/snyk/scan/container` | `POST` | Inspects target Docker container image tags for OS package vulnerabilities. |
| `/snyk/scan/code` | `POST` | Triggers Static Application Security Testing (SAST) on target code directory. |
| `/snyk/policies/evaluate` | `POST` | Evaluates scan output against `snyk-policies.rego` rules. |
