import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLinkParams } from "./auth-params.ts";

test("flux implicite : jetons dans le fragment", () => {
  const p = parseLinkParams("postbiz://auth-callback#access_token=abc.def&refresh_token=xyz&type=recovery&expires_in=3600");
  assert.equal(p.access_token, "abc.def");
  assert.equal(p.refresh_token, "xyz");
  assert.equal(p.type, "recovery");
});

test("flux PKCE : code dans la requête", () => {
  assert.equal(parseLinkParams("exp://192.168.1.5:8081/--/auth-callback?code=1234-abcd").code, "1234-abcd");
});

test("erreur Supabase : description décodée", () => {
  const p = parseLinkParams("postbiz://auth-callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(p.error_code, "otp_expired");
  assert.equal(p.error_description, "Email link is invalid or has expired");
});

test("lien sans paramètres", () => {
  assert.deepEqual(parseLinkParams("postbiz://auth-callback"), {});
});
