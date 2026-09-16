const source = (id, path, text) => ({
  id,
  path,
  category: 'code',
  oldStart: 1,
  oldEnd: 4,
  newStart: 1,
  newEnd: 4,
  added: 1,
  removed: 1,
  text,
});

export const cases = [
  {
    name: 'expiry-boundary',
    question:
      'What exact behavior changed at the expiry boundary? Cite the relevant source and suggest a focused test.',
    expected:
      'At expiresAt === now, an expired session now returns its user. Test equality as well as times just before and after expiry.',
    sources: [
      source(
        'S1',
        'src/session.ts',
        ' R1 export function validateSession(session, now) {\n-L2   if (session.expiresAt <= now) return null;\n+R2   if (session.expiresAt < now) return null;\n R3   return session.user;\n R4 }\n',
      ),
    ],
  },
  {
    name: 'tenant-guard',
    question:
      'Does this change still reject requests to a different organization? Identify the changed behavior and a regression test. Cite the code.',
    expected:
      'Changing OR to AND allows an active token from the wrong organization, and a revoked token from the right organization. Either condition must reject.',
    sources: [
      source(
        'S2',
        'src/scim/authorize.ts',
        ' R1 export function authorize(token, organizationId) {\n-L2   if (token.revoked || token.organizationId !== organizationId) return false;\n+R2   if (token.revoked && token.organizationId !== organizationId) return false;\n R3   return true;\n R4 }\n',
      ),
    ],
  },
  {
    name: 'missing-evidence',
    question:
      'Does the SAML callback validate signatures and prevent replay attacks? Cite the implementation or say what evidence is missing.',
    expected:
      'The supplied session expiry function does not establish anything about SAML signatures or replay protection. Ask for callback verification code.',
    sources: [
      source(
        'S3',
        'src/session.ts',
        ' R1 export function validateSession(session, now) {\n-L2   if (session.expiresAt <= now) return null;\n+R2   if (session.expiresAt < now) return null;\n R3   return session.user;\n R4 }\n',
      ),
    ],
  },
];
