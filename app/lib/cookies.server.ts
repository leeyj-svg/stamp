import { createCookie } from "@remix-run/node";

const COOKIE_SECRET = process.env.COOKIE_SECRET?.trim();

if (!COOKIE_SECRET) {
  throw new Error("COOKIE_SECRET is not set");
}

export const myPostsCookie = createCookie("my-posts", {
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  secrets: [COOKIE_SECRET],
});
