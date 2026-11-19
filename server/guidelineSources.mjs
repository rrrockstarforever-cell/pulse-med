// Official and trusted websites per subject, used to look for CURRENT guidelines, regimens, doses, criteria and schedules.
// Built from lists written by DeepSeek workers (2026-11-19); each domain was checked to answer, except Indian government
// sites that refuse automated requests. Order inside a subject is the order of priority: Indian official bodies and the
// guideline-issuing societies first. A subject that matches no line falls back to GENERAL_OFFICIAL.
// Edit this file to add or remove a site; nothing else needs to change.
export const SUBJECT_OFFICIAL_SOURCES = [
  [/forensic|toxicolog|preventive|social|community|\bpsm\b/i, ["ncvbdc.mohfw.gov.in","dghs.mohfw.gov.in","tbcindia.mohfw.gov.in","mohfw.gov.in","nhm.gov.in","ncdc.gov.in","ncrb.gov.in","nha.gov.in","nmc.org.in","indiacode.nic.in","nhp.gov.in","icmr.gov.in","naco.gov.in","fssai.gov.in","who.int","rchiips.org","unicef.org"]],
  [/surg|orthop|trauma|burn/i, ["facs.org","ameriburn.org","thyroid.org","nccn.org","fascrs.org","vascular.org","auanet.org","aofoundation.org","americanherniasociety.org","ota.org"]],
  [/obstet|gynae|gynec|pediatric|paediatric|neonat/i, ["dghs.mohfw.gov.in","fogsi.org","iapindia.org","nnfi.org","mohfw.gov.in","nhm.gov.in","wcd.nic.in","who.int","unicef.org","figo.org","rcog.org.uk","acog.org","aap.org","nice.org.uk"]],
  [/ophthalm|\bENT\b|oto-?rhino|otolaryng|eye/i, ["aios.org","mohfw.gov.in","aoiindia.org","nhp.gov.in","aao.org","icoph.org","entnet.org","who.int","nih.gov","cochranelibrary.com"]],
  [/dermat|venereol|leprosy|psychiatr|anesth|anaesth|radio/i, ["dghs.mohfw.gov.in","iadvl.org","nlep.nic.in","naco.gov.in","mohfw.gov.in","indianpsychiatricsociety.org","iria.org.in","aerb.gov.in","nimhans.ac.in","ijaweb.org","who.int","psychiatry.org","asahq.org","das.uk.com","acr.org"]],
  [/medicine|cardio|nephro|endocrin|neuro|respirat|gastro|haemat|hemat|infect|critical/i, ["ncvbdc.mohfw.gov.in","ncdc.mohfw.gov.in","tbcindia.mohfw.gov.in","heart.org","acc.org","icmr.gov.in","tbcindia.gov.in","naco.gov.in","mohfw.gov.in","who.int","escardio.org","kdigo.org","diabetes.org","ginasthma.org","goldcopd.org","idsociety.org","sccm.org","rheumatology.org","aasld.org","hematology.org","eso-stroke.org"]],
  [/pharmacolog/i, ["dghs.mohfw.gov.in","tbcindia.mohfw.gov.in","cdsco.gov.in","ipc.gov.in","mohfw.gov.in","naco.gov.in","icmr.gov.in","nhm.gov.in","who.int","nice.org.uk","fda.gov","medlineplus.gov","msdmanuals.com","cochranelibrary.com"]],
  [/patholog|microbiolog/i, ["ncdc.mohfw.gov.in","icmr.gov.in","ncdc.gov.in","who.int","cdc.gov","idsociety.org","clsi.org","eucast.org","hematology.org","cap.org","aaaai.org","asm.org"]],
  [/physiolog|biochem/i, ["who.int","nice.org.uk","ifcc.org","diabetes.org","endocrine.org","mayocliniclabs.com","nih.gov","medlineplus.gov","omim.org"]],
  [/anatom|embryolog|histolog/i, ["nih.gov","genome.gov","omim.org","medlineplus.gov","anatomy.org","radiopaedia.org"]],
];

/** Sites every subject may use when the subject is unknown (the free tutor chat). */
export const GENERAL_OFFICIAL = ['who.int', 'mohfw.gov.in', 'icmr.gov.in', 'nice.org.uk', 'cdc.gov', 'nih.gov', 'dghs.mohfw.gov.in'];

/** Every listed site, as one pattern, so the ranker can tell an official page from a blog. */
export const OFFICIAL_HOST_PATTERN = new RegExp('(' + ["ncvbdc.mohfw.gov.in","dghs.mohfw.gov.in","tbcindia.mohfw.gov.in","mohfw.gov.in","nhm.gov.in","ncdc.gov.in","ncrb.gov.in","nha.gov.in","nmc.org.in","indiacode.nic.in","nhp.gov.in","icmr.gov.in","naco.gov.in","fssai.gov.in","who.int","rchiips.org","unicef.org","facs.org","ameriburn.org","thyroid.org","nccn.org","fascrs.org","vascular.org","auanet.org","aofoundation.org","americanherniasociety.org","ota.org","fogsi.org","iapindia.org","nnfi.org","wcd.nic.in","figo.org","rcog.org.uk","acog.org","aap.org","nice.org.uk","aios.org","aoiindia.org","aao.org","icoph.org","entnet.org","nih.gov","cochranelibrary.com","iadvl.org","nlep.nic.in","indianpsychiatricsociety.org","iria.org.in","aerb.gov.in","nimhans.ac.in","ijaweb.org","psychiatry.org","asahq.org","das.uk.com","acr.org","ncdc.mohfw.gov.in","heart.org","acc.org","tbcindia.gov.in","escardio.org","kdigo.org","diabetes.org","ginasthma.org","goldcopd.org","idsociety.org","sccm.org","rheumatology.org","aasld.org","hematology.org","eso-stroke.org","cdsco.gov.in","ipc.gov.in","fda.gov","medlineplus.gov","msdmanuals.com","cdc.gov","clsi.org","eucast.org","cap.org","aaaai.org","asm.org","ifcc.org","endocrine.org","mayocliniclabs.com","omim.org","genome.gov","anatomy.org","radiopaedia.org"].map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i');

/** The sites for a subject, best first. */
export function officialDomainsFor(subject) {
  const s = String(subject || '');
  const hit = SUBJECT_OFFICIAL_SOURCES.find(([re]) => re.test(s));
  return hit ? hit[1] : GENERAL_OFFICIAL;
}

/** True when the page's host is one of the listed official sites (or a sub-domain of one). */
export function isOfficialHost(url) {
  try {
    return OFFICIAL_HOST_PATTERN.test(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}
