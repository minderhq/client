#!/bin/sh
# Writes the security response header snippets nginx.conf includes. Runs from
# the nginx image's /docker-entrypoint.d at every container start (and once at
# image build, so the files always exist), so these env vars apply on restart:
#
#   CLIENT_SECURITY_HEADERS  on (default) | off. "off" only when your own
#                            reverse proxy sets these headers.
#   CLIENT_CSP               replaces the whole Content-Security-Policy below.
#   MINDER_API_BASE_URL      the gateway URL the app calls (the image sets it
#                            from the VITE_API_BASE_URL build arg); its origin
#                            is added to connect-src.
#   MINDER_HEADERS_DIR       where to write (default /etc/nginx/minder).
set -eu

dir=${MINDER_HEADERS_DIR:-/etc/nginx/minder}
headers="$dir/security-headers.conf"
referrer="$dir/referrer-policy.conf"
mkdir -p "$dir"
if [ ! -w "$dir" ]; then
  # e.g. a read-only root filesystem: keep the defaults written at build time.
  echo "security-headers: $dir not writable, keeping the image defaults"
  exit 0
fi

case "${CLIENT_SECURITY_HEADERS:-on}" in
[Oo][Ff][Ff] | [Ff][Aa][Ll][Ss][Ee] | 0 | [Nn][Oo])
  : >"$headers"
  : >"$referrer"
  echo "security-headers: off (CLIENT_SECURITY_HEADERS)"
  exit 0
  ;;
esac

# scheme://host[:port] only; anything else (a relative URL, junk) adds nothing.
api_origin=$(printf '%s' "${MINDER_API_BASE_URL:-}" |
  sed -nE 's#^(https?://[A-Za-z0-9.-]+(:[0-9]+)?)(/.*)?$#\1#p')

# The built app loads its scripts, styles and fonts from this origin, calls the
# gateway with fetch(), shows plugin screenshots from https: URLs and plays
# blob: audio. React's style props go through the CSSOM, which style-src
# doesn't restrict, so no 'unsafe-inline' is needed.
default_csp="default-src 'self'; script-src 'self'; style-src 'self'; \
img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; \
connect-src 'self'${api_origin:+ $api_origin}; object-src 'none'; base-uri 'self'; \
form-action 'self'; frame-ancestors 'none'"

# The value goes inside a double-quoted nginx string: drop what could end it
# or be read as an nginx variable.
csp=$(printf '%s' "${CLIENT_CSP:-$default_csp}" | tr -d '"$\\{}\r\n')

cat >"$headers" <<EOF
add_header Content-Security-Policy "$csp" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Strict-Transport-Security \$minder_hsts always;
EOF
echo 'add_header Referrer-Policy no-referrer always;' >"$referrer"
echo "security-headers: on (connect-src adds: ${api_origin:-nothing})"
