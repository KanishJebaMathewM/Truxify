#!/bin/bash

echo "🚀 Setting up Snyk Shift-Left Security..."

# Install Snyk CLI
curl -sL https://static.snyk.io/cli/latest/snyk-linux | sudo tee /usr/local/bin/snyk > /dev/null
sudo chmod +x /usr/local/bin/snyk

# Authenticate
snyk auth ${SNYK_TOKEN}

# Test configuration
snyk config get

echo "✅ Snyk setup completed!"