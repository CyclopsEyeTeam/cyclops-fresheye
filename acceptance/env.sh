#!/bin/bash
# Run a command in the sandbox's clean environment (own HOME + CLAUDE_CONFIG_DIR; proxy/CA passed through).
X=$1; shift
exec env -i HOME="$X/home" PATH="$PATH" HTTPS_PROXY="${HTTPS_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
  CLAUDE_CONFIG_DIR="$X/cfg" FRESHEYE_ACCEPT_DIR="$X" TERM=xterm-256color "$@"
