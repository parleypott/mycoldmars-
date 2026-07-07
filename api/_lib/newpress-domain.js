// Re-export shim — the real predicate lives in shared/newpress-domain.js. It moved OUT of
// api/_lib because the client (scripts-library/src/auth.js) imports it too, and the vite DEV
// server's /api middleware shadows any /api/* module URL (the request never reaches the file
// → 404 → the whole auth module graph dies → blank page in dev; production builds were fine
// because vite inlines the import at bundle time). Server code keeps importing from here.
export { SIGNUP_DOMAIN, isNewpressEmail } from '../../shared/newpress-domain.js';
