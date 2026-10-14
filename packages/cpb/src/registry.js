/**
 * CPB's two registries (draft §13.1 and §13.2).
 *
 * The rule that matters for verification: a verifier resolves a reference's
 * digest context from the reference's `type`, looked up here — never from a
 * field sitting next to it in the document. Otherwise a producer could declare
 * its own digest rule inline and a verifier would obligingly follow it.
 *
 * Canonicalization Algorithm Registry entries are immutable. New behavior
 * requires a new entry, never a retroactive edit to an existing one.
 */

/** §13.1 — Canonicalization Algorithm Registry. */
export const CANONICALIZATION_ALGORITHMS = Object.freeze({
  jcs: Object.freeze({
    name: 'jcs',
    description: 'RFC 8785 JCS; SHA-256; lowercase hex.',
    normalize: false,
    reference: 'RFC 8785',
  }),
  'jcs-n': Object.freeze({
    name: 'jcs-n',
    description:
      'RFC 8785 JCS over a normalized JSON object with null, empty-array and ' +
      'empty-object members removed bottom-up; SHA-256; lowercase hex.',
    normalize: true,
    reference: 'draft-mih-sokolov-scitt-payload-binding',
  }),
  'cde-n': Object.freeze({
    name: 'cde-n',
    description: 'CDE/dCBOR normalization; SHA-256. Reserved for a later revision.',
    normalize: true,
    reserved: true,
    reference: 'draft-mih-sokolov-scitt-payload-binding',
  }),
});

/**
 * §13.2 — Artifact Type Registry.
 *
 * Each entry pins a digest context: the exclusion set, the canonicalization
 * algorithm, and the output representation.
 *
 * `proposed: true` marks types this demo registers locally to test the seam the
 * AAIF brief proposes. They are NOT registered in any IETF registry, and the
 * dashboard labels them as such. The brief's own words: "Proposed integration
 * point for discussion, not a normative mapping in the current drafts."
 */
export const ARTIFACT_TYPES = Object.freeze({
  'agent-action-capsule': Object.freeze({
    name: 'agent-action-capsule',
    // Draft-05 §5.1: strip local composite envelope fields and capsule_id.
    // chain, references and all nested null/empty values remain committed.
    exclusionSet: ['capsule_id', 'signature', 'key_id'],
    algorithm: 'jcs',
    representation: '64-char lowercase hex',
    mediaType: 'application/agent-action-capsule+json',
    reference: 'draft-mih-scitt-agent-action-capsule',
  }),
  'cll-checkpoint': Object.freeze({
    name: 'cll-checkpoint',
    exclusionSet: [],
    algorithm: 'jcs',
    representation: '64-char lowercase hex',
    mediaType: 'application/cll-checkpoint+json',
    reference: 'draft-mih-scitt-checkpointed-local-log',
  }),

  // ---- Proposed, demo-local: the CIGAR artifacts the brief suggests AAC
  // ---- should *reference rather than duplicate*.
  'cigar-native-execution': Object.freeze({
    name: 'cigar-native-execution',
    exclusionSet: [],
    // Native CIGAR null/empty fields can carry meaning. Never normalize them.
    algorithm: 'jcs',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-native-execution+json',
    reference: 'PROPOSED — hol-cigar 0.14.0 demo binding',
    proposed: true,
  }),
  'cigar-context-bundle': Object.freeze({
    name: 'cigar-context-bundle',
    exclusionSet: ['bundle_digest'],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-context-bundle+json',
    reference: 'PROPOSED — hol.org/cigar',
    proposed: true,
  }),
  'cigar-selection-manifest': Object.freeze({
    name: 'cigar-selection-manifest',
    exclusionSet: ['manifest_digest'],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-selection-manifest+json',
    reference: 'PROPOSED — hol.org/cigar',
    proposed: true,
  }),
  'cigar-signed-handoff': Object.freeze({
    name: 'cigar-signed-handoff',
    // Nothing excluded: the whole point of citing a handoff as the CAN member
    // is that it is bound exactly as transmitted, byte-identically.
    exclusionSet: [],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-signed-handoff+json',
    reference: 'PROPOSED — hol.org/cigar',
    proposed: true,
  }),
  'cigar-effect-ledger': Object.freeze({
    name: 'cigar-effect-ledger',
    exclusionSet: [],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-effect-ledger+json',
    reference: 'PROPOSED — hol.org/cigar',
    proposed: true,
  }),
  'cigar-decision-environment': Object.freeze({
    name: 'cigar-decision-environment',
    exclusionSet: ['env_digest'],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/cigar-decision-environment+json',
    reference: 'PROPOSED — hol.org/cigar',
    proposed: true,
  }),
  'aac-who': Object.freeze({
    name: 'aac-who',
    exclusionSet: [],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/aac-who+json',
    reference: 'PROPOSED — draft-mih-sato-agent-accountability-composition',
    proposed: true,
  }),
  'aac-did': Object.freeze({
    name: 'aac-did',
    exclusionSet: [],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/aac-did+json',
    reference: 'PROPOSED — draft-mih-sato-agent-accountability-composition',
    proposed: true,
  }),
  'aac-audit': Object.freeze({
    name: 'aac-audit',
    exclusionSet: [],
    algorithm: 'jcs-n',
    representation: '64-char lowercase hex',
    mediaType: 'application/aac-audit+json',
    reference: 'PROPOSED — draft-mih-sato-agent-accountability-composition',
    proposed: true,
  }),
});

export function lookupArtifactType(type) {
  const entry = ARTIFACT_TYPES[type];
  if (!entry) {
    throw new Error(
      `unknown artifact type "${type}" — a verifier must not guess a digest context`,
    );
  }
  return entry;
}

export function lookupAlgorithm(name) {
  const entry = CANONICALIZATION_ALGORITHMS[name];
  if (!entry) throw new Error(`unknown canonicalization algorithm "${name}"`);
  if (entry.reserved) throw new Error(`canonicalization algorithm "${name}" is reserved`);
  return entry;
}
