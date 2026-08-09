# Prerequisites

Install these tools before setting up RoadWatch.

## Required everywhere

| Tool | Minimum version | Check |
|------|-----------------|-------|
| Node.js | 20 LTS | `node --version` |
| pnpm | 8+ | `pnpm --version` |
| Docker Desktop | 4.x | `docker --version` |
| Git | any | `git --version` |

## Optional: Kubernetes (kind)

Required only for the Kind-based integration environment.

| Tool | Install |
|------|---------|
| kind | `winget install Kubernetes.kind` or [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/) |
| kubectl | `winget install Kubernetes.kubectl` or [kubectl install](https://kubernetes.io/docs/tasks/tools/) |

## Optional: Hyperledger Fabric

Required only for the blockchain anchoring pipeline. You can run the rest of the stack without Fabric.

These tools must be available **inside WSL 2 (Ubuntu)** on Windows:

| Tool | Install |
|------|---------|
| WSL 2 + Ubuntu 22.04 | `wsl --install -d Ubuntu-22.04` |
| Docker WSL integration | Docker Desktop → Settings → Resources → WSL Integration → enable Ubuntu |
| Fabric binaries (`peer`, `cryptogen`, `configtxgen`) | See [Fabric deployment](../infrastructure/fabric-deployment.md) |
| `jq`, `openssl` | `sudo apt install jq openssl` inside WSL |

## Optional: Mobile development

| Tool | Purpose |
|------|---------|
| Android Studio + SDK | Android builds |
| Xcode (macOS only) | iOS builds |
| React Native CLI deps | See [Mobile host](../services/mobile-host.md) |

## Hardware recommendations

| Environment | RAM | Disk |
|-------------|-----|------|
| Local dev (Docker + Node) | 8 GB+ | 10 GB free |
| Local dev + Fabric | 16 GB+ | 20 GB free |
| Kind + Fabric | 16 GB+ | 25 GB free |
