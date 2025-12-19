import { fetchIntrinsicNames } from './api/simdAi';

let intrinsics: string[] | null = null;

export async function getIntrinsics(): Promise<string[]> {
  if (!intrinsics) {
    try {
      intrinsics = await fetchIntrinsicNames();
    } catch (err) {
      console.error("Failed to fetch intrinsics:", err);
      intrinsics = [];
    }
  }
  return intrinsics;
}

export interface SimdPrototype {
  key: string;
  inputs?: string[];
  output?: string;
  asm?: string;
  syntax?: string;
  example?: string;
  llvm_mca?: any;
}

export interface SimdFullEntry {
  key: string;
  simd?: string;
  llvm_mca?: any;
  llvm_mca_neon?: any;
  tooltip: string;
  prototypes: SimdPrototype[];
}

export const simdFullData: Record<string, SimdFullEntry> = {};