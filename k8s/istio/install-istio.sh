#!/bin/bash
echo "🚀 Installing Istio Service Mesh..."
curl -L https://istio.io/downloadIstio | sh -
cd istio-*
export PATH=\C:\Users\bhakk\Truxify/bin:\
istioctl install --set profile=demo -y
kubectl label namespace default istio-injection=enabled
kubectl get pods -n istio-system
echo "✅ Istio installed successfully!"
#!/bin/bash

echo "🚀 Installing Istio Service Mesh..."

# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*

# Add istioctl to PATH
export PATH=$PWD/bin:$PATH

# Install Istio with demo profile
istioctl install --set profile=demo -y

# Label default namespace for sidecar injection
kubectl label namespace default istio-injection=enabled

# Verify installation
kubectl get pods -n istio-system

echo "✅ Istio installed successfully!"

