type AuthErrorLike = { message?: string; code?: string; status?: number };

export const NOT_REGISTERED = "Your college is not registered yet.";
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Local Supabase returns HTTP 500 with message "Database error saving new user"
 * (no code) when the signup trigger raises college_not_registered.
 */
export function signUpErrorMessage(error: AuthErrorLike): string {
  const message = error.message ?? "";
  if (/college_not_registered/i.test(message) || /database error saving new user/i.test(message)) {
    return NOT_REGISTERED;
  }
  if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return "An account with this email already exists. Try signing in.";
  }
  if (error.code === "weak_password") {
    return "Choose a stronger password (at least 8 characters).";
  }
  if (error.status === 400 || error.status === 422) {
    return "Could not create the account. Check your details and try again.";
  }
  return GENERIC_ERROR;
}

export function signInErrorMessage(error: AuthErrorLike): string {
  if (error.code === "email_not_confirmed") {
    return "Please confirm your email before signing in. Check your inbox.";
  }
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (error.code === "invalid_credentials" || (!error.code && (error.status === 400 || error.status === 401))) {
    return "Incorrect email or password.";
  }
  return GENERIC_ERROR;
}
