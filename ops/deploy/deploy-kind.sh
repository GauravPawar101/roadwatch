#!/usr/bin/env bash
# ops/deploy/deploy-kind.sh — kind cluster + images + ConfigMaps/Secrets overlay
# Linux/bash equivalent of deploy-kind.ps1 (no PowerShell required).
#
# Usage:
#   ./ops/deploy/deploy-kind.sh
#   ./ops/deploy/deploy-kind.sh --reset
#   ./ops/deploy/deploy-kind.sh --skip-build
#   ./ops/deploy/deploy-kind.sh --skip-fabric-certs
#   ./ops/deploy/deploy-kind.sh --infra-only

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="roadwatch"
ENVIRONMENT="dev"
RESET=0
SKIP_BUILD=0
SKIP_FABRIC_CERTS=0
INFRA_ONLY=0
SKIP_APP_IMAGES=0
WAIT_READY=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-fabric-certs) SKIP_FABRIC_CERTS=1 ;;
    --infra-only) INFRA_ONLY=1 ;;
    --skip-app-images) SKIP_APP_IMAGES=1 ;;
    --no-wait) WAIT_READY=0 ;;
    --environment) ENVIRONMENT="$2"; shift ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

step() { printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  %s\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' "$1"; }

resolve_fabric_host_ip() {
  if [[ -n "${FABRIC_HOST_IP:-}" ]]; then
    echo "$FABRIC_HOST_IP"
    return
  fi
  local ip
  ip="$(docker inspect "${CLUSTER_NAME}-control-plane" \
    --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' 2>/dev/null | head -1 || true)"
  if [[ -n "${ip:-}" ]]; then
    echo "$ip"
    return
  fi
  echo "172.17.0.1"
}

vite_api_base() {
  local base
  base="$(grep -E 'VITE_API_BASE:' k8s/base/layer-4-presentation/configmap-frontend.yaml \
    | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  echo "${base:-http://localhost:30100}"
}

apply_overlay() {
  local fabric_ip="$1"
  local staging overlay_dir
  staging="$(mktemp -d /tmp/roadwatch-k8s-XXXXXX)"
  mkdir -p "$staging/overlays"
  cp -a "k8s/base" "$staging/"
  cp -a "k8s/overlays/${ENVIRONMENT}" "$staging/overlays/"
  overlay_dir="$staging/overlays/${ENVIRONMENT}"
  if [[ -f "$overlay_dir/configmap-cluster-patch.yaml" ]]; then
    sed -i -E "s|FABRIC_HOST_IP:[[:space:]]*\"[^\"]*\"|FABRIC_HOST_IP: \"${fabric_ip}\"|" \
      "$overlay_dir/configmap-cluster-patch.yaml"
  fi
  echo "  Applying k8s/overlays/${ENVIRONMENT} (FABRIC_HOST_IP=${fabric_ip})"
  kubectl apply -k "$overlay_dir"
  rm -rf "$staging"
}

wait_label() {
  local label="$1" timeout="${2:-180}"
  echo "  Waiting for pods -l ${label} (${timeout}s)..."
  kubectl wait --for=condition=ready "pod" -l "$label" -n roadwatch --timeout="${timeout}s" || true
}

# ── Cluster ──────────────────────────────────────────────────────────
if [[ "$RESET" -eq 1 ]]; then
  step "Deleting kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "$CLUSTER_NAME" || true
fi

step "Creating kind cluster '${CLUSTER_NAME}'..."
ensure_kubeconfig() {
  kind export kubeconfig --name "$CLUSTER_NAME" >/dev/null
  kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
}

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "  Cluster exists — exporting kubeconfig."
  ensure_kubeconfig
  ready="$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$ready" != "True" ]]; then
    echo "  Node is NotReady (CNI/kubeconfig drift) — recreating cluster."
    kind delete cluster --name "$CLUSTER_NAME" || true
  fi
fi
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --config k8s/kind-config.yaml
fi
ensure_kubeconfig

# ── Istio Ambient (ztunnel L4 + optional waypoint L7) ─────────────────
step "Installing Istio Ambient profile..."
ISTIO_VERSION="${ISTIO_VERSION:-1.23.3}"
if ! command -v istioctl >/dev/null 2>&1; then
  ISTIO_DIR="${REPO_ROOT}/.tools/istio-${ISTIO_VERSION}"
  if [[ ! -x "${ISTIO_DIR}/bin/istioctl" ]]; then
    mkdir -p "${REPO_ROOT}/.tools"
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64|amd64) ISTIO_ARCH=linux-amd64 ;;
      aarch64|arm64) ISTIO_ARCH=linux-arm64 ;;
      *) ISTIO_ARCH=linux-amd64 ;;
    esac
    curl -fsSL "https://github.com/istio/istio/releases/download/${ISTIO_VERSION}/istio-${ISTIO_VERSION}-${ISTIO_ARCH}.tar.gz" \
      | tar -xz -C "${REPO_ROOT}/.tools"
  fi
  export PATH="${ISTIO_DIR}/bin:${PATH}"
