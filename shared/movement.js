export function horizontalVelocity(yaw, forwardInput, sideInput, speed) {
  const length = Math.hypot(forwardInput, sideInput) || 1;
  const f = forwardInput / length;
  const s = sideInput / length;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: (s * cos - f * sin) * speed,
    z: (-s * sin - f * cos) * speed,
  };
}
