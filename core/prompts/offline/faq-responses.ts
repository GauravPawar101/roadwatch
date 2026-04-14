export const FAQ_RESPONSES: Record<string, string> = {
  'how_file_complaint':
    "Tap the map, tap your road, then tap 'Report Damage.' " +
    "You can file even without internet — it will submit automatically when connected.",
  'who_responsible_nh':
    "National Highways are typically managed by NHAI (National Highways Authority of India). " +
    "For the exact authority for your road and area, open the road profile in the app.",
  'complaint_not_resolved':
    "If your complaint hasn't been resolved, check the SLA status in the app and consider escalating. " +
    "Escalation will ask for your confirmation before it is sent. If you're offline, it will queue and send when connected.",
  'what_is_blockchain_receipt':
    "A receipt/proof is a tamper-evident record that your complaint was captured with a specific hash at a specific time. " +
    "You can verify the proof integrity on your device, and when online you can verify against the latest official ledger record.",
  'budget_info':
    "Budget information may be shown from a locally cached index for offline use. " +
    "Connect to the internet to refresh and verify against the latest official record."
  // ... 50+ more entries
};

export const INTENT_FAQ_MAP: Record<string, string> = {
  'file_complaint':          'how_file_complaint',
  'check_responsibility_nh': 'who_responsible_nh',
  'complaint_ignored':       'complaint_not_resolved',
  'blockchain_explain':      'what_is_blockchain_receipt',
  'budget_question':         'budget_info',
};
