import { AnimatePresence, motion } from 'framer-motion';
import { Bot, ChevronDown, Mic, SendHorizontal, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DashboardRole } from '../data/roadwatchDashboard';
import { useDashboardStore } from '../store/dashboardStore';

const prompts: Record<DashboardRole, string[]> = {
  citizen: ['Show my pending complaints', 'Which issues are most urgent?', 'Open escalation options'],
  contractor: ['List urgent work orders', 'Show delayed approvals', 'Summarize proof uploads'],
  authority: ['Highlight SLA breaches', 'Show fraud risks', 'Generate district summary'],
  'super-admin': ['Compare districts', 'Audit trust drops', 'Inspect policy hotspots'],
};

export default function FloatingAssistant() {
  const role = useDashboardStore((state) => state.role);
  const chatOpen = useDashboardStore((state) => state.chatOpen);
  const setChatOpen = useDashboardStore((state) => state.setChatOpen);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    Array<{ from: 'system' | 'user' | 'assistant'; text: string }>
  >([
    {
      from: 'system',
      text: 'RoadWatch assistant online. Ask for route, risk, SLA, or trust intelligence.',
    },
  ]);

  const quickPrompts = useMemo(() => prompts[role], [role]);

  function submitMessage(value = input) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: trimmed },
      {
        from: 'assistant',
        text: `I can help with ${role} workflows. For now this is an operational preview: '${trimmed}' is routed to the live dashboard context.`,
      },
    ]);
    setInput('');
  }

  return (
    /* ── Fixed anchor: bottom-right corner ── */
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '12px',
      }}
    >
      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            style={{
              width: '340px',
              maxWidth: 'calc(100vw - 48px)',
              backdropFilter: 'blur(16px)',
              background: 'rgba(12,24,38,0.92)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'linear-gradient(90deg,rgba(139,92,246,0.12),rgba(6,182,212,0.08))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'linear-gradient(45deg,#8B5CF6,#06B6D4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Bot size={16} color="white" />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#d4e4fa',
                      fontFamily: 'Inter, sans-serif',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    AI Operations Assistant
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: '#4cd7f6',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    Role-aware · {role}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '6px',
                  cursor: 'pointer',
                  color: '#c7c6ca',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* Messages */}
            <div
              style={{
                maxHeight: '280px',
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {messages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: '10px',
                    padding: '9px 12px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    fontFamily: 'Inter, sans-serif',
                    ...(msg.from === 'user'
                      ? {
                          background: 'linear-gradient(135deg,#8B5CF6,#06B6D4)',
                          color: 'white',
                          alignSelf: 'flex-end',
                          maxWidth: '85%',
                        }
                      : msg.from === 'assistant'
                      ? {
                          background: 'rgba(76,215,246,0.07)',
                          border: '1px solid rgba(76,215,246,0.15)',
                          color: '#d4e4fa',
                          maxWidth: '90%',
                        }
                      : {
                          background: 'rgba(255,255,255,0.04)',
                          color: '#c7c6ca',
                          fontStyle: 'italic',
                          fontSize: '12px',
                        }),
                  }}
                >
                  {msg.text}
                </div>
              ))}
            </div>

            {/* Quick prompts */}
            <div
              style={{
                padding: '10px 12px 4px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => submitMessage(p)}
                  style={{
                    background: 'rgba(139,92,246,0.12)',
                    border: '1px solid rgba(208,188,255,0.2)',
                    borderRadius: '8px',
                    padding: '5px 10px',
                    fontSize: '11px',
                    color: '#c4abff',
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(139,92,246,0.25)')
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(139,92,246,0.12)')
                  }
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div style={{ padding: '10px 12px 14px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '8px 10px',
                }}
              >
                <Mic size={14} color="#c7c6ca" style={{ flexShrink: 0 }} />
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitMessage()}
                  placeholder="Ask about SLA, trust, assignments..."
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#d4e4fa',
                    fontSize: '13px',
                    fontFamily: 'Inter, sans-serif',
                    minWidth: 0,
                  }}
                />
                <button
                  onClick={() => submitMessage()}
                  style={{
                    background: 'linear-gradient(45deg,#8B5CF6,#06B6D4)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <SendHorizontal size={14} color="white" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toggle button ── */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 20px',
          borderRadius: '12px',
          background: 'linear-gradient(45deg,#8B5CF6,#06B6D4)',
          border: 'none',
          cursor: 'pointer',
          color: 'white',
          fontSize: '14px',
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '-0.01em',
          boxShadow: chatOpen
            ? '0 0 0 2px rgba(76,215,246,0.4), 0 8px 24px rgba(139,92,246,0.4)'
            : '0 8px 24px rgba(139,92,246,0.3)',
          transition: 'box-shadow 0.2s, transform 0.15s',
        }}
        onMouseDown={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.96)')}
        onMouseUp={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)')}
      >
        <Bot size={16} />
        <span>RoadWatch</span>
        {chatOpen ? <X size={14} /> : <Sparkles size={14} />}
      </button>
    </div>
  );
}