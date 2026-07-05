#!/bin/bash
#
# tor-rehearsal-drop.sh — A.14 rehearsal helper: drop the Tor circuit
# carrying the deployment's .onion signaling stream, on demand.
#
# Companion to docs/tor-circuit-degradation-runbook.md (Method 1). It
# authenticates to the Tor control port with the control cookie, finds
# the circuit(s) carrying the target .onion stream from `stream-status`,
# prints them for confirmation, and issues `CLOSECIRCUIT` on the correct
# id(s). This removes the error-prone hand-parsing the runbook warns
# about (closing the wrong circuit does nothing visible).
#
# Works against Rig A (standalone tor, control port 9051) and Rig B
# (Tor Browser, control port 9151) — just point --port/--cookie at the
# right client.
#
# Usage:
#   scripts/tor-rehearsal-drop.sh --onion <host>.onion [options]
#
# Options:
#   -o, --onion HOST    Target .onion host (with or without :port). Required.
#   -p, --port PORT     Tor control port (default: 9051; use 9151 for Tor Browser).
#   -c, --cookie PATH   control_auth_cookie path
#                       (default: /tmp/void-rehearsal-tor/control_auth_cookie;
#                        Tor Browser: .../Browser/TorBrowser/Data/Tor/control_auth_cookie).
#   -H, --host HOST     Control-port host (default: 127.0.0.1).
#   -y, --yes           Skip the confirmation prompt (hands-off drop).
#   -w, --watch         Watch mode: subscribe to control-port events
#                       (SETEVENTS STREAM CIRC) and CLOSECIRCUIT the onion
#                       circuit automatically the moment the stream attaches.
#                       Fully hands-off (no prompt); fires once then exits.
#   -t, --timeout SECS  Watch-mode timeout in seconds (default: 600). Exits
#                       cleanly (code 2) if no matching stream attaches in time.
#   -h, --help          Show this help.
#
# Exit codes: 0 success; 1 usage/precondition error; 2 no matching circuit
#             (or watch timeout); 3 control-port/auth error;
#             4 CLOSECIRCUIT failed.

set -euo pipefail

CTRL_HOST=127.0.0.1
CTRL_PORT=9051
COOKIE=/tmp/void-rehearsal-tor/control_auth_cookie
ONION=
ASSUME_YES=0
WATCH=0
TIMEOUT=600

prog=$(basename "$0")

usage() {
  # Print the contiguous comment header (everything before `set -euo
  # pipefail`), stripping the leading `# `.
  sed -n '2,/^set -euo pipefail/p' "$0" \
    | sed '/^set -euo pipefail/d' \
    | sed 's/^#\{0,1\} \{0,1\}//'
  exit "${1:-0}"
}

die() { printf '%s: error: %s\n' "$prog" "$1" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--onion)  ONION=${2:-}; shift 2 ;;
    -p|--port)   CTRL_PORT=${2:-}; shift 2 ;;
    -c|--cookie) COOKIE=${2:-}; shift 2 ;;
    -H|--host)   CTRL_HOST=${2:-}; shift 2 ;;
    -y|--yes)    ASSUME_YES=1; shift ;;
    -w|--watch)  WATCH=1; shift ;;
    -t|--timeout) TIMEOUT=${2:-}; shift 2 ;;
    -h|--help)   usage 0 ;;
    *)           die "unknown argument: $1 (try --help)" 1 ;;
  esac
done

[ -n "$ONION" ] || die "missing --onion <host>.onion (try --help)" 1
[ -r "$COOKIE" ] || die "control cookie not readable: $COOKIE" 1
command -v nc >/dev/null 2>&1 || die "nc (netcat) not found on PATH" 1

# Hex-encode the control cookie. Prefer xxd; fall back to od for hosts
# without it.
if command -v xxd >/dev/null 2>&1; then
  HEXCOOKIE=$(xxd -p -c 256 "$COOKIE")
elif command -v od >/dev/null 2>&1; then
  HEXCOOKIE=$(od -An -v -tx1 "$COOKIE" | tr -d ' \n')
else
  die "need xxd or od to hex-encode the control cookie" 1
fi

# Send a control command (after authenticating) and print the reply with
# CRs stripped. Mirrors the runbook's torctl() helper.
tor_cmd() {
  {
    printf 'AUTHENTICATE %s\r\n' "$HEXCOOKIE"
    printf '%s\r\n' "$1"
    printf 'QUIT\r\n'
  } | nc "$CTRL_HOST" "$CTRL_PORT" | tr -d '\r'
}

