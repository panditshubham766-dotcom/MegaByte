import path from 'path';
import url from 'url';
import fs from 'fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// Patch global fetch for file:// URLs in Node (needed by Human in Node 20+)
const origFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const str = input.toString();
  if (str.startsWith('file:')) {
    const filePath = url.fileURLToPath(str);
    const buffer = await fs.promises.readFile(filePath);
    return new Response(buffer);
  }
  return origFetch(input, init);
};

// @ts-ignore
const H = require(path.resolve(__dirname, '../../node_modules/@vladmandic/human/dist/human.node-wasm.js'));

const wasmPath = path.resolve(__dirname, '../../node_modules/@tensorflow/tfjs-backend-wasm/dist') + path.sep;
const modelsDir = path.resolve(__dirname, '../../node_modules/@vladmandic/human/models');
const modelBasePath = url.pathToFileURL(modelsDir).href + '/';

// Fast instance: detector + mesh only for rapid multi-frame pose/yaw detection
const poseConfig = {
  modelBasePath,
  wasmPath,
  backend: 'wasm',
  debug: false,
  face: {
    enabled: true,
    detector: { enabled: true },
    mesh: { enabled: true },
    description: { enabled: false },
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false }
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false }
};

// Full instance: detector + mesh + description + antispoof + liveness for Stage 2 & Stage 3 frontal frame check
const fullConfig = {
  modelBasePath,
  wasmPath,
  backend: 'wasm',
  debug: false,
  face: {
    enabled: true,
    detector: { enabled: true },
    mesh: { enabled: true },
    description: { enabled: true },
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true }
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false }
};

const humanPose = new H.Human(poseConfig);
const humanFull = new H.Human(fullConfig);

let initPromise: Promise<void> | null = null;
export async function initFaceService(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await Promise.all([humanPose.load(), humanFull.load()]);
    })();
  }
  await initPromise;
}

// Start loading models once at startup
initFaceService().catch((err: any) => console.error('Error loading face models:', err));

export type FaceErrorCode = 'NO_FACE' | 'MULTIPLE_FACES' | 'LIVENESS_FAILED';

export class FaceError extends Error {
  code: FaceErrorCode;
  constructor(code: FaceErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, FaceError.prototype);
  }
}

export function decodeImage(buffer: Buffer): { data: Uint8Array | Buffer; width: number; height: number } {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  const decoded = jpeg.decode(buffer, { useTArray: true });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

/**
 * Human's yaw sign convention:
 * - Turning head to student's own LEFT: yaw is NEGATIVE (< -0.35 rad)
 * - Turning head to student's own RIGHT: yaw is POSITIVE (> +0.35 rad)
 *
 * In Human's 3D facemesh, canonical coordinates have Z pointing into the screen for points further from camera.
 * When the student turns their head to their own LEFT, their left ear/cheek (point 454) moves backward (+Z)
 * and their right ear/cheek (point 234) comes forward (-Z), resulting in a negative yaw (yaw = -thetaY < 0).
 */
export async function detectPose(imageBuffer: Buffer): Promise<{ faces: number; yaw: number }> {
  await initFaceService();

  let decoded;
  try {
    decoded = decodeImage(imageBuffer);
  } catch (err) {
    return { faces: 0, yaw: 0 };
  }

  const tensor = humanPose.tf.tidy(() => {
    const rgba = humanPose.tf.tensor3d(new Uint8Array(decoded.data), [decoded.height, decoded.width, 4], 'int32');
    const rgb = humanPose.tf.slice3d(rgba, [0, 0, 0], [-1, -1, 3]);
    const expanded = humanPose.tf.expandDims(rgb, 0);
    return humanPose.tf.cast(expanded, 'float32');
  });

  try {
    const result = await humanPose.detect(tensor);
    const faces = result.face || [];
    if (faces.length === 0) {
      return { faces: 0, yaw: 0 };
    }
    const yaw = faces[0].rotation?.angle?.yaw ?? 0;
    return { faces: faces.length, yaw };
  } finally {
    humanPose.tf.dispose(tensor);
  }
}

export async function checkFrontalFrame(imageBuffer: Buffer): Promise<{ embedding: number[]; real: number; live: number }> {
  await initFaceService();

  let decoded;
  try {
    decoded = decodeImage(imageBuffer);
  } catch (err) {
    throw new FaceError('NO_FACE', 'Failed to decode photo');
  }

  const tensor = humanFull.tf.tidy(() => {
    const rgba = humanFull.tf.tensor3d(new Uint8Array(decoded.data), [decoded.height, decoded.width, 4], 'int32');
    const rgb = humanFull.tf.slice3d(rgba, [0, 0, 0], [-1, -1, 3]);
    const expanded = humanFull.tf.expandDims(rgb, 0);
    return humanFull.tf.cast(expanded, 'float32');
  });

  try {
    const result = await humanFull.detect(tensor);
    const faces = result.face || [];

    if (faces.length === 0) {
      throw new FaceError('NO_FACE', 'No face detected in photo');
    }
    if (faces.length > 1) {
      throw new FaceError('MULTIPLE_FACES', 'Multiple faces detected in photo');
    }

    const embedding = faces[0].embedding;
    if (!embedding || embedding.length === 0) {
      throw new FaceError('NO_FACE', 'Failed to extract face embedding');
    }

    const real = faces[0].real ?? 0;
    const live = faces[0].live ?? 0;

    return { embedding: Array.from(embedding), real, live };
  } finally {
    humanFull.tf.dispose(tensor);
  }
}

export async function getEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const { embedding } = await checkFrontalFrame(imageBuffer);
  return embedding;
}

export function compareSimilarity(embedding1: number[], embedding2: number[]): number {
  return humanFull.match.similarity(embedding1, embedding2);
}

export function getMatchThreshold(): number {
  const envVal = process.env.FACE_MATCH_THRESHOLD;
  if (envVal) {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed)) return parsed;
  }
  return 0.6;
}

export function getLivenessMinScore(): number {
  const envVal = process.env.LIVENESS_MIN_SCORE;
  if (envVal) {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed)) return parsed;
  }
  return 0.5;
}
