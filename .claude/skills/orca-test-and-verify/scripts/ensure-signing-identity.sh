#!/usr/bin/env bash
# Creates the self-signed "Orca Local Signing" code-signing identity in the login keychain if missing.
# Why: ad-hoc signing (`--sign -`) ties macOS trust to each build's content hash, so the
# "orca Safe Storage" keychain prompt returns after every reinstall even with Always Allow.
set -euo pipefail
identity="${ORCA_LOCAL_SIGN_IDENTITY:-Orca Local Signing}"

if security find-identity -p codesigning 2>/dev/null | grep -qF "\"$identity\""; then
  echo "signing identity present: $identity"
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/orca-signing.XXXXXX")"
trap 'rm -f "$work/key.pem" "$work/id.p12"' EXIT
cat > "$work/cs.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = ext
prompt = no
[ dn ]
CN = $identity
[ ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cs.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
# One-off password for the transient .p12 only; never printed, file deleted on exit.
P12PASS="$(openssl rand -hex 16)"
export P12PASS
openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$identity" \
  -out "$work/id.p12" -passout env:P12PASS -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
security import "$work/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$P12PASS" -T /usr/bin/codesign
unset P12PASS
echo "created signing identity: $identity (the next Orca launch asks for keychain access once; click Always Allow)"
