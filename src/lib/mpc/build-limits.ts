// Limits for "Build profile", shared by the server action and the Add MPC screen.

/**
 * Every source travels in one server action request, and Next caps a request at 11 MB
 * (next.config.ts). The sources together must stay under that, with room for the form overhead.
 */
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCES = 20;
export const TOO_BIG_TOGETHER =
  "These files add up to more than 10 MB. Build the profile from fewer files, then add the rest on its page.";
export const TOO_MANY = "Add up to 20 documents at a time. Add the rest on the profile page.";
