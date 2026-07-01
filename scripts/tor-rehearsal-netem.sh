#!/bin/bash
#
# tor-rehearsal-netem.sh — A.14 rehearsal helper: shape the Tor client's
# egress with `tc netem` (latency / jitter / loss) for Method 2 of the
# runbook (the "degrade, observe it limps, then drop" variant).
#
# Companion to docs/tor-circuit-degradation-runbook.md (Method 2). It
# applies / changes / clears a netem qdisc on a chosen interface and —
# crucially — refuses to shape the host's own default-route interface (or
# loopback) without an explicit --force, because shaping a shared host's
# egress degrades the operator's own connectivity and any production
# traffic on that box. This is the sharp gotcha the runbook warns about.
#
# Default action is "apply and hold": it adds the netem qdisc, then blocks
# (foreground) while you run the rehearsal — drop the circuit with
# scripts/tor-rehearsal-drop.sh from another shell — and removes the qdisc
# on exit (Ctrl-C, --duration timeout, or any signal). The shaping only
# exists while this helper runs, so you can never walk away leaving a
# shared box throttled. Use --detach to apply and return (you must --clear
# it yourself later), --change to retune an already-applied qdisc, or
# --clear to remove one.
#
# Usage:
#   scripts/tor-rehearsal-netem.sh --iface <if> [options]   # apply + hold
#   scripts/tor-rehearsal-netem.sh --iface <if> --clear     # remove
#
# Options:
#   -i, --iface IF      Interface to shape (e.g. eth0, veth0). Required.
#   -d, --delay MS      One-way delay (default: 800ms). Bare number => ms.
#   -j, --jitter MS     Delay jitter, normal distribution (default: 300ms).
#                       0 disables jitter.
#   -l, --loss PCT      Packet loss percent (default: 2%). 0 disables loss.
#       --change        Retune an already-applied qdisc in place and exit
#                       (tc qdisc change). Implies you applied with --detach.
#       --clear         Remove the netem qdisc from the interface and exit.
#       --detach        Apply and return immediately, leaving netem in place.
#                       You must run --clear later. (No auto-cleanup.)
#       --duration SEC  Hold for SEC seconds, then auto-clear. Implies hold.
#   -f, --force         Allow shaping the host's default-route interface or
#                       loopback. DANGEROUS on a shared host — see above.
#   -y, --yes           Skip the confirmation prompt.
#   -h, --help          Show this help.
#
# Exit codes: 0 success; 1 usage/precondition error; 2 guard tripped
#             (shared/loopback interface without --force); 3 tc command
#             failed.

set -euo pipefail

IFACE=
DELAY=800ms
JITTER=300ms
LOSS=2%
MODE=apply        # apply | change | clear
DETACH=0
DURATION=
FORCE=0
ASSUME_YES=0

prog=$(basename "$0")

usage() {
  sed -n '2,49p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'
  exit "${1:-0}"
}

die() { printf '%s: error: %s\n' "$prog" "$1" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -i|--iface)   IFACE=${2:-}; shift 2 ;;
    -d|--delay)   DELAY=${2:-}; shift 2 ;;
    -j|--jitter)  JITTER=${2:-}; shift 2 ;;
    -l|--loss)    LOSS=${2:-}; shift 2 ;;
    --change)     [ "$MODE" = apply ] || die "only one of --change/--clear" 1; MODE=change; shift ;;
    --clear)      [ "$MODE" = apply ] || die "only one of --change/--clear" 1; MODE=clear; shift ;;
    --detach)     DETACH=1; shift ;;
    --duration)   DURATION=${2:-}; shift 2 ;;
    -f|--force)   FORCE=1; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -h|--help)    usage 0 ;;
    *)            die "unknown argument: $1 (try --help)" 1 ;;
  esac
done

[ -n "$IFACE" ] || die "missing --iface <if> (try --help)" 1
command -v tc >/dev/null 2>&1 || die "tc (iproute2) not found on PATH" 1
command -v ip >/dev/null 2>&1 || die "ip (iproute2) not found on PATH" 1

if [ -n "$DURATION" ]; then
  case "$DURATION" in
    ''|*[!0-9]*) die "--duration must be a whole number of seconds" 1 ;;
  esac
fi

# Reject incompatible flag combinations early. --change/--clear return
# immediately, so hold/detach options make no sense with them; --detach
# and --duration are opposites (one leaves it in place, one auto-clears).
case "$MODE" in
  clear)
    [ "$DETACH" -eq 1 ] && die "--clear takes no --detach" 1
    [ -n "$DURATION" ] && die "--clear takes no --duration" 1
    ;;
  change)
    [ "$DETACH" -eq 1 ] && die "--change retunes in place and returns; it takes no --detach" 1
    [ -n "$DURATION" ] && die "--change retunes in place and returns; it takes no --duration" 1
    ;;
esac
if [ "$DETACH" -eq 1 ] && [ -n "$DURATION" ]; then
  die "--detach and --duration are mutually exclusive (detach leaves netem in place; duration auto-clears)" 1
fi

# Run tc with privilege if we are not already root.
if [ "$(id -u)" -eq 0 ]; then
  TC() { tc "$@"; }
elif command -v sudo >/dev/null 2>&1; then
  TC() { sudo tc "$@"; }
else
  die "need root or sudo to run tc" 1
fi

# Confirm the interface exists.
ip link show "$IFACE" >/dev/null 2>&1 || die "interface not found: $IFACE" 1

