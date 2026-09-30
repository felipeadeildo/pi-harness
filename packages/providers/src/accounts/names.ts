// Written into session files and into pi's status line, so these names stay stable.
export const NAME = "pi-providers";

/** The session entry that pins an account for the branch. */
export const SESSION_ENTRY = `${NAME}:accounts`;

/** What the look reads for the account the current model uses. */
export const STATUS_KEY = `${NAME}:account`;

/** The status while a provider login runs. */
export const LOGIN_KEY = `${NAME}:login`;
