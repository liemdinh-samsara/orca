import {
  isEligibleLocalCertificateHost,
  isValidDnsName,
  normalizeCertificateHostname
} from './browser-url'

// Why: Samsara devboxes serve dev servers on their own hostnames with self-signed localhost certificates.
const PROCEED_ELIGIBLE_HOST_SUFFIXES = ['.devbox.internal.samsara.com']

/** Hosts whose untrusted-authority certificate warning offers "Proceed Anyway". */
export function isCertificateProceedEligibleHost(hostname: string): boolean {
  if (isEligibleLocalCertificateHost(hostname)) {
    return true
  }
  const normalized = normalizeCertificateHostname(hostname)
  return (
    isValidDnsName(normalized) &&
    PROCEED_ELIGIBLE_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  )
}