fi
# Ambient profile installs istiod + ztunnel (+ CNI). No per-pod Envoy sidecars.
istioctl install --set profile=ambient -y
kubectl create namespace roadwatch --dry-run=client -o yaml | kubectl apply -f -
# Disable classic sidecar injection; enable ambient dataplane for the app namespace.
kubectl label namespace roadwatch istio-injection- --overwrite 2>/dev/null || true
kubectl label namespace roadwatch istio.io/dataplane-mode=ambient --overwrite
# Waypoint for L7 AuthorizationPolicy / DestinationRule HTTP features.
# Requires the Kubernetes Gateway API CRDs, which kind does not ship by default.
GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.1.0}"
if ! kubectl get crd gateways.gateway.networking.k8s.io >/dev/null 2>&1; then
  echo "  Installing Kubernetes Gateway API CRDs (${GATEWAY_API_VERSION})..."
  kubectl apply --server-side -f \
    "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"
fi
if ! kubectl get gateway waypoint -n roadwatch >/dev/null 2>&1; then
  istioctl waypoint apply -n roadwatch --wait || \
    echo "  WARNING: waypoint apply failed — L4 mTLS still works via ztunnel."
fi
kubectl label namespace roadwatch istio.io/use-waypoint=waypoint --overwrite 2>/dev/null || true
echo "  Istio Ambient installed; roadwatch namespace on ambient dataplane."

# ── KEDA (event-driven autoscaling for Kafka consumers) ──────────────
step "Installing KEDA..."
KEDA_VERSION="${KEDA_VERSION:-2.16.0}"
if ! kubectl get crd scaledobjects.keda.sh >/dev/null 2>&1; then
  if command -v helm >/dev/null 2>&1; then
    helm repo add kedacore https://kedacore.github.io/charts 2>/dev/null || true
    helm repo update kedacore
    helm upgrade --install keda kedacore/keda \
      --namespace keda --create-namespace \
      --wait --timeout 5m
    echo "  KEDA installed via Helm."
  else
    # --server-side avoids the kubectl.kubernetes.io/last-applied-configuration
    # annotation, which exceeds the 256KiB limit on KEDA's large CRDs under
    # client-side `kubectl apply`.
    kubectl apply --server-side --force-conflicts \
      -f "https://github.com/kedacore/keda/releases/download/v${KEDA_VERSION}/keda-${KEDA_VERSION}.yaml"
    echo "  KEDA installed from release manifest."
  fi
else
  echo "  KEDA CRDs already present — skipping install."
fi

# ── Images ───────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" -eq 0 && "$INFRA_ONLY" -eq 0 && "$SKIP_APP_IMAGES" -eq 0 ]]; then
  step "Building Docker images..."
  VITE_API_BASE="$(vite_api_base)"
  docker build -t roadwatch/gateway-api:local -f apps/gateway-api/Dockerfile .
  docker build -t roadwatch/backend-api:local -f backend-api/Dockerfile .
  docker build -t roadwatch/frontend:local -f frontend/Dockerfile \
    --build-arg "VITE_API_BASE=${VITE_API_BASE}" .
  docker build -t roadwatch/scheduler:local -f services/scheduler/Dockerfile .
  docker build -t roadwatch/webhook-handler:local -f services/webhook-handler/Dockerfile .
  docker build -t roadwatch/fabric-anchor-consumer:local -f services/fabric-anchor-consumer/Dockerfile .
fi

if [[ "$INFRA_ONLY" -eq 0 && "$SKIP_APP_IMAGES" -eq 0 ]]; then
  step "Loading images into kind..."
  for img in \
    roadwatch/gateway-api:local \
    roadwatch/backend-api:local \
    roadwatch/frontend:local \
    roadwatch/scheduler:local \
    roadwatch/webhook-handler:local \
    roadwatch/fabric-anchor-consumer:local
  do
    if docker image inspect "$img" >/dev/null 2>&1; then
      kind load docker-image "$img" --name "$CLUSTER_NAME"
    fi
  done
