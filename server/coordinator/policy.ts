/**
 * Phase 2.3.1: Central Resource Compatibility Policy
 * 
 * Enforces conservative admission rules across local workloads.
 * In this initial phase, all four resource types (LLM, SDXL, CPU_VIDEO_RENDER, AUDIO_PROCESSING)
 * are strictly serialized and mutually exclusive with every other resource and with themselves.
 */

import type { ResourceType } from './types.js';

/**
 * Explicit, centralized compatibility matrix.
 * Maps each candidate ResourceType to the set of ResourceTypes it can safely coexist with.
 * An empty set indicates strict mutual exclusivity with all concurrent resources.
 */
export const COMPATIBILITY_MATRIX: Readonly<Record<ResourceType, ReadonlySet<ResourceType>>> = {
  LLM: new Set<ResourceType>([]), // Serialized: no concurrent LLM, SDXL, RENDER, or AUDIO
  SDXL: new Set<ResourceType>([]), // Exclusive: no concurrent workload of any type
  CPU_VIDEO_RENDER: new Set<ResourceType>([]), // Serialized & exclusive initially
  AUDIO_PROCESSING: new Set<ResourceType>([]), // Serialized & exclusive initially
};

export class ResourceCompatibilityPolicy {
  /**
   * Centralized admission evaluator.
   * Returns true if and only if candidate resource can coexist with all currently active resources.
   */
  public static canAdmit(
    candidate: ResourceType,
    activeResources: ReadonlyArray<ResourceType>
  ): boolean {
    if (activeResources.length === 0) {
      return true;
    }

    const allowedConcurrent = COMPATIBILITY_MATRIX[candidate];
    if (!allowedConcurrent || allowedConcurrent.size === 0) {
      return false;
    }

    return activeResources.every((active) => allowedConcurrent.has(active));
  }

  /**
   * Type predicate confirming valid resource identifier.
   */
  public static isValidResourceType(type: string): type is ResourceType {
    return (
      type === 'LLM' ||
      type === 'SDXL' ||
      type === 'CPU_VIDEO_RENDER' ||
      type === 'AUDIO_PROCESSING'
    );
  }
}
