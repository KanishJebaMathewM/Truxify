#!/bin/bash
echo "🚀 Installing Istio Service Mesh..."
curl -L https://istio.io/downloadIstio | sh -
cd istio-*
export PATH=\C:\Users\bhakk\Truxify/bin:\
istioctl install --set profile=demo -y
kubectl label namespace default istio-injection=enabled
kubectl get pods -n istio-system
echo "✅ Istio installed successfully!"
