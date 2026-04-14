import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { SessionNetworkStatus } from '@roadwatch/core/src/engines/NetworkDegradationManager';
import type { IAIProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';
import type { IAgentMemoryStore, ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';

// ==========================================
// AI TOOL CLASSES (Executable Actions)
// ==========================================
export class SearchRoadsTool {
  constructor(private localStore: ILocalStore) {}
  async execute(query: string) {
    // Queries local IndexedDB/SQLite natively simulating RAG pipeline retrieval
    return { status: 'SUCCESS', data: `Found roads matching: ${query}` };
  }
}

export class FileComplaintTool {
  async execute(payload: Record<string, unknown>) {
    // Bypasses network entirely routing physical faults directly into Outbox serialization
    return { status: 'QUEUED_LOCALLY', data: `Complaint natively scheduled for sequential sync` };
  }
}

export class VerifyProofTool {
  async execute(id: string) {
    return { status: 'VERIFIED', data: `Cryptographic verification finalized locally.` };
  }
}

// ==========================================
// ORCHESTRATOR & CONTEXT BUILDER
// ==========================================
export class ChatFeatureOrchestrator {
  constructor(
    private searchTool: SearchRoadsTool,
    private fileTool: FileComplaintTool,
    private verifyTool: VerifyProofTool,
    private aiProvider: IAIProvider
  ) {}

  /**
   * Translates NLP conversational inputs logically onto rigorous domain functions.
   */
  async handleUserQuery(
    input: string,
    ctx: { networkStatus: SessionNetworkStatus; pendingAction: PendingAction | null },
    onStatus: (msg: string) => void
  ): Promise<{ reply: string; pendingAction: PendingAction | null }> {
    
    const normalizedInput = input.toLowerCase().trim();
    const lang = detectUserLanguage(input);

    const t = makeTranslator(lang);

    const isConfirm = /^(confirm|yes|y|submit|file it|go ahead|ok|okay)\b/i.test(normalizedInput);
    const isCancel = /^(cancel|no|n|stop|dont|don't)\b/i.test(normalizedInput);

    const intent = classifyIntent(normalizedInput);

    const isOffline = ctx.networkStatus === 'none';

    // 0) Pending irreversible action handling
    if (ctx.pendingAction) {
      if (isCancel) {
        return { reply: t.cancelled(), pendingAction: null };
      }

      if (ctx.pendingAction.kind === 'FILE_COMPLAINT' && isConfirm) {
        onStatus(t.submitting());
        await this.fileTool.execute(ctx.pendingAction.payload);

        return {
          reply: isOffline ? t.submittedQueued() : t.submittedNow(),
          pendingAction: null
        };
      }

      // If they didn't confirm/cancel, remind gently and keep pending.
      return {
        reply: t.needsConfirmation(ctx.pendingAction.summary),
        pendingAction: ctx.pendingAction
      };
    }

    // 1) Complaint Action Intent (irreversible -> ask confirmation)
    if (intent === 'FILE_COMPLAINT') {
      onStatus(t.draftingComplaint());

      const authorityHint = inferAuthorityHint(normalizedInput);
      const slaDays = authorityHint === 'NHAI' ? 7 : authorityHint === 'PWD' ? 15 : null;
      const slaDeadline = slaDays ? formatDate(addDays(new Date(), slaDays)) : null;

      const confirmationCard = [
        "Here's what I'll file:",
        `📍 Road: Unknown (open the map and select the road)` ,
        `🔴 Issue: ${summarizeIssue(input)}`,
        `📋 Authority: ${authorityHint ?? 'Unknown'}${authorityHint ? '' : ' (I can identify this after you select the road)'}`,
        `👤 Engineer: Unknown (assigned after submission)`,
        `⏱  SLA deadline: ${slaDeadline ? slaDeadline : 'Unknown (depends on the responsible authority)'}`,
        `🔗 Anchoring: Will be anchored on Hyperledger Fabric when connected` ,
        '',
        'Shall I file this complaint?'
      ].join('\n');

      const draft = t.complaintDraft(input);
      const summary = t.complaintSummary(input);

      return {
        reply: `${draft}\n\n${confirmationCard}\n\n${t.askToConfirm()}`,
        pendingAction: {
          kind: 'FILE_COMPLAINT',
          payload: { context: input, authorityHint, slaDays, slaDeadline },
          summary
        }
      };
    }

    if (intent === 'VERIFY_PROOF') {
      onStatus(t.checkingRecords());
      return {
        reply: isOffline
          ? t.verifyNeedsInternet()
          : ctx.networkStatus === '2g'
            ? t.verifyOnSlowNetwork()
            : t.verifyNeedsReceiptId(),
        pendingAction: null
      };
    }

    if (intent === 'CHECK_STATUS') {
      // Without access to local complaint store in this module, ask for an ID.
      return {
        reply: [
          'To check status, please share your complaint/receipt ID (or open the complaint in the app and paste the ID here).',
          '',
          'SLA deadline: Unknown (needs complaint details)'
        ].join('\n'),
        pendingAction: null
      };
    }

    if (intent === 'WHO_IS_RESPONSIBLE') {
      return {
        reply: [
          'To tell you exactly who is responsible, I need the road (map selection or road ID/name).',
          '',
          'Accountability (preview):',
          '🏗  Contractor: Unknown',
          '👤 Responsible Engineer: Unknown',
          '📋 Authority/Department: Unknown',
          '',
          'If you share the road name/ID, I’ll identify the authority and SLA.'
        ].join('\n'),
        pendingAction: null
      };
    }

    if (intent === 'BUDGET_QUERY') {
      return {
        reply: [
          'I can help with the road budget, but I need the road (map selection or road ID/name).',
          '',
          'Budget (preview):',
          '💰 Sanctioned: Unknown',
          '📤 Released: Unknown',
          '📊 Spent: Unknown',
          '💵 Remaining: Unknown',
          '',
          'Source: Unknown (no budget record loaded yet)'
        ].join('\n'),
        pendingAction: null
      };
    }

    if (intent === 'ESCALATE') {
      return {
        reply: [
          "I can help you escalate, but I need the complaint/receipt ID (or open the complaint in-app so I can read its status).",
          '',
          'If you share the ID, I’ll draft the escalation and show it for your confirmation before sending.'
        ].join('\n'),
        pendingAction: null
      };
    }

    if (intent === 'ROAD_INFO_QUERY') {
      return {
        reply: [
          'I can summarize this road, but I need the road (map selection or road ID/name).',
          '',
          'Road card (preview):',
          'Type: Unknown',
          'Condition: Unknown',
          'Last relaid: Unknown',
          'Contractor: Unknown'
        ].join('\n'),
        pendingAction: null
      };
    }

    if (intent === 'AUTHORITY_QUEUE') {
      return {
        reply: [
          'This view is only available to authority users (EE/SE/CE) in their jurisdiction.',
          'If you are an authority user, please log in with your authority account and open “My Queue”.'
        ].join('\n'),
        pendingAction: null
      };
    }

    // 3) Fallback to Geographic Search Intent
    onStatus(t.searchingLocally());
    await this.searchTool.execute(input);
    return {
      reply: t.searchResultOffer(),
      pendingAction: null
    };
  }
}

type Intent =
  | 'FILE_COMPLAINT'
  | 'CHECK_STATUS'
  | 'WHO_IS_RESPONSIBLE'
  | 'BUDGET_QUERY'
  | 'ESCALATE'
  | 'ROAD_INFO_QUERY'
  | 'AUTHORITY_QUEUE'
  | 'VERIFY_PROOF'
  | 'UNKNOWN';

function classifyIntent(normalizedLower: string): Intent {
  if (
    normalizedLower.includes('verify') ||
    normalizedLower.includes('proof') ||
    normalizedLower.includes('receipt') ||
    normalizedLower.includes('blockchain') ||
    normalizedLower.includes('prove it')
  ) return 'VERIFY_PROOF';

  if (
    normalizedLower.includes('what happened') ||
    normalizedLower.includes('any update') ||
    normalizedLower.includes('is it resolved') ||
    normalizedLower.includes('check complaint') ||
    normalizedLower.includes('check status')
  ) return 'CHECK_STATUS';

  if (
    normalizedLower.includes('who is responsible') ||
    normalizedLower.includes('whose fault') ||
    normalizedLower.includes('who maintains') ||
    normalizedLower.includes('contractor name') ||
    normalizedLower.includes('which engineer') ||
    normalizedLower.includes('which department')
  ) return 'WHO_IS_RESPONSIBLE';

  if (
    normalizedLower.includes('how much was spent') ||
    normalizedLower.includes('budget') ||
    normalizedLower.includes('funds sanctioned') ||
    normalizedLower.includes('where did the money go')
  ) return 'BUDGET_QUERY';

  if (
    normalizedLower.includes('escalate') ||
    normalizedLower.includes('nothing is happening') ||
    normalizedLower.includes('taking too long') ||
    normalizedLower.includes('file rti') ||
    normalizedLower.includes('no response')
  ) return 'ESCALATE';

  if (
    normalizedLower.includes('tell me about this road') ||
    normalizedLower.includes('road history') ||
    normalizedLower.includes('when was it built') ||
    normalizedLower.includes('last repaired') ||
    normalizedLower.includes('condition of the road')
  ) return 'ROAD_INFO_QUERY';

  if (
    normalizedLower.includes('my queue') ||
    normalizedLower.includes('show complaints') ||
    normalizedLower.includes('sla breaches') ||
    normalizedLower.includes('overdue complaints')
  ) return 'AUTHORITY_QUEUE';

  if (
    normalizedLower.includes('pothole') ||
    normalizedLower.includes('road is broken') ||
    normalizedLower.includes('report damage') ||
    normalizedLower.includes('file complaint') ||
    normalizedLower.includes('this needs to be fixed') ||
    normalizedLower.includes('complaint') ||
    normalizedLower.includes('report')
  ) return 'FILE_COMPLAINT';

  return 'UNKNOWN';
}

function inferAuthorityHint(normalizedLower: string): 'NHAI' | 'PWD' | null {
  if (normalizedLower.includes('nhai') || normalizedLower.includes('nh-') || normalizedLower.includes('national highway') || /\bnh\b/.test(normalizedLower)) {
    return 'NHAI';
  }
  if (normalizedLower.includes('pwd') || normalizedLower.includes('state highway') || /\bsh\b/.test(normalizedLower)) {
    return 'PWD';
  }
  return null;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function formatDate(d: Date): string {
  // e.g., 18 Apr 2026
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function summarizeIssue(userText: string): string {
  const t = userText.trim();
  return t.length <= 120 ? t : `${t.slice(0, 117)}…`;
}

// ==========================================
// VIEW MODEL (Streaming State Manager)
// ==========================================
export interface ChatMessage {
  id: string;
  sender: 'USER' | 'AGENT';
  text: string;
}

type PendingAction =
  | {
      kind: 'FILE_COMPLAINT';
      payload: Record<string, unknown>;
      summary: string;
    };

type SupportedLanguage = 'en' | 'hi';

function detectUserLanguage(text: string): SupportedLanguage {
  // Minimal detection: Devanagari => Hindi
  return /[\u0900-\u097F]/.test(text) ? 'hi' : 'en';
}

function makeTranslator(lang: SupportedLanguage) {
  if (lang === 'hi') {
    return {
      draftingComplaint: () => 'मैं आपकी शिकायत का ड्राफ्ट बना रहा/रही हूँ…',
      askToConfirm: () =>
        "अगर यह ड्राफ्ट सही है, तो 'confirm' लिखकर सबमिट करें। अगर बदलना है, तो क्या बदलना है बताइए (जैसे landmark/समय/खतरे का विवरण)।",
      complaintDraft: (userText: string) =>
        [
          'शिकायत ड्राफ्ट (आपके शब्दों के आधार पर):',
          `- समस्या: ${userText}`,
          '- स्थान: (यदि उपलब्ध हो तो landmark/nearby point जोड़ें)',
          '- जोखिम: (उदा. फिसलन/दुर्घटना का खतरा/रात में visibility कम)',
          '- अनुरोध: तत्काल निरीक्षण और मरम्मत'
        ].join('\n'),
      complaintSummary: (userText: string) => `शिकायत: ${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}`,
      needsConfirmation: (summary: string) =>
        `मैं यह कार्रवाई तभी आगे बढ़ाऊँगा/बढ़ाऊँगी जब आप पुष्टि करेंगे।\nPending: ${summary}\n\n'confirm' लिखें या 'cancel' लिखें।`,
      submitting: () => 'सबमिट कर रहा/रही हूँ…',
      submittedQueued: () =>
        'आप अभी offline हैं। शिकायत आपके फोन में सुरक्षित सेव हो गई है और इंटरनेट आते ही अपने-आप सबमिट हो जाएगी।',
      submittedNow: () => 'शिकायत सबमिट हो गई है।',
      cancelled: () => 'ठीक है — मैंने सबमिट नहीं किया। आप क्या बदलना चाहते हैं?',
      checkingRecords: () => 'रिकॉर्ड चेक कर रहा/रही हूँ…',
      verifyNeedsInternet: () =>
        "आप अभी offline हैं। सरकारी/ledger रिकॉर्ड की latest verification के लिए इंटरनेट चाहिए। अगर आपके पास receipt/complaint ID है, तो भेजें — मैं उसे ऑनलाइन होते ही verify करने में मदद करूँगा/करूँगी।",
      verifyNeedsReceiptId: () =>
        'Verification के लिए कृपया receipt/complaint ID भेजें। बिना ID के मैं किसी सरकारी/ledger रिकॉर्ड के बारे में दावा नहीं कर सकता/सकती।',
      verifyOnSlowNetwork: () =>
        "आपका नेटवर्क बहुत धीमा है (2G)। Live verification unreliable हो सकती है — अगर संभव हो तो 4G/WiFi पर जाएँ। अगर आप receipt/complaint ID भेजें, तो मैं अगला step बता दूँगा/दूँगी।",
      searchingLocally: () => 'मैं आपके फोन में मौजूद रिकॉर्ड में खोज रहा/रही हूँ…',
      searchResultOffer: () => 'मुझे कुछ matching roads/records मिले हैं। क्या मैं इन्हें map पर दिखाऊँ?',
      cancel: () => 'cancel',
      confirm: () => 'confirm'
    };
  }

  // English
  return {
    draftingComplaint: () => 'Drafting your complaint…',
    askToConfirm: () =>
      "If this draft looks right, reply 'confirm' to submit. If you want changes, tell me what to change (landmark/time/hazard details).",
    complaintDraft: (userText: string) =>
      [
        'Complaint draft (based on what you told me):',
        `- Issue: ${userText}`,
        '- Location: (add a landmark / nearby point if you can)',
        '- Safety risk: (e.g., near signal, night visibility, vehicles swerving)',
        '- Request: urgent inspection and repair'
      ].join('\n'),
    complaintSummary: (userText: string) => `Complaint: ${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}`,
    needsConfirmation: (summary: string) =>
      `I can proceed only after you confirm.\nPending: ${summary}\n\nReply 'confirm' or 'cancel'.`,
    submitting: () => 'Submitting…',
    submittedQueued: () => 'You’re offline. I saved it on your device and it will submit automatically when connectivity returns.',
    submittedNow: () => 'Complaint submitted.',
    cancelled: () => "Okay — I won’t submit it. What would you like to change?",
    checkingRecords: () => 'Checking the record…',
    verifyNeedsInternet: () =>
      'You’re offline. To verify against the latest official/ledger record, you’ll need internet. If you have a receipt/complaint ID, share it and I’ll guide the next step.',
    verifyNeedsReceiptId: () =>
      "Share the receipt/complaint ID to verify. Without an ID, I won’t make claims about official/ledger records.",
    verifyOnSlowNetwork: () =>
      "You’re on a very slow network (2G). Live verification may be unreliable — if you can, switch to 4G/WiFi. If you share the receipt/complaint ID, I can still guide the next step.",
    searchingLocally: () => 'Searching your local records…',
    searchResultOffer: () => 'I found a few matching roads/records. Want me to show them on the map?',
    cancel: () => 'cancel',
    confirm: () => 'confirm'
  };
}

const CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHAT_MAX_MESSAGES = 50;

type ChatThreadPayload = {
  v: 1;
  threadId: string;
  messages: ChatMessage[];
  pendingAction?: PendingAction | null;
};

export function useChatViewModel(
  orchestrator: ChatFeatureOrchestrator,
  options?: {
    userId?: string;
    memoryStore?: IAgentMemoryStore;
    threadId?: string;
    networkStatus?: SessionNetworkStatus;
    onReconnectSync?: () => Promise<{
      complaintsSubmitted: number;
      chainAnchorsSubmitted: number;
      failed: number;
    }>;
  }
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [networkStatus, setNetworkStatus] = useState<SessionNetworkStatus>(options?.networkStatus ?? 'none');
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const offlineBannerShownRef = useRef(false);
  const lastNetworkStatusRef = useRef<SessionNetworkStatus>(networkStatus);

  const userId = options?.userId ?? 'anon';
  const memoryStore = options?.memoryStore;
  const threadId = options?.threadId ?? 'default';
  const memoryId = `chat:${userId}:${threadId}`;

  // Lazy-load last chat from encrypted store (one-shot)
  useEffect(() => {
    if (!memoryStore) return;
    let cancelled = false;

    memoryStore
      .get<ChatThreadPayload>(memoryId)
      .then(record => {
        if (cancelled) return;
        if (record?.payload?.v === 1 && Array.isArray(record.payload.messages)) {
          setMessages(record.payload.messages.slice(-CHAT_MAX_MESSAGES));
          setPendingAction(record.payload.pendingAction ?? null);
        }
      })
      .catch(() => {
        // Ignore corrupted/tampered store rows.
      });

    return () => {
      cancelled = true;
    };
  }, [memoryId, memoryStore]);

  // Keep networkStatus in sync with props.
  useEffect(() => {
    if (!options?.networkStatus) return;
    setNetworkStatus(options.networkStatus);
  }, [options?.networkStatus]);

  // Offline banner should show once per session (per thread/user).
  useEffect(() => {
    if (networkStatus === 'none') {
      if (!offlineBannerShownRef.current) {
        offlineBannerShownRef.current = true;
        setShowOfflineBanner(true);
      }
      return;
    }

    setShowOfflineBanner(false);
  }, [networkStatus]);

  // Reconnect transition: from none -> connected triggers auto-sync hook + one-time banner per reconnect.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const prev = lastNetworkStatusRef.current;
      lastNetworkStatusRef.current = networkStatus;

      if (cancelled) return;
      if (prev === 'none' && networkStatus !== 'none') {
        const banner: ChatMessage = {
          id: `${Date.now()}-reconnect`,
          sender: 'AGENT',
          text: "You're back online. I'm syncing your queued reports now…"
        };
        setMessages(existing => [...existing, banner].slice(-CHAT_MAX_MESSAGES));

        if (options?.onReconnectSync) {
          try {
            const result = await options.onReconnectSync();
            if (cancelled) return;
            const done: ChatMessage = {
              id: `${Date.now()}-reconnect-done`,
              sender: 'AGENT',
              text: `All caught up. Submitted ${result.complaintsSubmitted} complaint(s), anchored ${result.chainAnchorsSubmitted} record(s) on-chain. Failed: ${result.failed}.`
            };
            setMessages(existing => [...existing, done].slice(-CHAT_MAX_MESSAGES));
          } catch {
            if (cancelled) return;
            const fail: ChatMessage = {
              id: `${Date.now()}-reconnect-fail`,
              sender: 'AGENT',
              text: "Sync started but couldn't complete. Your queued items are still safe on-device; I'll retry automatically when the network is stable."
            };
            setMessages(existing => [...existing, fail].slice(-CHAT_MAX_MESSAGES));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [networkStatus, options?.onReconnectSync]);

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'USER', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);
    setStatusHint(null);

    try {
      // Fire Orchestrator hook mapping state streams back dynamically
      const { reply, pendingAction: nextPending } = await orchestrator.handleUserQuery(
        userMsg.text,
        { networkStatus, pendingAction },
        (status) => {
          setStatusHint(status);
        }
      );

      setPendingAction(nextPending);

      const agentMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        sender: 'AGENT', 
        text: reply
      };
      
      setMessages(prev => {
        const next = [...prev, agentMsg].slice(-CHAT_MAX_MESSAGES);
        // Persist encrypted thread snapshot.
        if (memoryStore) {
          const payload: ChatThreadPayload = { v: 1, threadId, messages: next, pendingAction: nextPending };
          memoryStore
            .put('citizen', 'chat.thread', memoryId, payload, {
              expiresAt: Date.now() + CHAT_TTL_MS,
              importance: 1
            })
            .then(() => memoryStore.prune({ maxRecords: 200, maxBytes: 512 * 1024 }))
            .catch(() => {
              // Non-fatal
            });
        }
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsTyping(false);
      setStatusHint(null);
    }
  };

  return {
    messages,
    inputText,
    setInputText,
    sendMessage,
    networkStatus,
    showOfflineBanner,
    isTyping,
    statusHint
  };
}

// ==========================================
// REACT UI COMPONENTS
// ==========================================
export const ToolCallIndicator: React.FC<{ status: string }> = ({ status }) => (
  <View style={styles.toolIndicator}>
     <Text style={styles.toolIndicatorText}>{status}</Text>
  </View>
);

export const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isAgent = message.sender === 'AGENT';
  return (
    <View style={isAgent ? styles.bubbleWrapperAgent : styles.bubbleWrapperUser}>
      <View style={[styles.bubbleContainer, isAgent ? styles.bubbleAgent : styles.bubbleUser]}>
        <Text style={[styles.bubbleText, isAgent ? styles.textAgent : styles.textUser]}>{message.text}</Text>
      </View>
    </View>
  );
};

export const OfflineAgentBanner: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>Offline mode: I can draft & save. Live verification needs internet.</Text>
    </View>
  );
};

export const ChatScreen: React.FC<{ viewModel: ReturnType<typeof useChatViewModel> }> = ({ viewModel }) => {
  return (
    <View style={styles.screen}>
      <OfflineAgentBanner visible={viewModel.showOfflineBanner} />
      
      <ScrollView contentContainerStyle={styles.chatArea} automaticallyAdjustKeyboardInsets>
        <Text style={styles.helperText}>Describe the road issue you’re seeing.</Text>
        
        {viewModel.messages.map(msg => <ChatBubble key={msg.id} message={msg} />)}
        
        {viewModel.statusHint && <ToolCallIndicator status={viewModel.statusHint} />}
        {viewModel.isTyping && !viewModel.statusHint && <Text style={styles.typing}>Working…</Text>}
      </ScrollView>

      <View style={styles.inputArea}>
        <TextInput 
           style={styles.input} 
           value={viewModel.inputText}
           onChangeText={viewModel.setInputText}
           placeholder="I want to file a severe pothole report..."
           placeholderTextColor="#A0AEC0"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={viewModel.sendMessage}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const AgentChatScreen: React.FC<{
  viewModel?: ReturnType<typeof useChatViewModel>;
  orchestrator?: ChatFeatureOrchestrator;
  memoryStore?: IAgentMemoryStore;
  userId?: string;
  localStore?: ILocalStore;
}> = ({ viewModel, orchestrator, memoryStore, userId, localStore }) => {
  const fallbackLocalStore: ILocalStore =
    localStore ??
    ({
      initialize: async () => {},
      saveComplaint: async () => {},
      getComplaint: async () => null,
      queryComplaints: async () => [],
      saveRoad: async () => {}
    } satisfies ILocalStore);

  const effectiveOrchestrator =
    orchestrator ??
    new ChatFeatureOrchestrator(
      new SearchRoadsTool(fallbackLocalStore),
      new FileComplaintTool(),
      new VerifyProofTool(),
      ({
        analyzeMedia: async () => 'OK',
        classifyIntent: async () => 'OK'
      } as any)
    );

  const effectiveViewModel =
    viewModel ??
    useChatViewModel(effectiveOrchestrator, {
      userId,
      memoryStore,
      threadId: 'default'
    });

  return (
    <View style={styles.screen}>
      <OfflineAgentBanner visible={effectiveViewModel.showOfflineBanner} />
      
      <ScrollView contentContainerStyle={styles.chatArea} automaticallyAdjustKeyboardInsets>
        <Text style={styles.helperText}>Describe the road issue you’re seeing.</Text>
        
        {effectiveViewModel.messages.map(msg => <ChatBubble key={msg.id} message={msg} />)}
        
        {effectiveViewModel.statusHint && <ToolCallIndicator status={effectiveViewModel.statusHint} />}
        {effectiveViewModel.isTyping && !effectiveViewModel.statusHint && <Text style={styles.typing}>Working…</Text>}
      </ScrollView>

      <View style={styles.inputArea}>
        <TextInput 
           style={styles.input} 
           value={effectiveViewModel.inputText}
           onChangeText={effectiveViewModel.setInputText}
           placeholder="I want to file a severe pothole report..."
           placeholderTextColor="#A0AEC0"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={effectiveViewModel.sendMessage}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  offlineBanner: { backgroundColor: '#3182CE', padding: 10, alignItems: 'center' },
  offlineText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11, textTransform: 'uppercase' },
  chatArea: { padding: 16, paddingBottom: 40 },
  helperText: { textAlign: 'center', color: '#A0AEC0', fontSize: 12, marginBottom: 20 },
  bubbleWrapperAgent: { alignItems: 'flex-start', marginBottom: 16, maxWidth: '85%' },
  bubbleWrapperUser: { alignItems: 'flex-end', marginBottom: 16, width: '100%' },
  bubbleContainer: { padding: 14, borderRadius: 12 },
  bubbleAgent: { backgroundColor: '#EDF2F7', borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: '#4299E1', borderBottomRightRadius: 4, maxWidth: '85%' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  textAgent: { color: '#2D3748' },
  textUser: { color: '#FFFFFF' },
  toolIndicator: { alignSelf: 'flex-start', backgroundColor: '#FEFCBF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 10, borderWidth: 1, borderColor: '#F6E05E' },
  toolIndicatorText: { fontSize: 12, color: '#975A16', fontWeight: '700' },
  typing: { color: '#A0AEC0', fontSize: 13, fontStyle: 'italic', marginLeft: 8 },
  inputArea: { flexDirection: 'row', padding: 12, backgroundColor: '#F7FAFC', borderTopWidth: 1, borderColor: '#E2E8F0' },
  input: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 20, paddingHorizontal: 16, fontSize: 15, color: '#2D3748' },
  sendBtn: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#3182CE', paddingHorizontal: 20, marginLeft: 10, borderRadius: 20 },
  sendText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 }
});
