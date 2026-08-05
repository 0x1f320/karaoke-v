// Accessibility is the only permission the app needs, and only on macOS: the
// piano roll is read through the AX tree there, while the Windows helper gets
// the same data from UI Automation, which no user grant gates.
//
// Screen Recording is deliberately absent. The occlusion check reads window
// bounds, pid and layer out of CGWindowList, none of which that permission
// covers — it gates window titles and pixel capture, which nothing here reads.

export type PermissionKey = "accessibility"

export interface PermissionsStatus {
  accessibility: boolean
}
