export type StickStatus =
  | { state: "attached"; mode: "ax" | "poll" }
  | { state: "waiting" }
  | { state: "hidden" }
  | { state: "permission" }
  | { state: "unsupported" }