# Extract the data block of a `GETINFO <key>` multi-line reply
# (the lines between `250+<key>=` and the lone terminating `.`).
data_block() {
  awk -v key="$1" '
    $0=="250+" key "=" {f=1; next}
    f && $0=="." {f=0}
    f' 
}

# Issue CLOSECIRCUIT on each id in the (newline/space separated) list and
# report the result. Returns 0 on success, 4 if any close failed.
close_circs() {
  local rc=0 c reply
  for c in $1; do
    reply=$(tor_cmd "CLOSECIRCUIT $c") || { printf 'CLOSECIRCUIT %s: control port unreachable\n' "$c" >&2; rc=4; continue; }
    if printf '%s\n' "$reply" | grep -q '^250 '; then
      printf 'CLOSECIRCUIT %s: 250 OK — start your stopwatch.\n' "$c"
    else
      printf 'CLOSECIRCUIT %s failed: %s\n' "$c" "$(printf '%s' "$reply" | tr '\n' ' ')" >&2
      rc=4
    fi
  done
  return "$rc"
}

# Print the circuit id(s) carrying a stream to host_lc from a stream-status
# data block (4th field is the target; skip circ 0 = not yet attached).
match_circs() {
  printf '%s\n' "$1" | awk -v h="$host_lc" '
    NF>=4 { tgt=tolower($4); split(tgt, a, ":"); if (a[1]==h && $3!="0") print $3 }' \
    | sort -un
}

# Watch mode: subscribe to STREAM/CIRC events on a persistent, authenticated
# control connection and CLOSECIRCUIT the onion circuit the instant the stream
# attaches — the fully hands-off variant the runbook's Method 1 describes.
run_watch() {
  # If the onion stream is already attached (the call is already up), that *is*
  # the moment — drop it now rather than waiting for an event that won't fire.
  local snap pre_streams pre_circs
  snap=$(tor_cmd 'GETINFO stream-status') \
    || die "could not reach control port $CTRL_HOST:$CTRL_PORT" 3
  case "$snap" in
    *"515 "*|*"514 "*) die "control-port authentication failed (check --cookie / --port)" 3 ;;
  esac
  pre_streams=$(printf '%s\n' "$snap" | data_block stream-status)
  pre_circs=$(match_circs "$pre_streams")
  if [ -n "$pre_circs" ]; then
    printf '%s: onion stream already attached to circuit(s) %s — dropping now.\n' \
      "$prog" "$(printf '%s' "$pre_circs" | tr '\n' ' ')"
    close_circs "$pre_circs"
    exit $?
  fi

  printf '%s: watching STREAM/CIRC events for %s (timeout %ss, Ctrl-C to stop)...\n' \
    "$prog" "$host" "$TIMEOUT"

  # Persistent, authenticated session via a coprocess so we can read async 650
  # events and send CLOSECIRCUIT on the same connection.
  local rfd wfd ncpid line rc circ tgt deadline now remaining
  coproc TORCTL { nc "$CTRL_HOST" "$CTRL_PORT"; }
  rfd=${TORCTL[0]}; wfd=${TORCTL[1]}; ncpid=$TORCTL_PID

  # Tear down cleanly on normal exit, timeout, and Ctrl-C / SIGTERM so no
  # control connection or event subscription is ever left dangling.
  cleanup() {
    { printf 'QUIT\r\n' >&"$wfd"; } 2>/dev/null || true
    eval "exec ${wfd}>&-" 2>/dev/null || true
    eval "exec ${rfd}<&-" 2>/dev/null || true
    [ -n "$ncpid" ] && kill "$ncpid" 2>/dev/null || true
  }
  trap 'cleanup; printf "\n%s: interrupted — control connection closed.\n" "$prog" >&2; exit 130' INT TERM
  trap cleanup EXIT

  printf 'AUTHENTICATE %s\r\n' "$HEXCOOKIE" >&"$wfd"
  IFS= read -r -t 10 -u "$rfd" line || die "no reply from control port (auth)" 3
  line=${line%$'\r'}
  case "$line" in
    250*) ;;
    *) die "control-port authentication failed (check --cookie / --port): $line" 3 ;;
  esac

  printf 'SETEVENTS STREAM CIRC\r\n' >&"$wfd"
  IFS= read -r -t 10 -u "$rfd" line || die "no reply from control port (SETEVENTS)" 3
  line=${line%$'\r'}
  case "$line" in
    250*) ;;
    *) die "SETEVENTS rejected: $line" 3 ;;
  esac

  # Async STREAM event: `650 STREAM <id> <status> <circid> <target> [k=v ...]`.
  # When our onion target shows a non-zero circuit id the stream has attached —
  # close that circuit.
  deadline=$(( $(date +%s) + TIMEOUT ))
  while :; do
    now=$(date +%s)
    remaining=$(( deadline - now ))
    if [ "$remaining" -le 0 ]; then
      printf '%s: timed out after %ss — no onion stream attached.\n' "$prog" "$TIMEOUT" >&2
      exit 2
    fi
    if IFS= read -r -t "$remaining" -u "$rfd" line; then
      line=${line%$'\r'}
      # shellcheck disable=SC2086
      set -- $line
      [ "${2:-}" = STREAM ] || continue
      circ=${5:-0}
      tgt=$(printf '%s' "${6:-}" | tr 'A-Z' 'a-z'); tgt=${tgt%%:*}
      if [ -n "$circ" ] && [ "$circ" != 0 ] && [ "$tgt" = "$host_lc" ]; then
        printf '%s: onion stream attached to circuit %s (status %s) — dropping.\n' \
          "$prog" "$circ" "${4:-?}"
        close_circs "$circ"
        exit $?
      fi
    else
      rc=$?
      [ "$rc" -gt 128 ] && continue   # per-read timeout; deadline enforced above
      die "control connection closed before the onion stream attached" 3
    fi
  done
}

