export const PLAYER = {
  height: 1.75,
  eyeHeight: 1.62,
  radius: 0.35,
  walkSpeed: 4.6,
  sprintSpeed: 7.6,
  adsSpeed: 2.6,
  jumpVelocity: 6.2,
  gravity: -18,
  groundAccel: 12,
  airAccel: 3,
  mouseSensitivity: 0.0022,
  adsSensitivityScale: 0.6,
} as const;

export const CAMERA = {
  fov: 75,
  adsFov: 55,
  near: 0.05,
  far: 400,
} as const;

export const VIEWMODEL = {
  fov: 68,
  adsTime: 0.14,
} as const;

export const WORLD_COLORS = {
  sky: 0xd6dde6,
  fogNear: 45,
  fogFar: 150,
} as const;
