## Fabric Version Parity Checklist

- **Goal:** Ensure the local Fabric CLI (`peer`, `orderer`, `configtxlator`) matches the running container runtime (v2.5.15).
- **Verify versions:**
  - `peer version` (run in WSL)
  - `docker exec <peer-container> peer version`
- **If they differ (e.g., local v2.5.4 vs container v2.5.15):**
  1. Install matching binaries in WSL. Recommended quick command (downloads Fabric install helper and installs binaries):
     - `curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- binary 2.5.15`
  2. Alternatively download the prebuilt tarball and extract into `~/bin` or repo `bin/`:
     - `curl -LO https://github.com/hyperledger/fabric/releases/download/v2.5.15/hyperledger-fabric-linux-amd64-2.5.15.tar.gz`
     - `tar -xzf hyperledger-fabric-linux-amd64-2.5.15.tar.gz -C ~/bin`
  3. Ensure WSL PATH precedence picks up the new binaries by adding to `~/.profile`:
     - `export PATH=~/bin:$PATH`
  4. Re-open WSL or `source ~/.profile` and verify `peer version` reports `2.5.15`.

- **If you prefer containers to match local CLI:**
  - Edit `fabric/network/docker/docker-compose.yaml` to change image tags to your desired version and recreate the network (`docker compose down --volumes && docker compose up -d`).

- **After parity:** re-run `./fabric/network/scripts/deploy-chaincode.sh` and your smoke tests.

If you want, I can install v2.5.15 into WSL for you now and re-run the parity check.
