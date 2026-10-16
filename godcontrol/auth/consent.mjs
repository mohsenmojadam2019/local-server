export async function saveConsentGrant(provider, details) {
  const { prompt: { details: missing }, params, session } = details;
  let grantId = details.grantId;
  const grant = grantId ? await provider.Grant.find(grantId) : new provider.Grant({
    accountId: session.accountId,
    clientId: params.client_id,
  });

  if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(' '));
  if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
  if (missing.missingResourceScopes) {
    for (const [indicator, scopes] of Object.entries(missing.missingResourceScopes)) {
      grant.addResourceScope(indicator, scopes.join(' '));
    }
  }
  grantId = await grant.save();
  return grantId;
}
