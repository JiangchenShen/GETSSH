/**
 * Light Physics Engine for MOOVIER SUPREME (Chapter 0.4: Rim Lighting)
 * 
 * Calculates dynamic `box-shadow: inset` values for 3D rim lighting.
 */

export interface LightPhysicsConfig {
  rect: DOMRect | null;          // The bounding rect of the Tile
  lightPosition: { x: number, y: number } | null; // The global cursor/light position
  interactionMultiplier: number; // 1.0 (Default), 1.5 (Hover), 2.0 (Drag)
}

export const calculateRimLight = ({ rect, lightPosition, interactionMultiplier }: LightPhysicsConfig): string => {
  // Baseline (Static Top-Left 45°) as defined in 0.4.3
  const BASE_TOP = 0.15; // 15%
  const BASE_LEFT = 0.08; // 8%
  const BASE_RIGHT = 0.12; // 12% (Dark Shadow)

  let topOpacity = BASE_TOP;
  let leftOpacity = BASE_LEFT;
  let rightOpacity = BASE_RIGHT;

  // If we have a rect and a dynamic light position (Cursor Tracking)
  if (rect && lightPosition) {
    const tileCenterX = rect.left + rect.width / 2;
    const tileCenterY = rect.top + rect.height / 2;

    const dx = lightPosition.x - tileCenterX;
    const dy = lightPosition.y - tileCenterY;

    // Normalize light direction vector (-1 to 1)
    // We add a virtual Z-depth to the light so it's never purely edge-on (prevents harsh pop-ins)
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = 1000; // Light decay distance
    
    const intensityFactor = Math.max(0, 1 - distance / maxDistance);

    // X axis (Left/Right edges)
    if (dx < 0) {
      // Light is to the left: Left edge gets brighter
      leftOpacity = BASE_LEFT + (0.10 * intensityFactor);
      rightOpacity = BASE_RIGHT; // Right is shadowed
    } else {
      // Light is to the right: Left edge loses light, Right edge gets some light instead of shadow?
      // According to spec, rim light is white reflection. If light hits right side, right side should reflect white!
      leftOpacity = BASE_LEFT * 0.3; // almost gone
      rightOpacity = 0.05 + (0.08 * intensityFactor); // Right gets a white rim light instead of dark!
    }

    // Y axis (Top edge)
    if (dy < 0) {
      // Light is above: Top edge gets brighter
      topOpacity = BASE_TOP + (0.12 * intensityFactor);
    } else {
      // Light is below: Top edge loses light
      topOpacity = BASE_TOP * 0.4;
    }
  }

  // Apply Interaction Multiplier (Hover/Drag)
  topOpacity = Math.min(0.5, topOpacity * interactionMultiplier);
  leftOpacity = Math.min(0.4, leftOpacity * interactionMultiplier);
  
  // Right opacity behavior switches if light is from the right
  const rightRimColor = (rect && lightPosition && lightPosition.x > rect.left + rect.width / 2) 
    ? `rgba(255, 255, 255, ${rightOpacity.toFixed(3)})` // White reflection if light from right
    : `rgba(0, 0, 0, ${(rightOpacity * interactionMultiplier).toFixed(3)})`; // Dark shadow otherwise

  // Construct the CSS multiple inset box-shadow
  // Top: inset 0 1px 0 rgba(255,255,255, alpha)
  // Left: inset 1px 0 0 rgba(255,255,255, alpha)
  // Right: inset -1px 0 0 [Dark or White depending on light direction]
  return `inset 0 1px 0 rgba(255, 255, 255, ${topOpacity.toFixed(3)}), inset 1px 0 0 rgba(255, 255, 255, ${leftOpacity.toFixed(3)}), inset -1px 0 0 ${rightRimColor}`;
};