# Normalise the onion host: drop any :port the operator passed, lowercase.
host=${ONION%%:*}
host_lc=$(printf '%s' "$host" | tr 'A-Z' 'a-z')

if [ "$WATCH" -eq 1 ]; then
  case "$TIMEOUT" in
    ''|*[!0-9]*) die "--timeout must be a positive integer (seconds): $TIMEOUT" 1 ;;
  esac
  [ "$TIMEOUT" -gt 0 ] || die "--timeout must be greater than 0 seconds" 1
  run_watch
  exit $?
fi

stream_reply=$(tor_cmd 'GETINFO stream-status') \
  || die "could not reach control port $CTRL_HOST:$CTRL_PORT" 3

case "$stream_reply" in
  *"515 "*|*"514 "*) die "control-port authentication failed (check --cookie / --port)" 3 ;;
esac

streams=$(printf '%s\n' "$stream_reply" | data_block stream-status)

# Stream line: <id> <status> <circid> <target>. Match the target host,
# skip circ 0 (stream not yet attached to a circuit).
circs=$(match_circs "$streams")

if [ -z "$circs" ]; then
  printf '%s: no stream found targeting %s\n' "$prog" "$host" >&2
  if [ -n "$streams" ]; then
    printf 'Current streams (id status circ target):\n%s\n' "$streams" >&2
  else
    printf '(no streams open — load the .onion in the browser first)\n' >&2
  fi
  exit 2
fi

# Show the matching streams and the circuit detail (runbook step 2) so the
# operator can eyeball the target before anything is closed.
printf 'Matching stream(s) for %s:\n' "$host"
printf '%s\n' "$streams" | awk -v h="$host_lc" '
  NF>=4 { tgt=tolower($4); split(tgt, a, ":"); if (a[1]==h && $3!="0") print "  " $0 }'

circ_reply=$(tor_cmd 'GETINFO circuit-status') || true
circ_block=$(printf '%s\n' "$circ_reply" | data_block circuit-status)

printf '\nCircuit(s) to close: %s\n' "$(printf '%s' "$circs" | tr '\n' ' ')"
for c in $circs; do
  detail=$(printf '%s\n' "$circ_block" | awk -v c="$c" '$1==c')
  [ -n "$detail" ] && printf '  %s\n' "$detail"
done

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ -r /dev/tty ]; then
    printf '\nClose the circuit(s) above? [y/N] '
    read -r reply </dev/tty || reply=
  else
    die "no tty for confirmation; re-run with --yes to drop non-interactively" 1
  fi
  case "$reply" in
    y|Y|yes|YES) ;;
    *) printf 'Aborted — nothing closed.\n'; exit 0 ;;
  esac
fi

rc=0
close_circs "$circs" || rc=$?

exit "$rc"
