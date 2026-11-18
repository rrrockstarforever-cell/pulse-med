/**
 * Licences a picture may be shown under: CC0 and public domain (no conditions), and CC BY and CC BY-SA (free to use when the
 * author and licence are credited, which every picture caption here does). Non-commercial (NC), no-derivatives (ND), unknown
 * and contradictory licences are refused.
 */
export type ReusableImageLicense = { label: 'CC0' | 'Public domain' | 'CC BY' | 'CC BY-SA'; url: string };

export interface LicensedImageFields {
  image?: string;
  imageCaption?: string;
  imageSourceUrl?: string;
  imageLicence?: string;
  imageLicenceUrl?: string;
  imageCredit?: string;
  imageId?: string;
  imageVerified?: boolean;
}

export function normalizeReusableImageLicense(label: unknown, url: unknown = ''): ReusableImageLicense | null {
  const name = String(label ?? '').trim();
  const link = String(url ?? '').trim();
  const linkKind = /creativecommons\.org\/licenses\/(by(?:-nc-sa|-nc-nd|-nc|-nd|-sa)?)\//i.exec(link)?.[1]?.toLowerCase() ?? '';
  // Non-commercial and no-derivatives terms are never accepted, whatever the label says.
  if (linkKind && linkKind !== 'by' && linkKind !== 'by-sa') return null;
  const plain = name.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  if (/\b(nc|nd|non ?commercial|no ?deriv\w*)\b/.test(plain)) return null;
  const labelKind = /^cc by sa\b/.test(plain) ? 'by-sa' : /^cc by\b/.test(plain) ? 'by' : '';
  if (labelKind) {
    // The label and the link must agree when both are present.
    if (linkKind && linkKind !== labelKind) return null;
    return { label: labelKind === 'by-sa' ? 'CC BY-SA' : 'CC BY', url: link };
  }
  if (!name && linkKind) return { label: linkKind === 'by-sa' ? 'CC BY-SA' : 'CC BY', url: link };
  // A CC0 or public-domain label that points at a CC BY page contradicts itself.
  if (linkKind) return null;
  const labelIsCC0 = /^cc0(?:\b|\s)/i.test(name);
  // Commons marks works released by museums and agencies as "No restrictions"; those are public domain.
  const labelIsPublicDomain = /\bpublic domain\b|^pd(?:[-\s]|$)|^no restrictions$/i.test(name);
  if (name && !labelIsCC0 && !labelIsPublicDomain) return null;
  if (labelIsCC0 || (!name && /creativecommons\.org\/publicdomain\/zero(?:\/|$)/i.test(link))) {
    return { label: 'CC0', url: link };
  }
  if (labelIsPublicDomain || (!name && /creativecommons\.org\/publicdomain\/mark(?:\/|$)/i.test(link))) {
    return { label: 'Public domain', url: link };
  }
  return null;
}

export function stripUnlicensedImageFields<T extends LicensedImageFields>(record: T): T {
  if (!record.image || normalizeReusableImageLicense(record.imageLicence, record.imageLicenceUrl)) return record;
  return {
    ...record,
    image: undefined,
    imageCaption: undefined,
    imageSourceUrl: undefined,
    imageLicence: undefined,
    imageLicenceUrl: undefined,
    imageCredit: undefined,
    imageId: undefined,
    imageVerified: undefined,
  };
}