fi

# ── Secrets (ConfigMaps come from kustomize) ─────────────────────────
step "Ensuring namespace + Secrets..."
kubectl create namespace roadwatch --dry-run=client -o yaml | kubectl apply -f -

if [[ "$SKIP_FABRIC_CERTS" -eq 0 ]]; then
  TLS="fabric/network/organizations/peerOrganizations/nhai.roadwatch.com/peers/peer0.nhai.roadwatch.com/tls/ca.crt"
  CERT_DIR="fabric/network/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp/signcerts"
  KEY_DIR="fabric/network/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp/keystore"
  CERT="$(find "$CERT_DIR" -type f -name '*.pem' 2>/dev/null | head -1 || true)"
  KEY="$(find "$KEY_DIR" -type f \( -name 'priv_sk' -o -name '*_sk' \) 2>/dev/null | head -1 || true)"
  if [[ -f "$TLS" && -n "${CERT:-}" && -f "$CERT" && -n "${KEY:-}" && -f "$KEY" ]]; then
    kubectl create secret generic fabric-certs \
      --from-file=tls-ca.crt="$TLS" \
      --from-file=msp-cert.pem="$CERT" \
      --from-file=msp-key.pem="$KEY" \
      --namespace roadwatch \
      --dry-run=client -o yaml | kubectl apply -f -
    echo "  fabric-certs Secret applied"
  else
    echo "  WARNING: Fabric certs not found — fabric-anchor will fail until Secret exists."
    echo "  Re-run with certs present, or use --skip-fabric-certs intentionally."
  fi
fi

# app-secrets is in the overlay base (dev placeholders). Apply overlay next.

step "Applying manifests (ConfigMaps + Secrets via kustomize overlay)..."
FABRIC_IP="$(resolve_fabric_host_ip)"
if [[ "$INFRA_ONLY" -eq 1 ]]; then
  # Platform + Kafka only: apply layer files + config patches
  kubectl apply -f k8s/base/layer-0-platform/namespace.yaml
  kubectl apply -f k8s/base/layer-0-platform/configmap-infra.yaml
  kubectl apply -f k8s/base/layer-0-platform/configmap-app.yaml
  kubectl apply -f k8s/base/layer-0-platform/configmap-cluster.yaml
  kubectl apply -f k8s/base/layer-0-platform/secret.yaml
  kubectl apply -f "k8s/overlays/${ENVIRONMENT}/configmap-app-patch.yaml" || true
  sed -E "s|FABRIC_HOST_IP:[[:space:]]*\"[^\"]*\"|FABRIC_HOST_IP: \"${FABRIC_IP}\"|" \
    "k8s/overlays/${ENVIRONMENT}/configmap-cluster-patch.yaml" | kubectl apply -f -
  kubectl create configmap postgres-init-sql \
    --from-file=init.sql=docker/postgres/init.sql \
    --namespace roadwatch --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f k8s/base/layer-0-platform/postgres-ha.yaml
  kubectl apply -f k8s/base/layer-0-platform/pgbouncer.yaml
  kubectl apply -f k8s/base/layer-0-platform/redis.yaml
  kubectl apply -f k8s/base/layer-2-ingest-hlf/kafka-startup-configmap.yaml
  kubectl apply -f k8s/base/layer-2-ingest-hlf/configmap-fabric.yaml
  kubectl apply -f k8s/base/layer-2-ingest-hlf/kafka-hlf.yaml
  kubectl apply -f k8s/base/layer-2-ingest-hlf/kafka-events.yaml
else
  apply_overlay "$FABRIC_IP"
fi

if [[ "$WAIT_READY" -eq 1 ]]; then
  step "Waiting for core pods..."
  wait_label "app=postgres-primary" 240
  wait_label "app=postgres-replica" 240
  wait_label "app=redis" 180
  wait_label "app=pgbouncer" 120
  wait_label "app=kafka-hlf" 240
  wait_label "app=kafka-events" 240
  if [[ "$INFRA_ONLY" -eq 0 ]]; then
    wait_label "app=gateway" 180
    wait_label "app=backend" 180
    wait_label "app=frontend" 120
  fi
fi

echo
echo "  Frontend:  http://localhost:30080"
echo "  Gateway:   http://localhost:30100"
echo "  Backend:   http://localhost:30401"
echo "  Grafana:   http://localhost:30301  (admin / admin)"
echo
kubectl get configmaps,secrets -n roadwatch
echo
kubectl get pods -n roadwatch -o wide

