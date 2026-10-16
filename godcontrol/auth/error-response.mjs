export function authorizationErrorResponse(error, res, layout) {
  const staleInteraction = error?.name === 'SessionNotFound';
  const status = staleInteraction ? 400 : 500;
  const title = staleInteraction ? 'Authorization request expired' : 'Authorization error';
  const body = staleInteraction
    ? '<h1>Authorization request expired</h1><p>This authorization request was already completed or is no longer valid. Return to ChatGPT and start a new connection.</p>'
    : '<h1>Authorization could not continue</h1><p>Please return to ChatGPT and try connecting again.</p>';
  return res.status(status).type('html').send(layout(title, body));
}
