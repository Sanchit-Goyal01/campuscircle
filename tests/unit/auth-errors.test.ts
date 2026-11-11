import { describe, expect, it } from "vitest";
import { signInErrorMessage, signUpErrorMessage } from "@/lib/auth-errors";

describe("signUpErrorMessage", () => {
  it("maps college_not_registered", () => {
    expect(signUpErrorMessage({ message: "college_not_registered", status: 500 })).toBe(
      "Your college is not registered yet.",
    );
  });
  it("maps the auth server failed-user-insert message", () => {
    expect(signUpErrorMessage({ message: "Database error saving new user", status: 500 })).toBe(
      "Your college is not registered yet.",
    );
  });
  it("does not map other 500s", () => {
    expect(signUpErrorMessage({ message: "upstream exploded", status: 500 })).toBe(
      "Something went wrong. Please try again.",
    );
  });
  it("handles rate limits and existing users", () => {
    expect(signUpErrorMessage({ status: 429, code: "over_request_rate_limit" })).toMatch(/Too many/);
    expect(signUpErrorMessage({ status: 422, code: "user_already_exists" })).toMatch(/already exists/);
  });
});

describe("signInErrorMessage", () => {
  it("shows the credentials message only for invalid credentials", () => {
    expect(signInErrorMessage({ code: "invalid_credentials", status: 400 })).toBe("Incorrect email or password.");
  });
  it("handles unconfirmed email", () => {
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 400 })).toMatch(/confirm your email/);
  });
  it("handles rate limit and server errors", () => {
    expect(signInErrorMessage({ status: 429 })).toMatch(/Too many/);
    expect(signInErrorMessage({ status: 500 })).toBe("Something went wrong. Please try again.");
    expect(signInErrorMessage({ status: 503, message: "x" })).toBe("Something went wrong. Please try again.");
  });
});
