/**
 * Host half of the two-pane sidebar bundle.
 *
 * The split is a pure Client-side layout concern: `client.js` renders the
 * plugin rail into the frame's `shell.overlay` seat and reserves its width with
 * one left padding on the frame element, leaving the shipped `sidebar` slot
 * (and the workspace browser inside it) untouched. Nothing runs on the Host, so
 * this apply is intentionally empty.
 */
export function apply() {}
