export enum RecognizedIntent {
  FILE_COMPLAINT = 'FILE_COMPLAINT',
  CHECK_STATUS = 'CHECK_STATUS',
  WHO_IS_RESPONSIBLE = 'WHO_IS_RESPONSIBLE',
  BUDGET_QUERY = 'BUDGET_QUERY',
  ESCALATE = 'ESCALATE',
  ROAD_INFO_QUERY = 'ROAD_INFO_QUERY',
  AUTHORITY_QUEUE = 'AUTHORITY_QUEUE',
  VERIFY_PROOF = 'VERIFY_PROOF',
  UNKNOWN = 'UNKNOWN'
}

export class IntentClassifier {
  /**
   * Simulates an on-device NLP router to classify user text gracefully.
   * Helps determine whether to invoke the Camera hardware, query the 
   * Gov Data Adapter, or open a standard filing form.
   */
  public classify(userMessage: string): RecognizedIntent {
    const normalized = userMessage.toLowerCase().trim();

    // VERIFY_PROOF
    if (
      normalized.includes('verify') ||
      normalized.includes('proof') ||
      normalized.includes('receipt') ||
      normalized.includes('blockchain') ||
      normalized.includes('prove it')
    ) {
      return RecognizedIntent.VERIFY_PROOF;
    }

    // CHECK_STATUS
    if (
      normalized.includes('what happened') ||
      normalized.includes('any update') ||
      normalized.includes('is it resolved') ||
      normalized.includes('check complaint') ||
      normalized.includes('status')
    ) {
      return RecognizedIntent.CHECK_STATUS;
    }

    // WHO_IS_RESPONSIBLE
    if (
      normalized.includes('who is responsible') ||
      normalized.includes('who maintains') ||
      normalized.includes('whose fault') ||
      normalized.includes('contractor name') ||
      normalized.includes('which engineer') ||
      normalized.includes('which department')
    ) {
      return RecognizedIntent.WHO_IS_RESPONSIBLE;
    }

    // BUDGET_QUERY
    if (
      normalized.includes('budget') ||
      normalized.includes('how much was spent') ||
      normalized.includes('what was spent') ||
      normalized.includes('funds sanctioned') ||
      normalized.includes('where did the money go')
    ) {
      return RecognizedIntent.BUDGET_QUERY;
    }

    // ESCALATE
    if (
      normalized.includes('escalate') ||
      normalized.includes('nothing is happening') ||
      normalized.includes('no response') ||
      normalized.includes('file rti') ||
      normalized.includes('taking too long')
    ) {
      return RecognizedIntent.ESCALATE;
    }

    // ROAD_INFO_QUERY
    if (
      normalized.includes('tell me about this road') ||
      normalized.includes('road history') ||
      normalized.includes('when was it built') ||
      normalized.includes('last repaired') ||
      normalized.includes('condition of the road')
    ) {
      return RecognizedIntent.ROAD_INFO_QUERY;
    }

    // AUTHORITY_QUEUE
    if (
      normalized.includes('my queue') ||
      normalized.includes('show complaints') ||
      normalized.includes('what needs attention') ||
      normalized.includes('sla breaches') ||
      normalized.includes('overdue complaints')
    ) {
      return RecognizedIntent.AUTHORITY_QUEUE;
    }

    if (
      normalized.includes('pothole') ||
      normalized.includes('road is broken') ||
      normalized.includes('report damage') ||
      normalized.includes('file complaint') ||
      normalized.includes('this needs to be fixed')
    ) {
      return RecognizedIntent.FILE_COMPLAINT;
    }

    if (
      normalized.includes('file') ||
      normalized.includes('report') ||
      normalized.includes('register') || 
      normalized.includes('complaint')
    ) {
      return RecognizedIntent.FILE_COMPLAINT;
    }

    return RecognizedIntent.UNKNOWN;
  }
}
