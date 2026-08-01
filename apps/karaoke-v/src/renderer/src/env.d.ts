import type { StickStatus } from "../../shared/stick-status"

declare global {
  interface Window {
    stick: {
      onStatus(callback: (status: StickStatus) => void): void
    }
  }
}
