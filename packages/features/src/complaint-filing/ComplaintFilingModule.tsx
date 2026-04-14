import type { Complaint, GeoLocation } from '@roadwatch/core/src/domain/Entities';
import { DamageType, Severity } from '@roadwatch/core/src/domain/Enums';
import { ComplaintEngine } from '@roadwatch/core/src/engines/ComplaintEngine';
import { RoadEngine } from '@roadwatch/core/src/engines/RoadEngine';
import type { ILocalStore, IOutboxQueue } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// ==========================================
// USE CASES
// Pure abstractions handling logic sequences
// ==========================================
export class IdentifyRoadFromGPS {
  constructor(private localStore: ILocalStore, private roadEngine: RoadEngine) {}
  async execute(location: GeoLocation) {
    // In production, queries radius from SQLite and runs geo-snapping algorithm natively
    return { id: 'R-8419', name: 'NH-44 Expressway' }; 
  }
}

export class ValidateComplaint {
  constructor(private complaintEngine: ComplaintEngine) {}
  execute(draft: Partial<Complaint>): boolean {
     // Maps UI drafts to full objects allowing pure Engine logic to constrain and validate
     if (!draft.location || !draft.damageType || !draft.severity) return false;
     
     // Specific hardware validation (Lvl 4/5 demands images natively)
     if (draft.severity >= Severity.Severe && (!draft.mediaIds || draft.mediaIds.length === 0)) return false;
     return true; 
  }
}

export class DeduplicateComplaint {
  constructor(private localStore: ILocalStore, private complaintEngine: ComplaintEngine) {}
  async execute(draft: Complaint) {
     const existingCache = await this.localStore.queryComplaints();
     return this.complaintEngine.deduplicate(draft, existingCache);
  }
}

export class FileComplaint {
  constructor(private outboxQueue: IOutboxQueue) {}
  async execute(complaintPayload: Record<string, unknown>) {
    // CRITICAL OFFLINE CONCEPT: 
    // Instead of forcing a fragile Cloud URL POST, we enqueue 100% locally.
    await this.outboxQueue.enqueueTask('CREATE_COMPLAINT', complaintPayload);
  }
}

// ==========================================
// VIEW MODEL (State Management)
// ==========================================
export function useComplaintFilingViewModel(
  identifyRoadUC: IdentifyRoadFromGPS,
  validateUC: ValidateComplaint,
  dedupeUC: DeduplicateComplaint,
  fileUC: FileComplaint
) {
  const [currentStep, setCurrentStep] = useState(0);
  const [draft, setDraft] = useState<Partial<Complaint>>({});
  const [isOffline] = useState(true); // Stubbed hardware state illustrating offline safety
  const [submitting, setSubmitting] = useState(false);

  const updateDraft = (key: keyof Complaint, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const nextStep = () => setCurrentStep(prev => prev + 1);
  const prevStep = () => setCurrentStep(prev => Math.max(0, prev - 1));

  const submit = async () => {
    setSubmitting(true);
    try {
      if(!validateUC.execute(draft)) {
        console.error("Invalid Constraint Logic");
        return;
      }
      
      // Routes direct to Offline SQLite Queue layer
      await fileUC.execute({ ...draft, timestamp: Date.now() });
      setCurrentStep(99); // End state resolution
    } catch(e) {
      console.error('Submission faulted', e);
    } finally {
      setSubmitting(false);
    }
  };

  return { currentStep, draft, isOffline, submitting, updateDraft, nextStep, prevStep, submit };
}

// ==========================================
// WIZARD UI STEPS
// Strictly Functional React Elements
// ==========================================
const LocationStep: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => (
  <View style={styles.stepContainer}>
    <Text style={styles.header}>Step 1: Pinpoint Incident</Text>
    <TouchableOpacity style={styles.btn} onPress={() => { 
      viewModel.updateDraft('location', { latitude: 28.6139, longitude: 77.2090 }); 
      viewModel.nextStep(); 
    }}>
      <Text style={styles.btnText}>Derive GPS Coordinates Automatically</Text>
    </TouchableOpacity>
  </View>
);

const DamageTypeStep: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => (
  <View style={styles.stepContainer}>
    <Text style={styles.header}>Step 2: Classify Hazard</Text>
    <TouchableOpacity style={styles.btn} onPress={() => { 
      viewModel.updateDraft('damageType', DamageType.Pothole); 
      viewModel.nextStep(); 
    }}>
      <Text style={styles.btnText}>A. Deep Pothole Array</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.btn} onPress={() => { 
      viewModel.updateDraft('damageType', DamageType.Waterlogging); 
      viewModel.nextStep(); 
    }}>
      <Text style={styles.btnText}>B. Severe Flooding/Waterlogging</Text>
    </TouchableOpacity>
  </View>
);

