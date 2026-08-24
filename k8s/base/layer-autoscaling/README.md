# Layer Autoscaling — KEDA ScaledObjects

KEDA extends Kubernetes with event-driven autoscaling. RoadWatch uses Kafka lag
scalers for consumer Deployments instead of CPU-based HPAs where lag is the
better signal.

## Prerequisites

KEDA must be installed in the cluster before applying this layer. See
[`keda-install.md`](./keda-install.md). The `deploy-kind.sh` script installs KEDA
via Helm when deploying a full cluster.

## ScaledObjects

| ScaledObject | Target | Cluster | Topics |
|--------------|--------|---------|--------|
| `webhook-kafka` | `webhook` Deployment | kafka-events | complaint-submitted, complaint-anchored, complaint-status-changed, escalation-due, notification-send |
| `fabric-anchor-kafka` | `fabric-anchor` Deployment | kafka-hlf | complaint-submitted, complaint-status-changed |

Gateway and backend retain CPU HPAs as fallback scalers.

## Apply

```bash
# After KEDA is installed
kubectl apply -k k8s/base/layer-autoscaling
```

## Notes

- `webhook-hpa` (CPU) was removed to avoid conflicting with the Kafka ScaledObject.
- Bootstrap servers list all three brokers per cluster for resilience.
- Tune `lagThreshold` per topic based on observed throughput in Grafana/Prometheus.
