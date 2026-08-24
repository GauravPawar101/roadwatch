# KEDA installation (required before ScaledObjects apply)
#
# KEDA is NOT bundled in kustomize base — install it via deploy-kind.sh or manually:
#
#   helm repo add kedacore https://kedacore.github.io/charts
#   helm repo update
#   helm install keda kedacore/keda --namespace keda --create-namespace
#
# Or apply the upstream release manifest:
#   kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.16.0/keda-2.16.0.yaml
#
# After KEDA CRDs are present, apply layer-autoscaling ScaledObjects:
#   kubectl apply -k k8s/base/layer-autoscaling
#
# Verify:
#   kubectl get scaledobjects -n roadwatch
#   kubectl get hpa -n roadwatch
