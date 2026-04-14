import { RoadType } from '@roadwatch/adapters/src/base/ICountryAdapter';
import { IndiaAdapter } from '@roadwatch/adapters/src/india/IndiaAdapter';
import { Complaint } from '@roadwatch/core/src/domain/Complaint';
import type { IAiAgent } from '@roadwatch/core/src/interfaces/IAiAgent';
import type { IDeviceHardware } from '@roadwatch/core/src/interfaces/IDeviceHardware';
import type { IStorageProvider } from '@roadwatch/core/src/interfaces/IStorageProvider';

export class ComplaintFilingUseCase {
  /**
   * Inversion of Control: The use case is entirely unaware if the hardware is React Native, 
   * Flutter, or Capacitor. It just knows it can ask for coordinates and photos.
   */
  constructor(
    private readonly deviceHardware: IDeviceHardware,
    private readonly storageProvider: IStorageProvider,
    private readonly aiAgent: IAiAgent,
    private readonly indiaAdapter: IndiaAdapter
  ) {}

  /**
   * Vertical Slice Execution: 
   * Orchestrates the entire domain flow from hardware sensors to AI evaluation,
   * persistence, and Indian government routing.
   */
  async execute(authorId: string, description: string): Promise<string> {
    // 1. Secure Device Hardware Access
    const cameraGranted = await this.deviceHardware.requestCameraPermissions();
    const locationGranted = await this.deviceHardware.requestLocationPermissions();

    if (!cameraGranted || !locationGranted) {
      throw new Error("Camera and Location permissions are required to file a complaint.");
    }

    // 2. Hardware: Fetch live GPS coordinate & Evidence Image
    console.log("Acquiring GPS lock and launching Native Camera...");
    const location = await this.deviceHardware.getCurrentLocation();
    const photo = await this.deviceHardware.capturePhoto();

    // 3. AI Agent: Run local TFLite / MLKit pothole validation
    console.log("Analyzing image via On-Device AI Pipeline...");
    const aiAnalysis = await this.aiAgent.detectPotholes(photo.imagePath);
    if (!aiAnalysis.hasPothole) {
      console.warn(`AI Warning: High probability (${((1-aiAnalysis.confidenceScore)*100).toFixed(1)}%) this image does not contain road damage.`);
    }

    // 4. Core Domain: Create strictly validated entity
    const complaintId = `COMP-${Date.now()}`;
    const roadId = "UNKNOWN_ROAD"; // Would ordinarily be resolved via MapProvider reverse geocoding
    
    // If coordinates fail Indian Bounding Box validation, this throws immediately before hitting DB
    const newComplaint = Complaint.create(
      complaintId,
      roadId,
      authorId,
      description,
      location,
      [photo.imageHash]
    );

    // 5. Persistence: Offline-first Storage
    console.log("Saving complaint to Local Database (Offline-First mode)...");
    await this.storageProvider.createComplaint(newComplaint);

    // 6. Adapters: Route to correct NHAI or State specific authorities
    // (This adapter currently exposes formatting + hierarchy; actual network dispatch is out-of-scope here.)
    const formattedRoadId = this.indiaAdapter.formatRoadId(newComplaint.roadId);
    const hierarchy = this.indiaAdapter.getAuthorityHierarchy(RoadType.NH);
    const routingStatus = `Routed ${formattedRoadId} to ${hierarchy[0] ?? 'UNKNOWN_AUTHORITY'}`;

    return `Success. Complaint ${newComplaint.id} secured internally. ${routingStatus}`;
  }
}
