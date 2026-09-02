const MIN_CAMERA_RADIUS = 9;
const MAX_CAMERA_RADIUS = 900;

export function clampCameraRadius(radius) {
  return Math.max(MIN_CAMERA_RADIUS, Math.min(MAX_CAMERA_RADIUS, radius));
}

export function zoomRadiusFromPinch(radius, previousDistance, nextDistance) {
  if (previousDistance <= 0 || nextDistance <= 0) return radius;
  return clampCameraRadius(radius * (previousDistance / nextDistance));
}
