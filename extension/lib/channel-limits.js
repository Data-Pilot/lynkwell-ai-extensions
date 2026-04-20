/**
 * LinkedIn-style character caps used for prompts + the side-panel counter.
 *
 * Sources (verify periodically — LinkedIn can change UI caps):
 * - Connection personalized note: 200 (free) / 300 (some paid) — we use 200 so drafts paste safely for most accounts.
 * - InMail: https://www.linkedin.com/help/linkedin/answer/a411986 — subject 200, body 1,900 (counted separately; same numbers on Sales Navigator Help). Another Help article (Send an InMail) has said 2,000 body — we keep 1,900 so drafts stay within the dedicated “character limits” spec.
 * - DM (1st-degree messaging): commonly cited as 3,000 characters per composer message; not repeated on every Help page — adjust if your LinkedIn surface differs.
 */
var REACH_CHANNEL_LIMITS = {
  connection: 200,
  message: 3000,
  inmailSubjectMax: 200,
  inmailBodyMax: 1900
};
