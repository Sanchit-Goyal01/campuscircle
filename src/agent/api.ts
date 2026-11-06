const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isActionId = (id: string) => UUID.test(id);

export const INVALID_ACTION_STATE = 'invalid_action_state';

export const errorResponse = (status: number, error: string) => Response.json({ error }, { status });

export const signedOut = () => errorResponse(401, 'Sign in to continue.');
export const badActionId = () => errorResponse(400, 'That action id is not valid.');
export const actionClosed = () => errorResponse(409, 'This action can no longer be changed.');

/** Logs the real cause and answers with a plain message: no stack or SQL text reaches the client. */
export function unexpected(route: string, e: unknown) {
  console.error(route, e);
  return errorResponse(500, 'Something went wrong. Please try again.');
}
