export const SESSION_COOKIE_NAME = "__Host-ll_session";

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "strict" as const,
  secure: true,
};
