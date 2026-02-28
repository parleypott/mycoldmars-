import * as THREE from 'three';
import { latLonToVector3, GLOBE_RADIUS } from './geo-utils.js';

/**
 * Create a flat circular marker on the globe surface.
 */
function createMarkerMesh(color, opacity = 1.0) {
  const group = new THREE.Group();

  // Outer ring
  const ringGeom = new THREE.RingGeometry(0.06, 0.08, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  group.add(ring);

  // Inner dot
  const dotGeom = new THREE.CircleGeometry(0.03, 24);
  const dotMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const dot = new THREE.Mesh(dotGeom, dotMat);
  group.add(dot);

  return group;
}

/**
 * Orient a flat marker to sit on the globe surface at lat/lon, facing outward.
 */
function placeOnGlobe(group, lat, lon, liftFactor = 1.002) {
  const surfacePoint = latLonToVector3(lat, lon, GLOBE_RADIUS * liftFactor);
  group.position.copy(surfacePoint);

  // Look outward from center
  const outward = surfacePoint.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    outward
  );
  group.setRotationFromQuaternion(quaternion);
}

/**
 * Create a permanent pin marker.
 */
export function createPin(lat, lon, correct = false) {
  const color = correct ? 0x2ecc71 : 0xe74c3c;
  const marker = createMarkerMesh(color);
  placeOnGlobe(marker, lat, lon);

  // Start invisible for animation
  marker.scale.set(0.01, 0.01, 0.01);

  return marker;
}

/**
 * Animate a pin appearing with a clean scale-up.
 */
export function animatePinIn(pin, onComplete) {
  const duration = 350;
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // Smooth overshoot
    const ease = t < 1 ? 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.08 : 1;

    pin.scale.set(ease, ease, ease);

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      pin.scale.set(1, 1, 1);
      if (onComplete) onComplete();
    }
  }

  requestAnimationFrame(tick);
}

/**
 * Create a tentative pin (before confirmation).
 */
export function createTentativePin(lat, lon) {
  const marker = createMarkerMesh(0xffffff, 0.5);
  placeOnGlobe(marker, lat, lon);
  return marker;
}

/**
 * Create a directional arrow pointing from guessLatLon toward targetLatLon.
 * The arrow sits on the globe surface at the guess location.
 */
export function createDirectionArrow(guessLat, guessLon, targetLat, targetLon) {
  const group = new THREE.Group();

  // Arrow shape (flat triangle)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.14);
  shape.lineTo(-0.045, 0);
  shape.lineTo(0.045, 0);
  shape.closePath();

  const arrowGeom = new THREE.ShapeGeometry(shape);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xe74c3c,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const arrow = new THREE.Mesh(arrowGeom, arrowMat);
  // Offset arrow away from the center dot
  arrow.position.y = 0.12;
  group.add(arrow);

  // Position on globe
  placeOnGlobe(group, guessLat, guessLon);

  // Now rotate the arrow to point toward the target
  // We need to compute the bearing on the globe surface
  const bearing = computeBearing(guessLat, guessLon, targetLat, targetLon);

  // The arrow needs to rotate around the surface normal
  // After placeOnGlobe, the group's local Z points outward from globe
  // We rotate around Z to set bearing direction
  // Bearing: 0 = north (up on surface), clockwise
  // Our arrow points in local +Y, so rotation = -bearing
  group.children[0].rotation.z = -bearing;

  return group;
}

/**
 * Compute bearing from point A to point B (in radians, clockwise from north).
 */
function computeBearing(lat1, lon1, lat2, lon2) {
  const DEG2RAD = Math.PI / 180;
  const φ1 = lat1 * DEG2RAD;
  const φ2 = lat2 * DEG2RAD;
  const Δλ = (lon2 - lon1) * DEG2RAD;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return Math.atan2(y, x);
}
