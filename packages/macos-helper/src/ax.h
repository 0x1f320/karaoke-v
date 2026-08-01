// Shared Accessibility helpers for the macOS addon.
#pragma once

#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>

// Read an element's screen frame (top-left origin, global points). Returns false
// if the element has no position/size.
static inline bool axFrame(AXUIElementRef el, CGRect *out) {
  CFTypeRef posVal = nullptr;
  CFTypeRef sizeVal = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXPositionAttribute, &posVal) != kAXErrorSuccess ||
      AXUIElementCopyAttributeValue(el, kAXSizeAttribute, &sizeVal) != kAXErrorSuccess) {
    if (posVal) CFRelease(posVal);
    if (sizeVal) CFRelease(sizeVal);
    return false;
  }
  CGPoint p = CGPointZero;
  CGSize s = CGSizeZero;
  AXValueGetValue((AXValueRef)posVal, kAXValueTypeCGPoint, &p);
  AXValueGetValue((AXValueRef)sizeVal, kAXValueTypeCGSize, &s);
  CFRelease(posVal);
  CFRelease(sizeVal);
  *out = CGRectMake(p.x, p.y, s.width, s.height);
  return true;
}