# Guard: refuse to shape the host's own egress. The default-route
# interface carries the operator's connectivity and any production
# traffic; loopback shaping is almost always a mistake. Both are
# overridable with --force for the deliberate-VM case.
default_if=$(ip route show default 2>/dev/null \
  | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')

if [ "$MODE" != "clear" ] && [ "$FORCE" -ne 1 ]; then
  if [ "$IFACE" = "lo" ]; then
    die "refusing to shape loopback ($IFACE); use a real egress interface, or --force" 2
  fi
  if [ -n "$default_if" ] && [ "$IFACE" = "$default_if" ]; then
    printf '%s: error: %s is this host'\''s default-route interface.\n' "$prog" "$IFACE" >&2
    printf 'Shaping it degrades the operator'\''s own connectivity and any\n' >&2
    printf 'production traffic on this box. Run this on a dedicated rehearsal\n' >&2
    printf 'box, VM, or netns instead. Override with --force only if this host\n' >&2
    printf 'is truly disposable.\n' >&2
    exit 2
  fi
fi

# --clear: remove and exit. Idempotent — a missing qdisc is not an error.
# Only delete when the root qdisc is actually netem, so we never tear down
# an unrelated custom qdisc and then claim to have "cleared netem".
if [ "$MODE" = "clear" ]; then
  current=$(TC qdisc show dev "$IFACE" 2>/dev/null || true)
  if printf '%s\n' "$current" | grep -Eq 'qdisc netem [0-9a-fx]+: root'; then
    TC qdisc del dev "$IFACE" root || die "tc qdisc del failed" 3
    printf 'Cleared netem on %s.\n' "$IFACE"
  elif printf '%s\n' "$current" | grep -q 'qdisc netem'; then
    printf 'netem on %s is not the root qdisc — leaving it untouched.\n' "$IFACE" >&2
    printf 'Inspect with: tc qdisc show dev %s\n' "$IFACE" >&2
    exit 1
  else
    printf 'No netem qdisc on %s (nothing to clear).\n' "$IFACE"
  fi
  exit 0
fi

# Normalise values: bare numbers get a unit, an explicit 0 disables.
norm_ms()  { case "$1" in 0) printf '0' ;; *[!0-9.]*) printf '%s' "$1" ;; *) printf '%sms' "$1" ;; esac; }
norm_pct() { case "$1" in 0) printf '0' ;; *%) printf '%s' "$1" ;; *) printf '%s%%' "$1" ;; esac; }

DELAY=$(norm_ms "$DELAY")
JITTER=$(norm_ms "$JITTER")
LOSS=$(norm_pct "$LOSS")

# Build the netem spec. delay is always present; jitter/loss are optional.
netem=(delay "$DELAY")
case "$JITTER" in 0) ;; *) netem+=("$JITTER" distribution normal) ;; esac
case "$LOSS"   in 0) ;; *) netem+=(loss "$LOSS") ;; esac

human="delay $DELAY"
[ "$JITTER" != 0 ] && human="$human ±$JITTER"
[ "$LOSS"   != 0 ] && human="$human, loss $LOSS"

# --change: retune an existing qdisc and exit (no hold/cleanup — the
# operator applied it detached and stays responsible for clearing it).
if [ "$MODE" = "change" ]; then
  printf 'Retuning netem on %s: %s\n' "$IFACE" "$human"
  TC qdisc change dev "$IFACE" root netem "${netem[@]}" \
    || die "tc qdisc change failed (was netem applied with --detach first?)" 3
  printf 'Done. Remember to --clear %s when finished.\n' "$IFACE"
  exit 0
fi

# apply (default). Confirm before touching the interface unless --yes.
printf 'About to apply netem on %s:\n  %s\n' "$IFACE" "$human"
if [ "$DETACH" -eq 1 ]; then
  printf 'Mode: detach (left in place — you must --clear %s afterwards).\n' "$IFACE"
elif [ -n "$DURATION" ]; then
  printf 'Mode: hold for %ss, then auto-clear.\n' "$DURATION"
else
  printf 'Mode: hold until Ctrl-C, then auto-clear.\n'
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ -r /dev/tty ]; then
    printf 'Proceed? [y/N] '
    read -r reply </dev/tty || reply=
  else
    die "no tty for confirmation; re-run with --yes" 1
  fi
  case "$reply" in
    y|Y|yes|YES) ;;
    *) printf 'Aborted — nothing applied.\n'; exit 0 ;;
  esac
fi

TC qdisc add dev "$IFACE" root netem "${netem[@]}" \
  || die "tc qdisc add failed (already shaped? clear it first, or use --change)" 3
printf 'netem active on %s: %s\n' "$IFACE" "$human"

# Detached: leave it in place and return.
if [ "$DETACH" -eq 1 ]; then
  printf 'Left in place. Run: %s --iface %s --clear  when finished.\n' "$prog" "$IFACE"
  exit 0
fi

# Hold: keep the qdisc up while the rehearsal runs, then always clean up.
cleared=0
cleanup() {
  [ "$cleared" -eq 1 ] && return 0
  cleared=1
  printf '\nClearing netem on %s...\n' "$IFACE"
  TC qdisc del dev "$IFACE" root 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'Run the circuit drop from another shell now, e.g.:\n'
printf '  scripts/tor-rehearsal-drop.sh --onion <deployment>.onion\n'

if [ -n "$DURATION" ]; then
  printf 'Holding for %ss (Ctrl-C to clear early)...\n' "$DURATION"
  sleep "$DURATION"
else
  printf 'Holding — press Ctrl-C to clear.\n'
  while true; do sleep 86400; done
fi
