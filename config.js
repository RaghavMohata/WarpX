/* WarpX local configuration — committed to the repo on purpose.

   A Web OAuth Client ID is public by design: Google renders it into every page
   for every visitor to read, so keeping it here is safe and saves typing an
   environment variable on every launch.

   A Client SECRET is a different thing entirely. It is NOT needed for the
   "Sign in with Google" button flow (which verifies a signed ID token, never
   exchanging an authorization code), and it must never be put in this file or
   anywhere else in this repository. */

module.exports = {
  /* From the Google Cloud Console → Credentials → OAuth 2.0 Client IDs.
     Leave it empty and the button never renders — the site behaves exactly as
     it does without Google sign-in. */
  GOOGLE_CLIENT_ID: "271784652438-b3dihv1ltakiqilr3lago1n1brvrrfrh.apps.googleusercontent.com",
};
