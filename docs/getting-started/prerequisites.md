# Prerequisites

Install these tools before setting up RoadWatch.

## Required everywhere

| Tool | Minimum version | Check |
|------|-----------------|-------|
| Node.js | 20 LTS (22+ OK) | `node --version` |
| pnpm | 8.10.x | `pnpm --version` |
| Docker Engine + Compose plugin | 24+ | `docker --version` / `docker compose version` |
| Git | any | `git --version` |

### Arch Linux

```bash
sudo pacman -Syu --needed nodejs npm docker docker-compose git curl jq openssl python-setuptools
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# log out and back in, then:
sudo npm install -g pnpm@8.10.0
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y nodejs npm docker.io docker-compose-v2 git curl jq openssl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# log out and back in, then:
sudo npm install -g pnpm@8.10.0
```

### Windows

Install [Node.js 20+](https://nodejs.org/), [pnpm](https://pnpm.io/installation), and [Docker Desktop](https://docs.docker.com/desktop/windows/).

## Optional: Kubernetes (kind)

Required only for the Kind-based integration environment.

| Tool | Arch | Windows |
|------|------|---------|
| kind | [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/) | `winget install Kubernetes.kind` |
| kubectl | `sudo pacman -S kubectl` | `winget install Kubernetes.kubectl` |

## Optional: Hyperledger Fabric

Required only for the blockchain anchoring pipeline. You can run the rest of the stack without Fabric (`pnpm start:all -- --skip-fabric` / `./ops/dev/start-all.sh --skip-fabric`).

### Linux (Arch, Ubuntu, …)

Fabric runs **natively** (no WSL):

| Tool | Notes |
|------|-------|
| Docker | Same daemon as Compose |
| Fabric binaries (`peer`, `cryptogen`, `configtxgen`) | `pnpm setup` downloads into `bin/`, or see [Fabric deployment](../infrastructure/fabric-deployment.md) |
| `jq`, `openssl` | package manager |

### Windows

These tools must be available **inside WSL 2 (Ubuntu)**:

| Tool | Install |
|------|---------|
| WSL 2 + Ubuntu 22.04 | `wsl --install -d Ubuntu-22.04` |
| Docker WSL integration | Docker Desktop → Settings → Resources → WSL Integration → enable Ubuntu |
| Fabric binaries | See [Fabric deployment](../infrastructure/fabric-deployment.md) |
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
