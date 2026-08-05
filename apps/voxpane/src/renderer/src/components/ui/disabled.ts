import { createContext, useContext } from "react"

export const DisabledContext = createContext(false)

export function useDisabled(own?: boolean): boolean {
  const inherited = useContext(DisabledContext)
  return Boolean(own) || inherited
}
