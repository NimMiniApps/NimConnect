#!/bin/bash
# Generates a fresh Nimiq mainnet keypair to use as the marketplace escrow
# wallet (ESCROW_ADDRESS / NIMIQ_WALLET_KEY — see docker-compose.yml).
#
# Spins up a throwaway node (same image as the real escrow node) with no
# persistent volume and no published ports, calls its local createAccount
# RPC once, then tears the container down — the real escrow node's
# nimiq/client.toml deliberately does NOT allow createAccount (it's a
# one-time setup operation, not something the running node should ever
# accept), so this uses its own disposable config instead of relaxing that.
#
# Usage: ./scripts/create-escrow-wallet.sh
set -euo pipefail

IMAGE="ghcr.io/nimiq/core-rs-albatross:1.7.1"
CONTAINER_NAME="nimconnect-walletgen-$$"
CONFIG_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$CONFIG_DIR"
}
trap cleanup EXIT

cat > "$CONFIG_DIR/client.toml" <<'EOF'
[network]
listen_addresses = []

[consensus]
sync_mode = "full"
network = "main-albatross"

[rpc-server]
bind = "0.0.0.0"
port = 8648
methods = ["createAccount"]

[database]

[log]
level = "warn"
EOF

echo "Starting a throwaway node (no persistent data, no published ports) just to generate a keypair..."
docker run -d --name "$CONTAINER_NAME" \
  --user "0:0" \
  --entrypoint /bin/sh \
  -v "$CONFIG_DIR/client.toml:/home/nimiq/.nimiq/client.toml:ro" \
  "$IMAGE" \
  -c 'chown -R nimiq:nimiq /home/nimiq/.nimiq || true; exec runuser -u nimiq -- /usr/bin/tini -- nimiq-client' \
  >/dev/null

echo "Waiting for its RPC server to come up..."
RESULT=""
for _ in $(seq 1 30); do
  RESULT=$(docker exec "$CONTAINER_NAME" curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"createAccount","params":[""],"id":1}' \
    http://localhost:8648 2>/dev/null || true)
  if echo "$RESULT" | grep -q '"address"'; then
    break
  fi
  RESULT=""
  sleep 1
done

if [ -z "$RESULT" ]; then
  echo "ERROR: RPC server never responded after 30s. Is Docker able to pull/run $IMAGE?" >&2
  exit 1
fi

ADDRESS=$(echo "$RESULT" | grep -o '"address":"[^"]*"' | head -1 | sed 's/"address":"//;s/"//')
PRIVATE_KEY=$(echo "$RESULT" | grep -o '"privateKey":"[^"]*"' | head -1 | sed 's/"privateKey":"//;s/"//')

if [ -z "$ADDRESS" ] || [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: could not parse createAccount response: $RESULT" >&2
  exit 1
fi

OUTPUT_FILE="escrow-wallet-$(date +%Y%m%d-%H%M%S).json"
cat > "$OUTPUT_FILE" <<EOF
{
  "address": "$ADDRESS",
  "private_key": "$PRIVATE_KEY",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "network": "main-albatross"
}
EOF
chmod 600 "$OUTPUT_FILE"

cat <<SUMMARY

=== New escrow wallet (MAINNET) ===
Address:     $ADDRESS
Private key: $PRIVATE_KEY
Saved to:    $OUTPUT_FILE (chmod 600 — already gitignored, treat like a password)

Fund this address with a small amount of NIM to cover payout fees, then:

  export ESCROW_ADDRESS='$ADDRESS'
  export NIMIQ_WALLET_KEY='$PRIVATE_KEY'
  docker compose --profile escrow up --build

WARNING: this key controls real mainnet funds once funded. Never commit
$OUTPUT_FILE or paste the private key anywhere outside your own secrets.
SUMMARY
