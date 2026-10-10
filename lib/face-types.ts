export const FACE_CHALLENGE_STEPS = ["blink", "turn-left", "turn-right", "center"] as const;

export const FACE_TEMPLATE_ROLES = ["desktop-primary", "mobile-primary", "canonical-cross-device"] as const;
export const FACE_DESCRIPTOR_ENGINES = ["human-webgl-v1", "human-wasm-v1"] as const;
export const FACE_DEVICE_CLASSES = ["desktop", "mobile"] as const;
export const FACE_MODEL_VERSION = "human-3.3.6-faceres-1024-v1" as const;

export type FaceChallengeStep = (typeof FACE_CHALLENGE_STEPS)[number];

export type FaceChallengeMode = "register" | "enroll" | "verify";

export type FaceTemplateRole = (typeof FACE_TEMPLATE_ROLES)[number];

export type FaceDescriptorEngine = (typeof FACE_DESCRIPTOR_ENGINES)[number];

export type FaceDeviceClass = (typeof FACE_DEVICE_CLASSES)[number];

export type FaceEvidence = {
  startedAt: number;
  completedAt: number;
  completedSteps: FaceChallengeStep[];
  sampleCount: number;
  averageReal: number;
  averageLive: number;
};

export type FaceCapturePayload = {
  templateRole: FaceTemplateRole;
  descriptorEngine: FaceDescriptorEngine;
  modelVersion: typeof FACE_MODEL_VERSION;
  sourceDeviceClass: FaceDeviceClass;
  embedding: number[];
  challengeToken: string;
  evidence: FaceEvidence;
};

export type FaceChallengeResponse = {
  ok: true;
  token: string;
  steps: FaceChallengeStep[];
  expiresAt: number;
};

export function expectedEngineForRole(role: FaceTemplateRole): FaceDescriptorEngine {
  return role === "desktop-primary" ? "human-webgl-v1" : "human-wasm-v1";
}
