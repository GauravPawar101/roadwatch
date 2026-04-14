export interface PotholeDetectionResult {
  hasPothole: boolean;
  confidenceScore: number;
  boundingBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface IAiAgent {
  /**
   * Analyzes an image (remotely or locally) to detect road anomalies like potholes.
   */
  detectPotholes(imagePath: string): Promise<PotholeDetectionResult>;

  /**
   * Initializes the AI model (useful for loading on-device TFLite models).
   */
  initializeModel(modelPath?: string): Promise<boolean>;
}
