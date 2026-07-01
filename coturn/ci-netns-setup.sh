#!/usr/bin/env bash
# ─── VOID connection-smoke network-namespace topology ────────────────
# Builds the network isolation that lets the connection-smoke CI prove a
# GENUINE relay/relay WebRTC path. Used by .github/workflows/
# connection-smoke.yml. Must run as root (CAP_NET_ADMIN).
#
# WHY THIS EXISTS
# ---------------
# A single host cannot produce a relay/relay candidate pair. coturn matches
# TURN permissions by *peer IP only*, so when a peer's base-socket IP equals
# coturn's relay-ip the direct base→relay shortcut is wrongly permitted and
# ICE forms a host/prflx pair — the SDK's relay-only verifier then fails.
#
# This topology removes both failure modes at once:
#   1. Each peer lives in its OWN netns with NO route to the other peer, so
#      the only transport that can possibly reach the far peer is the relay.
#   2. coturn's relay-ip (RELAY_IP) is a dedicated dummy address that DIFFERS
#      from every peer's base-socket IP, so even an attempted base→relay
#      shortcut is dropped by coturn's permission-by-IP check.
#
# TOPOLOGY
# --------
#   default netns (host): coturn + API server, both reachable at RELAY_IP
#       (a /32 on a dummy interface). The host routes to each peer subnet.
#
#   ns-peer-a (10.10.1.2/24)  ──veth──  vh-a (10.10.1.1/24) ┐
#                                                            ├─ host ── RELAY_IP (10.99.0.1)
#   ns-peer-b (10.10.2.2/24)  ──veth──  vh-b (10.10.2.1/24) ┘
#
#   * Each peer has a route to RELAY_IP via its gateway, and NO default
#     route — so it literally cannot address the other peer's subnet.
#   * The two harnesses run sequentially, so the same two namespaces are
#     reused: buyer/tool-server → ns-peer-a, seller/tool-client → ns-peer-b.
#
# USAGE
#   sudo coturn/ci-netns-setup.sh up      # build the topology (idempotent)
#   sudo coturn/ci-netns-setup.sh check   # assert relay reachable + peers isolated
#   sudo coturn/ci-netns-setup.sh down    # tear everything down
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

NS_A="${NS_A:-ns-peer-a}"
NS_B="${NS_B:-ns-peer-b}"

# Peer A
VETH_A_HOST="vh-a"
VETH_A_NS="vp-a"
A_HOST_IP="10.10.1.1"
A_NS_IP="10.10.1.2"
A_CIDR="24"

# Peer B
VETH_B_HOST="vh-b"
VETH_B_NS="vp-b"
B_HOST_IP="10.10.2.1"
B_NS_IP="10.10.2.2"
B_CIDR="24"

# Shared relay/API address (distinct from every peer base IP — see header).
RELAY_DUMMY="void-relay0"
RELAY_IP="${RELAY_IP:-10.99.0.1}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: must run as root (need CAP_NET_ADMIN for ip netns/veth)." >&2
    exit 1
  fi
}

up() {
  require_root

  # rp_filter would drop packets that arrive on a veth but whose source is a
  # peer subnet while the destination is the host-local RELAY_IP. Relax it so
  # asymmetric host-local delivery works.
  sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null
  sysctl -w net.ipv4.conf.default.rp_filter=0 >/dev/null

  # Dedicated relay/API address on a dummy interface in the default netns.
  ip link show "$RELAY_DUMMY" >/dev/null 2>&1 || ip link add "$RELAY_DUMMY" type dummy
  ip addr replace "${RELAY_IP}/32" dev "$RELAY_DUMMY"
  ip link set "$RELAY_DUMMY" up

  _build_peer "$NS_A" "$VETH_A_HOST" "$VETH_A_NS" "$A_HOST_IP" "$A_NS_IP" "$A_CIDR"
  _build_peer "$NS_B" "$VETH_B_HOST" "$VETH_B_NS" "$B_HOST_IP" "$B_NS_IP" "$B_CIDR"

  echo "netns topology up: ${NS_A} (${A_NS_IP}) + ${NS_B} (${B_NS_IP}) -> relay ${RELAY_IP}"
}

_build_peer() {
  local ns="$1" vhost="$2" vns="$3" host_ip="$4" ns_ip="$5" cidr="$6"

  ip netns add "$ns" 2>/dev/null || true

  # Recreate the veth pair cleanly (deleting one end removes both).
  ip link del "$vhost" 2>/dev/null || true
  ip link add "$vhost" type veth peer name "$vns"

  # Move the peer end into the namespace; configure both ends.
  ip link set "$vns" netns "$ns"
  ip addr replace "${host_ip}/${cidr}" dev "$vhost"
  ip link set "$vhost" up

  ip netns exec "$ns" ip link set lo up
  ip netns exec "$ns" ip addr replace "${ns_ip}/${cidr}" dev "$vns"
  ip netns exec "$ns" ip link set "$vns" up

  # Reach the relay/API ONLY — no default route, so the peer cannot address
  # the other peer's subnet. This is the hard isolation guarantee.
  ip netns exec "$ns" ip route replace "${RELAY_IP}/32" via "$host_ip"

  ip netns exec "$ns" sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null
}

check() {
  require_root
  local rc=0

  echo "── reachability: each peer MUST reach the relay (${RELAY_IP}) ──"
  for ns in "$NS_A" "$NS_B"; do
    if ip netns exec "$ns" ping -c1 -W2 "$RELAY_IP" >/dev/null 2>&1; then
      echo "  OK    ${ns} -> ${RELAY_IP}"
    else
      echo "  FAIL  ${ns} -> ${RELAY_IP} (relay/API will be unreachable)"; rc=1
    fi
  done

  echo "── isolation: peers MUST NOT reach each other ──"
  if ip netns exec "$NS_A" ping -c1 -W2 "$B_NS_IP" >/dev/null 2>&1; then
    echo "  FAIL  ${NS_A} CAN reach ${B_NS_IP} (isolation broken -> shortcut possible)"; rc=1
  else
    echo "  OK    ${NS_A} cannot reach ${B_NS_IP}"
  fi
  if ip netns exec "$NS_B" ping -c1 -W2 "$A_NS_IP" >/dev/null 2>&1; then
    echo "  FAIL  ${NS_B} CAN reach ${A_NS_IP} (isolation broken -> shortcut possible)"; rc=1
  else
    echo "  OK    ${NS_B} cannot reach ${A_NS_IP}"
  fi

  echo "── relay-ip vs base-ip (MUST differ) ──"
  if [ "$RELAY_IP" = "$A_NS_IP" ] || [ "$RELAY_IP" = "$B_NS_IP" ]; then
    echo "  FAIL  RELAY_IP (${RELAY_IP}) equals a peer base IP — permission shortcut"; rc=1
  else
    echo "  OK    RELAY_IP ${RELAY_IP} != ${A_NS_IP}, ${B_NS_IP}"
  fi

  return "$rc"
}

down() {
  require_root
  ip netns del "$NS_A" 2>/dev/null || true
  ip netns del "$NS_B" 2>/dev/null || true
  ip link del "$VETH_A_HOST" 2>/dev/null || true
  ip link del "$VETH_B_HOST" 2>/dev/null || true
  ip link del "$RELAY_DUMMY" 2>/dev/null || true
  echo "netns topology down"
}

case "${1:-}" in
  up) up ;;
  check) check ;;
  down) down ;;
  *) echo "usage: $0 {up|check|down}" >&2; exit 2 ;;
esac
