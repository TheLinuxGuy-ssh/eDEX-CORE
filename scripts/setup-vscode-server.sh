#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/openvscode-server"
REPO="gitpod-io/openvscode-server"
UA="edex-core-setup/1.0"

if [ -x "$VENDOR/bin/openvscode-server" ]; then
  echo "OpenVSCode Server already installed at $VENDOR"
  exit 0
fi

mkdir -p "$ROOT/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l|armv7) ARCH="armhf" ;;
  *)
    echo "Unsupported CPU architecture: $ARCH"
    exit 1
    ;;
esac

VERSION="${OPENVSCODE_VERSION:-1.109.5}"
TAG="openvscode-server-v${VERSION}"
ASSET="openvscode-server-v${VERSION}-linux-${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

echo "Downloading ${URL}"
curl -fsSL -H "User-Agent: ${UA}" "$URL" -o "$TMP/server.tar.gz"
tar -xzf "$TMP/server.tar.gz" -C "$TMP"
EXTRACTED="$(find "$TMP" -maxdepth 1 -type d -name 'openvscode-server-*' | head -n1)"
if [ -z "$EXTRACTED" ]; then
  echo "Could not find extracted OpenVSCode Server directory."
  exit 1
fi
rm -rf "$VENDOR"
mv "$EXTRACTED" "$VENDOR"
echo "Installed to $VENDOR"