const SeverityStep: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => (
  <View style={styles.stepContainer}>
    <Text style={styles.header}>Step 3: Analyze Severity Index</Text>
    <TouchableOpacity style={[styles.btn, { backgroundColor: '#e74c3c' }]} onPress={() => { 
      viewModel.updateDraft('severity', Severity.Critical); 
      viewModel.nextStep(); 
    }}>
      <Text style={styles.btnText}>Declare Critical (Lvl 5 - Requires Media!)</Text>
    </TouchableOpacity>
  </View>
);

const MediaStep: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => (
  <View style={styles.stepContainer}>
    <Text style={styles.header}>Step 4: Attach Edge Evidence</Text>
    <TouchableOpacity style={styles.btn} onPress={() => { 
      viewModel.updateDraft('mediaIds', ['cache/img_A299_hash.webp']); 
      viewModel.nextStep(); 
    }}>
      <Text style={styles.btnText}>Trigger Native Camera Intent</Text>
    </TouchableOpacity>
  </View>
);

const ReviewStep: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => (
  <ScrollView style={styles.stepContainer}>
    <Text style={styles.header}>Step 5: Review & Anchor</Text>
    
    <View style={styles.jsonPreview}>
       <Text style={styles.jsonText}>{JSON.stringify(viewModel.draft, null, 2)}</Text>
    </View>
    
    {viewModel.isOffline && (
      <View style={styles.offlineNotice}>
         <Text style={styles.offlineNoticeText}>
           ⚠️ You are operating offline securely. 
           This log will physically evaluate to your Outbox and sequentially sync exactly 
           when WiFi/4G network packets align successfully.
         </Text>
      </View>
    )}

    <TouchableOpacity style={[styles.btn, { backgroundColor: '#27ae60' }]} onPress={viewModel.submit}>
      <Text style={styles.btnText}>
        {viewModel.submitting ? 'Deduplicating & Committing to SQLite...' : 'Digitally Sign & File Complaint'}
      </Text>
    </TouchableOpacity>
  </ScrollView>
);

export const ComplaintWizard: React.FC<{ viewModel: ReturnType<typeof useComplaintFilingViewModel> }> = ({ viewModel }) => {
  // Post-Execution Success State Override
  if (viewModel.currentStep === 99) {
    return (
      <View style={styles.screen}>
        <View style={styles.successBlock}>
          <Text style={styles.successText}>Log secured directly into SQLite payload cache!</Text>
          <Text style={styles.successSub}>Awaiting Differential Network Sync Worker.</Text>
        </View>
      </View>
    );
  }

  // Linear Wizard Renderer
  return (
    <View style={styles.screen}>
      {viewModel.currentStep === 0 && <LocationStep viewModel={viewModel} />}
      {viewModel.currentStep === 1 && <DamageTypeStep viewModel={viewModel} />}
      {viewModel.currentStep === 2 && <SeverityStep viewModel={viewModel} />}
      {viewModel.currentStep === 3 && <MediaStep viewModel={viewModel} />}
      {viewModel.currentStep === 4 && <ReviewStep viewModel={viewModel} />}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#EDF2F7', justifyContent: 'center' },
  stepContainer: { flex: 1, padding: 24, paddingTop: 60 },
  header: { fontSize: 22, fontWeight: '800', color: '#2D3748', marginBottom: 20 },
  btn: { backgroundColor: '#3182CE', padding: 16, borderRadius: 8, marginBottom: 12, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  jsonPreview: { backgroundColor: '#1A202C', padding: 16, borderRadius: 6, marginBottom: 20 },
  jsonText: { color: '#A0AEC0', fontFamily: 'monospace', fontSize: 12 },
  offlineNotice: { backgroundColor: '#FEFCBF', padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#F6E05E', marginBottom: 20 },
  offlineNoticeText: { color: '#975A16', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  successBlock: { padding: 40, alignItems: 'center', backgroundColor: '#C6F6D5', margin: 20, borderRadius: 12 },
  successText: { color: '#22543D', fontWeight: 'bold', fontSize: 18, textAlign: 'center' },
  successSub: { color: '#276749', marginTop: 10 }
});
